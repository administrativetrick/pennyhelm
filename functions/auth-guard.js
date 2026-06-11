/**
 * auth-guard.js — Bot-signup defense via a `beforeUserCreated` blocking function.
 *
 * WHY THIS INSTEAD OF APP CHECK
 *   The mobile app uses the Firebase JS SDK, whose App Check only works through
 *   reCAPTCHA (a browser/DOM feature React Native does not have). We therefore
 *   cannot enforce App Check on Auth/Firestore without locking the mobile app
 *   out. A blocking function runs server-side at account-creation time, needs no
 *   App Check token, and is client-agnostic — so it does NOT break the JS-SDK
 *   mobile client. It runs ONLY on user creation, so existing users signing in
 *   (web or mobile) are never affected.
 *
 * SAFETY / ROLLOUT — read before arming
 *   1. Requires Identity Platform (GCIP) enabled on the project. Until it is,
 *      DO NOT wire this into index.js: deploying an identity trigger without
 *      Identity Platform fails the ENTIRE functions deploy. That is why this
 *      module is intentionally NOT required from index.js yet.
 *   2. Ships in LOG-ONLY mode. With AUTH_GUARD_MODE unset or "log" it never
 *      blocks anyone — it only logs what it WOULD have blocked. Watch the logs
 *      for a few days, confirm zero false positives on real signups, then set
 *      AUTH_GUARD_MODE="enforce" to actually start rejecting.
 *   3. Never blocks an allowlisted email (set AUTH_GUARD_ALLOWLIST_EMAILS to a
 *      comma-separated list — keep your own addresses there so you can never be
 *      locked out). No email is hardcoded (this repo is public/AGPL).
 *
 * ARMING (after Identity Platform is on and you've reviewed log-mode output)
 *   a. In functions/index.js:
 *        const authGuardFns = require("./auth-guard")(shared);
 *      then add `authGuardFns` to the final Object.assign(exports, ...).
 *   b. Deploy: npm run deploy:cloud -- --only functions:beforecreated --project cashpilot-c58d5
 *   c. Once logs look clean, set the env var to enforce and redeploy:
 *        firebase functions:config / params or runtime env AUTH_GUARD_MODE=enforce
 *
 * VERIFY BEFORE ARMING: confirm the firebase-functions v2 identity API
 * (beforeUserCreated signature, event.ipAddress, HttpsError) against the
 * installed version (7.x) in the emulator. Blocking-function APIs have shifted
 * across majors.
 */

module.exports = function ({ admin, db }) {
    const { beforeUserCreated, HttpsError } = require("firebase-functions/v2/identity");

    const MODE = (process.env.AUTH_GUARD_MODE || "log").toLowerCase();

    const ALLOWLIST = new Set(
        (process.env.AUTH_GUARD_ALLOWLIST_EMAILS || "")
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
    );

    // Obvious throwaway/disposable mail providers. Extend freely.
    const DISPOSABLE_DOMAINS = new Set([
        "mailinator.com", "guerrillamail.com", "10minutemail.com",
        "tempmail.com", "temp-mail.org", "trashmail.com", "yopmail.com",
        "getnada.com", "dispostable.com", "sharklasers.com", "maildrop.cc",
    ]);

    // Throttle new accounts per source IP.
    const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const IP_MAX_SIGNUPS = 3;

    async function ipVelocityExceeded(ip) {
        if (!ip) return false;
        const safeId = ip.replace(/[^a-zA-Z0-9._-]/g, "_");
        const ref = db.collection("authGuard").doc(safeId);
        const now = Date.now();
        let exceeded = false;
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const prior = (snap.exists && snap.data().hits) || [];
            const recent = prior.filter((t) => now - t < IP_WINDOW_MS);
            exceeded = recent.length >= IP_MAX_SIGNUPS;
            recent.push(now);
            tx.set(ref, {
                hits: recent,
                // Wire a Firestore TTL policy on authGuard.expiresAt to self-clean.
                expiresAt: admin.firestore.Timestamp.fromMillis(now + IP_WINDOW_MS),
            });
        });
        return exceeded;
    }

    const beforecreated = beforeUserCreated(async (event) => {
        const user = event.data || {};
        const email = (user.email || "").toLowerCase();
        const ip = event.ipAddress || "";
        const domain = email.includes("@") ? email.split("@")[1] : "";

        if (email && ALLOWLIST.has(email)) return;

        const reasons = [];
        if (domain && DISPOSABLE_DOMAINS.has(domain)) reasons.push(`disposable domain ${domain}`);
        if (await ipVelocityExceeded(ip)) reasons.push(`ip velocity > ${IP_MAX_SIGNUPS}/h`);

        if (reasons.length === 0) return;

        console.warn(
            `[auth-guard] ${MODE === "enforce" ? "BLOCK" : "WOULD-BLOCK"} ` +
            `email=${email || "(none)"} ip=${ip} reasons=${reasons.join("; ")}`
        );

        if (MODE === "enforce") {
            throw new HttpsError("permission-denied", "Signup rejected.");
        }
        // log mode: fall through, account is allowed
    });

    return { beforecreated };
};
