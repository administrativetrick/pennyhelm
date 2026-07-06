/**
 * Self-host authentication (issue #10) — unit tests for selfhost-auth.js.
 * Uses an in-memory SQLite store; no network, no Express server.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const createSelfhostAuth = require('../selfhost-auth.js');

function makeDb() {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))`);
    return db;
}

function mockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; },
        setHeader(k, v) { this.headers[k] = v; },
    };
    return res;
}

function reqWithCookie(token) {
    return { headers: token ? { cookie: `ph_session=${token}` } : {}, socket: { remoteAddress: '10.0.0.9' } };
}

describe('selfhost-auth: password hashing', () => {
    const auth = createSelfhostAuth(makeDb(), { disabled: false });
    const { hashPassword, verifyPassword } = auth._internals;

    test('correct password verifies; wrong password does not', () => {
        const cfg = hashPassword('hunter2hunter2');
        assert.equal(verifyPassword('hunter2hunter2', cfg), true);
        assert.equal(verifyPassword('hunter2hunter3', cfg), false);
        assert.equal(verifyPassword('', cfg), false);
        assert.equal(verifyPassword(undefined, cfg), false);
    });

    test('same password hashes differently per salt', () => {
        const a = hashPassword('correct horse battery');
        const b = hashPassword('correct horse battery');
        assert.notEqual(a.hash, b.hash);
        assert.notEqual(a.salt, b.salt);
    });
});

describe('selfhost-auth: sessions', () => {
    const auth = createSelfhostAuth(makeDb(), { disabled: false });
    const { signSession, verifySession } = auth._internals;
    const cfg = { secret: 'a'.repeat(64) };

    test('valid session verifies', () => {
        assert.equal(verifySession(signSession(cfg), cfg), true);
    });

    test('expired session rejected', () => {
        assert.equal(verifySession(signSession(cfg, Date.now() - 1000), cfg), false);
    });

    test('tampered payload rejected', () => {
        const token = signSession(cfg);
        const [payload, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
        const forged = `${Number(payload) + 999999}.${sig}`;
        assert.equal(verifySession(forged, cfg), false);
    });

    test('token signed with a different secret rejected (password change rotates secret)', () => {
        const token = signSession(cfg);
        assert.equal(verifySession(token, { secret: 'b'.repeat(64) }), false);
    });

    test('garbage tokens rejected', () => {
        assert.equal(verifySession('', cfg), false);
        assert.equal(verifySession('no-dot', cfg), false);
        assert.equal(verifySession(null, cfg), false);
    });
});

describe('selfhost-auth: middleware', () => {
    test('unconfigured install blocks with SETUP_REQUIRED', () => {
        const auth = createSelfhostAuth(makeDb(), { disabled: false });
        const res = mockRes();
        let passed = false;
        auth.requireSelfhostAuth(reqWithCookie(null), res, () => { passed = true; });
        assert.equal(passed, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.code, 'SETUP_REQUIRED');
    });

    test('configured install blocks without a session, passes with one', () => {
        const db = makeDb();
        const auth = createSelfhostAuth(db, { disabled: false });
        // configure via the setup route handler logic: store config directly
        const { hashPassword, signSession, loadConfig } = auth._internals;
        const { salt, hash } = hashPassword('a strong password');
        db.prepare(`INSERT INTO store (key, value) VALUES ('selfhost-auth', ?)`)
            .run(JSON.stringify({ salt, hash, secret: 'c'.repeat(64) }));

        const resNo = mockRes();
        let passedNo = false;
        auth.requireSelfhostAuth(reqWithCookie(null), resNo, () => { passedNo = true; });
        assert.equal(passedNo, false);
        assert.equal(resNo.body.code, 'AUTH_REQUIRED');

        const token = signSession(loadConfig());
        const resYes = mockRes();
        let passedYes = false;
        auth.requireSelfhostAuth(reqWithCookie(token), resYes, () => { passedYes = true; });
        assert.equal(passedYes, true);
    });

    test('disabled mode passes everything through', () => {
        const auth = createSelfhostAuth(makeDb(), { disabled: true });
        let passed = false;
        auth.requireSelfhostAuth(reqWithCookie(null), mockRes(), () => { passed = true; });
        assert.equal(passed, true);
        assert.equal(auth.disabled, true);
    });
});

describe('selfhost-auth: login throttle', () => {
    test('locks out after repeated failures, then expires', () => {
        const auth = createSelfhostAuth(makeDb(), { disabled: false });
        const { isThrottled, recordFailure } = auth._internals;
        const now = Date.now();
        const ip = '192.168.0.66';
        for (let i = 0; i < 4; i++) recordFailure(ip, now);
        assert.equal(isThrottled(ip, now), false, 'not locked before the 5th failure');
        recordFailure(ip, now);
        assert.equal(isThrottled(ip, now), true, 'locked after the 5th failure');
        assert.equal(isThrottled(ip, now + 61 * 1000), false, 'lock expires after 60s');
        assert.equal(isThrottled('10.9.9.9', now), false, 'other IPs unaffected');
    });
});
