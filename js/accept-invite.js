import { firebaseConfig, APP_CHECK_SITE_KEY } from './firebase-config.js';
import { activateAppCheck } from './app-check-boot.js';
import { confirmModal } from './services/modal-manager.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
// App Check must activate before any auth / firestore / functions call.
// No-op if APP_CHECK_SITE_KEY is empty.
activateAppCheck(firebase, APP_CHECK_SITE_KEY);
const auth = firebase.auth();
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

const ROLE_LABELS = {
    'companion': 'Companion',
    'advisor': 'Financial Advisor',
    'viewer': 'Viewer',
    'partner': 'Partner',
    'full': 'Full Access'
};

const ROLE_ACCESS_TEXT = {
    'companion': 'Budgets & selected account balances',
    'advisor': 'Read-only financial picture',
    'viewer': 'View everything',
    'partner': 'View everything, manage day-to-day',
    'full': 'View and edit everything'
};

// Prefer the RBAC role for display; fall back to the legacy type/permissions.
function getBadgeLabel(invite) {
    return invite.role ? ROLE_LABELS[invite.role] || invite.role : getTypeLabel(invite.type);
}

function getAccessText(invite) {
    if (invite.role && ROLE_ACCESS_TEXT[invite.role]) return ROLE_ACCESS_TEXT[invite.role];
    return invite.permissions === 'edit' ? 'Edit Access' : 'View Only';
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
        <span class="invite-type-badge ${typeClass}">${esc(getBadgeLabel(invite))}</span>
        <div class="invite-info">
            <div class="info-item">
                <div class="info-label">Access Level</div>
                <div class="info-value">${esc(getAccessText(invite))}</div>
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
        // Fetch display-safe invite details via Cloud Function. A direct
        // Firestore read doesn't work here: security rules (correctly)
        // require auth, but this page must render for signed-out invitees.
        const getInvitePreview = functions.httpsCallable('getInvitePreview');
        const result = await getInvitePreview({ inviteId });

        const invite = result.data.invite;
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
        if (err && (err.code === 'not-found' || err.code === 'functions/not-found')) {
            showError('This invitation was not found. It may have been cancelled or expired.');
        } else {
            showError('Unable to load invitation. Please try again later.');
        }
    }
}

function showInviteDetails(invite) {
    document.getElementById('inviter-name').textContent = invite.inviterName || 'Someone';
    document.getElementById('inviter-email').textContent = invite.inviterEmail || '';

    const typeBadge = document.getElementById('invite-type-badge');
    typeBadge.textContent = getBadgeLabel(invite);
    typeBadge.className = 'invite-type-badge';
    if (invite.type === 'cpa') typeBadge.classList.add('cpa');
    if (invite.type === 'financial-planner') typeBadge.classList.add('financial-planner');

    document.getElementById('permissions-text').textContent = getAccessText(invite);
    document.getElementById('invite-date').textContent = formatDate(invite.createdAt);
    document.getElementById('permissions-description').textContent =
        invite.role ? (ROLE_ACCESS_TEXT[invite.role] || 'view').toLowerCase() :
        (invite.permissions === 'edit' ? 'view and edit' : 'view');

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

    if (!(await confirmModal({ title: 'Decline invitation', message: 'Are you sure you want to decline this invitation?', confirmLabel: 'Decline', danger: true }))) {
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
