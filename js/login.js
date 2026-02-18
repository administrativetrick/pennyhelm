import { firebaseConfig } from './firebase-config.js';
import { APP_MODE } from './mode-config.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const functions = firebase.functions();

const isCloudMode = APP_MODE === 'cloud';

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
const inviteCodeGroup = document.getElementById('invite-code-group');
const inviteCodeInput = document.getElementById('auth-invite-code');
const errorDiv = document.getElementById('auth-error');
const submitBtn = document.getElementById('auth-submit');
const googleBtn = document.getElementById('google-signin');

// Tab switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        isSignUp = tab.dataset.tab === 'signup';

        confirmGroup.style.display = isSignUp ? 'block' : 'none';
        if (inviteCodeGroup) {
            inviteCodeGroup.style.display = (isSignUp && isCloudMode) ? 'block' : 'none';
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
            // Validate invite code before creating account (cloud mode only)
            const inviteCode = inviteCodeInput ? inviteCodeInput.value.trim().toUpperCase() : '';
            if (isCloudMode) {
                if (!inviteCode) {
                    errorDiv.textContent = 'An invite code is required to create an account.';
                    setLoading(false);
                    return;
                }
                try {
                    const validateCode = functions.httpsCallable('validateRegistrationCode');
                    await validateCode({ code: inviteCode });
                } catch (err) {
                    errorDiv.textContent = err.message || 'Invalid or already-used invite code.';
                    setLoading(false);
                    return;
                }
            }

            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await registerUser(userCredential.user, inviteCode);

            // Redeem invite code and generate user's own codes (cloud mode)
            if (isCloudMode && inviteCode) {
                try {
                    const redeemCode = functions.httpsCallable('redeemRegistrationCode');
                    await redeemCode({ code: inviteCode });
                    const genCodes = functions.httpsCallable('generateRegistrationCodes');
                    await genCodes({});
                } catch (err) {
                    console.error('Failed to redeem/generate invite codes:', err);
                }
            }

            window.location.href = '/app';
        } else {
            isLoggingIn = true; // Prevent onAuthStateChanged redirect
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            // Ensure users/{uid} doc exists (safety net for all sign-in methods)
            await ensureUserRegistered(userCredential.user);
            console.log('Email/password sign-in successful, checking password change requirement...');
            // Check if password change is required
            const requiresChange = await checkRequiresPasswordChange(userCredential.user);
            console.log('Password change required:', requiresChange);
            if (requiresChange) {
                console.log('Showing password change modal...');
                setLoading(false);
                showPasswordChangeModal(userCredential.user, password);
                return; // Don't redirect
            }
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

    // In cloud mode sign-up, validate invite code BEFORE Google popup
    let inviteCode = null;
    if (isSignUp && isCloudMode) {
        inviteCode = inviteCodeInput ? inviteCodeInput.value.trim().toUpperCase() : '';
        if (!inviteCode) {
            errorDiv.textContent = 'Please enter your invite code before signing up with Google.';
            return;
        }
        try {
            const validateCode = functions.httpsCallable('validateRegistrationCode');
            await validateCode({ code: inviteCode });
        } catch (err) {
            errorDiv.textContent = err.message || 'Invalid or already-used invite code.';
            return;
        }
    }

    const provider = new firebase.auth.GoogleAuthProvider();

    try {
        const result = await auth.signInWithPopup(provider);
        const user = result.user;

        // Check if Firestore user doc exists (more reliable than isNewUser)
        const db = firebase.firestore();
        const userDoc = await db.collection('users').doc(user.uid).get();
        const isFirstTime = !userDoc.exists;

        if (isFirstTime && isCloudMode && !inviteCode) {
            // New user on Sign In tab without invite code — sign out and prompt
            await auth.signOut();
            errorDiv.textContent = 'No account found. Please switch to Sign Up and enter an invite code.';
            return;
        }

        if (isFirstTime) {
            // New user — create doc (with invite code if in cloud mode)
            await registerUser(user, inviteCode || null);

            if (isCloudMode && inviteCode) {
                try {
                    const redeemCode = functions.httpsCallable('redeemRegistrationCode');
                    await redeemCode({ code: inviteCode });
                    const genCodes = functions.httpsCallable('generateRegistrationCodes');
                    await genCodes({});
                } catch (err) {
                    console.error('Failed to redeem/generate invite codes:', err);
                }
            }
        } else {
            // Existing user — ensure doc is up to date
            await ensureUserRegistered(user);
        }

        // Set up mobile credentials if needed (works for both new and existing users)
        await checkAndSetupMobileCredentials(user);

        // Check if MFA is enabled for existing users
        if (!isFirstTime) {
            const mfaRequired = await checkMFAEnabled(user);
            if (mfaRequired) {
                showMFAVerificationModal();
                return;
            }
        }

        window.location.href = '/app';
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') {
            errorDiv.textContent = getErrorMessage(error.code);
        }
    }
});

