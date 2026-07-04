/**
 * Shared mode — the app chrome for viewing finances shared WITH you.
 *
 * When active, the sidebar and mobile nav collapse to what the granted role
 * actually allows: the shared overview (served by the getSharedSnapshot
 * gateway, filtered server-side) plus the viewer's own Settings. Every other
 * route — Bills, Calendar, Income, … — redirects to the shared overview, so
 * a Companion never even sees a Bills tab.
 *
 * Entry points:
 *  - "Shared with you" section in the sidebar (any account with shares)
 *  - Settings → People with access → Shared with me → View
 *  - Automatic on sign-in when the account has exactly one share and no
 *    finances of its own (the "invited girlfriend/advisor" account shape).
 *
 * The context persists in localStorage so the next visit lands straight back
 * in the shared view. Cloud mode only.
 */

import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

const MODE_KEY = 'pennyhelm-shared-mode';   // localStorage: persisted viewing context
const VIEW_KEY = 'pennyhelm-shared-view';   // sessionStorage: read by shared-view.js
const OWN_SETUP_KEY = 'pennyhelm-own-setup-started';   // localStorage: user chose "My finances" — never auto-enter again
const RESUME_ONBOARD_KEY = 'pennyhelm-resume-onboarding'; // sessionStorage: run the setup tour after leaving shared mode

// Pages reachable while shared mode is active; anything else → 'shared'.
export const SHARED_MODE_PAGES = ['shared', 'settings'];

let myShares = [];
let sharesLoaded = false;
let storeRef = null;

async function fetchShares() {
    if (sharesLoaded) return myShares;
    const listMyShares = firebase.functions().httpsCallable('listMyShares');
    const result = await listMyShares({});
    myShares = (result.data && result.data.shares) || [];
    sharesLoaded = true;
    return myShares;
}

function ownSetupStarted() {
    return !!localStorage.getItem(OWN_SETUP_KEY);
}

/**
 * Boot-time check, called BEFORE the first-run welcome screen: an invited
 * account that has never set up finances of its own defaults straight into
 * the shared view — no "Load Sample Data / Start Fresh" screen. Setup stays
 * incomplete, so pressing "My finances" later runs the normal first-run
 * flow. Returns true when shared mode was activated.
 */
export async function maybeAutoEnterSharedEarly({ store, auth }) {
    storeRef = store;
    if (!auth.isCloud()) return false;
    if (isSharedMode()) return true;          // already viewing a share
    if (ownSetupStarted()) return false;      // they chose to build their own
    try {
        const shares = await fetchShares();
        if (shares.length === 0) return false;
        const s = shares[0];
        const state = { ownerUid: s.ownerUid, ownerName: s.ownerName, role: s.role };
        localStorage.setItem(MODE_KEY, JSON.stringify(state));
        sessionStorage.setItem(VIEW_KEY, JSON.stringify(state));
        return true;
    } catch (e) {
        return false; // offline / not deployed — fall back to the welcome screen
    }
}

/**
 * Consumes the "resume onboarding" flag set when a user without finances of
 * their own leaves shared mode via "My finances" — the boot flow uses it to
 * start the setup tour.
 */
export function consumeResumeOnboarding() {
    if (!sessionStorage.getItem(RESUME_ONBOARD_KEY)) return false;
    sessionStorage.removeItem(RESUME_ONBOARD_KEY);
    return true;
}

export function getSharedModeState() {
    try { return JSON.parse(localStorage.getItem(MODE_KEY) || 'null'); } catch (e) { return null; }
}

export function isSharedMode() {
    const s = getSharedModeState();
    return !!(s && s.ownerUid);
}

/**
 * Must run BEFORE the router's first navigate: seeds the sessionStorage key
 * shared-view.js reads, so a fresh tab restored into shared mode renders.
 */
export function primeSharedMode() {
    const state = getSharedModeState();
    if (state && state.ownerUid) {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify(state));
    }
}

export function enterSharedMode(share) {
    const state = { ownerUid: share.ownerUid, ownerName: share.ownerName, role: share.role };
    localStorage.setItem(MODE_KEY, JSON.stringify(state));
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(state));
    applySharedChrome(state);
    navigate('shared');
}

export function exitSharedMode() {
    localStorage.removeItem(MODE_KEY);
    sessionStorage.removeItem(VIEW_KEY);
    // An explicit "My finances" means: stop defaulting to the shared view.
    localStorage.setItem(OWN_SETUP_KEY, '1');
    // If they have no finances of their own yet, the reload runs the
    // first-run flow (welcome screen if setup never completed) and this
    // flag starts the setup tour on top.
    const noOwnFinances = !storeRef || !storeRef.isSetupComplete() || ownDataIsEmpty(storeRef);
    if (noOwnFinances) sessionStorage.setItem(RESUME_ONBOARD_KEY, '1');
    // Reload rebuilds the full sidebar/mobile nav with their listeners.
    window.location.hash = 'dashboard';
    window.location.reload();
}

/**
 * Runs after init(): applies shared chrome if a context is persisted, then
 * asynchronously loads this account's shares to (a) validate the persisted
 * context, (b) offer a "Shared with you" sidebar section in normal mode,
 * (c) auto-enter for accounts whose only purpose is a share.
 */
