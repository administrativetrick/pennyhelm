const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 8081;
const MODE = process.env.PENNYHELM_MODE || 'selfhost'; // 'selfhost' or 'cloud'

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(dataDir, 'finances.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        trial_start_date TEXT NOT NULL DEFAULT (datetime('now')),
        subscription_status TEXT NOT NULL DEFAULT 'trial',
        created_at TEXT DEFAULT (datetime('now'))
    )
`);

// Prepared statements
const getStmt = db.prepare('SELECT value FROM store WHERE key = ?');
const upsertStmt = db.prepare(`
    INSERT INTO store (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);

// User statements
const getUserStmt = db.prepare('SELECT * FROM users WHERE uid = ?');
const createUserStmt = db.prepare(`
    INSERT OR IGNORE INTO users (uid, email, display_name, trial_start_date, subscription_status)
    VALUES (?, ?, ?, datetime('now'), 'trial')
`);
const updateUserStatusStmt = db.prepare(
    'UPDATE users SET subscription_status = ? WHERE uid = ?'
);

// ===== Firebase Admin SDK (Cloud mode only) =====
let firebaseAdmin = null;
if (MODE === 'cloud') {
    try {
        firebaseAdmin = require('firebase-admin');
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
            || path.join(__dirname, 'firebase-service-account.json');
        if (fs.existsSync(serviceAccountPath)) {
            firebaseAdmin.initializeApp({
                credential: firebaseAdmin.credential.cert(
                    JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
                )
            });
            console.log('Firebase Admin initialized with service account');
        } else {
            try {
                firebaseAdmin.initializeApp();
                console.log('Firebase Admin initialized with default credentials');
            } catch (e) {
                console.warn('Firebase Admin: No service account found. Auth verification will fail.');
                console.warn('Place firebase-service-account.json in project root or set FIREBASE_SERVICE_ACCOUNT env var.');
            }
        }
    } catch (e) {
        console.error('Failed to load firebase-admin. Run: npm install firebase-admin');
        console.error(e.message);
    }
}