// Set up mobile credentials via Cloud Function (sends email, sets password server-side)
// Called for NEW users on first Google sign-in
async function setupMobileCredentials(user) {
    try {
        console.log('Calling setupMobileCredentials Cloud Function...');
        // Call Cloud Function to generate password, set it in Firebase Auth, and send email
        const setupMobileCredentialsFn = functions.httpsCallable('setupMobileCredentials');
        const result = await setupMobileCredentialsFn({ resend: false });
        console.log('Cloud Function result:', result.data);

        if (result.data.success && !result.data.alreadySet) {
            // Show confirmation modal (password was sent to email)
            showMobileCredentialsModal(user.email);
        }
    } catch (error) {
        console.error('Error setting up mobile credentials:', error);
        // Don't block login if mobile setup fails
    }
}

// Check if existing user needs mobile credentials and set them up if not
async function checkAndSetupMobileCredentials(user) {
    try {
        console.log('Checking mobile credentials for user:', user.uid);
        const db = firebase.firestore();
        const userDoc = await db.collection('users').doc(user.uid).get();
        console.log('User doc exists:', userDoc.exists, 'mobilePasswordSet:', userDoc.exists ? userDoc.data().mobilePasswordSet : 'N/A');

        // If user doesn't have mobile credentials set up, create them
        if (!userDoc.exists || !userDoc.data().mobilePasswordSet) {
            console.log('Setting up mobile credentials...');
            await setupMobileCredentials(user);
        } else {
            console.log('Mobile credentials already set up');
        }
    } catch (error) {
        console.error('Error checking mobile credentials:', error);
        // Don't block login if check fails
    }
}

// Check if user needs to change their password
async function checkRequiresPasswordChange(user) {
    try {
        const db = firebase.firestore();
        const userDoc = await db.collection('users').doc(user.uid).get();
        console.log('Checking password change for user:', user.uid);
        console.log('User doc exists:', userDoc.exists);
        if (userDoc.exists) {
            console.log('requirePasswordChange value:', userDoc.data().requirePasswordChange);
        }
        const requiresChange = userDoc.exists && userDoc.data().requirePasswordChange === true;
        console.log('Will show password change modal:', requiresChange);
        return requiresChange;
    } catch (error) {
        console.error('Error checking password change requirement:', error);
        return false;
    }
}

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
            <div class="form-group" style="margin-top:16px;">
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

// Show password change modal
function showPasswordChangeModal(user, currentPassword) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content">
            <h2>🔐 Password Change Required</h2>
            <p>For security reasons, you must change your temporary password.</p>
            <div class="form-group" style="margin-top:16px;">
                <label>New Password</label>
                <input type="password" class="form-input" id="new-password" placeholder="Enter new password" minlength="6">
            </div>
            <div class="form-group">
                <label>Confirm New Password</label>
                <input type="password" class="form-input" id="confirm-new-password" placeholder="Confirm new password">
            </div>
            <div id="password-change-error" style="color:var(--red);font-size:13px;margin-bottom:12px;"></div>
            <button class="btn btn-primary" id="change-password-btn" style="width:100%;">Change Password</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const newPasswordInput = document.getElementById('new-password');
    const confirmInput = document.getElementById('confirm-new-password');
    const errorDiv = document.getElementById('password-change-error');
    const changeBtn = document.getElementById('change-password-btn');

    changeBtn.addEventListener('click', async () => {
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmInput.value;

        // Validate
        if (newPassword.length < 6) {
            errorDiv.textContent = 'Password must be at least 6 characters.';
            return;
        }
        if (newPassword !== confirmPassword) {
            errorDiv.textContent = 'Passwords do not match.';
            return;
        }
        if (newPassword === currentPassword) {
            errorDiv.textContent = 'New password must be different from current password.';
            return;
        }

        changeBtn.disabled = true;
        changeBtn.textContent = 'Changing...';
        errorDiv.textContent = '';

        try {
            // Update password in Firebase Auth
            await user.updatePassword(newPassword);

            // Clear the requirePasswordChange flag via Cloud Function
            const confirmFn = functions.httpsCallable('confirmPasswordChanged');
            await confirmFn({});

            // Success - redirect to app
            overlay.remove();
            window.location.href = '/app';
        } catch (error) {
            console.error('Error changing password:', error);
            changeBtn.disabled = false;
            changeBtn.textContent = 'Change Password';
            if (error.code === 'auth/requires-recent-login') {
                errorDiv.textContent = 'Session expired. Please sign in again.';
            } else {
                errorDiv.textContent = 'Failed to change password. Please try again.';
            }
        }
    });
}

