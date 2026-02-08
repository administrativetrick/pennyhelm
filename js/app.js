import { store } from './store.js';
import { auth } from './auth.js';
import { seedSampleData } from './seed.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderBills } from './pages/bills.js';
import { renderCalendar } from './pages/calendar.js';
import { renderSettings } from './pages/settings.js';
import { renderAccounts } from './pages/accounts.js';
import { renderTaxes } from './pages/taxes.js';
import { renderDebts } from './pages/debts.js';
import { renderIncome } from './pages/income.js';
import { renderAdmin } from './pages/admin.js';

const pages = {
    dashboard: renderDashboard,
    bills: renderBills,
    calendar: renderCalendar,
    income: renderIncome,
    debts: renderDebts,
    accounts: renderAccounts,
    taxes: renderTaxes,
    settings: renderSettings,
    admin: renderAdmin
};

let currentPage = 'dashboard';

function navigate(page) {
    if (!pages[page]) page = 'dashboard';

    // Guard: admin page only accessible to admins in cloud mode
    if (page === 'admin' && (!auth.isCloud() || !auth.isAdmin())) {
        page = 'dashboard';
    }

    currentPage = page;

    // Update nav active states
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });
    document.querySelectorAll('.mobile-nav a').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });

    // Render page
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    pages[page](main, store);

    // Update hash
    window.location.hash = page;
}

// Modal helpers
export function openModal(title, contentHtml) {
    const overlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    modalTitle.textContent = title;
    modalBody.innerHTML = contentHtml;
    overlay.classList.add('open');
}

export function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
}

export function refreshPage() {
    navigate(currentPage);
}

// Update dependent-related UI elements in navigation
export function updateDependentNav() {
    // Currently no dependent-specific nav items to update
    // This function is called when dependent settings change
    // to allow for future expansion of dependent-related nav elements
}

export { navigate };

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
        if (hash !== currentPage) navigate(hash);
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
        <a href="#accounts" data-page="accounts">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/><path d="M6 16h4"/></svg>
            Accounts
        </a>
        <a href="#debts" data-page="debts">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Debts
        </a>
        <a href="#taxes" data-page="taxes">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Taxes
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

    // 6. Cloud mode: add sign-out and user info to sidebar
    if (auth.isCloud()) {
        addCloudUI();
    }
});

async function checkTrialStatus() {
    try {
        // Admin users bypass trial expiration
        if (auth.isAdmin()) return true;

        const status = await auth.getUserStatus();

        if (status.status === 'expired') {
            showTrialExpiredScreen();
            return false;
        }
        if (status.status === 'trial' && status.trialDaysRemaining <= 7 && !status.isUnlimited) {
            showTrialBanner(status.trialDaysRemaining);
        }
        return true;
    } catch (e) {
        console.error('Failed to check trial status:', e);
        return true; // fail open
    }
}

function showTrialBanner(daysRemaining) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(251,146,60,0.1);color:#fb923c;text-align:center;padding:8px 16px;font-size:13px;font-weight:600;border-bottom:1px solid rgba(251,146,60,0.3);position:fixed;top:0;left:0;right:0;z-index:200;';
    banner.innerHTML = `Your free trial expires in <strong>${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</strong>. <a href="#" style="color:#4f8cff;text-decoration:underline;margin-left:8px;" onclick="alert('Stripe integration coming soon!');return false;">Subscribe now</a>`;
    document.body.prepend(banner);
    // Shift everything down
    document.body.style.paddingTop = '36px';
}

function showTrialExpiredScreen() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'none';
    const main = document.getElementById('main-content');
    if (main) {
        main.style.marginLeft = '0';
        main.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
                <div style="max-width:480px;text-align:center;padding:40px;">
                    <div style="width:64px;height:64px;background:linear-gradient(135deg,#4f8cff,#7c3aed);border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;margin:0 auto 24px;">PH</div>
                    <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:12px;">Your Trial Has Expired</h1>
                    <p style="color:#9aa0b0;margin-bottom:8px;">Your free trial of PennyHelm Cloud has ended.</p>
                    <p style="color:#9aa0b0;margin-bottom:32px;">Subscribe to continue using PennyHelm Cloud, or redeem a trial code.</p>
                    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                        <button style="padding:12px 28px;background:#4f8cff;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;" onclick="alert('Stripe integration coming soon!')">Subscribe Now</button>
                        <button style="padding:12px 28px;background:transparent;color:#e8eaed;border:1px solid #2e3348;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;" id="trial-redeem-code">Redeem Code</button>
                        <button style="padding:12px 28px;background:transparent;color:#9aa0b0;border:1px solid #2e3348;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;" id="trial-signout">Sign Out</button>
                    </div>
                </div>
            </div>
        `;
        const signOutBtn = document.getElementById('trial-signout');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', () => auth.signOut());
        }
        const redeemBtn = document.getElementById('trial-redeem-code');
        if (redeemBtn) {
            redeemBtn.addEventListener('click', () => showRedeemCodeModal());
        }
    }
}

function showRedeemCodeModal() {
    openModal('Redeem Trial Code', `
        <div class="form-group">
            <label>Enter your trial code</label>
            <input type="text" class="form-input" id="redeem-code-input"
                   placeholder="e.g., BETA2026" style="text-transform:uppercase;font-family:monospace;">
        </div>
        <div id="redeem-error" style="color:#f87171;font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-redeem">Redeem</button>
        </div>
    `);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-redeem').addEventListener('click', async () => {
        const code = document.getElementById('redeem-code-input').value.trim().toUpperCase();
        const errorDiv = document.getElementById('redeem-error');

        if (!code) {
            errorDiv.textContent = 'Please enter a code.';
            errorDiv.style.display = 'block';
            return;
        }

        const db = firebase.firestore();
        try {
            // Look up the code
            const codeDoc = await db.collection('trialCodeLookup').doc(code).get();
            if (!codeDoc.exists) {
                errorDiv.textContent = 'Invalid code.';
                errorDiv.style.display = 'block';
                return;
            }
            const codeData = codeDoc.data();
            if (!codeData.active) {
                errorDiv.textContent = 'This code is no longer active.';
                errorDiv.style.display = 'block';
                return;
            }
            if (codeData.maxUses > 0 && codeData.currentUses >= codeData.maxUses) {
                errorDiv.textContent = 'This code has reached its maximum uses.';
                errorDiv.style.display = 'block';
                return;
            }

            // Update user's trial status
            const uid = auth.getUserId();
            await db.collection('users').doc(uid).update({
                subscriptionStatus: 'trial',
                trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
                trialCode: code,
                trialDays: codeData.trialDays
            });

            closeModal();
            window.location.reload(); // Reload to re-check trial status
        } catch (e) {
            errorDiv.textContent = 'Failed to redeem code. Please try again.';
            errorDiv.style.display = 'block';
            console.error('Redemption error:', e);
        }
    });
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
            // Insert before Settings
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
            <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;" title="${displayName}">${displayName}</div>
            <button id="cloud-signout" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;font-weight:500;padding:4px 8px;border-radius:4px;transition:color 0.15s;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-muted)'">Sign Out</button>
        </div>
    `;

    const sidebarNav = document.querySelector('.sidebar');
    if (sidebarNav) {
        sidebarNav.appendChild(signOutDiv);
    }

    const signOutBtn = document.getElementById('cloud-signout');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => auth.signOut());
    }
}
