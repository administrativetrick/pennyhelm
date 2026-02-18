import { store } from './store.js';
import { auth } from './auth.js';
import { seedSampleData } from './seed.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderBills } from './pages/bills.js';
import { renderCalendar } from './pages/calendar.js';
import { renderSettings } from './pages/settings.js';
import { renderDebts } from './pages/debts.js';
import { renderIncome } from './pages/income.js';
import { renderAdmin } from './pages/admin.js';
import { renderAccounts } from './pages/accounts.js';
import { initChatbot } from './chatbot.js';
import { shouldShowOnboarding, startOnboarding, resetOnboarding } from './onboarding.js';
import { shouldSyncTransactions, syncPlaidTransactions } from './plaid.js';
import {
    openModal, closeModal, showToast,
    showSubscriptionModal, showRedeemCodeModal,
    showPastDueBanner, showTrialBanner, showTrialExpiredScreen,
    openManageSubscription
} from './services/modal-manager.js';

const pages = {
    dashboard: renderDashboard,
    bills: renderBills,
    calendar: renderCalendar,
    income: renderIncome,
    debts: renderDebts,
    accounts: renderAccounts,
    settings: renderSettings,
    admin: renderAdmin
};

let currentPage = 'dashboard';
let currentSubTab = null;

function navigate(page) {
    // Redirect legacy hashes
    if (page === 'taxes') {
        window.location.hash = 'income/documents';
        return;
    }
    // Handle sub-tabs like "income/documents" or "income/deductions"
    let subTab = null;
    if (page.includes('/')) {
        const parts = page.split('/');
        page = parts[0];
        subTab = parts[1];
    }

    if (!pages[page]) page = 'dashboard';

    // Guard: admin page only accessible to admins in cloud mode
    if (page === 'admin' && (!auth.isCloud() || !auth.isAdmin())) {
        page = 'dashboard';
    }

    currentPage = page;
    currentSubTab = subTab;

    // Update nav active states
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });
    document.querySelectorAll('.mobile-nav a').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });

    // Render page with subTab
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    pages[page](main, store, subTab);

    // Update hash (preserve sub-tab in URL)
    if (subTab) {
        window.location.hash = `${page}/${subTab}`;
    } else {
        window.location.hash = page;
    }
}

export function refreshPage() {
    navigate(currentSubTab ? `${currentPage}/${currentSubTab}` : currentPage);
}

// Update dependent-related UI elements in navigation
export function updateDependentNav() {
    // Currently no dependent-specific nav items to update
}

export { navigate, openModal, closeModal };

// Init
function init() {
    // Set dynamic app name from stored user name
    const userName = store.getUserName();
    const logoText = document.querySelector('.logo-text');
    if (logoText) logoText.textContent = userName + ' Finances';
    const logo = document.querySelector('.logo');
    if (logo) logo.textContent = userName.charAt(0).toUpperCase() + 'F';
    document.title = userName + ' Finances';

    // Desktop nav clicks
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(link.dataset.page);
        });
    });

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    // Create mobile nav
    createMobileNav();

    // Handle hash
    const hash = window.location.hash.slice(1);
    navigate(hash || 'dashboard');

    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.slice(1);
        const currentFull = currentSubTab ? `${currentPage}/${currentSubTab}` : currentPage;
        if (hash !== currentFull) navigate(hash);
    });
}

function createMobileNav() {
    const nav = document.createElement('nav');
    nav.className = 'mobile-nav';
    nav.innerHTML = `
        <a href="#dashboard" data-page="dashboard" class="active">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Dashboard
        </a>
        <a href="#bills" data-page="bills">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Bills
        </a>
        <a href="#calendar" data-page="calendar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Calendar
        </a>
        <a href="#income" data-page="income">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Income
        </a>
        <a href="#debts" data-page="debts">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Debts
        </a>
        <a href="#accounts" data-page="accounts">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg>
            Accounts
        </a>
        <a href="#settings" data-page="settings">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>
            Settings
        </a>
    `;
    document.body.appendChild(nav);

    nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(link.dataset.page);
        });
    });
}

