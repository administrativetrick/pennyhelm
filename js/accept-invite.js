import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

// DOM elements
const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const loginState = document.getElementById('login-state');
const inviteState = document.getElementById('invite-state');
const successState = document.getElementById('success-state');
const declinedState = document.getElementById('declined-state');
const errorMessage = document.getElementById('error-message');

// Get invite ID from URL
const urlParams = new URLSearchParams(window.location.search);
const inviteId = urlParams.get('id');

// Helper functions
function showState(stateElement) {
    [loadingState, errorState, loginState, inviteState, successState, declinedState].forEach(el => {
        el.classList.add('hidden');
    });
    stateElement.classList.remove('hidden');
}

function showError(message) {
    errorMessage.textContent = message;
    showState(errorState);
}

function getTypeLabel(type) {
    const labels = {
        'partner': 'Partner/Spouse',
        'financial-planner': 'Financial Planner',
        'cpa': 'CPA/Accountant'
    };
    return labels[type] || type;
}

function formatDate(timestamp) {
    if (!timestamp) return 'Recently';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
}

function populateInviteDetails(invite, container) {
    const typeClass = invite.type === 'cpa' ? 'cpa' :
                     invite.type === 'financial-planner' ? 'financial-planner' : '';

    // Escape user-supplied values to prevent XSS
    const esc = (str) => {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };
    container.innerHTML = `
        <div class="inviter-name">${esc(invite.inviterName || 'Someone')}</div>
        <div class="inviter-email">${esc(invite.inviterEmail || '')}</div>
        <span class="invite-type-badge ${typeClass}">${esc(getTypeLabel(invite.type))}</span>
        <div class="invite-info">
            <div class="info-item">
                <div class="info-label">Access Level</div>
                <div class="info-value">${invite.permissions === 'edit' ? 'Edit Access' : 'View Only'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Invited</div>
                <div class="info-value">${formatDate(invite.createdAt)}</div>
            </div>
        </div>
    `;
}

// Store invite data globally for after login
let currentInvite = null;

async function loadInvite() {
    if (!inviteId) {
        showError('No invitation ID provided. Please check your invitation link.');
        return;
    }

    try {
        // Fetch invite details from Firestore
        const inviteDoc = await db.collection('invites').doc(inviteId).get();

        if (!inviteDoc.exists) {
            showError('This invitation was not found. It may have been cancelled or expired.');
            return;
        }

        const invite = inviteDoc.data();
        currentInvite = invite;

        // Check invite status
        if (invite.status === 'accepted') {
            showError('This invitation has already been accepted.');
            return;
        }
        if (invite.status === 'declined') {
            showError('This invitation has been declined.');
            return;
        }
        if (invite.status === 'revoked') {
            showError('This invitation has been cancelled by the sender.');
            return;
        }

        // Check if user is logged in
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                // User is logged in
                const userEmail = user.email.toLowerCase();
                const inviteeEmail = invite.inviteeEmail.toLowerCase();

                if (userEmail !== inviteeEmail) {
                    showError(`This invitation was sent to ${invite.inviteeEmail}. You're signed in as ${user.email}. Please sign in with the correct account.`);
                    return;
                }

                // Show invite details for acceptance
                showInviteDetails(invite);
            } else {
                // User not logged in - show login prompt with invite preview
                const loginPreview = document.getElementById('login-invite-preview');
                populateInviteDetails(invite, loginPreview);

                // Store invite ID for after login redirect
                sessionStorage.setItem('pendingInviteId', inviteId);

                showState(loginState);
            }
        });

    } catch (err) {
        console.error('Error loading invite:', err);
        showError('Unable to load invitation. Please try again later.');
    }
}

function showInviteDetails(invite) {
    document.getElementById('inviter-name').textContent = invite.inviterName || 'Someone';
    document.getElementById('inviter-email').textContent = invite.inviterEmail || '';

    const typeBadge = document.getElementById('invite-type-badge');
    typeBadge.textContent = getTypeLabel(invite.type);
    typeBadge.className = 'invite-type-badge';
    if (invite.type === 'cpa') typeBadge.classList.add('cpa');
    if (invite.type === 'financial-planner') typeBadge.classList.add('financial-planner');

    document.getElementById('permissions-text').textContent =
        invite.permissions === 'edit' ? 'Edit Access' : 'View Only';
    document.getElementById('invite-date').textContent = formatDate(invite.createdAt);
    document.getElementById('permissions-description').textContent =
        invite.permissions === 'edit' ? 'view and edit' : 'view';

    // Wire up buttons
    document.getElementById('btn-accept').onclick = () => acceptInvite(invite);
    document.getElementById('btn-decline').onclick = () => declineInvite(invite);

    showState(inviteState);
}

async function acceptInvite(invite) {
    const acceptBtn = document.getElementById('btn-accept');
    const declineBtn = document.getElementById('btn-decline');

    acceptBtn.disabled = true;
    declineBtn.disabled = true;
    acceptBtn.textContent = 'Accepting...';

    try {
        const acceptInviteFn = functions.httpsCallable('acceptInvite');
        const result = await acceptInviteFn({ inviteId });

        document.getElementById('success-message').textContent = result.data.message ||
            `You now have ${invite.permissions} access to ${invite.inviterName}'s finances.`;

        // Clear the pending invite from session
        sessionStorage.removeItem('pendingInviteId');

        showState(successState);

    } catch (err) {
        console.error('Error accepting invite:', err);
        acceptBtn.disabled = false;
        declineBtn.disabled = false;
        acceptBtn.textContent = 'Accept Invitation';
        showError(err.message || 'Failed to accept invitation. Please try again.');
    }
}

async function declineInvite(invite) {
    const acceptBtn = document.getElementById('btn-accept');
    const declineBtn = document.getElementById('btn-decline');

    if (!confirm('Are you sure you want to decline this invitation?')) {
        return;
    }

    acceptBtn.disabled = true;
    declineBtn.disabled = true;
    declineBtn.textContent = 'Declining...';

    try {
        const declineInviteFn = functions.httpsCallable('declineInvite');
        await declineInviteFn({ inviteId });

        // Clear the pending invite from session
        sessionStorage.removeItem('pendingInviteId');

        showState(declinedState);

    } catch (err) {
        console.error('Error declining invite:', err);
        acceptBtn.disabled = false;
        declineBtn.disabled = false;
        declineBtn.textContent = 'Decline';
        showError(err.message || 'Failed to decline invitation. Please try again.');
    }
}

// Initialize
loadInvite();
