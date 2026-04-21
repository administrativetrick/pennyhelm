import { firebaseConfig, APP_CHECK_SITE_KEY } from './firebase-config.js';
import { APP_MODE } from './mode-config.js';
import {
    captureAcquisitionParams,
    getAcquisitionSourceForSignup,
    clearAcquisition,
} from './acquisition.js';
import { activateAppCheck } from './app-check-boot.js';

// Capture any UTM / ref / gclid / fbclid params that landed the user here.
// Runs before Firebase init so it's captured even if Firebase fails to load.
captureAcquisitionParams();

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
// App Check activation must precede any service getter so tokens are attached
// to the very first auth / functions call. No-op if site key is empty.
activateAppCheck(firebase, APP_CHECK_SITE_KEY);
const auth = firebase.auth();
const functions = firebase.functions();

const isCloudMode = APP_MODE === 'cloud';

// ─── Google Ads + Consent Mode v2 ────────────────────────────────
// Cloud-only. Loads gtag.js asynchronously and fires the signup conversion
// after a successful registration. Skipped entirely in selfhost so no third
// parties are contacted from local installs.
//
// Consent Mode v2 (advanced):
//   https://developers.google.com/tag-platform/security/guides/consent
// We set `consent default` BEFORE loading gtag.js with `*_storage` and
// `ad_user_data` / `ad_personalization` denied for EEA visitors. gtag then
// runs in "cookieless ping" mode — conversions are still modeled in aggregate
// without setting any cookies or sharing identifiers. The /switch banner
// calls `gtag('consent', 'update', { ... })` with granted values when an EEA
// user clicks Accept, and persists that choice in localStorage so we can
// restore it on subsequent visits.
//
// Non-EEA traffic defaults to granted (no banner required by law).
//
// TO ENABLE CONVERSION ATTRIBUTION: create a Conversion Action in Google
// Ads → Tools → Conversions (Website → Sign-up). Google gives you a snippet
// like `gtag('event', 'conversion', { send_to: 'AW-1061347212/AbCdEfGh' })`.
// Replace CONVERSION_LABEL below with the real label after the slash. Until
// then, the conversion fires with a placeholder Google Ads ignores (no user
// impact, just no conversions counted).
const GOOGLE_ADS_ID = 'AW-1061347212';
const SIGNUP_CONVERSION_SEND_TO = 'AW-1061347212/CONVERSION_LABEL';
const CONSENT_STORAGE_KEY = 'pennyhelm-consent';

function isEeaVisitor() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        // Europe/* covers every EEA country + UK (UK-GDPR). A few Atlantic
        // zones are EU dependencies (Iceland, Azores, Madeira, Faroe).
        return (
            tz.indexOf('Europe/') === 0 ||
            tz === 'Atlantic/Reykjavik' ||
            tz === 'Atlantic/Faroe' ||
            tz === 'Atlantic/Azores' ||
            tz === 'Atlantic/Madeira'
        );
    } catch (_) {
        // Fail closed — if we can't tell, assume EEA so we require consent.
        return true;
    }
}

function readStoredConsent() {
    try {
        const v = localStorage.getItem(CONSENT_STORAGE_KEY);
        return v === 'granted' || v === 'denied' ? v : null;
    } catch (_) {
        return null;
    }
}

function loadGtag() {
    if (!isCloudMode) return;

    // Initialize dataLayer + gtag shim BEFORE the script tag so `consent
    // default` queues up before gtag.js reads it.
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;

    // Consent Mode v2 defaults. EEA users start denied; non-EEA granted.
    // If an EEA user previously accepted the banner on /switch, honor it.
    const stored = readStoredConsent();
    let adsState = 'granted';
    let analyticsState = 'granted';
    if (isEeaVisitor()) {
        adsState = stored === 'granted' ? 'granted' : 'denied';
        analyticsState = stored === 'granted' ? 'granted' : 'denied';
    }
    gtag('consent', 'default', {
        ad_storage: adsState,
        ad_user_data: adsState,
        ad_personalization: adsState,
        analytics_storage: analyticsState,
        // EU region scoping — Google restricts automatic region inference to
        // best-effort; being explicit with EEA+UK+CH is safer.
        wait_for_update: 500,
    });

    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GOOGLE_ADS_ID);
}