// Show modal confirming credentials were emailed
function showMobileCredentialsModal(email) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content">
            <h2>📱 Mobile App Access</h2>
            <p>Your mobile app login credentials have been sent to:</p>
            <div class="credentials-box">
                <div class="credential-row">
                    <span class="credential-value" style="text-align:center;width:100%;" id="mobile-cred-email"></span>
                </div>
            </div>
            <p class="modal-note" style="color: var(--orange);">
                <strong>Important:</strong> You will be required to change your password on first mobile login.
            </p>
            <p class="modal-note">
                Check your email for the temporary password.
            </p>
            <button class="btn-modal-close" onclick="this.closest('.modal-overlay').remove(); window.location.href='/app';">
                Got it, continue to app
            </button>
        </div>
    `;
    document.body.appendChild(overlay);
    // Set email via textContent to prevent XSS
    const emailEl = document.getElementById('mobile-cred-email');
    if (emailEl) emailEl.textContent = email;
}

// Register new user in Firestore (creates trial record)
async function registerUser(firebaseUser, inviteCode) {
    try {
        const db = firebase.firestore();
        const userData = {
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || '',
            trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
            subscriptionStatus: 'trial',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (inviteCode) {
            userData.invitedBy = inviteCode;
        }
        await db.collection('users').doc(firebaseUser.uid).set(userData);
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
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            // Doc exists — update email/displayName if they changed (Google can update these)
            const data = userDoc.data();
            const updates = {};
            if (firebaseUser.email && firebaseUser.email !== data.email) {
                updates.email = firebaseUser.email;
            }
            if (firebaseUser.displayName && firebaseUser.displayName !== data.displayName) {
                updates.displayName = firebaseUser.displayName;
            }
            if (Object.keys(updates).length > 0) {
                await db.collection('users').doc(firebaseUser.uid).set(updates, { merge: true });
            }
        }
    } catch (e) {
        console.error('Failed to ensure user registered in Firestore:', e);
    }
}

// ── Waitlist ─────────────────────────────────
const waitlistSection = document.getElementById('waitlist-section');
const showWaitlistLink = document.getElementById('show-waitlist-link');
const hideWaitlistLink = document.getElementById('hide-waitlist-link');
const waitlistEmailInput = document.getElementById('waitlist-email');
const waitlistSubmitBtn = document.getElementById('waitlist-submit');
const waitlistResult = document.getElementById('waitlist-result');

if (showWaitlistLink) {
    showWaitlistLink.addEventListener('click', (e) => {
        e.preventDefault();
        inviteCodeGroup.style.display = 'none';
        waitlistSection.style.display = 'block';
        // Pre-fill with email from the main form if available
        if (emailInput.value.trim()) {
            waitlistEmailInput.value = emailInput.value.trim();
        }
    });
}

if (hideWaitlistLink) {
    hideWaitlistLink.addEventListener('click', (e) => {
        e.preventDefault();
        waitlistSection.style.display = 'none';
        if (isSignUp && isCloudMode) {
            inviteCodeGroup.style.display = 'block';
        }
    });
}

if (waitlistSubmitBtn) {
    waitlistSubmitBtn.addEventListener('click', async () => {
        const email = waitlistEmailInput.value.trim();
        if (!email) {
            waitlistResult.innerHTML = '<p style="color:var(--red);font-size:12px;margin-top:8px;">Please enter your email address.</p>';
            return;
        }

        waitlistSubmitBtn.disabled = true;
        waitlistSubmitBtn.innerHTML = '<span class="spinner"></span>';
        waitlistResult.innerHTML = '';

        try {
            const joinWaitlist = functions.httpsCallable('joinWaitlist');
            const result = await joinWaitlist({ email });
            const data = result.data;

            if (data.alreadyApproved) {
                waitlistResult.innerHTML = `
                    <div style="padding:12px;background:var(--green-bg, #e8f5e9);border-radius:6px;margin-top:8px;">
                        <p style="color:var(--green, #2e7d32);font-size:13px;font-weight:600;margin:0;">You've already been approved!</p>
                        <p style="color:var(--text-secondary);font-size:12px;margin:4px 0 0;">Check your email for your invite code, then come back and sign up.</p>
                    </div>`;
            } else if (data.alreadyOnList) {
                waitlistResult.innerHTML = `
                    <div style="padding:12px;background:var(--accent-bg, #e8eaf6);border-radius:6px;margin-top:8px;">
                        <p style="color:var(--accent);font-size:13px;font-weight:600;margin:0;">You're already on the waitlist!</p>
                        <p style="color:var(--text-secondary);font-size:12px;margin:4px 0 0;">You're #${data.position} in line. We'll email you when it's your turn.</p>
                    </div>`;
            } else {
                waitlistResult.innerHTML = `
                    <div style="padding:12px;background:var(--green-bg, #e8f5e9);border-radius:6px;margin-top:8px;">
                        <p style="color:var(--green, #2e7d32);font-size:13px;font-weight:600;margin:0;">You're #${data.position} on the waitlist!</p>
                        <p style="color:var(--text-secondary);font-size:12px;margin:4px 0 0;">Check your email for a confirmation. We'll send your invite code when it's your turn.</p>
                    </div>`;
            }
        } catch (err) {
            waitlistResult.innerHTML = `<p style="color:var(--red);font-size:12px;margin-top:8px;">${err.message || 'Failed to join waitlist. Please try again.'}</p>`;
        }

        waitlistSubmitBtn.disabled = false;
        waitlistSubmitBtn.textContent = 'Join Waitlist';
    });
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
