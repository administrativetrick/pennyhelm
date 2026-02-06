import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const functions = firebase.functions();

// State
let isSignUp = false;

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
        } else {
            await auth.signInWithEmailAndPassword(email, password);
        }
        // Redirect to app on success
        window.location.href = '/app';
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
        }

        // Set up mobile credentials via Cloud Function
        await setupMobileCredentials(user, isNewUser);

        window.location.href = '/app';
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') {
            errorDiv.textContent = getErrorMessage(error.code);
        }
    }
});

// Set up mobile credentials via Cloud Function (sends email, links credential)
async function setupMobileCredentials(user, isNewUser) {
    try {
        // Call Cloud Function to generate password and send email
        const setupMobileCredentialsFn = functions.httpsCallable('setupMobileCredentials');
        const result = await setupMobileCredentialsFn({ resend: false });

        if (result.data.alreadySet) {
            // Mobile credentials already configured
            return;
        }

        if (result.data.success && result.data.tempPassword) {
            // Link email/password credential to the Google account
            const emailCredential = firebase.auth.EmailAuthProvider.credential(
                user.email,
                result.data.tempPassword
            );

            try {
                await user.linkWithCredential(emailCredential);
                console.log('Email/password credential linked successfully');
            } catch (linkError) {
                if (linkError.code === 'auth/provider-already-linked') {
                    console.log('Email/password already linked');
                } else if (linkError.code === 'auth/email-already-in-use') {
                    console.log('Email already in use by another account');
                } else {
                    console.error('Error linking credential:', linkError);
                }
            }

            // Show confirmation modal (password was sent to email)
            showMobileCredentialsModal(user.email);
        }
    } catch (error) {
        console.error('Error setting up mobile credentials:', error);
        // Don't block login if mobile setup fails
    }
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

// If already signed in, redirect to app
auth.onAuthStateChanged((user) => {
    if (user) {
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
