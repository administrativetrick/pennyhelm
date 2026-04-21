/**
 * Dynamic script loader for cloud-only third-party SDKs.
 *
 * Selfhost users never hit these CDNs — scripts are injected on demand
 * only when cloud mode actually needs them (Firebase, Plaid, QRCode).
 */

const _loaded = new Map(); // url -> Promise

function loadScript(url) {
    if (_loaded.has(url)) return _loaded.get(url);
    const p = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = false; // preserve execution order for Firebase compat bundles
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + url));
        document.head.appendChild(s);
    });
    _loaded.set(url, p);
    return p;
}

const FIREBASE_VERSION = '10.14.1';
const FIREBASE_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

export async function loadFirebaseSdk() {
    if (typeof firebase !== 'undefined' && firebase.apps) return;
    // Must load in order: app → {auth, firestore, functions, app-check}
    await loadScript(`${FIREBASE_BASE}/firebase-app-compat.js`);
    await Promise.all([
        loadScript(`${FIREBASE_BASE}/firebase-auth-compat.js`),
        loadScript(`${FIREBASE_BASE}/firebase-firestore-compat.js`),
        loadScript(`${FIREBASE_BASE}/firebase-functions-compat.js`),
        loadScript(`${FIREBASE_BASE}/firebase-app-check-compat.js`),
    ]);
}

export async function loadPlaidSdk() {
    if (typeof Plaid !== 'undefined') return;
    await loadScript('https://cdn.plaid.com/link/v2/stable/link-initialize.js');
}

export async function loadQrcodeSdk() {
    if (typeof QRCode !== 'undefined') return;
    await loadScript('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js');
}