function showWelcomeScreen() {
    return new Promise((resolve) => {
        const main = document.getElementById('main-content');
        main.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
                <div style="max-width:500px;text-align:center;padding:40px;">
                    <div style="font-size:48px;margin-bottom:16px;">
                        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/><path d="M6 16h4"/></svg>
                    </div>
                    <h1 style="font-size:28px;font-weight:700;margin-bottom:8px;">Welcome to Personal Finances</h1>
                    <p style="color:var(--text-secondary);margin-bottom:32px;line-height:1.6;">
                        Track your bills, accounts, debts, and taxes all in one place.
                        How would you like to get started?
                    </p>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <button class="btn btn-primary" id="welcome-sample" style="padding:14px 24px;font-size:15px;">
                            Load Sample Data
                            <div style="font-size:12px;opacity:0.8;margin-top:4px;">Explore with example bills, accounts, and debts</div>
                        </button>
                        <button class="btn btn-secondary" id="welcome-empty" style="padding:14px 24px;font-size:15px;">
                            Start Fresh
                            <div style="font-size:12px;opacity:0.8;margin-top:4px;">Set up everything yourself from scratch</div>
                        </button>
                    </div>
                    <p style="color:var(--text-muted);font-size:12px;margin-top:24px;">
                        You can always clear sample data or import your own data later in Settings.
                    </p>
                </div>
            </div>
        `;

        document.getElementById('welcome-sample').addEventListener('click', () => {
            seedSampleData();
            store.completeSetup();
            resolve();
        });

        document.getElementById('welcome-empty').addEventListener('click', () => {
            store.completeSetup();
            resolve();
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize auth (determines mode, checks login for cloud)
    await auth.init();

    // 2. Configure store backend based on mode
    if (auth.isCloud()) {
        store.setMode('cloud');
        store.initFirestore(auth.getUserId());
    } else {
        store.setMode('selfhost');
        store.setAuthProvider(() => auth.getAuthHeaders());
    }

    // 3. Load data from server/Firestore
    await store.initFromServer();

    // 4. Cloud mode: check trial status
    if (auth.isCloud()) {
        const trialOk = await checkTrialStatus();
        if (!trialOk) return; // expired — don't render app
    }

    // 5. First run — show welcome screen before initializing
    if (!store.isSetupComplete()) {
        await showWelcomeScreen();
    }

    init();

    // 5a. Show onboarding guide for new users (or existing users who haven't seen it)
    if (shouldShowOnboarding()) {
        setTimeout(() => startOnboarding(), 400);
    }

    // 5b. Auto-sync Plaid transactions as expenses (once per day)
    if (auth.isCloud() && shouldSyncTransactions(store)) {
        syncPlaidTransactions(store).then(result => {
            if (result.imported > 0) {
                console.log(`Auto-imported ${result.imported} transaction(s) as expenses.`);
                if (window.location.hash.includes('expenses')) {
                    navigate(window.location.hash.slice(1));
                }
            }
        }).catch(() => { /* non-critical */ });
    }

    // 5c. Snapshot account balances daily for history tracking
    try {
        if (store.getAccounts().length > 0) {
            const history = store.getBalanceHistory();
            const today = new Date().toISOString().slice(0, 10);
            if (!history.length || history[history.length - 1].date !== today) {
                store.snapshotBalances();
            }
        }
    } catch (e) { /* snapshot is non-critical */ }

    // 6. Cloud mode: add sign-out and user info to sidebar
    if (auth.isCloud()) {
        addCloudUI();
        initChatbot();
    }
});

async function checkTrialStatus() {
    try {
        if (auth.isAdmin()) return true;

        const status = await auth.getUserStatus();

        if (status.status === 'active') return true;

        if (status.status === 'past_due') {
            showPastDueBanner(() => openManageSubscription(auth));
            return true;
        }

        if (status.status === 'expired') {
            showTrialExpiredScreen(
                auth,
                () => showSubscriptionModal(auth),
                () => showRedeemCodeModal(auth)
            );
            return false;
        }

        if (status.status === 'trial' && status.trialDaysRemaining <= 7 && !status.isUnlimited) {
            showTrialBanner(status.trialDaysRemaining, () => showSubscriptionModal(auth));
        }

        // Handle subscription success redirect
        if (window.location.hash === '#subscription-success') {
            showToast('Subscription activated! Welcome to PennyHelm Cloud.', 'success');
            window.location.hash = '#dashboard';
        }

        // Handle mobile "Subscribe on Web" redirect
        if (window.location.hash === '#subscription-needed') {
            window.location.hash = '#dashboard';
            setTimeout(() => showSubscriptionModal(auth), 300);
        }

        return true;
    } catch (e) {
        console.error('Failed to check trial status:', e);
        return true; // fail open
    }
}

function addCloudUI() {
    const user = auth.getUser();
    const displayName = user?.displayName || user?.email || 'User';

    // Add admin nav link if user is admin
    if (auth.isAdmin()) {
        const navLinks = document.querySelector('.nav-links');
        if (navLinks) {
            const adminLi = document.createElement('li');
            adminLi.innerHTML = `
                <a href="#admin" class="nav-link" data-page="admin">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/>
                    </svg>
                    <span>Admin</span>
                </a>
            `;
            const settingsLi = navLinks.querySelector('[data-page="settings"]')?.closest('li');
            if (settingsLi) {
                navLinks.insertBefore(adminLi, settingsLi);
            } else {
                navLinks.appendChild(adminLi);
            }

            adminLi.querySelector('.nav-link').addEventListener('click', (e) => {
                e.preventDefault();
                navigate('admin');
            });
        }

        // Also add to mobile nav if it exists
        const mobileNav = document.querySelector('.mobile-nav');
        if (mobileNav) {
            const settingsMobileLink = mobileNav.querySelector('[data-page="settings"]');
            if (settingsMobileLink) {
                const adminMobileLink = document.createElement('a');
                adminMobileLink.href = '#admin';
                adminMobileLink.dataset.page = 'admin';
                adminMobileLink.innerHTML = `
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/>
                    </svg>
                    Admin
                `;
                mobileNav.insertBefore(adminMobileLink, settingsMobileLink);
                adminMobileLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    navigate('admin');
                });
            }
        }
    }

    // Sign out UI at bottom of sidebar
    const signOutDiv = document.createElement('div');
    signOutDiv.style.cssText = 'padding:8px 18px 12px;border-top:1px solid var(--border);';
    signOutDiv.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;" id="sidebar-display-name"></div>
            <button id="cloud-signout" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;font-weight:500;padding:4px 8px;border-radius:4px;transition:color 0.15s;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-muted)'">Sign Out</button>
        </div>
    `;

    const sidebarNav = document.querySelector('.sidebar');
    if (sidebarNav) {
        sidebarNav.appendChild(signOutDiv);
    }
    const nameEl = document.getElementById('sidebar-display-name');
    if (nameEl) {
        nameEl.textContent = displayName;
        nameEl.title = displayName;
    }

    const signOutBtn = document.getElementById('cloud-signout');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => auth.signOut());
    }
}
