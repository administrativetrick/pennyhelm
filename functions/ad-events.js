/**
 * Ad-attribution events — anonymous pre-signup funnel tracking.
 *
 * Pairs with `js/acquisition.js` (which writes `acquisitionSource` on the
 * user doc at signup) to let the admin see the full Reddit/Google/direct
 * funnel: landing_view → cta_click → signup.
 *
 *   - logAdEvent (HTTP, unauth): one endpoint the landing page hits for both
 *     `landing_view` (on load) and `cta_click` (on CTA press). Rate-limited
 *     by IP. Events auto-expire after 90 days via the `expiresAt` TTL field.
 *     Wire a TTL policy on `adEvents.expiresAt` in Firebase Console → TTL.
 *
 *   - getAdAttributionStats (callable, admin-only): reads last 30 days of
 *     `adEvents` + `users.acquisitionSource`, returns a rollup by source,
 *     campaign, and creative. In-memory aggregation — Firestore can't group
 *     server-side and the cardinality is tiny for the foreseeable future.
 *
 * @module ad-events
 */

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const adminSdk = require("firebase-admin");

// Events we're willing to persist. Anything else is a 400 — prevents a script
// from filling the collection with junk event types.
const ALLOWED_TYPES = new Set(["landing_view", "cta_click"]);

// Retention — how long individual events stick around before Firestore TTL
// policy reaps them. 90 days covers any reasonable attribution window.
const RETENTION_DAYS = 90;

// Rate limiting — per-IP cap on logAdEvent calls. High enough that normal
// browsing never hits it, low enough that a scripted attacker can't blow up
// our Firestore quota. Window is deliberately 1 minute so retries recover
// quickly.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SEC = 60;

// Max string lengths we'll accept from the client. Defense-in-depth —
// prevents someone stuffing gigabytes into a single field.
const MAX_UTM_LEN = 200;
const MAX_VISITOR_LEN = 64;
const MAX_PATH_LEN = 200;
const MAX_REFERRER_LEN = 500;

