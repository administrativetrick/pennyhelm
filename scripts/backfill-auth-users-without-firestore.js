/**
 * backfill-auth-users-without-firestore.js
 *
 * Finds every Firebase Auth user that has NO corresponding users/{uid}
 * document in Firestore, and creates the missing doc with the same shape
 * registerUser() in js/login.js writes at normal signup.
 *
 * Why this exists: a race condition in js/login.js shipped a long time.
 * For Google and email *sign-ups* (not sign-ins), `isLoggingIn = true`
 * was never set, so onAuthStateChanged could fire and navigate the tab
 * to /app before the Firestore write in registerUser() completed —
 * stranding the user with an Auth account but no Firestore doc. Errors
 * were swallowed by a try/catch that only console.error'd, so the
 * failure was silent on both client and server.
 *
 * How it differs from scripts/fix-missing-users.js:
 *   - fix-missing-users.js iterates `userData` docs → only catches users
 *     who got part-way through signup (doc in userData but none in users).
 *   - This script iterates Firebase Auth → catches users who got NOTHING
 *     written to Firestore at all (Tom Walker's case).
 *
 * Trial clock accuracy: uses the Auth user's metadata.creationTime for
 * both trialStartDate and createdAt, NOT serverTimestamp. That preserves
 * the original 30-day trial window rather than restarting it from today.
 *
 * Safe to re-run: skips users who already have a users/{uid} doc.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Service-account JSON is gitignored, so it may live in the main worktree
// rather than the per-branch worktree this script is running from. Try the
// local dir first (normal case), then the main repo two levels up
// (when running from .claude/worktrees/<branch>/).
function resolveServiceAccount() {
    const candidates = [
        path.join(__dirname, '..', 'firebase-service-account.json'),
        path.join(__dirname, '..', '..', '..', '..', 'firebase-service-account.json'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error(
        'firebase-service-account.json not found. Looked in:\n  ' +
            candidates.join('\n  ')
    );
}

const serviceAccount = require(resolveServiceAccount());

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Matches generateReferralCode() in js/login.js — same alphabet, same length,
// so backfilled users are indistinguishable from normal signups downstream.
function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let code = 'REF-';
    for (let i = 0; i < 7; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function listAllAuthUsers() {
    const users = [];
    let pageToken = undefined;
    do {
        // 1000 is the max page size allowed by admin.auth().listUsers.
        const res = await admin.auth().listUsers(1000, pageToken);
        users.push(...res.users);
        pageToken = res.pageToken;
    } while (pageToken);
    return users;
}

async function existingUsersDocIds() {
    const snap = await db.collection('users').get();
    return new Set(snap.docs.map((d) => d.id));
}

async function backfill() {
    console.log('Listing all Firebase Auth users...');
    const authUsers = await listAllAuthUsers();
    console.log(`  → ${authUsers.length} Auth users\n`);

    console.log('Listing all users/{uid} Firestore docs...');
    const existingIds = await existingUsersDocIds();
    console.log(`  → ${existingIds.size} Firestore docs\n`);

    const orphans = authUsers.filter((u) => !existingIds.has(u.uid));

    if (orphans.length === 0) {
        console.log('✓ No orphaned Auth users. Every Auth user has a Firestore doc.');
        return;
    }

    console.log(`Found ${orphans.length} Auth user(s) with no Firestore doc:\n`);
    orphans.forEach((u) => {
        const providers = u.providerData.map((p) => p.providerId).join(', ') || 'password';
        console.log(`  • ${u.uid}  ${u.email || '(no email)'}  via ${providers}  created ${u.metadata.creationTime}`);
    });
    console.log('');

    for (const user of orphans) {
        // Preserve the original signup moment so the 30-day trial clock
        // reflects when the user actually tried to sign up, not today.
        const creationDate = user.metadata.creationTime
            ? new Date(user.metadata.creationTime)
            : new Date();
        const creationTimestamp = admin.firestore.Timestamp.fromDate(creationDate);

        const doc = {
            email: user.email || '',
            displayName: user.displayName || '',
            subscriptionStatus: 'trial',
            trialStartDate: creationTimestamp,
            createdAt: creationTimestamp,
            referralCode: generateReferralCode(),
            paidReferralCount: 0,
            // Marker so we can audit later which docs were backfilled vs
            // created by the normal signup flow.
            backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
            backfillReason: 'signup-race-condition-recovery',
        };

        console.log(`Writing users/${user.uid}  (${user.email})...`);
        await db.collection('users').doc(user.uid).set(doc);
        console.log(`  ✓ trialStartDate = ${creationDate.toISOString()}`);
    }

    console.log(`\n✓ Backfilled ${orphans.length} user doc(s).`);
}

backfill().catch((err) => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
});