export function initSharedMode({ store, auth }) {
    if (!auth.isCloud()) return;
    storeRef = store;

    const state = getSharedModeState();
    if (state && state.ownerUid) {
        applySharedChrome(state);
    }

    (async () => {
        try {
            await fetchShares();
        } catch (e) {
            return; // offline or not deployed — leave chrome as-is
        }

        if (isSharedMode()) {
            const current = getSharedModeState();
            const still = myShares.find(s => s.ownerUid === current.ownerUid);
            if (!still) { exitSharedMode(); return; }
            // Refresh the display name/role in case they changed
            if (still.ownerName !== current.ownerName || still.role !== current.role) {
                localStorage.setItem(MODE_KEY, JSON.stringify({ ownerUid: still.ownerUid, ownerName: still.ownerName, role: still.role }));
                applySharedChrome(getSharedModeState());
            }
            return;
        }

        if (myShares.length === 0) return;

        // Default to the shared view for accounts with an invite and no
        // finances of their own — unless they've explicitly chosen
        // "My finances" before.
        if (!ownSetupStarted() && (!store.isSetupComplete() || ownDataIsEmpty(store))) {
            enterSharedMode(myShares[0]);
            return;
        }

        addSharedWithYouSection();
    })();
}

function ownDataIsEmpty(store) {
    try {
        return store.getBills().length === 0
            && store.getAccounts().length === 0
            && store.getDebts().length === 0
            && store.getExpenses().length === 0
            && store.getBudgets().length === 0
            && store.getSavingsGoals().length === 0;
    } catch (e) {
        return false;
    }
}

const ROLE_LABELS = {
    companion: 'Companion', advisor: 'Financial Advisor',
    viewer: 'Viewer', partner: 'Partner', full: 'Full Access'
};

// ── Normal mode: a "Shared with you" section at the bottom of the sidebar ──
function addSharedWithYouSection() {
    const nav = document.querySelector('.nav-links');
    if (!nav || nav.querySelector('.shared-with-you')) return;

    const frag = document.createElement('div');
    frag.innerHTML = `<li class="nav-section shared-with-you">Shared with you</li>` +
        myShares.map((s, i) => `
        <li class="shared-with-you"><a href="#" class="nav-link" data-share-index="${i}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>${escapeHtml(s.ownerName)}</span>
        </a></li>`).join('');
    while (frag.firstChild) nav.appendChild(frag.firstChild);

    nav.querySelectorAll('[data-share-index]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            enterSharedMode(myShares[parseInt(link.dataset.shareIndex, 10)]);
        });
    });
}

// ── Shared mode: replace the sidebar + mobile nav with role-scoped items ──
function applySharedChrome(state) {
    document.body.classList.add('shared-mode');

    state = { ...state, ownerName: state.ownerName || 'Shared' };
    const roleLabel = ROLE_LABELS[state.role] || state.role || '';
    const logoText = document.querySelector('.logo-text');
    if (logoText) logoText.textContent = `${state.ownerName.split(' ')[0]}'s Finances`;
    const logo = document.querySelector('.logo');
    if (logo) logo.textContent = state.ownerName.charAt(0).toUpperCase() + 'F';
    document.title = `${state.ownerName.split(' ')[0]}'s Finances - PennyHelm`;

    const nav = document.querySelector('.nav-links');
    if (nav) {
        nav.innerHTML = `
            <li class="nav-section">${escapeHtml(state.ownerName)}${roleLabel ? ` · ${escapeHtml(roleLabel)}` : ''}</li>
            <li><a href="#shared" class="nav-link" data-page="shared">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                <span>Overview</span>
            </a></li>
            <li class="nav-section">Your account</li>
            <li><a href="#settings" class="nav-link" data-page="settings">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>
                <span>Settings</span>
            </a></li>
            <li><a href="#" class="nav-link" id="exit-shared-mode">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>My finances</span>
            </a></li>`;

        nav.querySelectorAll('.nav-link[data-page]').forEach(link => {
            link.addEventListener('click', (e) => { e.preventDefault(); navigate(link.dataset.page); });
        });
        nav.querySelector('#exit-shared-mode').addEventListener('click', (e) => {
            e.preventDefault();
            exitSharedMode();
        });
        // Reflect whatever page the router already landed on
        const activePage = (window.location.hash.slice(1).split('/')[0]) || 'shared';
        nav.querySelectorAll('.nav-link[data-page]').forEach(link => {
            link.classList.toggle('active', link.dataset.page === activePage);
        });
    }

    const mobile = document.querySelector('.mobile-nav');
    if (mobile) {
        mobile.innerHTML = `
            <a href="#shared" data-page="shared" class="active">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                Overview
            </a>
            <a href="#settings" data-page="settings">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>
                Settings
            </a>
            <a href="#" id="mobile-exit-shared">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                My finances
            </a>`;
        mobile.querySelectorAll('a[data-page]').forEach(link => {
            link.addEventListener('click', (e) => { e.preventDefault(); navigate(link.dataset.page); });
        });
        mobile.querySelector('#mobile-exit-shared').addEventListener('click', (e) => {
            e.preventDefault();
            exitSharedMode();
        });
    }
}
