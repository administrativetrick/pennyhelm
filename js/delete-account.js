import { firebaseConfig } from './firebase-config.js';

firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const functions = firebase.functions();

// DOM state helpers
const states = ['loading-state', 'login-state', 'delete-state', 'final-state', 'processing-state', 'success-state', 'error-state'];
function showState(stateId) {
    states.forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== stateId);
    });
}

// Wait for auth state
fbAuth.onAuthStateChanged(user => {
    if (!user) {
        showState('login-state');
        return;
    }

    // Show delete confirmation
    document.getElementById('user-email').textContent = user.email || user.uid;
    showState('delete-state');

    // Enable delete button only when "DELETE" is typed
    const input = document.getElementById('delete-confirm-input');
    const deleteBtn = document.getElementById('btn-delete');
    input.addEventListener('input', () => {
        deleteBtn.disabled = input.value.trim() !== 'DELETE';
    });

    // Step 1: First delete button -> show final confirmation
    deleteBtn.addEventListener('click', () => {
        showState('final-state');

        let seconds = 5;
        const countdownEl = document.getElementById('countdown');
        const finalBtn = document.getElementById('btn-final-delete');
        const cancelBtn = document.getElementById('btn-final-cancel');

        const timer = setInterval(() => {
            seconds--;
            countdownEl.textContent = seconds;
            if (seconds <= 0) {
                clearInterval(timer);
                finalBtn.disabled = false;
                finalBtn.textContent = 'Permanently Delete My Account';
            }
        }, 1000);

        cancelBtn.addEventListener('click', () => {
            clearInterval(timer);
            showState('delete-state');
            input.value = '';
            deleteBtn.disabled = true;
        });

        // Step 2: Final delete
        finalBtn.addEventListener('click', async () => {
            finalBtn.disabled = true;
            finalBtn.textContent = 'Deleting...';
            showState('processing-state');

            try {
                const deleteAccountFn = functions.httpsCallable('deleteAccount');
                await deleteAccountFn();

                // Sign out locally
                try {
                    await fbAuth.signOut();
                } catch (e) {
                    // Auth account already deleted server-side, sign-out may fail — that's OK
                }

                showState('success-state');
            } catch (err) {
                console.error('Account deletion failed:', err);
                document.getElementById('error-message').textContent =
                    'Failed to delete account: ' + (err.message || 'Unknown error. Please try again.');
                showState('error-state');
            }
        });
    });

    // Retry button
    document.getElementById('btn-retry').addEventListener('click', () => {
        showState('delete-state');
        document.getElementById('delete-confirm-input').value = '';
        document.getElementById('btn-delete').disabled = true;
    });
});
