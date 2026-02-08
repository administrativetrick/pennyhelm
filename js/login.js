import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const functions = firebase.functions();

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
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await registerUser(userCredential.user);
            window.location.href = '/app';
        } else {
            isLoggingIn = true; // Prevent onAuthStateChanged redirect
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            console.log('Email/password sign-in successful, checking password change requirement...');
            // Check if password change is required
            const requiresChange = await checkRequiresPasswordChange(userCredential.user);
            console.log('Password change required:', requiresChange);
            if (requiresChange) {
                console.log('Showing password change modal...');
                setLoading(false);
                showPasswordChangeModal(userCredential.user, password);
                return; // Don't redirect
            } else {
                window.location.href = '/app';
            }
        }
    } catch (error) {
        errorDiv.textContent = getErrorMessage(error.code);
        setLoading(false);
    }
});

// Google Sign-In
googleBtn.addEventListener('click', async () => {
    errorDiv.textContent = '';
    const provider = new firebase.auth.GoogleAuthProvider();

    try {
        const result = await auth.signInWithPopup(provider);
        const user = result.user;
        const isNewUser = result.additionalUserInfo && result.additionalUserInfo.isNewUser;

        // Register if new user
        if (isNewUser) {
            await registerUser(user);
            // Set up mobile credentials via Cloud Function (for NEW users)
            await setupMobileCredentials(user);
        } else {
            // Check if existing user needs mobile credentials set up
            await checkAndSetupMobileCredentials(user);
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
                    <span class="credential-value" style="text-align:center;width:100%;">${email}</span>
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
}

// Register new user in Firestore (creates trial record)
async function registerUser(firebaseUser) {
    try {
        const db = firebase.firestore();
        await db.collection('users').doc(firebaseUser.uid).set({
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || '',
            trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
            subscriptionStatus: 'trial',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.error('Failed to register user in Firestore:', e);
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
