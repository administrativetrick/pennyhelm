// Acquisition source tracking — captures UTM params AND the external referrer
// from the URL on landing, stashes them in localStorage so they survive the
// journey (landing → /login → signup, even across a tab close or a later return
// in the same browser), then attaches them to the users/{uid} doc.
//
// Safe to call multiple times. A page load WITH UTM params wins (fresh click,
// overwrite). A referrer-only visit is recorded as first-touch only if nothing
// was captured before, so we don't clobber an earlier UTM/referrer.
//
// NOTE: an inline copy of this same logic lives at the top of index.html and in
// the SSR blog pages (functions/blog-site.js) so every entry point captures the
// source. If you change the capture rules here, update those too.

const STORAGE_KEY = 'pennyhelm-acquisition';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// Prefer localStorage (survives tab close), fall back to sessionStorage.
function readRaw() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (_) { return null; }
}

function writeRaw(record) {
    const json = JSON.stringify(record);
    try { localStorage.setItem(STORAGE_KEY, json); return; } catch (_) {}
    try { sessionStorage.setItem(STORAGE_KEY, json); } catch (_) {}
}

// Read and stash UTM / ref / referrer on page load. Call this from the top of
// every entry point (landing, login, blog).
export function captureAcquisitionParams() {
    try {
        const params = new URLSearchParams(window.location.search);
        const hasParams = UTM_KEYS.some(k => params.has(k)) || params.has('ref') || params.has('gclid') || params.has('fbclid');

        // External (off-site) referrer, captured even when there is no UTM param.
        let externalReferrer = '';
        if (document.referrer) {
            try {
                const refUrl = new URL(document.referrer);
                if (refUrl.host !== window.location.host) externalReferrer = document.referrer.slice(0, 500);
            } catch (_) { /* malformed referrer */ }
        }

        if (!hasParams && !externalReferrer) return;

        const existing = readRaw() || {};
        // Referrer-only visit and we already have a first-touch source → keep it.
        if (!hasParams && externalReferrer && (existing.utm_source || existing.ref || existing.referrer)) return;

        const record = { ...existing };
        UTM_KEYS.forEach(k => { const v = params.get(k); if (v) record[k] = v.slice(0, 200); });
        const ref = params.get('ref'); if (ref) record.ref = ref.slice(0, 50).toUpperCase();
        const gclid = params.get('gclid'); if (gclid) record.gclid = gclid.slice(0, 200);
        const fbclid = params.get('fbclid'); if (fbclid) record.fbclid = fbclid.slice(0, 200);
        if (!record.referrer && externalReferrer) record.referrer = externalReferrer;
        if (!record.landingPath) record.landingPath = window.location.pathname.slice(0, 200);
        if (!record.capturedAt) record.capturedAt = new Date().toISOString();

        writeRaw(record);
    } catch (e) {
        // storage disabled / quota — attribution is best-effort
    }
}

// Read the stashed acquisition record. Returns null if nothing was captured.
export function readAcquisition() {
    return readRaw();
}

// Build the Firestore-friendly acquisitionSource subobject to merge onto the
// new users/{uid} doc at signup. Returns null if we have nothing to record.
export function getAcquisitionSourceForSignup() {
    const record = readRaw();
    if (!record) return null;
    const out = {};
    Object.entries(record).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') out[k] = v;
    });
    return Object.keys(out).length ? out : null;
}

// Clear after successful signup so the record doesn't leak into a second account
// created in the same browser.
export function clearAcquisition() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
}
