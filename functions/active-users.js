/**
 * Active-user analytics — DAU / MAU rollups over the userActivity collection.
 *
 * The collection is populated by `js/active-ping.js` — each doc is one
 * (user, UTC day) marker with ID `{YYYY-MM-DD}_{uid}`. 90-day TTL wired via
 * the `expiresAt` field (Firestore Console → TTL policy).
 *
 *   - getActiveUserStats (callable, admin-only): returns a daily active-user
 *     series for the last N days plus a rolling MAU curve. In-memory
 *     aggregation — Firestore can't GROUP BY date server-side, and row
 *     counts here are tiny (one per user per day).
 *
 * @module active-users
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");

// Max window the client can request. 90 matches the userActivity TTL —
// asking for more would just return 90 days of real data padded with
// zeros, which is misleading.
const MAX_DAYS_BACK = 90;
const DEFAULT_DAYS_BACK = 30;

module.exports = (shared) => {
    const { db } = shared;

    /** Build the sequence of YYYY-MM-DD strings from (today - daysBack + 1) through today. */
    function dateSeries(daysBack) {
        const out = [];
        const base = new Date();
        base.setUTCHours(0, 0, 0, 0);
        for (let i = daysBack - 1; i >= 0; i--) {
            const d = new Date(base);
            d.setUTCDate(base.getUTCDate() - i);
            out.push(d.toISOString().slice(0, 10));
        }
        return out;
    }

    const getActiveUserStats = onCall(
        { region: "us-central1" },
        async (request) => {
            if (!request.auth || request.auth.token.admin !== true) {
                throw new HttpsError("permission-denied", "Admin access required.");
            }

            const daysBack = Math.max(1, Math.min(MAX_DAYS_BACK, Number(request.data?.daysBack) || DEFAULT_DAYS_BACK));
            const series = dateSeries(daysBack);
            const earliest = series[0];

            // Pull every activity marker in the window. date is a YYYY-MM-DD
            // string — string >= comparison is ISO-ordered so this works.
            const snap = await db
                .collection("userActivity")
                .where("date", ">=", earliest)
                .get();

            // uidsByDay[date] = Set<uid> — distinct users seen on that day.
            const uidsByDay = {};
            series.forEach((d) => { uidsByDay[d] = new Set(); });

            snap.forEach((doc) => {
                const d = doc.data();
                if (!d || typeof d.date !== "string" || !d.uid) return;
                if (!uidsByDay[d.date]) return; // outside series
                uidsByDay[d.date].add(d.uid);
            });

            // Daily active users.
            const dau = series.map((date) => ({
                date,
                activeUsers: uidsByDay[date].size,
            }));

            // Rolling 30-day MAU at each day in the series — distinct users
            // active in the 30 days ending on `date`. For days earlier in
            // the series than 30 days, MAU reflects whatever window we have.
            const mau = [];
            for (let i = 0; i < series.length; i++) {
                const windowSet = new Set();
                const windowStart = Math.max(0, i - 29);
                for (let j = windowStart; j <= i; j++) {
                    uidsByDay[series[j]].forEach((uid) => windowSet.add(uid));
                }
                mau.push({
                    date: series[i],
                    activeUsers: windowSet.size,
                    windowDays: i - windowStart + 1,
                });
            }

            // Headline numbers — most useful when the admin first loads the card.
            const todayStr = series[series.length - 1];
            const dauToday = uidsByDay[todayStr].size;
            const last7Set = new Set();
            for (let i = Math.max(0, series.length - 7); i < series.length; i++) {
                uidsByDay[series[i]].forEach((uid) => last7Set.add(uid));
            }
            const wau = last7Set.size;
            const mauCurrent = mau[mau.length - 1]?.activeUsers || 0;

            return {
                daysBack,
                dauToday,
                wau,
                mau: mauCurrent,
                dau,
                mauSeries: mau,
            };
        }
    );

    return { getActiveUserStats };
};
