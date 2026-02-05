import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

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
        // Register if new user
        if (result.additionalUserInfo && result.additionalUserInfo.isNewUser) {
            await registerUser(result.user);
        }
        window.location.href = '/app';
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') {
            errorDiv.textContent = getErrorMessage(error.code);
        }
    }
});

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
