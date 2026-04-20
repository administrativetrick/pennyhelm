import { store } from './store.js';
import { auth } from './auth.js';
import { initMode, capabilities } from './mode/mode.js';
import { seedSampleData } from './seed.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderBills } from './pages/bills.js';
import { renderCalendar } from './pages/calendar.js';
import { renderSettings } from './pages/settings.js';
import { renderDebts } from './pages/debts.js';
import { renderIncome } from './pages/income.js';
import { renderAdmin } from './pages/admin.js';
import { renderAccounts } from './pages/accounts.js';
import { renderRules } from './pages/rules.js';
import { renderBudgets } from './pages/budgets.js';
import { renderSavingsGoalsPage } from './pages/savings.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';
import { openModal, closeModal } from './services/modal-manager.js';
import { pingActiveUser } from './active-ping.js';

const pages = {
    dashboard: renderDashboard,
    bills: renderBills,
    calendar: renderCalendar,
    income: renderIncome,
    debts: renderDebts,
    accounts: renderAccounts,
    budgets: renderBudgets,
    savings: renderSavingsGoalsPage,
    rules: renderRules,
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

    // Guard: admin page only exists in modes that declare the capability
    if (page === 'admin' && (!capabilities().admin || !auth.isAdmin())) {
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
        <a href="#budgets" data-page="budgets">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 4"/></svg>
            Budgets
        </a>
        <a href="#savings" data-page="savings">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16"/><path d="M3 21h18"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>
            Savings
        </a>
        <a href="#rules" data-page="rules">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h6"/><circle cx="19" cy="12" r="3"/><path d="M19 15v3"/></svg>
            Rules
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
    // 1. Register the active mode (cloud or selfhost) — single source of truth
    //    for every subsequent mode-specific action.
    const mode = await initMode();

    // 2. Auth init — delegates to the mode's auth strategy.
    await auth.init();

    // 3. Wire the store's storage backend.
    await mode.initStorage(store, auth);

    // 4. Load data from the configured backend.
    await store.initFromServer();

    // 5. Mode-specific access gate (trial/subscription for cloud; no-op selfhost).
    const canContinue = await mode.gateAccess({ auth, store });
    if (!canContinue) return;

    // 6. First-run welcome screen.
    if (!store.isSetupComplete()) {
        await showWelcomeScreen();
    }

    init();

    // 7. Onboarding (both modes).
    if (shouldShowOnboarding()) {
        setTimeout(() => startOnboarding(), 400);
    }

    // 8. Daily balance snapshot (both modes).
    try {
        if (store.getAccounts().length > 0) {
            const history = store.getBalanceHistory();
            const today = new Date().toISOString().slice(0, 10);
            if (!history.length || history[history.length - 1].date !== today) {
                store.snapshotBalances();
            }
        }
    } catch (e) { /* snapshot is non-critical */ }

    // 9. Mode-specific finalize (cloud: Plaid sync + sidebar + chatbot; selfhost: no-op).
    await mode.finalize({ store, auth, navigate });

    // 10. DAU/MAU ping (cloud only, no-ops in selfhost). Fires at most once
    //     per UTC day per device — see js/active-ping.js and privacy.html §1.8.
    pingActiveUser();
});

