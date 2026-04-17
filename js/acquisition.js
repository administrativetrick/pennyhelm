// Acquisition source tracking — captures UTM params (and referrer) from the URL
// on landing, stashes them in sessionStorage so they survive the SPA navigation
// from / → /login → signup, then attaches them to the users/{uid} doc.
//
// Safe to call multiple times. If a page load has UTMs in the URL, those win
// and overwrite any prior session values (the user clicked a fresh ad).

const STORAGE_KEY = 'pennyhelm-acquisition';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// Read and stash UTM / ref / referrer on page load. Call this from the top of
// both landing (index.html) and login.html.
export function captureAcquisitionParams() {
    try {
        const params = new URLSearchParams(window.location.search);
        const present = UTM_KEYS.some(k => params.has(k)) || params.has('ref') || params.has('gclid') || params.has('fbclid');

        // Only overwrite storage if THIS page load has tracking params. Otherwise
        // preserve whatever the user arrived with originally (e.g. ad click → landing
        // → login.html with no params).
        if (!present) return;

        const existing = readAcquisition() || {};
        const record = { ...existing };

        UTM_KEYS.forEach(k => {
            const v = params.get(k);
            if (v) record[k] = v.slice(0, 200);
        });

        const ref = params.get('ref');
        if (ref) record.ref = ref.slice(0, 50).toUpperCase();

        const gclid = params.get('gclid');
        if (gclid) record.gclid = gclid.slice(0, 200);

        const fbclid = params.get('fbclid');
        if (fbclid) record.fbclid = fbclid.slice(0, 200);

        // First-touch referrer (only record on first capture, don't overwrite
        // with an internal referrer like /login).
        if (!record.referrer && document.referrer) {
            try {
                const refUrl = new URL(document.referrer);
                if (refUrl.host !== window.location.host) {
                    record.referrer = document.referrer.slice(0, 500);
                }
            } catch (_) {
                // ignore malformed referrer
            }
        }

        if (!record.landingPath) {
            record.landingPath = window.location.pathname.slice(0, 200);
        }
        if (!record.capturedAt) {
            record.capturedAt = new Date().toISOString();
        }

        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) {
        // sessionStorage disabled / quota — fail silent, tracking is best-effort
    }
}

// Read the stashed acquisition record. Returns null if nothing was captured.
export function readAcquisition() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (_) {
        return null;
    }
}

// Build the Firestore-friendly acquisitionSource subobject to merge onto the
// new users/{uid} doc at signup. Returns null if we have nothing to record —
// callers should only attach if non-null to keep the user doc clean.
export function getAcquisitionSourceForSignup() {
    const record = readAcquisition();
    if (!record) return null;

    // Strip empty values — Firestore doesn't love undefined.
    const out = {};
    Object.entries(record).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') out[k] = v;
    });

    if (Object.keys(out).length === 0) return null;
    return out;
}

// Clear after successful signup so the record doesn't leak into a second
// account created in the same browser tab (unlikely but cheap to prevent).
export function clearAcquisition() {
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* ignore */ }
}