// Fire the Google Ads signup conversion, then invoke `onDone` (usually the
// post-signup redirect). Uses the event_callback pattern so the redirect
// doesn't race the beacon, with a hard-timeout fallback in case gtag.js is
// blocked or never calls the callback (ad blockers, offline, etc.).
// With Consent Mode v2, conversions still fire when consent is denied —
// Google Ads receives a cookieless ping and models them in aggregate.
function fireSignupConversion(onDone) {
    if (!isCloudMode || typeof window.gtag !== 'function') {
        onDone();
        return;
    }
    let called = false;
    const done = () => { if (called) return; called = true; onDone(); };
    try {
        window.gtag('event', 'conversion', {
            send_to: SIGNUP_CONVERSION_SEND_TO,
            event_callback: done,
        });
    } catch (_) {
        // If gtag throws for any reason, still redirect.
        done();
        return;
    }
    setTimeout(done, 1500);
}

loadGtag();

// State
let isSignUp = false;
let isLoggingIn = false; // Prevent onAuthStateChanged redirect during login flow

// DOM Elements
const tabs = document.querySelectorAll('.auth-tab');
const form = document.getElementById('email-auth-form');
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const confirmPasswordInput = document.getElementById('auth-confirm-password');
const confirmGroup = document.getElementById('confirm-password-group');
const referralCodeGroup = document.getElementById('referral-code-group');
const referralCodeInput = document.getElementById('auth-referral-code');
const errorDiv = document.getElementById('auth-error');
const submitBtn = document.getElementById('auth-submit');
const googleBtn = document.getElementById('google-signin');

// Auto-fill referral code from URL param (e.g. ?ref=REF-A3X9K2M7)
const urlRef = new URLSearchParams(window.location.search).get('ref');
if (urlRef && referralCodeInput) {
    referralCodeInput.value = urlRef.toUpperCase();
}

// Tab switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        isSignUp = tab.dataset.tab === 'signup';

        confirmGroup.style.display = isSignUp ? 'block' : 'none';
        if (referralCodeGroup) {
            referralCodeGroup.style.display = (isSignUp && isCloudMode) ? 'block' : 'none';
        }
        submitBtn.textContent = isSignUp ? 'Create Account' : 'Sign In';
        errorDiv.textContent = '';

        if (isSignUp) {
            confirmPasswordInput.setAttribute('required', '');
        } else {
            confirmPasswordInput.removeAttribute('required');
        }
    });
});

// If URL has ?ref=, auto-switch to Sign Up tab
if (urlRef && isCloudMode) {
    const signupTab = document.querySelector('.auth-tab[data-tab="signup"]');
    if (signupTab) signupTab.click();
}

// Email/Password form submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.textContent = '';

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (isSignUp) {
        const confirmPassword = confirmPasswordInput.value;
        if (password !== confirmPassword) {
            errorDiv.textContent = 'Passwords do not match.';
            return;
        }
        if (password.length < 6) {
            errorDiv.textContent = 'Password must be at least 6 characters.';
            return;
        }
    }

    setLoading(true);

    try {
        if (isSignUp) {
            const referralCode = referralCodeInput ? referralCodeInput.value.trim().toUpperCase() : '';

            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await registerUser(userCredential.user, referralCode || null);

            // Fire Google Ads signup conversion, then redirect. No-op in selfhost.
            fireSignupConversion(() => { window.location.href = '/app'; });
        } else {
            isLoggingIn = true; // Prevent onAuthStateChanged redirect
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            // Ensure users/{uid} doc exists (safety net for all sign-in methods)
            await ensureUserRegistered(userCredential.user);
            // Check if MFA is enabled
            const mfaRequired = await checkMFAEnabled(userCredential.user);
            if (mfaRequired) {
                setLoading(false);
                showMFAVerificationModal();
                return;
            }
            window.location.href = '/app';
        }
    } catch (error) {
        errorDiv.textContent = getErrorMessage(error.code);
        setLoading(false);
    }
});

