/**
 * Firebase App Check activation — reCAPTCHA v3 for the web.
 *
 * Call `activateAppCheck(firebase, siteKey)` ONCE, right after
 * `firebase.initializeApp(firebaseConfig)`, before any `firebase.auth()` /
 * `firestore()` / `functions()` calls. Activating later still works but the
 * initial requests from those services won't be attested.
 *
 * Ships inert when `siteKey` is empty — safe to deploy before the site is
 * registered in Firebase Console. Once you register a reCAPTCHA v3 site key
 * and set `APP_CHECK_SITE_KEY` in `js/firebase-config.js`, App Check tokens
 * are attached automatically to all subsequent Firestore / Functions / Auth
 * traffic.
 *
 * Debug tokens: on `localhost` / `127.0.0.1`, sets
 * `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` so the SDK prints a debug token
 * to the console. Paste it into Firebase Console → App Check → Apps → Web →
 * Manage debug tokens to let your dev machine through enforcement.
 *
 * Idempotent: repeat calls are no-ops.
 *
 * @param {import('firebase').default} firebase — the compat `firebase` global
 * @param {string} siteKey — reCAPTCHA v3 site key, or "" to disable
 * @returns {object|null} — the AppCheck instance, or null if skipped
 */
export function activateAppCheck(firebase, siteKey) {
    if (!siteKey) return null;
    if (!firebase || !firebase.appCheck) {
        console.warn('[AppCheck] firebase-app-check-compat.js not loaded; skipping');
        return null;
    }
    // Global flag — we stash the instance here so repeat calls are cheap and
    // callers can also read it if they need to (e.g. force token refresh).
    if (typeof window !== 'undefined' && window.__pennyhelmAppCheck) {
        return window.__pennyhelmAppCheck;
    }

    // Debug token for local dev — must be set BEFORE .activate().
    if (typeof self !== 'undefined' && typeof location !== 'undefined') {
        const host = location.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '') {
            // eslint-disable-next-line no-undef
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
    }

    try {
        const appCheck = firebase.appCheck();
        // Compat signature: activate(providerOrSiteKey, isTokenAutoRefreshEnabled)
        // Passing the raw site key as a string makes the SDK auto-construct a
        // ReCaptchaV3Provider internally; ReCaptchaV3Provider is also exposed
        // at firebase.appCheck.ReCaptchaV3Provider if we ever want to swap in
        // EnterpriseProvider.
        appCheck.activate(siteKey, /* isTokenAutoRefreshEnabled */ true);
        if (typeof window !== 'undefined') {
            window.__pennyhelmAppCheck = appCheck;
        }
        return appCheck;
    } catch (e) {
        // Do not block the app if App Check itself explodes — surfaces as a
        // 403 on attested endpoints rather than a blank page.
        console.error('[AppCheck] activation failed:', e);
        return null;
    }
}