// ===== Auth Middleware =====
async function requireAuth(req, res, next) {
    if (MODE === 'selfhost') {
        req.userId = 'local';
        req.subscriptionStatus = 'active';
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization header' });
    }

    if (!firebaseAdmin) {
        return res.status(500).json({ error: 'Firebase Admin not initialized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
        req.userId = decodedToken.uid;
        req.userEmail = decodedToken.email;

        // Check trial/subscription status
        const user = getUserStmt.get(req.userId);
        if (user) {
            req.subscriptionStatus = user.subscription_status;
            // Check trial expiry (30 days)
            if (user.subscription_status === 'trial') {
                const trialStart = new Date(user.trial_start_date + 'Z');
                const daysSinceStart = (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceStart > 30) {
                    updateUserStatusStmt.run('expired', req.userId);
                    req.subscriptionStatus = 'expired';
                }
            }
        } else {
            req.subscriptionStatus = 'new';
        }

        next();
    } catch (error) {
        console.error('Auth verification failed:', error.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ===== Active Subscription Middleware =====
function requireActiveSubscription(req, res, next) {
    if (MODE === 'selfhost') return next();
    if (req.subscriptionStatus === 'expired') {
        return res.status(403).json({
            error: 'Trial expired',
            code: 'TRIAL_EXPIRED',
            message: 'Your 30-day trial has expired. Please subscribe to continue.'
        });
    }
    next();
}

// ===== Middleware =====
app.use(express.json({ limit: '5mb' }));

// ===== Public API Routes =====

// Health check — used by Docker HEALTHCHECK, load balancers, and uptime monitors.
// Returns 200 only if the Express process is up AND SQLite responds to a ping.
// Intentionally unauthenticated and cheap — do not add auth, DB writes, or
// anything that could make a legitimate health check fail under load.
app.get('/health', (req, res) => {
    try {
        // Lightweight SQLite round-trip. SELECT 1 is cached and effectively free.
        db.prepare('SELECT 1').get();
        res.status(200).json({
            status: 'ok',
            mode: MODE,
            uptime: process.uptime(),
        });
    } catch (e) {
        res.status(503).json({ status: 'degraded', error: 'database unreachable' });
    }
});

// Config endpoint (public — tells the client what mode we're in)
app.get('/api/config', (req, res) => {
    res.json({ mode: MODE, appName: 'PennyHelm' });
});

// ===== Plaid (selfhost only — cloud mode uses Firebase Cloud Functions) =====
if (MODE === 'selfhost') {
    try {
        const createPlaidRouter = require('./plaid-service');
        app.use('/api/plaid', createPlaidRouter(db));
        console.log('Plaid routes mounted at /api/plaid');
    } catch (e) {
        console.warn('Plaid routes not mounted:', e.message);
        console.warn('Run `npm install` to enable Plaid support.');
    }
}

// ===== Auth Routes =====

// Register a new user (called after Firebase signup)
app.post('/api/auth/register', requireAuth, (req, res) => {
    if (MODE === 'selfhost') return res.json({ ok: true, status: 'active' });

    const { email, displayName } = req.body;
    createUserStmt.run(req.userId, email || req.userEmail || '', displayName || '');
    res.json({ ok: true, status: 'trial' });
});

// Check auth/subscription status
app.get('/api/auth/status', requireAuth, (req, res) => {
    if (MODE === 'selfhost') {
        return res.json({ mode: 'selfhost', status: 'active' });
    }

    const user = getUserStmt.get(req.userId);
    if (!user) {
        return res.json({
            mode: 'cloud',
            status: 'new',
            trialDaysRemaining: 30,
            email: req.userEmail
        });
    }

    const trialStart = new Date(user.trial_start_date + 'Z');
    const trialDaysRemaining = Math.max(0, 30 - Math.floor(
        (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
    ));

    res.json({
        mode: 'cloud',
        status: user.subscription_status,
        trialDaysRemaining,
        email: user.email,
        displayName: user.display_name
    });
});

// ===== Data API (auth-protected, user-scoped) =====
app.get('/api/data', requireAuth, requireActiveSubscription, (req, res) => {
    try {
        const key = MODE === 'cloud' ? `data:${req.userId}` : 'data';
        const row = getStmt.get(key);
        if (row) {
            res.type('json').send(row.value);
        } else {
            res.json(null);
        }
    } catch (err) {
        console.error('Error reading data:', err);
        res.status(500).json({ error: 'Failed to read data' });
    }
});

app.post('/api/data', requireAuth, requireActiveSubscription, (req, res) => {
    try {
        const key = MODE === 'cloud' ? `data:${req.userId}` : 'data';
        const jsonStr = JSON.stringify(req.body);
        upsertStmt.run(key, jsonStr);
        res.json({ ok: true });
    } catch (err) {
        console.error('Error saving data:', err);
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// ===== Page Routes =====

// Landing page
app.get('/', (req, res) => {
    if (MODE === 'selfhost') {
        return res.redirect('/app');
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Login page
app.get('/login', (req, res) => {
    if (MODE === 'selfhost') {
        return res.redirect('/app');
    }
    res.sendFile(path.join(__dirname, 'login.html'));
});

// SPA app route (before static middleware to avoid index.html being served)
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/app/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

// Static file serving — block access to sensitive files
app.use((req, res, next) => {
    const blocked = ['/server.js', '/package.json', '/package-lock.json',
        '/firebase-service-account.json', '/firebase.json', '/.firebaserc',
        '/firestore.rules', '/firestore.indexes.json', '/auth_export.json'];
    const lower = req.path.toLowerCase();
    if (blocked.includes(lower) || lower.startsWith('/data/') || lower.startsWith('/scripts/') ||
        lower.startsWith('/functions/') || lower.startsWith('/node_modules/') || lower.startsWith('/.')) {
        return res.status(404).send('Not found');
    }
    next();
});
app.use(express.static(__dirname));

// General fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});

// In selfhost mode, bind to localhost only for security — unless the caller
// sets HOST (e.g. the Docker image sets HOST=0.0.0.0 so port mapping works).
const HOST = process.env.HOST || (MODE === 'selfhost' ? '127.0.0.1' : '0.0.0.0');
app.listen(PORT, HOST, () => {
    console.log(`PennyHelm (${MODE} mode) running at http://${HOST}:${PORT}`);
    console.log(`Database: ${dbPath}`);
});