// Google Sign-In
googleBtn.addEventListener('click', async () => {
    errorDiv.textContent = '';

    const referralCode = (isSignUp && isCloudMode && referralCodeInput)
        ? referralCodeInput.value.trim().toUpperCase()
        : '';

    const provider = new firebase.auth.GoogleAuthProvider();

    try {
        const result = await auth.signInWithPopup(provider);
        const user = result.user;

        // Check if Firestore user doc exists (more reliable than isNewUser)
        const db = firebase.firestore();
        const userDoc = await db.collection('users').doc(user.uid).get();
        const isFirstTime = !userDoc.exists;

        if (isFirstTime) {
            // New user — create doc with optional referral code
            await registerUser(user, referralCode || null);
        } else {
            // Existing user — ensure doc is up to date
            await ensureUserRegistered(user);
        }

        // Check if MFA is enabled for existing users
        if (!isFirstTime) {
            const mfaRequired = await checkMFAEnabled(user);
            if (mfaRequired) {
                showMFAVerificationModal();
                return;
            }
        }

        // Only fire signup conversion for first-time Google registrations.
        // Re-logins of existing users must not double-count.
        if (isFirstTime) {
            fireSignupConversion(() => { window.location.href = '/app'; });
        } else {
            window.location.href = '/app';
        }
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') {
            errorDiv.textContent = getErrorMessage(error.code);
        }
    }
});

// Check if user has MFA enabled
async function checkMFAEnabled(user) {
    try {
        const db = firebase.firestore();
        const userDoc = await db.collection('users').doc(user.uid).get();
        return userDoc.exists && userDoc.data().mfaEnabled === true;
    } catch (error) {
        console.error('Error checking MFA status:', error);
        return false;
    }
}

// Show MFA verification modal
function showMFAVerificationModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:380px;">
            <h2>🔐 Two-Factor Authentication</h2>
            <p id="mfa-prompt-text">Enter the 6-digit code from your authenticator app.</p>
            <div class="form-group mt-16">
                <input type="text" class="form-input" id="mfa-code-input"
                    placeholder="000000" maxlength="6" autocomplete="one-time-code"
                    inputmode="numeric" pattern="[0-9]*"
                    style="text-align:center;font-size:24px;letter-spacing:8px;font-family:monospace;">
            </div>
            <div id="mfa-error" style="color:var(--red);font-size:13px;margin-bottom:12px;"></div>
            <button class="btn btn-primary" id="mfa-verify-btn" style="width:100%;margin-bottom:12px;">Verify</button>
            <button class="btn btn-secondary" id="mfa-recovery-toggle" style="width:100%;margin-bottom:12px;background:transparent;border:1px solid var(--border);color:var(--text-secondary);">Use Recovery Code</button>
            <button class="btn btn-secondary" id="mfa-cancel-btn" style="width:100%;background:transparent;border:none;color:var(--text-secondary);font-size:13px;">Sign Out</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const codeInput = document.getElementById('mfa-code-input');
    const mfaError = document.getElementById('mfa-error');
    const verifyBtn = document.getElementById('mfa-verify-btn');
    const recoveryToggle = document.getElementById('mfa-recovery-toggle');
    const cancelBtn = document.getElementById('mfa-cancel-btn');
    const promptText = document.getElementById('mfa-prompt-text');

    let isRecoveryMode = false;

    codeInput.focus();

    // Auto-submit when 6 digits entered
    codeInput.addEventListener('input', () => {
        mfaError.textContent = '';
        if (!isRecoveryMode && codeInput.value.length === 6) {
            verifyBtn.click();
        }
    });

    // Enter key to submit
    codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyBtn.click();
    });

    recoveryToggle.addEventListener('click', () => {
        isRecoveryMode = !isRecoveryMode;
        if (isRecoveryMode) {
            promptText.textContent = 'Enter one of your 8-character recovery codes.';
            codeInput.placeholder = 'ABCD1234';
            codeInput.maxLength = 8;
            codeInput.inputMode = 'text';
            codeInput.pattern = '';
            codeInput.style.letterSpacing = '4px';
            codeInput.style.fontSize = '20px';
            recoveryToggle.textContent = 'Use Authenticator Code';
        } else {
            promptText.textContent = 'Enter the 6-digit code from your authenticator app.';
            codeInput.placeholder = '000000';
            codeInput.maxLength = 6;
            codeInput.inputMode = 'numeric';
            codeInput.pattern = '[0-9]*';
            codeInput.style.letterSpacing = '8px';
            codeInput.style.fontSize = '24px';
            recoveryToggle.textContent = 'Use Recovery Code';
        }
        codeInput.value = '';
        mfaError.textContent = '';
        codeInput.focus();
    });

    cancelBtn.addEventListener('click', async () => {
        await auth.signOut();
        overlay.remove();
        isLoggingIn = false;
    });

    verifyBtn.addEventListener('click', async () => {
        const code = codeInput.value.trim();
        if (!code) {
            mfaError.textContent = 'Please enter a code.';
            return;
        }
        if (!isRecoveryMode && code.length !== 6) {
            mfaError.textContent = 'Please enter all 6 digits.';
            return;
        }

        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
        mfaError.textContent = '';

        try {
            const verifyMFALogin = functions.httpsCallable('verifyMFALogin');
            await verifyMFALogin({
                code: code,
                isRecoveryCode: isRecoveryMode,
            });

            // Success — redirect to app
            overlay.remove();
            window.location.href = '/app';
        } catch (error) {
            console.error('MFA verification error:', error);
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Verify';
            mfaError.textContent = error.message || 'Invalid code. Please try again.';
            codeInput.value = '';
            codeInput.focus();
        }
    });
}

