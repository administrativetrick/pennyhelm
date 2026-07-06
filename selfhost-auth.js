/**
 * Self-host authentication (issue #10).
 *
 * Password-protects a self-hosted PennyHelm so data is NOT readable by
 * anyone who can reach the IP:port (LAN, Docker port-mapping, etc).
 *
 * Design constraints: zero new dependencies (node:crypto only), zero
 * config for the happy path (first visit sets the password), and safe
 * upgrades (existing installs see the setup screen on next load; their
 * data is blocked from the API until a password exists).
 *
 *  - Password storage: scrypt (N=16384 default), random 16-byte salt,
 *    stored in the existing SQLite `store` table under 'selfhost-auth'.
 *  - Sessions: stateless `expiresAtMs.hmacSha256(secret, expiresAtMs)`
 *    tokens in an HttpOnly SameSite=Strict cookie, 30-day expiry.
 *    Changing the password rotates the secret → all sessions invalidate.
 *  - Brute force: per-IP throttle (5 failures → 60s lockout).
 *  - Escape hatch: PENNYHELM_DISABLE_AUTH=1 skips all of it (e.g. auth
 *    handled by a reverse proxy) — the app shows a prominent warning.
 */

const crypto = require('crypto');
const express = require('express');

const AUTH_KEY = 'selfhost-auth';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'ph_session';
const MIN_PASSWORD_LENGTH = 8;
const THROTTLE_MAX_FAILURES = 5;
const THROTTLE_LOCKOUT_MS = 60 * 1000;

function createSelfhostAuth(db, options = {}) {
    const disabled = options.disabled !== undefined
        ? options.disabled
        : process.env.PENNYHELM_DISABLE_AUTH === '1';

    const getStmt = db.prepare('SELECT value FROM store WHERE key = ?');
    const upsertStmt = db.prepare(`
        INSERT INTO store (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);

    function loadConfig() {
        const row = getStmt.get(AUTH_KEY);
        if (!row) return null;
        try { return JSON.parse(row.value); } catch (e) { return null; }
    }
    function saveConfig(cfg) {
        upsertStmt.run(AUTH_KEY, JSON.stringify(cfg));
    }
    function isConfigured() {
        return loadConfig() !== null;
    }

    // ── Password hashing (scrypt, timing-safe compare) ──
    function hashPassword(password, salt = crypto.randomBytes(16)) {
        const hash = crypto.scryptSync(password, salt, 64);
        return { salt: salt.toString('hex'), hash: hash.toString('hex') };
    }
    function verifyPassword(password, cfg) {
        if (!cfg || typeof password !== 'string') return false;
        const candidate = crypto.scryptSync(password, Buffer.from(cfg.salt, 'hex'), 64);
        const stored = Buffer.from(cfg.hash, 'hex');
        return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
    }

    // ── Stateless sessions ──
    function signSession(cfg, expiresAt = Date.now() + SESSION_TTL_MS) {
        const payload = String(expiresAt);
        const sig = crypto.createHmac('sha256', cfg.secret).update(payload).digest('hex');
        return `${payload}.${sig}`;
    }
    function verifySession(token, cfg) {
        if (!token || !cfg || !cfg.secret) return false;
        const idx = token.lastIndexOf('.');
        if (idx === -1) return false;
        const payload = token.slice(0, idx);
        const sig = token.slice(idx + 1);
        const expected = crypto.createHmac('sha256', cfg.secret).update(payload).digest('hex');
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
        const expiresAt = Number(payload);
        return Number.isFinite(expiresAt) && expiresAt > Date.now();
    }

    function getSessionFromRequest(req) {
        const header = req.headers.cookie || '';
        for (const part of header.split(';')) {
            const eq = part.indexOf('=');
            if (eq === -1) continue;
            if (part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
        }
        return null;
    }
    function setSessionCookie(res, token) {
        res.setHeader('Set-Cookie',
            `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    }
    function clearSessionCookie(res) {
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    }

    // ── Per-IP login throttle ──
    const failures = new Map(); // ip -> { count, lockedUntil }
    function isThrottled(ip, now = Date.now()) {
        const f = failures.get(ip);
        return !!(f && f.lockedUntil && f.lockedUntil > now);
    }
    function recordFailure(ip, now = Date.now()) {
        const f = failures.get(ip) || { count: 0, lockedUntil: 0 };
        f.count += 1;
        if (f.count >= THROTTLE_MAX_FAILURES) {
            f.lockedUntil = now + THROTTLE_LOCKOUT_MS;
            f.count = 0;
        }
        failures.set(ip, f);
    }
    function clearFailures(ip) {
        failures.delete(ip);
    }

    // ── Middleware ──
    function requireSelfhostAuth(req, res, next) {
        if (disabled) return next();
        const cfg = loadConfig();
        if (!cfg) {
            return res.status(401).json({ error: 'Set a password to protect this PennyHelm', code: 'SETUP_REQUIRED' });
        }
        if (verifySession(getSessionFromRequest(req), cfg)) return next();
        return res.status(401).json({ error: 'Not signed in', code: 'AUTH_REQUIRED' });
    }

    // ── Routes ──
    const router = express.Router();

    router.get('/setup-status', (req, res) => {
        res.json({ configured: isConfigured(), authDisabled: disabled });
    });

    router.post('/setup', (req, res) => {
        if (disabled) return res.status(400).json({ error: 'Authentication is disabled (PENNYHELM_DISABLE_AUTH=1)' });
        if (isConfigured()) return res.status(403).json({ error: 'A password is already set' });
        const { password } = req.body || {};
        if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        const { salt, hash } = hashPassword(password);
        const cfg = { salt, hash, secret: crypto.randomBytes(32).toString('hex'), createdAt: new Date().toISOString() };
        saveConfig(cfg);
        setSessionCookie(res, signSession(cfg));
        res.json({ ok: true });
    });

    router.post('/login', (req, res) => {
        if (disabled) return res.status(400).json({ error: 'Authentication is disabled' });
        const cfg = loadConfig();
        if (!cfg) return res.status(400).json({ error: 'Setup required', code: 'SETUP_REQUIRED' });
        const ip = req.socket.remoteAddress || 'unknown';
        if (isThrottled(ip)) {
            return res.status(429).json({ error: 'Too many attempts — wait a minute and try again' });
        }
        const { password } = req.body || {};
        if (!verifyPassword(password, cfg)) {
            recordFailure(ip);
            return res.status(401).json({ error: 'Wrong password' });
        }
        clearFailures(ip);
        setSessionCookie(res, signSession(cfg));
        res.json({ ok: true });
    });

    router.post('/logout', (req, res) => {
        clearSessionCookie(res);
        res.json({ ok: true });
    });

    router.post('/change-password', requireSelfhostAuth, (req, res) => {
        if (disabled) return res.status(400).json({ error: 'Authentication is disabled' });
        const cfg = loadConfig();
        const { currentPassword, newPassword } = req.body || {};
        if (!verifyPassword(currentPassword, cfg)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        const { salt, hash } = hashPassword(newPassword);
        // Rotating the secret invalidates every other session.
        const next = { ...cfg, salt, hash, secret: crypto.randomBytes(32).toString('hex'), changedAt: new Date().toISOString() };
        saveConfig(next);
        setSessionCookie(res, signSession(next));
        res.json({ ok: true });
    });

    return {
        disabled,
        isConfigured,
        requireSelfhostAuth,
        router,
        // Exposed for unit tests only.
        _internals: { hashPassword, verifyPassword, signSession, verifySession, loadConfig, isThrottled, recordFailure, clearFailures },
    };
}

module.exports = createSelfhostAuth;
