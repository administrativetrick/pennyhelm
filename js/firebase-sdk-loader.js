/**
 * Lazy Firebase compat SDK loader for the login page.
 *
 * login.html only ships firebase-app-compat + firebase-auth-compat on the
 * critical path — the form paints in <1s on 4G. Firestore (~344 KB),
 * Functions (~8 KB), and App Check (~23 KB) are injected on demand by this
 * module, then pre-warmed right after module load so they're ready by the
 * time the user hits Submit.
 *
 * Exposed as a factory so tests can instantiate fresh loaders with stubbed
 * DOM and firebase globals. Production code calls it once in login.js.
 *
 * Ordering contract:
 *   App Check activates BEFORE any Firestore / Functions request so the
 *   first attested call carries a reCAPTCHA token. The ready-promises chain
 *   enforces this without callers having to think about it.
 */

export const DEFAULT_SDK_CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';

/**
 * @typedef {object} SdkLoaderOptions
 * @property {string}  appCheckSiteKey — reCAPTCHA v3 site key. Empty string
 *   skips App Check entirely (selfhost, or cloud deploys that haven't
 *   registered with reCAPTCHA yet). In that case the firestore/functions
 *   ready-promises resolve without ever fetching app-check-compat.
 * @property {(firebase: any, siteKey: string) => void} activateAppCheck —
 *   Usually the function from `./app-check-boot.js`. Called exactly once
 *   after app-check-compat.js finishes loading.
 * @property {any}      [firebaseGlobal] — the `firebase` compat global.
 *   Defaults to `window.firebase` if available.
 * @property {Document} [documentRef]   — DOM root. Defaults to `document`.
 * @property {string}   [cdnBase=DEFAULT_SDK_CDN]
 */

/**
 * Build a fresh loader instance. See the module-level doc for contract.
 *
 * @param {SdkLoaderOptions} opts
 * @returns {{
 *   ensureAppCheckReady: () => Promise<void>,
 *   ensureFirestoreReady: () => Promise<void>,
 *   ensureFunctionsReady: () => Promise<void>,
 *   _loadSdkScript: (name: string) => Promise<void>,
 * }}
 */
export function createFirebaseSdkLoader(opts) {
    const {
        appCheckSiteKey,
        activateAppCheck,
        firebaseGlobal,
        documentRef,
        cdnBase = DEFAULT_SDK_CDN,
    } = opts || {};

    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const fb = firebaseGlobal || (typeof window !== 'undefined' ? window.firebase : null);
    if (!doc) throw new Error('firebase-sdk-loader: no document provided and none on globalThis');
    if (!fb) throw new Error('firebase-sdk-loader: no firebase global provided and none on window');
    if (typeof activateAppCheck !== 'function') {
        throw new Error('firebase-sdk-loader: activateAppCheck function is required');
    }

    // Memoized script-tag injections, keyed by SDK name. Repeat loads return
    // the same promise — critical for the pre-warm + submit-gate pattern,
    // otherwise we'd hit gstatic twice for firestore on every page view.
    const _scriptLoads = {};
    function _loadSdkScript(name) {
        if (_scriptLoads[name]) return _scriptLoads[name];
        _scriptLoads[name] = new Promise((resolve, reject) => {
            const s = doc.createElement('script');
            s.src = cdnBase + name + '.js';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load ' + name));
            doc.head.appendChild(s);
        });
        return _scriptLoads[name];
    }

    let _appCheckReady = null;
    function ensureAppCheckReady() {
        if (_appCheckReady) return _appCheckReady;
        // Skip the SDK entirely when no site key is configured. Saves a
        // network round-trip and — more importantly — keeps login working
        // if gstatic is unreachable on a site that doesn't need attestation.
        if (!appCheckSiteKey) {
            _appCheckReady = Promise.resolve();
            return _appCheckReady;
        }
        _appCheckReady = _loadSdkScript('firebase-app-check-compat').then(() => {
            // Idempotent; activateAppCheck internally guards repeat calls.
            activateAppCheck(fb, appCheckSiteKey);
        });
        return _appCheckReady;
    }

    let _firestoreReady = null;
    function ensureFirestoreReady() {
        if (_firestoreReady) return _firestoreReady;
        _firestoreReady = ensureAppCheckReady().then(() => _loadSdkScript('firebase-firestore-compat'));
        return _firestoreReady;
    }

    let _functionsReady = null;
    function ensureFunctionsReady() {
        if (_functionsReady) return _functionsReady;
        _functionsReady = ensureAppCheckReady().then(() => _loadSdkScript('firebase-functions-compat'));
        return _functionsReady;
    }

    return {
        ensureAppCheckReady,
        ensureFirestoreReady,
        ensureFunctionsReady,
        _loadSdkScript,
    };
}
