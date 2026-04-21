/**
 * DAU/MAU active-user ping.
 *
 * Records at most one Firestore write per user per UTC day to a
 * `userActivity/` doc with ID `{YYYY-MM-DD}_{uid}`. Self-idempotent
 * across devices — two browsers for the same user on the same day
 * upsert into the same doc.
 *
 * The doc holds only `{uid, date, createdAt, expiresAt}`. No page,
 * action, bill, balance, or financial detail. See privacy.html §1.8.
 *
 * Cloud mode only — selfhost mode has no shared backend to aggregate on.
 *
 * @module active-ping
 */

const LOCAL_STORAGE_KEY = 'pennyhelm-active-date';
const RETENTION_DAYS = 90;

function todayUtcDate() {
    // ISO date — the YYYY-MM-DD slice of UTC midnight. Aligning every
    // user to UTC days keeps server-side aggregation trivial.
    return new Date().toISOString().slice(0, 10);
}

/**
 * Mark the currently signed-in user as active today. Safe to call from
 * anywhere after auth has resolved — all failure modes are swallowed so
 * a network blip or rules change can never break the app.
 */
export async function pingActiveUser() {
    try {
        // Only valid in cloud mode — in selfhost there's no shared Firestore.
        if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) return;

        const user = firebase.auth().currentUser;
        if (!user || !user.uid) return;

        const today = todayUtcDate();

        // Per-device dedupe — if we've already pinged today from this
        // browser, skip even the no-op Firestore upsert.
        try {
            if (localStorage.getItem(LOCAL_STORAGE_KEY) === today) return;
        } catch (_) { /* private mode / storage disabled — proceed */ }

        const docId = `${today}_${user.uid}`;
        const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

        await firebase.firestore().collection('userActivity').doc(docId).set({
            uid: user.uid,
            date: today,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt,
        }, { merge: true });

        try { localStorage.setItem(LOCAL_STORAGE_KEY, today); } catch (_) {}
    } catch (err) {
        // Activity tracking is best-effort. Never throw — if it errors, the
        // app still works, we just miss one data point.
        console.warn('[active-ping] skipped:', err && err.message ? err.message : err);
    }
}