// Generate a REF-XXXXXXX referral code (client-side, for new user registration)
function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let code = 'REF-';
    for (let i = 0; i < 7; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Register new user in Firestore (creates trial record + referral code)
async function registerUser(firebaseUser, referralCode) {
    try {
        const db = firebase.firestore();
        const userData = {
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || '',
            trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
            subscriptionStatus: 'trial',
            referralCode: generateReferralCode(),
            paidReferralCount: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (referralCode) {
            userData.referredBy = referralCode;
        }
        // Attach UTM / gclid / fbclid / referrer captured on landing so we can
        // measure paid-ad ROI and organic attribution in the admin panel.
        const acquisitionSource = getAcquisitionSourceForSignup();
        if (acquisitionSource) {
            userData.acquisitionSource = acquisitionSource;
        }
        await db.collection('users').doc(firebaseUser.uid).set(userData);
        clearAcquisition();
    } catch (e) {
        console.error('Failed to register user in Firestore:', e);
    }
}

// Ensure users/{uid} doc exists — creates it if missing (safety net for Google Sign-In)
// Uses set with merge so it never overwrites existing subscription data
async function ensureUserRegistered(firebaseUser) {
    try {
        const db = firebase.firestore();
        const userDoc = await db.collection('users').doc(firebaseUser.uid).get();
        if (!userDoc.exists) {
            console.log('users doc missing for', firebaseUser.uid, '— creating now');
            await db.collection('users').doc(firebaseUser.uid).set({
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || '',
                trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
                subscriptionStatus: 'trial',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                referralCode: generateReferralCode(),
                paidReferralCount: 0,
            });
        } else {
            // Doc exists — update email/displayName if they changed (Google can update these)
            // Also backfill referralCode for users who predate the referral system.
            const data = userDoc.data();
            const updates = {};
            if (firebaseUser.email && firebaseUser.email !== data.email) {
                updates.email = firebaseUser.email;
            }
            if (firebaseUser.displayName && firebaseUser.displayName !== data.displayName) {
                updates.displayName = firebaseUser.displayName;
            }
            // Backfill referralCode for existing users who don't have one
            if (!data.referralCode) {
                updates.referralCode = generateReferralCode();
                updates.paidReferralCount = data.paidReferralCount || 0;
            }
            if (Object.keys(updates).length > 0) {
                await db.collection('users').doc(firebaseUser.uid).set(updates, { merge: true });
            }
        }
    } catch (e) {
        console.error('Failed to ensure user registered in Firestore:', e);
    }
}

// If already signed in, redirect to app (but not during login flow)
auth.onAuthStateChanged((user) => {
    if (user && !isLoggingIn) {
        window.location.href = '/app';
    }
});

// UI Helpers
function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
        ? '<span class="spinner"></span>'
        : (isSignUp ? 'Create Account' : 'Sign In');
    emailInput.disabled = loading;
    passwordInput.disabled = loading;
    confirmPasswordInput.disabled = loading;
    googleBtn.disabled = loading;
}

function getErrorMessage(code) {
    switch (code) {
        case 'auth/user-not-found':
            return 'No account found with this email.';
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return 'Incorrect email or password.';
        case 'auth/email-already-in-use':
            return 'An account with this email already exists.';
        case 'auth/weak-password':
            return 'Password must be at least 6 characters.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please try again later.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your connection.';
        default:
            return 'Something went wrong. Please try again.';
    }
}