module.exports = (shared) => {
    const { db } = shared;

    /**
     * Check-and-increment an IP-bucketed rate limit counter. Returns true if
     * the caller is over the cap (= should be rejected).
     */
    async function rateLimitByIp(ip) {
        const windowStart = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SEC) * RATE_LIMIT_WINDOW_SEC;
        const safeIp = (ip || "unknown").replace(/[^\w.-]/g, "_").slice(0, 60);
        const ref = db.collection("rateLimits").doc(`logAdEvent__ip:${safeIp}__${windowStart}`);
        await ref.set({
            fn: "logAdEvent",
            identity: `ip:${safeIp}`,
            windowStart,
            expiresAt: new Date((windowStart + RATE_LIMIT_WINDOW_SEC + 60) * 1000),
            count: adminSdk.firestore.FieldValue.increment(1),
        }, { merge: true });
        const snap = await ref.get();
        return (snap.data()?.count || 0) > RATE_LIMIT_MAX;
    }

    // ─── logAdEvent — HTTP, unauth ─────────────────────────────

    const logAdEvent = onRequest(
        {
            region: "us-central1",
            cors: true,
            invoker: "public",
        },
        async (req, res) => {
            try {
                // Accept only POST. The Hosting rewrite is same-origin for
                // pennyhelm.com, so we don't need to think about CORS much —
                // but `cors: true` above covers the cross-origin edge case.
                if (req.method !== "POST") {
                    res.status(405).json({ error: "method_not_allowed" });
                    return;
                }

                // Derive caller IP from the forwarded chain Hosting / Cloud Run set.
                const xff = req.headers["x-forwarded-for"];
                const ip = (typeof xff === "string" ? xff.split(",")[0] : req.ip) || "unknown";

                if (await rateLimitByIp(ip.trim())) {
                    res.status(429).json({ error: "rate_limited" });
                    return;
                }

                // Body can arrive as parsed JSON (Cloud Functions default),
                // or as a raw string when sent via sendBeacon with a Blob.
                let body = req.body;
                if (typeof body === "string") {
                    try { body = JSON.parse(body); } catch { body = {}; }
                } else if (Buffer.isBuffer(body)) {
                    try { body = JSON.parse(body.toString("utf8")); } catch { body = {}; }
                }
                body = body || {};

                const { type, visitorId, utm, landingPath, referrer } = body;

                if (!ALLOWED_TYPES.has(type)) {
                    res.status(400).json({ error: "invalid_type" });
                    return;
                }

                // Sanitize UTMs — accept only the five canonical fields,
                // drop anything else, cap length.
                const cleanUtm = {};
                if (utm && typeof utm === "object") {
                    for (const k of ["source", "medium", "campaign", "content", "term"]) {
                        const v = utm[k];
                        if (typeof v === "string" && v.length > 0) {
                            cleanUtm[k] = v.slice(0, MAX_UTM_LEN);
                        }
                    }
                }
                // Default to "direct" so the funnel cleanly shows organic vs paid mix.
                if (!cleanUtm.source) cleanUtm.source = "direct";

                const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

                await db.collection("adEvents").add({
                    type,
                    visitorId: typeof visitorId === "string" ? visitorId.slice(0, MAX_VISITOR_LEN) : null,
                    utm: cleanUtm,
                    landingPath: typeof landingPath === "string" ? landingPath.slice(0, MAX_PATH_LEN) : null,
                    referrer: typeof referrer === "string" ? referrer.slice(0, MAX_REFERRER_LEN) : null,
                    createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
                    expiresAt,
                });

                // 204 so sendBeacon doesn't retry on next pageview.
                res.status(204).send();
            } catch (err) {
                console.error("[logAdEvent] failed:", err);
                // Never 5xx the browser — attribution is best-effort and we
                // don't want errors here to surface in browser consoles.
                res.status(204).send();
            }
        }
    );

    // ─── getAdAttributionStats — callable, admin-only ──────────

    const getAdAttributionStats = onCall(
        { region: "us-central1" },
        async (request) => {
            if (!request.auth || request.auth.token.admin !== true) {
                throw new HttpsError("permission-denied", "Admin access required.");
            }

            const daysBack = Math.max(1, Math.min(90, Number(request.data?.daysBack) || 30));
            const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

            // Fetch the window. We do in-memory aggregation because Firestore
            // doesn't support GROUP BY and the row counts are tiny for any
            // realistic ad-spend scale we'll hit in the next year.
            const [eventsSnap, usersSnap] = await Promise.all([
                db.collection("adEvents").where("createdAt", ">=", since).get(),
                db.collection("users").where("createdAt", ">=", since).get(),
            ]);

            // Generic bucket helper — one row per distinct key (source / campaign / creative).
            const bucket = (map, key) => {
                if (!key) key = "(unknown)";
                if (!map[key]) {
                    map[key] = {
                        key,
                        views: 0,
                        clicks: 0,
                        signups: 0,
                        uniqueVisitors: new Set(),
                    };
                }
                return map[key];
            };

            const bySource = {};
            const byCampaign = {};
            const byContent = {};
            const allVisitors = new Set();

            eventsSnap.forEach((doc) => {
                const d = doc.data();
                const src = d.utm?.source || "direct";
                const camp = d.utm?.campaign || "(no campaign)";
                const content = d.utm?.content || "(no creative)";

                const sB = bucket(bySource, src);
                const cB = bucket(byCampaign, camp);
                const nB = bucket(byContent, content);

                if (d.visitorId) {
                    allVisitors.add(d.visitorId);
                    sB.uniqueVisitors.add(d.visitorId);
                    cB.uniqueVisitors.add(d.visitorId);
                    nB.uniqueVisitors.add(d.visitorId);
                }

                if (d.type === "landing_view") {
                    sB.views++; cB.views++; nB.views++;
                } else if (d.type === "cta_click") {
                    sB.clicks++; cB.clicks++; nB.clicks++;
                }
            });

            usersSnap.forEach((doc) => {
                const u = doc.data();
                const acq = u.acquisitionSource;
                if (!acq) {
                    // Signups with zero attribution — show as "direct" so the
                    // row count adds up to total signups.
                    bucket(bySource, "direct").signups++;
                    bucket(byCampaign, "(no campaign)").signups++;
                    bucket(byContent, "(no creative)").signups++;
                    return;
                }
                bucket(bySource, acq.utm_source || "direct").signups++;
                bucket(byCampaign, acq.utm_campaign || "(no campaign)").signups++;
                bucket(byContent, acq.utm_content || "(no creative)").signups++;
            });

            const toRows = (map) =>
                Object.values(map)
                    .map((b) => ({
                        key: b.key,
                        views: b.views,
                        clicks: b.clicks,
                        signups: b.signups,
                        uniqueVisitors: b.uniqueVisitors.size,
                        abandoned: Math.max(0, b.clicks - b.signups),
                        clickThroughRate: b.views > 0 ? b.clicks / b.views : 0,
                        conversionRate: b.clicks > 0 ? b.signups / b.clicks : 0,
                    }))
                    .sort((a, b) => (b.views + b.signups) - (a.views + a.signups));

            return {
                daysBack,
                totalUniqueVisitors: allVisitors.size,
                totalSignupsInWindow: usersSnap.size,
                sources: toRows(bySource),
                campaigns: toRows(byCampaign),
                creatives: toRows(byContent),
            };
        }
    );

    return { logAdEvent, getAdAttributionStats };
};
