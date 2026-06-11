#!/usr/bin/env node
/**
 * cleanup-bot-users.js — find (and optionally delete) likely bot signups.
 *
 * A "likely bot" = an Auth user with NO meaningful userData/{uid} document
 * (never saved any finances), is NOT an admin, and is NOT allowlisted.
 *
 * DRY RUN BY DEFAULT — prints a table and writes nothing:
 *   node scripts/cleanup-bot-users.js
 *
 * Delete the listed accounts (and their leftover Firestore docs):
 *   node scripts/cleanup-bot-users.js --delete --yes
 *
 * Protect specific addresses (besides admins, who are always protected):
 *   node scripts/cleanup-bot-users.js --allow you@example.com,test@test.com
 *
 * Requires firebase-service-account.json in the repo root (gitignored).
 * No email addresses are hardcoded (this repo is public/AGPL).
 */

const path = require("path");

// Resolve firebase-admin from root or, failing that, from functions/.
let admin;
try {
    admin = require("firebase-admin");
} catch (_) {
    admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
}

const serviceAccount = require(path.join(__dirname, "..", "firebase-service-account.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const auth = admin.auth();

const DELETE = process.argv.includes("--delete");
const CONFIRM = process.argv.includes("--yes");
const allowArg = process.argv[process.argv.indexOf("--allow") + 1] || "";
const ALLOWLIST = new Set(
    process.argv.includes("--allow")
        ? allowArg.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
        : []
);

async function listAllUsers() {
    const users = [];
    let pageToken;
    do {
        const res = await auth.listUsers(1000, pageToken);
        users.push(...res.users);
        pageToken = res.pageToken;
    } while (pageToken);
    return users;
}

async function hasRealData(uid) {
    const snap = await db.collection("userData").doc(uid).get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    // userData stores the finance blob as a JSON string; treat tiny/empty as none.
    const raw = typeof d.data === "string" ? d.data : JSON.stringify(d);
    return Boolean(raw) && raw.length > 60;
}

(async () => {
    const users = await listAllUsers();
    const candidates = [];

    for (const u of users) {
        const email = (u.email || "").toLowerCase();
        if (email && ALLOWLIST.has(email)) continue;
        if (u.customClaims && u.customClaims.admin) continue; // never touch admins
        if (await hasRealData(u.uid)) continue;

        candidates.push({
            uid: u.uid,
            email: u.email || "(none)",
            provider: (u.providerData[0] && u.providerData[0].providerId) || "?",
            created: u.metadata.creationTime,
            lastSignIn: u.metadata.lastSignInTime,
        });
    }

    console.log(`\nTotal auth users:                 ${users.length}`);
    console.log(`Likely bots (no saved finances):  ${candidates.length}\n`);
    console.table(candidates);

    if (!DELETE) {
        console.log("\nDRY RUN — nothing deleted. Re-run with --delete --yes to remove the above.\n");
        process.exit(0);
    }
    if (!CONFIRM) {
        console.log("\nRefusing to delete without --yes. Aborting.\n");
        process.exit(1);
    }

    const uids = candidates.map((c) => c.uid);
    for (let i = 0; i < uids.length; i += 1000) {
        const res = await auth.deleteUsers(uids.slice(i, i + 1000));
        console.log(`Auth delete: ${res.successCount} ok, ${res.failureCount} failed`);
    }
    for (const uid of uids) {
        await db.collection("users").doc(uid).delete().catch(() => {});
        await db.collection("userData").doc(uid).delete().catch(() => {});
    }
    console.log("\nDone.\n");
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
