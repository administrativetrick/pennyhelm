/**
 * Rate limiter for Firebase Cloud Functions (onCall v2).
 *
 * Uses a Firestore counter doc per (function, identity) pair. Counts requests
 * in fixed time windows and rejects with HttpsError once the cap is hit.
 *
 * Design notes:
 *   - "Identity" is UID when the caller is authenticated, else client IP.
 *     For unauth signup/password flows this blunts the most common abuse —
 *     one bot exhausting the free-tier quota on Identity Toolkit.
 *   - Firestore transactions are overkill for our volumes — the observed
 *     false-negative rate from racy increments is acceptable given we're
 *     guarding against scripted abuse, not a perfectly synchronous meter.
 *   - Docs have a TTL field (`expiresAt`) so Firestore auto-deletes stale
 *     counters. No cron needed. You must configure a TTL policy on the
 *     `rateLimits` collection in Firebase Console → Firestore → TTL →
 *     `expiresAt` field. If the policy is missing we still work; the
 *     collection just grows (cheap — sub-gigabyte over years).
 *   - Admin callers (`request.auth.token.admin === true`) are skipped so
 *     support flows aren't throttled during an incident.
 *
 * @module rate-limit
 */

const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Extract a stable identity for rate-limit bucketing.
 * Prefers UID (authenticated caller), falls back to client IP.
 */
function getIdentity(request) {
    if (request.auth?.uid) return `uid:${request.auth.uid}`;
    // v2 onCall exposes rawRequest; Firebase sets x-forwarded-for.
    const raw = request.rawRequest;
    const xff = raw?.headers?.['x-forwarded-for'];
    const ip = (typeof xff === 'string' ? xff.split(',')[0] : raw?.ip) || 'unknown';
    return `ip:${ip.trim()}`;
}

/**
 * Check-and-increment a rate-limit counter. Throws `resource-exhausted` if
 * the caller is over the cap for the current window.
 *
 * @param {object} opts
 * @param {FirebaseFirestore.Firestore} opts.db
 * @param {object} opts.request — the v2 onCall request object
 * @param {string} opts.name   — the function name (forms the counter bucket)
 * @param {number} opts.limit  — max calls allowed per window
 * @param {number} opts.windowSec — window length in seconds
 * @param {string} [opts.message] — custom user-facing message
 */
async function enforceRateLimit({ db, request, name, limit, windowSec, message }) {
    // Admins are never throttled — leaves us headroom during incident response.
    if (request.auth?.token?.admin === true) return;

    const identity = getIdentity(request);
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const docId = `${name}__${identity}__${windowStart}`.replace(/[^\w:.-]/g, '_');
    const ref = db.collection('rateLimits').doc(docId);

    // Single write + read. Firestore's `increment` is atomic per-doc.
    await ref.set({
        fn: name,
        identity,
        windowStart,
        expiresAt: new Date((windowStart + windowSec + 60) * 1000), // +60s slack for TTL
        count: require('firebase-admin').firestore.FieldValue.increment(1),
    }, { merge: true });

    const snap = await ref.get();
    const count = snap.data()?.count || 0;

    if (count > limit) {
        const retryAfter = windowStart + windowSec - Math.floor(Date.now() / 1000);
        throw new HttpsError(
            'resource-exhausted',
            message || `Too many attempts. Try again in ${Math.max(1, retryAfter)} seconds.`,
            { retryAfter }
        );
    }
}

module.exports = { enforceRateLimit, getIdentity };
