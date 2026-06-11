// Firebase configuration
// Get full config from: Firebase Console → Project Settings → General → Your apps → Web app
export const firebaseConfig = {
    apiKey: "AIzaSyAGVbGJmAXmGFMlFFkgcbIxLFdXyHxk2l4",
    // Custom auth handler domain. Keeps Google sign-in on pennyhelm.com instead of
    // briefly flashing cashpilot-c58d5.firebaseapp.com (the internal project id), and
    // makes the OAuth handshake same-origin (more robust vs 3rd-party-cookie blocking).
    // PREREQ: pennyhelm.com must be a Firebase Auth "Authorized domain" AND an
    // "Authorized redirect URI" on the OAuth web client (https://pennyhelm.com/__/auth/handler).
    authDomain: "pennyhelm.com",
    projectId: "cashpilot-c58d5",
    storageBucket: "cashpilot-c58d5.firebasestorage.app",
    messagingSenderId: "348712070883",
    appId: "1:348712070883:web:147ed5974770faedbf9fd6"
};

// Firebase App Check — reCAPTCHA v3 site key.
// Register the site in Firebase Console → App Check → Apps → Web, then paste
// the public site key here. Leave as empty string to disable App Check (no-op).
// Safe to ship empty: activation is gated so missing key = legacy behavior.
// Debug tokens for localhost are auto-enabled when APP_CHECK_SITE_KEY is set.
export const APP_CHECK_SITE_KEY = "";
