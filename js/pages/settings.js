import { formatCurrency, escapeHtml, getScoreRating, estimateScoreImpact } from '../utils.js';
import { openModal, closeModal, refreshPage, updateDependentNav } from '../app.js';
import { auth } from '../auth.js';
import { CATEGORY_COLORS } from '../categories.js';
import { showAccountForm, handleOcrImport } from './accounts.js';
import { connectBank, refreshPlaidBalances, hasPlaidConnections, updateBankConsent } from '../plaid.js';
import { showVehicleDetail } from './vehicle-detail.js';
import { requireMFAForUpload } from '../mfa-guard.js';
import { getThemePreference, setThemePreference } from '../theme.js';

export function renderSettings(container, store) {
    const userName = store.getUserName();
    const depName = store.getDependentName();
    const depEnabled = store.isDependentEnabled();
    const sources = store.getPaymentSources();
    const bills = store.getBills();
    // Dependent bills are now in the main bills array with owner: 'dependent'
    const dependentBills = bills.filter(b => b.owner === 'dependent');
    const accounts = store.getAccounts();
    const creditScores = store.getCreditScores();
    const totalCreditLimit = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);
    const pref = getThemePreference();

    container.innerHTML = `
        <div class="page-header">
            <h2>Settings</h2>
        </div>

        <div class="card mb-24">
            <div class="settings-section">
                <h3>Profile</h3>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Your Name</div>
                        <div class="setting-desc">Used in the app title and labels. Currently: <strong>${escapeHtml(userName)}</strong></div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="edit-user-name">Edit</button>
                </div>
            </div>
        </div>

        <div class="card mb-24">
            <div class="settings-section">
                <h3>Appearance</h3>
                <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div class="setting-label">Theme</div>
                        <div class="setting-desc">Choose light, dark, or match your system</div>
                    </div>
                    <div style="display:flex;gap:4px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:3px;">
                        <button class="theme-option${pref === 'system' ? ' active' : ''}" data-theme="system" style="padding:6px 14px;border-radius:4px;border:none;background:${pref === 'system' ? 'var(--accent)' : 'none'};color:${pref === 'system' ? '#fff' : 'var(--text-secondary)'};font-size:13px;font-weight:600;cursor:pointer;">System</button>
                        <button class="theme-option${pref === 'light' ? ' active' : ''}" data-theme="light" style="padding:6px 14px;border-radius:4px;border:none;background:${pref === 'light' ? 'var(--accent)' : 'none'};color:${pref === 'light' ? '#fff' : 'var(--text-secondary)'};font-size:13px;font-weight:600;cursor:pointer;">Light</button>
                        <button class="theme-option${pref === 'dark' ? ' active' : ''}" data-theme="dark" style="padding:6px 14px;border-radius:4px;border:none;background:${pref === 'dark' ? 'var(--accent)' : 'none'};color:${pref === 'dark' ? '#fff' : 'var(--text-secondary)'};font-size:13px;font-weight:600;cursor:pointer;">Dark</button>
                    </div>
                </div>
            </div>
        </div>

        ${renderAccountsSection(store)}

        ${auth.isCloud() ? `
        <div class="card mb-24">
            <div class="settings-section">
                <h3>💳 Subscription</h3>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Plan Status</div>
                        <div class="setting-desc" id="subscription-status-text">Loading...</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="manage-subscription-btn" style="display:none;">Manage</button>
                </div>
            </div>
        </div>
        <div class="card mb-24">
            <div class="settings-section">
                <h3>📱 Mobile App</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Sign in to the PennyHelm mobile app with your email and mobile password.
                </p>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Mobile App Login</div>
                        <div class="setting-desc" id="mobile-credentials-status">Loading...</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="resend-mobile-password">Resend Password</button>
                </div>
            </div>
        </div>
        ` : ''}

        ${auth.isCloud() ? `
        <div class="card mb-24">
            <div class="settings-section">
                <h3>🔐 Security</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Protect your account with two-factor authentication using an authenticator app.
                </p>
                <div class="settings-row" id="mfa-status-row">
                    <div>
                        <div class="setting-label">Two-Factor Authentication</div>
                        <div class="setting-desc" id="mfa-status-text">Loading...</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="mfa-toggle-btn" style="display:none;">Enable</button>
                </div>
                <div id="mfa-setup-container" style="display:none;"></div>
            </div>
        </div>
        ` : ''}

        <div class="card mb-24">
            <div class="settings-section">
                <h3>Credit Scores</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Track your FICO credit score (300–850) and estimate how debt changes might affect it.
                </p>

                <div class="settings-row">
                    <div>
                        <div class="setting-label">${escapeHtml(userName)}'s Credit Score</div>
                        ${creditScores.user.score ? (() => {
                            const r = getScoreRating(creditScores.user.score);
                            const updated = new Date(creditScores.user.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            return `<div class="setting-desc"><span style="color:${r.color};font-weight:700;">${creditScores.user.score}</span> &middot; ${r.label} &middot; Updated ${updated}</div>`;
                        })() : '<div class="setting-desc">Not set</div>'}
                    </div>
                    <button class="btn btn-secondary btn-sm" id="update-user-score">${creditScores.user.score ? 'Update' : 'Set Score'}</button>
                </div>

                ${creditScores.user.score ? `
                <div style="margin-top:12px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);">
                    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">DEBT IMPACT SIMULATOR</div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span style="font-size:13px;color:var(--text-secondary);">If you</span>
                        <select class="form-select" id="user-debt-direction" style="width:auto;padding:4px 28px 4px 8px;font-size:12px;">
                            <option value="paydown">pay down</option>
                            <option value="add">add</option>
                        </select>
                        <span style="font-size:13px;color:var(--text-secondary);">$</span>
                        <input type="number" class="form-input" id="user-debt-amount" style="width:100px;padding:4px 8px;font-size:12px;" placeholder="0" value="0">
                        <span style="font-size:13px;color:var(--text-secondary);">in debt:</span>
                        <span id="user-score-estimate" style="font-weight:700;font-size:13px;">—</span>
                    </div>
                    ${totalCreditLimit > 0 ? '' : '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Add credit card accounts in the Accounts section above for more accurate estimates.</div>'}
                    <div style="font-size:10px;color:var(--text-muted);margin-top:6px;font-style:italic;">Estimate only — actual scores depend on many factors including payment history, credit age, and inquiries.</div>
                </div>
                ` : ''}

                ${depEnabled ? `
                <div class="settings-row" style="margin-top:8px;">
                    <div>
                        <div class="setting-label">${escapeHtml(depName)}'s Credit Score</div>
                        ${creditScores.dependent && creditScores.dependent.score ? (() => {
                            const r = getScoreRating(creditScores.dependent.score);
                            const updated = new Date(creditScores.dependent.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            return `<div class="setting-desc"><span style="color:${r.color};font-weight:700;">${creditScores.dependent.score}</span> &middot; ${r.label} &middot; Updated ${updated}</div>`;
                        })() : '<div class="setting-desc">Not set</div>'}
                    </div>
                    <button class="btn btn-secondary btn-sm" id="update-dependent-score">${creditScores.dependent && creditScores.dependent.score ? 'Update' : 'Set Score'}</button>
                </div>

                ${creditScores.dependent && creditScores.dependent.score ? `
                <div style="margin-top:12px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);">
                    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">${escapeHtml(depName).toUpperCase()}'S DEBT IMPACT SIMULATOR</div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span style="font-size:13px;color:var(--text-secondary);">If they</span>
                        <select class="form-select" id="dependent-debt-direction" style="width:auto;padding:4px 28px 4px 8px;font-size:12px;">
                            <option value="paydown">pay down</option>
                            <option value="add">add</option>
                        </select>
                        <span style="font-size:13px;color:var(--text-secondary);">$</span>
                        <input type="number" class="form-input" id="dependent-debt-amount" style="width:100px;padding:4px 8px;font-size:12px;" placeholder="0" value="0">
                        <span style="font-size:13px;color:var(--text-secondary);">in debt:</span>
                        <span id="dependent-score-estimate" style="font-weight:700;font-size:13px;">—</span>
                    </div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:6px;font-style:italic;">Estimate only — actual scores depend on many factors.</div>
                </div>
                ` : ''}
                ` : ''}
            </div>
        </div>

        <div class="card mb-24">
            <div class="settings-section">
                <h3>Dependent Coverage</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Track another person's bills and toggle whether you're covering them.
                </p>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Enable Dependent Tracking</div>
                        <div class="setting-desc">${depEnabled ? `Tracking <strong>${escapeHtml(depName)}</strong>'s bills` : 'Disabled'}</div>
                    </div>
                    <label class="toggle">
                        <input type="checkbox" ${depEnabled ? 'checked' : ''} id="dep-enabled-toggle">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                ${depEnabled ? `
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Dependent Name</div>
                        <div class="setting-desc">Currently: <strong>${escapeHtml(depName)}</strong></div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="edit-dep-name">Edit</button>
                </div>
                ` : ''}
            </div>
        </div>

        <div class="card mb-24">
            <div class="settings-section">
                <h3>Payment Sources</h3>
                <div id="sources-list">
                    ${sources.map(s => {
                    const billCount = bills.filter(b => b.paymentSource === s).length;
                    const depBillCount = dependentBills.filter(b => b.paymentSource === s).length;
                    const totalCount = billCount + depBillCount;
                    return `
                        <div class="settings-row">
                            <div class="setting-label">${escapeHtml(s)}</div>
                            <div style="display:flex;gap:6px;align-items:center;">
                                <span class="text-muted" style="font-size:12px;">${totalCount} bill${totalCount !== 1 ? 's' : ''}</span>
                                <button class="btn-icon edit-source" data-source="${escapeHtml(s)}" title="Rename">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button class="btn-icon remove-source" data-source="${escapeHtml(s)}" title="Remove" style="color:var(--red);">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
                </div>
                <div style="margin-top:12px;display:flex;gap:8px;">
                    <input type="text" class="form-input" id="new-source-input" placeholder="New payment source..." style="flex:1;">
                    <button class="btn btn-primary btn-sm" id="add-source-btn">Add</button>
                </div>
            </div>
        </div>

        <div class="card mb-24">
            <div class="settings-section">
                <h3>Custom Categories</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Create custom categories for organizing your bills. These appear alongside the default categories.
                </p>
                <div id="custom-categories-list">
                    ${renderCustomCategoriesList(store.getCustomCategories(), bills)}
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-primary btn-sm" id="add-custom-category-btn">+ Add Category</button>
                </div>
            </div>
        </div>

        <div class="card mb-24">
            <div class="settings-section">
                <h3>Data Management</h3>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Export Data</div>
                        <div class="setting-desc">Download all your data as a JSON file</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="export-btn">Export JSON</button>
                </div>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Import Data</div>
                        <div class="setting-desc">Restore from a previously exported JSON file</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="import-btn">Import JSON</button>
                </div>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Clear All Data</div>
                        <div class="setting-desc">Remove all bills, debts, accounts, and deductions (keeps settings)</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="clear-data-btn" style="color:var(--orange);">Clear Data</button>
                </div>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Reset All Data</div>
                        <div class="setting-desc">Clear everything and re-seed with default sample data</div>
                    </div>
                    <button class="btn btn-danger btn-sm" id="reset-btn">Reset</button>
                </div>
            </div>
        </div>

        ${auth.isCloud() ? `
        <div class="card mb-24">
            <div class="settings-section">
                <h3>🤝 Sharing & Invites</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Invite others to view or collaborate on your finances. Perfect for partners, spouses, or financial professionals.
                </p>

                <div class="settings-row">
                    <div>
                        <div class="setting-label">Invite Someone</div>
                        <div class="setting-desc">Share access with a partner, spouse, or financial professional</div>
                    </div>
                    <button class="btn btn-primary btn-sm" id="invite-person-btn">+ Invite</button>
                </div>

                <div id="pending-invites-section" style="margin-top:16px;display:none;">
                    <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">PENDING INVITES</div>
                    <div id="pending-invites-list"></div>
                </div>

                <div id="shared-with-section" style="margin-top:16px;display:none;">
                    <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">PEOPLE WITH ACCESS</div>
                    <div id="shared-with-list"></div>
                </div>
            </div>
        </div>
        ` : ''}

        <div class="card">
            <div class="settings-section">
                <h3>Summary</h3>
                <div class="settings-row">
                    <span class="text-muted">Total ${escapeHtml(userName)} Bills</span>
                    <span class="font-bold">${bills.length} (${formatCurrency(bills.reduce((s, b) => s + b.amount, 0))})</span>
                </div>
                <div class="settings-row">
                    <span class="text-muted">Active (non-frozen)</span>
                    <span class="font-bold">${bills.filter(b => !b.frozen).length} (${formatCurrency(bills.filter(b => !b.frozen).reduce((s, b) => s + b.amount, 0))})</span>
                </div>
                <div class="settings-row">
                    <span class="text-muted">Frozen Bills</span>
                    <span class="font-bold">${bills.filter(b => b.frozen).length}</span>
                </div>
                ${depEnabled ? `
                <div class="settings-row">
                    <span class="text-muted">${escapeHtml(depName)}'s Bills</span>
                    <span class="font-bold">${dependentBills.length} (${formatCurrency(dependentBills.reduce((s, b) => s + b.amount, 0))})</span>
                </div>
                ` : ''}
                <div class="settings-row">
                    <span class="text-muted">Payment Sources</span>
                    <span class="font-bold">${sources.length}</span>
                </div>
            </div>
        </div>

        <input type="file" id="import-file-input" accept=".json" style="display:none;">
    `;

    // Edit user name
    container.querySelector('#edit-user-name').addEventListener('click', () => {
        openModal('Edit Your Name', `
            <div class="form-group">
                <label>Your Name</label>
                <input type="text" class="form-input" id="user-name-input" value="${escapeHtml(userName)}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Save</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', () => {
            const val = document.getElementById('user-name-input').value.trim();
            if (val) {
                store.setUserName(val);
                // Update sidebar and page title dynamically
                const logoText = document.querySelector('.logo-text');
                if (logoText) logoText.textContent = val + ' Finances';
                const logo = document.querySelector('.logo');
                if (logo) logo.textContent = val.charAt(0).toUpperCase() + 'F';
                document.title = val + ' Finances';
                closeModal();
                refreshPage();
            }
        });
    });

    // Theme toggle
    container.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            setThemePreference(btn.dataset.theme);
            // Re-render to update active state
            renderSettings(container, store);
        });
    });

    // === Accounts Section Event Handlers ===
    wireAccountsEvents(container, store);

    // Subscription status (cloud mode only)
    if (auth.isCloud()) {
        const subStatusText = container.querySelector('#subscription-status-text');
        const manageSubBtn = container.querySelector('#manage-subscription-btn');

        const loadSubscriptionStatus = async () => {
            try {
                const status = await auth.getUserStatus();
                if (status.status === 'active') {
                    subStatusText.innerHTML = '<span style="color:var(--green);font-weight:600;">Active</span>';
                    manageSubBtn.style.display = '';
                } else if (status.status === 'past_due') {
                    subStatusText.innerHTML = '<span style="color:var(--orange);font-weight:600;">Past Due</span> — Please update your payment method.';
                    manageSubBtn.style.display = '';
                    manageSubBtn.textContent = 'Fix Payment';
                } else if (status.status === 'trial') {
                    const daysText = status.isUnlimited ? 'Unlimited' : `${status.trialDaysRemaining} days remaining`;
                    subStatusText.innerHTML = `<span style="color:var(--accent);font-weight:600;">Free Trial</span> — ${daysText}`;
                } else if (status.status === 'expired') {
                    subStatusText.innerHTML = '<span style="color:var(--red);font-weight:600;">Expired</span>';
                } else {
                    subStatusText.textContent = status.status || 'Unknown';
                }
            } catch (e) {
                console.error('Error loading subscription status:', e);
                subStatusText.textContent = 'Error loading status';
            }
        };

        loadSubscriptionStatus();

        if (manageSubBtn) {
            manageSubBtn.addEventListener('click', async () => {
                manageSubBtn.textContent = 'Opening...';
                manageSubBtn.disabled = true;
                try {
                    const result = await auth.createPortalSession();
                    if (result.url) {
                        window.location.href = result.url;
                    }
                } catch (e) {
                    console.error('Portal error:', e);
                    alert('Unable to open subscription management.');
                    manageSubBtn.textContent = 'Manage';
                    manageSubBtn.disabled = false;
                }
            });
        }
    }

    // Mobile app credentials (cloud mode only)
    if (auth.isCloud()) {
        const resendMobilePasswordBtn = container.querySelector('#resend-mobile-password');
        const credentialsStatus = container.querySelector('#mobile-credentials-status');

        // Load mobile credentials status from Firestore
        const loadMobileCredentials = async () => {
            try {
                const user = auth.getUser();
                if (!user) return;

                const db = firebase.firestore();
                const userDoc = await db.collection('users').doc(user.uid).get();

                if (userDoc.exists && userDoc.data().mobilePasswordSet) {
                    credentialsStatus.innerHTML = `Email: <strong>${escapeHtml(user.email)}</strong>`;
                    if (userDoc.data().requirePasswordChange) {
                        credentialsStatus.innerHTML += '<br><span style="color:var(--orange);font-size:11px;">Password change required on next mobile login</span>';
                    }
                } else {
                    credentialsStatus.innerHTML = 'Not set up yet. Sign in with Google to set up mobile access.';
                    resendMobilePasswordBtn.style.display = 'none';
                }
            } catch (e) {
                console.error('Error loading mobile credentials:', e);
                credentialsStatus.textContent = 'Error loading credentials';
            }
        };

        loadMobileCredentials();

        if (resendMobilePasswordBtn) {
            resendMobilePasswordBtn.addEventListener('click', async () => {
                const user = auth.getUser();
                if (!user) return;

                openModal('Resend Mobile Password', `
                    <div style="padding:8px 0 16px;font-size:14px;">
                        <p>A new temporary password will be sent to:</p>
                        <p style="margin:12px 0;font-family:monospace;color:var(--accent);">${escapeHtml(user.email)}</p>
                        <p style="color:var(--text-secondary);font-size:13px;">You will be required to change this password on your next mobile login.</p>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                        <button class="btn btn-primary" id="modal-confirm">Send New Password</button>
                    </div>
                `);

                document.getElementById('modal-cancel').addEventListener('click', closeModal);
                document.getElementById('modal-confirm').addEventListener('click', async () => {
                    const confirmBtn = document.getElementById('modal-confirm');
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Sending...';

                    try {
                        const functions = firebase.functions();
                        const resendFn = functions.httpsCallable('resendMobilePassword');
                        const result = await resendFn({});

                        if (result.data.success) {
                            // Update the credential with new password
                            if (result.data.tempPassword) {
                                const emailCredential = firebase.auth.EmailAuthProvider.credential(
                                    user.email,
                                    result.data.tempPassword
                                );
                                try {
                                    // Re-authenticate and update password
                                    await user.reauthenticateWithCredential(emailCredential);
                                } catch (e) {
                                    // May fail if credential isn't linked, that's ok
                                    console.log('Credential update note:', e.code);
                                }
                            }

                            closeModal();
                            openModal('Password Sent', `
                                <div style="padding:8px 0 16px;font-size:14px;">
                                    <p style="color:var(--green);">✓ A new temporary password has been sent to your email.</p>
                                    <p style="margin-top:12px;color:var(--text-secondary);font-size:13px;">Check your inbox for the new password. You will need to change it on your next mobile login.</p>
                                </div>
                                <div class="modal-actions">
                                    <button class="btn btn-primary" id="modal-close">Got it</button>
                                </div>
                            `);
                            document.getElementById('modal-close').addEventListener('click', closeModal);
                            loadMobileCredentials(); // Refresh status
                        }
                    } catch (e) {
                        console.error('Error resending password:', e);
                        closeModal();
                        alert('Failed to send new password. Please try again.');
                    }
                });
            });
        }

    // MFA / Two-Factor Authentication (cloud mode only)
    if (auth.isCloud()) {
        const mfaStatusText = container.querySelector('#mfa-status-text');
        const mfaToggleBtn = container.querySelector('#mfa-toggle-btn');
        const mfaSetupContainer = container.querySelector('#mfa-setup-container');

        const loadMFAStatus = async () => {
            try {
                const user = auth.getUser();
                if (!user) return;
                const db = firebase.firestore();
                const userDoc = await db.collection('users').doc(user.uid).get();
                const mfaEnabled = userDoc.exists && userDoc.data().mfaEnabled === true;

                if (mfaEnabled) {
                    mfaStatusText.innerHTML = '<span style="color:var(--green);font-weight:600;">✓ Enabled</span>';
                    mfaToggleBtn.textContent = 'Disable';
                    mfaToggleBtn.style.display = '';
                } else {
                    mfaStatusText.textContent = 'Not enabled';
                    mfaToggleBtn.textContent = 'Enable';
                    mfaToggleBtn.style.display = '';
                }
            } catch (e) {
                console.error('Error loading MFA status:', e);
                mfaStatusText.textContent = 'Error loading status';
            }
        };

        loadMFAStatus();

        if (mfaToggleBtn) {
            mfaToggleBtn.addEventListener('click', async () => {
                const user = auth.getUser();
                if (!user) return;
                const db = firebase.firestore();
                const userDoc = await db.collection('users').doc(user.uid).get();
                const mfaEnabled = userDoc.exists && userDoc.data().mfaEnabled === true;

                if (mfaEnabled) {
                    // Disable MFA — prompt for current TOTP code
                    openModal('Disable Two-Factor Authentication', `
                        <div style="padding:8px 0 16px;font-size:14px;">
                            <p>Enter your current authenticator code to disable 2FA.</p>
                            <div class="form-group" style="margin-top:16px;">
                                <input type="text" class="form-input" id="mfa-disable-code"
                                    placeholder="000000" maxlength="6" inputmode="numeric" pattern="[0-9]*"
                                    style="text-align:center;font-size:20px;letter-spacing:6px;font-family:monospace;">
                            </div>
                            <div id="mfa-disable-error" style="color:var(--red);font-size:13px;margin-bottom:8px;"></div>
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                            <button class="btn btn-danger" id="modal-confirm">Disable 2FA</button>
                        </div>
                    `);
                    document.getElementById('mfa-disable-code').focus();
                    document.getElementById('modal-cancel').addEventListener('click', closeModal);
                    document.getElementById('modal-confirm').addEventListener('click', async () => {
                        const code = document.getElementById('mfa-disable-code').value.trim();
                        const errorDiv = document.getElementById('mfa-disable-error');
                        if (!code || code.length !== 6) {
                            errorDiv.textContent = 'Enter your 6-digit code.';
                            return;
                        }
                        const confirmBtn = document.getElementById('modal-confirm');
                        confirmBtn.disabled = true;
                        confirmBtn.textContent = 'Disabling...';
                        errorDiv.textContent = '';
                        try {
                            const functions = firebase.functions();
                            const disableMFA = functions.httpsCallable('disableMFA');
                            await disableMFA({ code });
                            auth.setMFAEnabled(false);
                            closeModal();
                            loadMFAStatus();
                        } catch (e) {
                            confirmBtn.disabled = false;
                            confirmBtn.textContent = 'Disable 2FA';
                            errorDiv.textContent = e.message || 'Invalid code. Please try again.';
                        }
                    });
                } else {
                    // Enable MFA — start setup flow
                    mfaToggleBtn.disabled = true;
                    mfaToggleBtn.textContent = 'Setting up...';

                    try {
                        const functions = firebase.functions();
                        const setupMFA = functions.httpsCallable('setupMFA');
                        const result = await setupMFA({});
                        const { secret, otpauthUri, recoveryCodes } = result.data;

                        mfaToggleBtn.style.display = 'none';
                        mfaSetupContainer.style.display = 'block';
                        mfaSetupContainer.innerHTML = `
                            <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:20px;margin-top:16px;background:var(--bg-secondary);">
                                <h4 style="margin:0 0 12px 0;font-size:14px;">Step 1: Scan QR Code</h4>
                                <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
                                    Scan this QR code with your authenticator app (Google Authenticator, Duo, Authy, etc.)
                                </p>
                                <div style="text-align:center;margin:16px 0;">
                                    <canvas id="mfa-qr-canvas" style="border-radius:8px;"></canvas>
                                </div>
                                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">Or enter this key manually:</p>
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">
                                    <code style="flex:1;padding:8px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;font-size:13px;word-break:break-all;user-select:all;">${escapeHtml(secret)}</code>
                                    <button class="btn btn-secondary btn-sm" id="mfa-copy-secret">Copy</button>
                                </div>

                                <h4 style="margin:0 0 12px 0;font-size:14px;">Step 2: Save Recovery Codes</h4>
                                <p style="font-size:13px;color:var(--orange);margin-bottom:8px;">
                                    ⚠️ Save these codes securely. They are the only way to access your account if you lose your authenticator app.
                                </p>
                                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;padding:12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;">
                                    ${recoveryCodes.map(code => `<code style="font-size:13px;padding:2px 0;">${code}</code>`).join('')}
                                </div>
                                <button class="btn btn-secondary btn-sm" id="mfa-copy-recovery" style="margin-bottom:20px;">Copy All Codes</button>

                                <h4 style="margin:0 0 12px 0;font-size:14px;">Step 3: Verify Setup</h4>
                                <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
                                    Enter the 6-digit code from your authenticator app to confirm setup.
                                </p>
                                <div style="display:flex;gap:8px;align-items:center;">
                                    <input type="text" class="form-input" id="mfa-verify-code"
                                        placeholder="000000" maxlength="6" inputmode="numeric" pattern="[0-9]*"
                                        style="text-align:center;font-size:20px;letter-spacing:6px;font-family:monospace;flex:1;">
                                    <button class="btn btn-primary" id="mfa-verify-btn">Verify & Enable</button>
                                </div>
                                <div id="mfa-verify-error" style="color:var(--red);font-size:13px;margin-top:8px;"></div>
                                <button class="btn btn-secondary btn-sm" id="mfa-cancel-setup" style="margin-top:12px;">Cancel Setup</button>
                            </div>
                        `;

                        // Render QR code
                        try {
                            const canvas = document.getElementById('mfa-qr-canvas');
                            await QRCode.toCanvas(canvas, otpauthUri, {
                                width: 200,
                                margin: 2,
                                color: document.documentElement.getAttribute('data-theme') === 'light' ||
                                       (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: light)').matches)
                                    ? { dark: '#1a1a2e', light: '#ffffff' }
                                    : { dark: '#e8eaed', light: '#0f1117' }
                            });
                        } catch (qrErr) {
                            console.error('QR code render error:', qrErr);
                        }

                        // Copy secret
                        document.getElementById('mfa-copy-secret').addEventListener('click', () => {
                            navigator.clipboard.writeText(secret);
                            document.getElementById('mfa-copy-secret').textContent = 'Copied!';
                            setTimeout(() => { document.getElementById('mfa-copy-secret').textContent = 'Copy'; }, 2000);
                        });

                        // Copy recovery codes
                        document.getElementById('mfa-copy-recovery').addEventListener('click', () => {
                            navigator.clipboard.writeText(recoveryCodes.join('\n'));
                            document.getElementById('mfa-copy-recovery').textContent = 'Copied!';
                            setTimeout(() => { document.getElementById('mfa-copy-recovery').textContent = 'Copy All Codes'; }, 2000);
                        });

                        // Verify setup
                        document.getElementById('mfa-verify-btn').addEventListener('click', async () => {
                            const code = document.getElementById('mfa-verify-code').value.trim();
                            const verifyError = document.getElementById('mfa-verify-error');
                            const verifyBtn = document.getElementById('mfa-verify-btn');
                            if (!code || code.length !== 6) {
                                verifyError.textContent = 'Enter your 6-digit code.';
                                return;
                            }
                            verifyBtn.disabled = true;
                            verifyBtn.textContent = 'Verifying...';
                            verifyError.textContent = '';
                            try {
                                const verifyMFASetup = functions.httpsCallable('verifyMFASetup');
                                await verifyMFASetup({ code });
                                auth.setMFAEnabled(true);
                                mfaSetupContainer.style.display = 'none';
                                mfaSetupContainer.innerHTML = '';
                                loadMFAStatus();
                            } catch (e) {
                                verifyBtn.disabled = false;
                                verifyBtn.textContent = 'Verify & Enable';
                                verifyError.textContent = e.message || 'Invalid code. Please try again.';
                            }
                        });

                        // Cancel setup
                        document.getElementById('mfa-cancel-setup').addEventListener('click', async () => {
                            try {
                                const cancelMFASetup = functions.httpsCallable('cancelMFASetup');
                                await cancelMFASetup({});
                            } catch (e) {
                                console.error('Cancel MFA setup error:', e);
                            }
                            mfaSetupContainer.style.display = 'none';
                            mfaSetupContainer.innerHTML = '';
                            mfaToggleBtn.disabled = false;
                            mfaToggleBtn.textContent = 'Enable';
                            mfaToggleBtn.style.display = '';
                        });

                    } catch (e) {
                        console.error('MFA setup error:', e);
                        mfaToggleBtn.disabled = false;
                        mfaToggleBtn.textContent = 'Enable';
                        alert('Failed to start MFA setup. Please try again.');
                    }
                }
            });
        }
    }

        // Sharing & Invites functionality
        const inviteBtn = container.querySelector('#invite-person-btn');
        if (inviteBtn) {
            // Load and display existing invites/shares
            const loadInvitesAndShares = () => {
                const invites = store.getInvites();
                const sharedWith = store.getSharedWith();

                // Pending invites
                const pendingSection = container.querySelector('#pending-invites-section');
                const pendingList = container.querySelector('#pending-invites-list');
                const pendingInvites = invites.filter(i => i.status === 'pending');

                if (pendingInvites.length > 0) {
                    pendingSection.style.display = 'block';
                    pendingList.innerHTML = pendingInvites.map(invite => `
                        <div class="settings-row" style="background:var(--bg-secondary);padding:10px 12px;border-radius:var(--radius-sm);margin-bottom:6px;">
                            <div>
                                <div class="setting-label" style="font-size:13px;">${escapeHtml(invite.email)}</div>
                                <div class="setting-desc" style="font-size:11px;">
                                    ${invite.type === 'partner' ? '👫 Partner' : invite.type === 'cpa' ? '📊 CPA' : '💼 Financial Planner'}
                                    · ${invite.permissions === 'edit' ? 'Can edit' : 'View only'}
                                    · Sent ${new Date(invite.invitedAt).toLocaleDateString()}
                                </div>
                            </div>
                            <div style="display:flex;gap:6px;">
                                <button class="btn-icon resend-invite" data-id="${invite.id}" title="Resend">📧</button>
                                <button class="btn-icon cancel-invite" data-id="${invite.id}" title="Cancel" style="color:var(--red);">✕</button>
                            </div>
                        </div>
                    `).join('');

                    // Cancel invite handlers
                    pendingList.querySelectorAll('.cancel-invite').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const id = btn.dataset.id;
                            if (confirm('Cancel this invite?')) {
                                store.deleteInvite(id);
                                loadInvitesAndShares();
                            }
                        });
                    });
                } else {
                    pendingSection.style.display = 'none';
                }

                // People with access
                const sharedSection = container.querySelector('#shared-with-section');
                const sharedList = container.querySelector('#shared-with-list');

                if (sharedWith.length > 0) {
                    sharedSection.style.display = 'block';
                    sharedList.innerHTML = sharedWith.map(person => `
                        <div class="settings-row" style="background:var(--bg-secondary);padding:10px 12px;border-radius:var(--radius-sm);margin-bottom:6px;">
                            <div>
                                <div class="setting-label" style="font-size:13px;">${escapeHtml(person.email)}</div>
                                <div class="setting-desc" style="font-size:11px;">
                                    ${person.type === 'partner' ? '👫 Partner' : person.type === 'cpa' ? '📊 CPA' : '💼 Financial Planner'}
                                    · ${person.permissions === 'edit' ? 'Can edit' : 'View only'}
                                    · Shared ${new Date(person.sharedAt).toLocaleDateString()}
                                </div>
                            </div>
                            <button class="btn btn-secondary btn-sm revoke-access" data-uid="${person.uid}" style="color:var(--red);">Revoke</button>
                        </div>
                    `).join('');

                    // Revoke access handlers
                    sharedList.querySelectorAll('.revoke-access').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const uid = btn.dataset.uid;
                            if (confirm('Revoke access for this person? They will no longer be able to view your finances.')) {
                                store.revokeAccess(uid);
                                loadInvitesAndShares();
                            }
                        });
                    });
                } else {
                    sharedSection.style.display = 'none';
                }
            };

            loadInvitesAndShares();

            // Invite button click
            inviteBtn.addEventListener('click', () => {
                openModal('Invite Someone', `
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" class="form-input" id="invite-email" placeholder="name@example.com">
                    </div>
                    <div class="form-group">
                        <label>Relationship Type</label>
                        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
                            <label class="invite-type-option" style="flex:1;min-width:120px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;text-align:center;">
                                <input type="radio" name="invite-type" value="partner" checked style="display:none;">
                                <div style="font-size:24px;margin-bottom:4px;">👫</div>
                                <div style="font-size:12px;font-weight:600;">Partner / Spouse</div>
                                <div style="font-size:10px;color:var(--text-muted);">Someone you share finances with</div>
                            </label>
                            <label class="invite-type-option" style="flex:1;min-width:120px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;text-align:center;">
                                <input type="radio" name="invite-type" value="financial-planner" style="display:none;">
                                <div style="font-size:24px;margin-bottom:4px;">💼</div>
                                <div style="font-size:12px;font-weight:600;">Financial Planner</div>
                                <div style="font-size:10px;color:var(--text-muted);">Professional advisor</div>
                            </label>
                            <label class="invite-type-option" style="flex:1;min-width:120px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;text-align:center;">
                                <input type="radio" name="invite-type" value="cpa" style="display:none;">
                                <div style="font-size:24px;margin-bottom:4px;">📊</div>
                                <div style="font-size:12px;font-weight:600;">CPA / Accountant</div>
                                <div style="font-size:10px;color:var(--text-muted);">Tax professional</div>
                            </label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Permissions</label>
                        <select class="form-select" id="invite-permissions">
                            <option value="view">View only — can see but not change anything</option>
                            <option value="edit">Can edit — can make changes to bills, accounts, etc.</option>
                        </select>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                        <button class="btn btn-primary" id="modal-send-invite">Send Invite</button>
                    </div>
                    <style>
                        .invite-type-option:has(input:checked) {
                            border-color: var(--accent);
                            background: var(--accent-bg);
                        }
                    </style>
                `);

                document.getElementById('modal-cancel').addEventListener('click', closeModal);
                document.getElementById('modal-send-invite').addEventListener('click', async () => {
                    const email = document.getElementById('invite-email').value.trim().toLowerCase();
                    const type = document.querySelector('input[name="invite-type"]:checked').value;
                    const permissions = document.getElementById('invite-permissions').value;

                    if (!email || !email.includes('@')) {
                        alert('Please enter a valid email address');
                        return;
                    }

                    // Check if already invited
                    const existingInvites = store.getInvites();
                    if (existingInvites.find(i => i.email === email && i.status === 'pending')) {
                        alert('This email has already been invited');
                        return;
                    }

                    // Check if already has access
                    const sharedWith = store.getSharedWith();
                    if (sharedWith.find(s => s.email === email)) {
                        alert('This person already has access');
                        return;
                    }

                    const sendBtn = document.getElementById('modal-send-invite');
                    sendBtn.disabled = true;
                    sendBtn.textContent = 'Sending...';

                    try {
                        // Call Cloud Function to send invite email
                        const functions = firebase.functions();
                        const sendInviteFn = functions.httpsCallable('sendInvite');
                        const result = await sendInviteFn({ email, type, permissions });

                        if (result.data.success) {
                            // Also create invite in local store for UI display
                            store.addInvite({
                                id: result.data.inviteId,
                                email,
                                type,
                                permissions
                            });

                            closeModal();
                            openModal('Invite Sent', `
                                <div style="padding:8px 0 16px;font-size:14px;text-align:center;">
                                    <div style="font-size:48px;margin-bottom:12px;">✉️</div>
                                    <p style="color:var(--green);font-weight:600;">Invite sent to ${escapeHtml(email)}!</p>
                                    <p style="margin-top:12px;color:var(--text-secondary);font-size:13px;">
                                        They'll receive an email with instructions to access your finances.
                                        ${type === 'partner' ? 'Once they accept, they can view and collaborate on your shared finances.' :
                                          type === 'cpa' ? 'Once they accept, they can review your finances for tax preparation.' :
                                          'Once they accept, they can review your finances to provide planning advice.'}
                                    </p>
                                </div>
                                <div class="modal-actions">
                                    <button class="btn btn-primary" id="modal-close">Done</button>
                                </div>
                            `);
                            document.getElementById('modal-close').addEventListener('click', closeModal);
                            loadInvitesAndShares();
                        }
                    } catch (err) {
                        console.error('Error sending invite:', err);
                        sendBtn.disabled = false;
                        sendBtn.textContent = 'Send Invite';
                        alert('Failed to send invite. Please try again.');
                    }
                });
            });
        }
    }

    // Credit score - user
    container.querySelector('#update-user-score').addEventListener('click', () => {
        openModal(`Update ${escapeHtml(userName)}'s Credit Score`, `
            <div class="form-group">
                <label>FICO Score (300–850)</label>
                <input type="number" class="form-input" id="credit-score-input" min="300" max="850" value="${creditScores.user.score || ''}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Save</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', () => {
            const val = parseInt(document.getElementById('credit-score-input').value);
            if (val >= 300 && val <= 850) {
                store.updateCreditScore('user', val);
                closeModal();
                refreshPage();
            } else {
                alert('Please enter a score between 300 and 850');
            }
        });
    });

    // User debt simulator
    const userDebtAmount = container.querySelector('#user-debt-amount');
    const userDebtDir = container.querySelector('#user-debt-direction');
    if (userDebtAmount && userDebtDir) {
        const updateUserEstimate = () => {
            const amount = parseFloat(userDebtAmount.value) || 0;
            const direction = userDebtDir.value;
            const debtChange = direction === 'paydown' ? -amount : amount;
            const limit = totalCreditLimit > 0 ? totalCreditLimit : 10000; // default $10k if no accounts
            const result = estimateScoreImpact(creditScores.user.score, debtChange, limit);
            const el = container.querySelector('#user-score-estimate');
            if (el) {
                const r = getScoreRating(result.newScore);
                const sign = result.pointChange >= 0 ? '+' : '';
                el.innerHTML = `<span style="color:${r.color};">${result.newScore}</span> <span style="font-size:11px;color:${result.pointChange >= 0 ? 'var(--green)' : 'var(--red)'};">(${sign}${result.pointChange} pts)</span>`;
            }
        };
        userDebtAmount.addEventListener('input', updateUserEstimate);
        userDebtDir.addEventListener('change', updateUserEstimate);
    }

    // Credit score - Dependent
    const updateDependentScoreBtn = container.querySelector('#update-dependent-score');
    if (updateDependentScoreBtn) {
        updateDependentScoreBtn.addEventListener('click', () => {
            openModal(`Update ${escapeHtml(depName)}'s Credit Score`, `
                <div class="form-group">
                    <label>FICO Score (300–850)</label>
                    <input type="number" class="form-input" id="credit-score-input" min="300" max="850" value="${creditScores.dependent && creditScores.dependent.score ? creditScores.dependent.score : ''}">
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Save</button>
                </div>
            `);
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', () => {
                const val = parseInt(document.getElementById('credit-score-input').value);
                if (val >= 300 && val <= 850) {
                    store.updateCreditScore('dependent', val);
                    closeModal();
                    refreshPage();
                } else {
                    alert('Please enter a score between 300 and 850');
                }
            });
        });
    }

    // Dependent debt simulator
    const dependentDebtAmount = container.querySelector('#dependent-debt-amount');
    const dependentDebtDir = container.querySelector('#dependent-debt-direction');
    if (dependentDebtAmount && dependentDebtDir && creditScores.dependent && creditScores.dependent.score) {
        const updateDependentEstimate = () => {
            const amount = parseFloat(dependentDebtAmount.value) || 0;
            const direction = dependentDebtDir.value;
            const debtChange = direction === 'paydown' ? -amount : amount;
            const result = estimateScoreImpact(creditScores.dependent.score, debtChange, 10000); // default limit for dependent
            const el = container.querySelector('#dependent-score-estimate');
            if (el) {
                const r = getScoreRating(result.newScore);
                const sign = result.pointChange >= 0 ? '+' : '';
                el.innerHTML = `<span style="color:${r.color};">${result.newScore}</span> <span style="font-size:11px;color:${result.pointChange >= 0 ? 'var(--green)' : 'var(--red)'};">(${sign}${result.pointChange} pts)</span>`;
            }
        };
        dependentDebtAmount.addEventListener('input', updateDependentEstimate);
        dependentDebtDir.addEventListener('change', updateDependentEstimate);
    }

    // Dependent enabled toggle
    container.querySelector('#dep-enabled-toggle').addEventListener('change', (e) => {
        store.setDependentEnabled(e.target.checked);
        // When enabling, auto-cover all dependent bills (now using owner field in main bills array)
        if (e.target.checked) {
            const allBills = store.getBills();
            allBills.filter(b => b.owner === 'dependent').forEach(b => {
                if (!b.userCovering) {
                    store.updateBill(b.id, { ...b, userCovering: true });
                }
            });
        }
        updateDependentNav();
        refreshPage();
    });

    // Edit dependent name
    const editDepNameBtn = container.querySelector('#edit-dep-name');
    if (editDepNameBtn) {
        editDepNameBtn.addEventListener('click', () => {
            openModal('Edit Dependent Name', `
                <div class="form-group">
                    <label>Dependent Name</label>
                    <input type="text" class="form-input" id="dep-name-input" value="${escapeHtml(depName)}">
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Save</button>
                </div>
            `);
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', () => {
                const val = document.getElementById('dep-name-input').value.trim();
                if (val) {
                    store.setDependentName(val);
                    updateDependentNav();
                    closeModal();
                    refreshPage();
                }
            });
        });
    }

    // Add source
    container.querySelector('#add-source-btn').addEventListener('click', () => {
        const input = container.querySelector('#new-source-input');
        const name = input.value.trim();
        if (name) {
            store.addPaymentSource(name);
            refreshPage();
        }
    });

    container.querySelector('#new-source-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') container.querySelector('#add-source-btn').click();
    });

    // Edit/rename sources
    container.querySelectorAll('.edit-source').forEach(btn => {
        btn.addEventListener('click', () => {
            const oldName = btn.dataset.source;
            openModal('Rename Payment Source', `
                <div class="form-group">
                    <label>Source Name</label>
                    <input type="text" class="form-input" id="rename-source-input" value="${escapeHtml(oldName)}">
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Save</button>
                </div>
            `);
            const input = document.getElementById('rename-source-input');
            input.focus();
            input.select();
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', () => {
                const newName = input.value.trim();
                if (newName && newName !== oldName) {
                    store.renamePaymentSource(oldName, newName);
                    closeModal();
                    refreshPage();
                } else if (!newName) {
                    alert('Please enter a name');
                } else {
                    closeModal();
                }
            });
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') document.getElementById('modal-save').click();
            });
        });
    });

    // Remove sources
    container.querySelectorAll('.remove-source').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm(`Remove payment source "${btn.dataset.source}"?`)) {
                store.removePaymentSource(btn.dataset.source);
                refreshPage();
            }
        });
    });

    // === Custom Categories ===

    // Add custom category
    container.querySelector('#add-custom-category-btn')?.addEventListener('click', () => {
        openModal('Add Custom Category', `
            <div class="form-group">
                <label>Category Name</label>
                <input type="text" class="form-input" id="category-name" placeholder="e.g., Pet Supplies">
            </div>
            <div class="form-group">
                <label>Color</label>
                <div class="color-picker" id="color-picker">
                    ${renderColorPicker('purple')}
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Add Category</button>
            </div>
        `);

        // Color picker selection
        document.querySelectorAll('.color-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
            });
        });

        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', () => {
            const name = document.getElementById('category-name').value.trim();
            const color = document.querySelector('.color-option.selected')?.dataset.color || 'purple';

            if (!name) {
                alert('Please enter a category name');
                return;
            }

            try {
                store.addCustomCategory({ name, color });
                closeModal();
                refreshPage();
            } catch (err) {
                alert(err.message);
            }
        });
    });

    // Edit custom category
    container.querySelectorAll('.edit-category').forEach(btn => {
        btn.addEventListener('click', () => {
            const customCategories = store.getCustomCategories();
            const cat = customCategories.find(c => c.id === btn.dataset.id);
            if (!cat) return;

            openModal('Edit Category', `
                <div class="form-group">
                    <label>Category Name</label>
                    <input type="text" class="form-input" id="category-name" value="${escapeHtml(cat.name)}">
                </div>
                <div class="form-group">
                    <label>Color</label>
                    <div class="color-picker" id="color-picker">
                        ${renderColorPicker(cat.color)}
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Save</button>
                </div>
            `);

            // Color picker selection
            document.querySelectorAll('.color-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
                    opt.classList.add('selected');
                });
            });

            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', () => {
                const name = document.getElementById('category-name').value.trim();
                const color = document.querySelector('.color-option.selected')?.dataset.color || cat.color;

                if (!name) {
                    alert('Please enter a category name');
                    return;
                }

                try {
                    store.updateCustomCategory(cat.id, { name, color });
                    closeModal();
                    refreshPage();
                } catch (err) {
                    alert(err.message);
                }
            });
        });
    });

    // Delete custom category
    container.querySelectorAll('.delete-category').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm(`Delete category "${btn.dataset.name}"? Bills using this category will keep their category text.`)) {
                store.deleteCustomCategory(btn.dataset.id);
                refreshPage();
            }
        });
    });

    // Export
    container.querySelector('#export-btn').addEventListener('click', () => {
        const json = store.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${userName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-finances-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Import
    container.querySelector('#import-btn').addEventListener('click', () => {
        container.querySelector('#import-file-input').click();
    });

    container.querySelector('#import-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            if (store.importJSON(evt.target.result)) {
                alert('Data imported successfully!');
                refreshPage();
            } else {
                alert('Failed to import. Invalid JSON file.');
            }
        };
        reader.readAsText(file);
    });

    // Clear data (keeps settings)
    container.querySelector('#clear-data-btn').addEventListener('click', () => {
        openModal('Clear All Data', `
            <div style="padding:8px 0 16px;font-size:14px;">
                <p style="margin-bottom:12px;">This will remove all:</p>
                <ul style="margin-left:20px;margin-bottom:16px;color:var(--text-secondary);font-size:13px;">
                    <li>Bills (yours and dependent's)</li>
                    <li>Bank accounts</li>
                    <li>Debts</li>
                    <li>Tax documents and deductions</li>
                    <li>Payment history</li>
                </ul>
                <p style="color:var(--text-muted);font-size:12px;">Your settings (name, pay schedule, payment sources, credit scores) will be kept.</p>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-confirm" style="background:var(--orange);">Clear All Data</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-confirm').addEventListener('click', () => {
            store.clearSampleData();
            closeModal();
            refreshPage();
        });
    });

    // Reset
    container.querySelector('#reset-btn').addEventListener('click', () => {
        if (confirm('This will delete ALL your data and re-seed with defaults. Are you sure?')) {
            if (confirm('Really sure? This cannot be undone.')) {
                store.resetData();
                // Re-seed
                import('../seed.js').then(mod => {
                    mod.seedSampleData();
                    refreshPage();
                });
            }
        }
    });
}

// Render custom categories list
function renderCustomCategoriesList(customCategories, bills) {
    if (customCategories.length === 0) {
        return '<p style="color:var(--text-secondary);font-size:13px;">No custom categories yet.</p>';
    }

    return customCategories.map(cat => {
        const billCount = bills.filter(b => b.category?.toLowerCase() === cat.name.toLowerCase()).length;
        const colorHex = CATEGORY_COLORS.find(c => c.name === cat.color)?.hex || '#a78bfa';
        return `
            <div class="settings-row">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${colorHex};"></span>
                    <span class="setting-label">${escapeHtml(cat.name)}</span>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                    <span class="text-muted" style="font-size:12px;">${billCount} bill${billCount !== 1 ? 's' : ''}</span>
                    <button class="btn-icon edit-category" data-id="${cat.id}" title="Edit">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon delete-category" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" title="Delete" style="color:var(--red);">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Render color picker HTML
function renderColorPicker(selectedColor = 'purple') {
    return CATEGORY_COLORS.map(c => `
        <button type="button" class="color-option ${c.name === selectedColor ? 'selected' : ''}"
                data-color="${c.name}" style="background:${c.hex};" title="${c.label}">
        </button>
    `).join('');
}

// === Accounts Section Event Handlers ===

function wireAccountsEvents(container, store) {
    const accounts = store.getAccounts();

    // Add Account button
    const addBtn = container.querySelector('#settings-add-account-btn');
    if (addBtn) addBtn.addEventListener('click', () => showAccountForm(store));

    // Empty state add button
    const emptyAddBtn = container.querySelector('#settings-empty-add-account');
    if (emptyAddBtn) emptyAddBtn.addEventListener('click', () => showAccountForm(store));

    // Connect Bank buttons (cloud only)
    const connectBankBtn = container.querySelector('#settings-connect-bank-btn');
    if (connectBankBtn) connectBankBtn.addEventListener('click', () => connectBank(store, () => refreshPage()));

    const emptyConnectBtn = container.querySelector('#settings-empty-connect-bank');
    if (emptyConnectBtn) emptyConnectBtn.addEventListener('click', () => connectBank(store, () => refreshPage()));

    // Refresh Connected Balances
    const refreshPlaidBtn = container.querySelector('#settings-refresh-plaid-btn');
    if (refreshPlaidBtn) {
        refreshPlaidBtn.addEventListener('click', async () => {
            refreshPlaidBtn.disabled = true;
            refreshPlaidBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refreshing...
            `;
            try {
                const result = await refreshPlaidBalances(store);
                if (result.errors > 0) {
                    alert(`Refreshed ${result.updated} account(s), but ${result.errors} connection(s) had errors.`);
                }
                refreshPage();
            } catch (err) {
                console.error('Refresh error:', err);
                alert('Failed to refresh balances. Please try again.');
                refreshPlaidBtn.disabled = false;
                refreshPlaidBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    Refresh Connected Balances
                `;
            }
        });
    }

    // Scan Statement
    const scanBtn = container.querySelector('#settings-scan-statement-btn');
    const ocrInput = container.querySelector('#settings-ocr-file-input');
    if (scanBtn && ocrInput) {
        scanBtn.addEventListener('click', () => requireMFAForUpload(() => ocrInput.click()));
        ocrInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleOcrImport(file, store, accounts);
            e.target.value = '';
        });
    }

    // Update balance (quick)
    container.querySelectorAll('.settings-update-balance-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            if (!account) return;
            const isAssetAcct = account.type === 'property' || account.type === 'vehicle';
            const isCredit = account.type === 'credit';
            const linkedDebt = isCredit && account.linkedDebtId ? store.getDebts().find(d => d.id === account.linkedDebtId) : null;
            const owedLabel = account.type === 'vehicle' ? 'Amount Owed (Auto Loan)' : 'Amount Owed (Mortgage)';
            openModal(`Update ${escapeHtml(account.name)}`, `
                <div class="form-group">
                    <label>${isAssetAcct ? 'Estimated Value' : 'Current Balance'}</label>
                    <input type="number" class="form-input" id="quick-balance-input" step="0.01" value="${account.balance}">
                </div>
                ${isAssetAcct ? `
                <div class="form-group">
                    <label>${owedLabel}</label>
                    <input type="number" class="form-input" id="quick-owed-input" step="0.01" value="${account.amountOwed || 0}">
                </div>
                ` : ''}
                ${isCredit && linkedDebt ? `
                <div class="form-row">
                    <div class="form-group">
                        <label>APR %</label>
                        <input type="number" class="form-input" id="quick-apr-input" step="0.01" value="${linkedDebt.interestRate || 0}">
                    </div>
                    <div class="form-group">
                        <label>Min Payment</label>
                        <input type="number" class="form-input" id="quick-min-input" step="0.01" value="${linkedDebt.minimumPayment || 0}">
                    </div>
                </div>
                ` : ''}
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Update</button>
                </div>
            `);
            document.getElementById('quick-balance-input').select();
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', () => {
                const val = parseFloat(document.getElementById('quick-balance-input').value);
                if (!isNaN(val)) {
                    const updates = { balance: val };
                    if (isAssetAcct) {
                        const owedVal = parseFloat(document.getElementById('quick-owed-input').value);
                        if (!isNaN(owedVal)) updates.amountOwed = owedVal;
                    }
                    if (isCredit && linkedDebt) {
                        const aprEl = document.getElementById('quick-apr-input');
                        const minEl = document.getElementById('quick-min-input');
                        if (aprEl) updates._interestRate = parseFloat(aprEl.value) || 0;
                        if (minEl) updates._minimumPayment = parseFloat(minEl.value) || 0;
                    }
                    store.updateAccount(account.id, updates);
                    closeModal();
                    refreshPage();
                }
            });
        });
    });

    // Edit account
    container.querySelectorAll('.settings-edit-account-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            if (account) showAccountForm(store, account);
        });
    });

    // Delete account
    container.querySelectorAll('.settings-delete-account-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            const hasLink = account && account.linkedDebtId;
            const msg = hasLink
                ? 'Delete this account? This will also remove the linked debt and its payment bill.'
                : 'Delete this account?';
            if (confirm(msg)) {
                store.deleteAccount(btn.dataset.accountId);
                refreshPage();
            }
        });
    });

    // Vehicle detail click
    container.querySelectorAll('.vehicle-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            showVehicleDetail(store, link.dataset.vehicleId);
        });
    });

    // Toggle investment holdings panels
    container.querySelectorAll('.settings-toggle-holdings').forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = document.getElementById(`settings-holdings-${btn.dataset.accountId}`);
            if (panel) {
                const isHidden = panel.style.display === 'none';
                panel.style.display = isHidden ? '' : 'none';
                btn.style.background = isHidden ? 'var(--accent)' : 'var(--accent-bg)';
                btn.style.color = isHidden ? 'var(--bg)' : 'var(--accent)';
            }
        });
    });

    // Update consent for investment accounts (enable holdings)
    container.querySelectorAll('.settings-update-consent-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const itemId = btn.dataset.itemId;
            if (!itemId) return;
            btn.textContent = '⏳ Opening...';
            btn.style.pointerEvents = 'none';
            try {
                await updateBankConsent(store, itemId, () => refreshPage());
            } catch (err) {
                console.error('Update consent error:', err);
                btn.textContent = '⚠ Enable Holdings';
                btn.style.pointerEvents = '';
            }
        });
    });
}

// === Accounts Section (embedded in Settings) ===

function renderAccountsSection(store) {
    const accounts = store.getAccounts();
    const isCloud = auth.isCloud();
    const hasPlaid = hasPlaidConnections(store);

    const cashTotal = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);
    const creditTotal = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);
    const investTotal = accounts.filter(a => a.type === 'investment' || a.type === 'retirement').reduce((s, a) => s + a.balance, 0);
    const propEquity = accounts.filter(a => a.type === 'property').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const propCount = accounts.filter(a => a.type === 'property').length;
    const vehicleEquity = accounts.filter(a => a.type === 'vehicle').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const vehicleCount = accounts.filter(a => a.type === 'vehicle').length;
    const netTotal = cashTotal + investTotal + propEquity + vehicleEquity - creditTotal;

    const typeLabels = { credit: 'Credit Card', savings: 'Savings', checking: 'Checking', investment: 'Brokerage/Investment', retirement: '401(k) / Retirement', property: 'Property', vehicle: 'Vehicle' };

    return `
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                    <div>
                        <h3 style="margin:0;">Accounts & Investments</h3>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${accounts.length} account${accounts.length !== 1 ? 's' : ''} &middot; Net: ${formatCurrency(netTotal)}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${isCloud ? '<button class="btn btn-secondary btn-sm" id="settings-connect-bank-btn" style="display:flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg> Connect Bank</button>' : ''}
                        <button class="btn btn-secondary btn-sm" id="settings-scan-statement-btn">Scan Statement</button>
                        <button class="btn btn-primary btn-sm" id="settings-add-account-btn">+ Add Account</button>
                    </div>
                </div>

                ${accounts.length > 0 ? `
                <div class="card-grid" style="margin-bottom:16px;">
                    ${cashTotal !== 0 || accounts.some(a => a.type === 'checking' || a.type === 'savings') ? `
                    <div class="stat-card ${cashTotal >= 0 ? 'green' : 'red'}">
                        <div class="label">Cash / Savings</div>
                        <div class="value">${formatCurrency(cashTotal)}</div>
                        <div class="sub">${accounts.filter(a => a.type === 'checking' || a.type === 'savings').length} account${accounts.filter(a => a.type === 'checking' || a.type === 'savings').length !== 1 ? 's' : ''}</div>
                    </div>
                    ` : ''}
                    ${investTotal > 0 ? `
                    <div class="stat-card green">
                        <div class="label">Investments / Retirement</div>
                        <div class="value">${formatCurrency(investTotal)}</div>
                        <div class="sub">${accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length} account${accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length !== 1 ? 's' : ''}</div>
                    </div>
                    ` : ''}
                    ${propCount > 0 ? `
                    <div class="stat-card ${propEquity >= 0 ? 'green' : 'red'}">
                        <div class="label">Property Equity</div>
                        <div class="value">${formatCurrency(propEquity)}</div>
                        <div class="sub">${propCount} propert${propCount !== 1 ? 'ies' : 'y'}</div>
                    </div>
                    ` : ''}
                    ${vehicleCount > 0 ? `
                    <div class="stat-card ${vehicleEquity >= 0 ? 'green' : 'red'}">
                        <div class="label">Vehicle Equity</div>
                        <div class="value">${formatCurrency(vehicleEquity)}</div>
                        <div class="sub">${vehicleCount} vehicle${vehicleCount !== 1 ? 's' : ''}</div>
                    </div>
                    ` : ''}
                    ${creditTotal > 0 ? `
                    <div class="stat-card red">
                        <div class="label">Credit Owed</div>
                        <div class="value">${formatCurrency(creditTotal)}</div>
                        <div class="sub">${accounts.filter(a => a.type === 'credit').length} card${accounts.filter(a => a.type === 'credit').length !== 1 ? 's' : ''}</div>
                    </div>
                    ` : ''}
                    <div class="stat-card ${netTotal >= 0 ? 'blue' : 'red'}">
                        <div class="label">Net Total</div>
                        <div class="value">${formatCurrency(netTotal)}</div>
                        <div class="sub">${accounts.length} account${accounts.length !== 1 ? 's' : ''} total</div>
                    </div>
                </div>

                ${hasPlaid ? `
                <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
                    <button class="btn btn-secondary btn-sm" id="settings-refresh-plaid-btn" style="display:flex;align-items:center;gap:4px;font-size:11px;">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                        Refresh Connected Balances
                    </button>
                </div>
                ` : ''}

                <div id="settings-accounts-list">
                    ${accounts.map(a => {
                        const updated = a.lastUpdated ? new Date(a.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
                        const typeLabel = typeLabels[a.type] || 'Checking';
                        const balanceClass = a.type === 'credit' ? 'text-red' : 'text-green';
                        const isLinked = !!a.linkedDebtId;
                        const isPlaidAcct = !!a.plaidAccountId;
                        const linkedDebt = isLinked ? store.getDebts().find(d => d.id === a.linkedDebtId) : null;
                        const isAssetWithLoan = a.type === 'property' || a.type === 'vehicle';
                        const isInvestment = a.type === 'investment' || a.type === 'retirement';
                        const needsConsent = isInvestment && isPlaidAcct && !(a.holdings && a.holdings.length > 0);
                        const balanceHtml = isAssetWithLoan ? (() => {
                            const owed = a.amountOwed || 0;
                            const equity = a.balance - owed;
                            return `<div style="text-align:right;">
                                <div class="text-green" style="font-size:16px;font-weight:700;">${formatCurrency(a.balance)}</div>
                                ${owed > 0 ? `<div class="text-red" style="font-size:12px;">Owed: ${formatCurrency(owed)}</div>` : ''}
                                <div class="${equity >= 0 ? 'text-green' : 'text-red'}" style="font-size:13px;font-weight:600;">Equity: ${formatCurrency(equity)}</div>
                            </div>`;
                        })() : `<span class="${balanceClass}" style="font-size:16px;font-weight:700;">${a.type === 'credit' ? '-' : ''}${formatCurrency(Math.abs(a.balance))}</span>`;
                        return `
                        <div class="settings-row" style="flex-wrap:wrap;">
                            <div style="flex:1;min-width:150px;">
                                <div class="setting-label">
                                    ${a.type === 'vehicle' ? `<span class="vehicle-link" data-vehicle-id="${a.id}">${escapeHtml(a.name)}</span>` : escapeHtml(a.name)}
                                    ${isPlaidAcct ? `<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--green-bg);color:var(--green);border:1px solid var(--green);border-radius:4px;vertical-align:middle;" title="${escapeHtml(a.plaidInstitution || 'Bank')} &middot; ****${a.plaidMask || ''}">&#127974; ${escapeHtml(a.plaidInstitution || 'Bank')}</span>` : ''}
                                    ${isLinked ? '<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;" title="Linked to debt">&#128279; Linked</span>' : ''}
                                    ${isInvestment && a.holdings && a.holdings.length > 0 ? `<span class="settings-toggle-holdings" data-account-id="${a.id}" style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent);border-radius:4px;cursor:pointer;vertical-align:middle;" title="Click to show/hide holdings">📊 ${a.holdings.length} holdings</span>` : ''}
                                    ${needsConsent ? `<span class="settings-update-consent-btn" data-item-id="${a.plaidItemId}" style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--yellow-bg, #fef3c7);color:var(--yellow, #d97706);border:1px solid var(--yellow, #d97706);border-radius:4px;cursor:pointer;vertical-align:middle;" title="Grant additional permissions to see holdings data">⚠ Enable Holdings</span>` : ''}
                                </div>
                                <div class="setting-desc">${typeLabel} &middot; Updated ${updated}${linkedDebt ? ` &middot; ${linkedDebt.interestRate.toFixed(1)}% APR &middot; ${formatCurrency(linkedDebt.minimumPayment)} min` : ''}</div>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;">
                                ${balanceHtml}
                                <button class="btn btn-secondary btn-sm settings-update-balance-btn" data-account-id="${a.id}" style="font-size:11px;padding:2px 8px;">Update</button>
                                <button class="btn-icon settings-edit-account-btn" data-account-id="${a.id}" title="Edit">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button class="btn-icon settings-delete-account-btn" data-account-id="${a.id}" title="Delete" style="color:var(--red);">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        </div>
                        ${isInvestment && a.holdings && a.holdings.length > 0 ? `
                        <div class="settings-holdings-panel" id="settings-holdings-${a.id}" style="display:none;padding:0 0 12px 0;border-bottom:1px solid var(--border);">
                            <table style="width:100%;font-size:12px;">
                                <thead>
                                    <tr style="text-align:left;">
                                        <th style="padding:6px 10px;color:var(--text-muted);font-size:10px;text-transform:uppercase;font-weight:600;">Name</th>
                                        <th style="padding:6px 10px;color:var(--text-muted);font-size:10px;text-transform:uppercase;font-weight:600;">Ticker</th>
                                        <th style="padding:6px 10px;color:var(--text-muted);font-size:10px;text-transform:uppercase;font-weight:600;">Type</th>
                                        <th style="padding:6px 10px;color:var(--text-muted);font-size:10px;text-transform:uppercase;font-weight:600;text-align:right;">Shares</th>
                                        <th style="padding:6px 10px;color:var(--text-muted);font-size:10px;text-transform:uppercase;font-weight:600;text-align:right;">Price</th>
                                        <th style="padding:6px 10px;color:var(--text-muted);font-size:10px;text-transform:uppercase;font-weight:600;text-align:right;">Value</th>
                                        <th style="padding:6px 10px;color:var(--text-muted);font-size:10px;text-transform:uppercase;font-weight:600;text-align:right;">Gain/Loss</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${a.holdings.map(h => {
                                        const gain = (h.value != null && h.costBasis != null) ? h.value - h.costBasis : null;
                                        const gainPct = (gain != null && h.costBasis > 0) ? (gain / h.costBasis * 100) : null;
                                        return `<tr style="border-top:1px solid var(--border);">
                                            <td style="padding:6px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</td>
                                            <td style="padding:6px 10px;font-weight:600;color:var(--accent);">${h.ticker || '—'}</td>
                                            <td style="padding:6px 10px;color:var(--text-muted);text-transform:capitalize;">${h.type || '—'}</td>
                                            <td style="padding:6px 10px;text-align:right;">${h.quantity != null ? h.quantity.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 4}) : '—'}</td>
                                            <td style="padding:6px 10px;text-align:right;">${h.price != null ? formatCurrency(h.price) : '—'}</td>
                                            <td style="padding:6px 10px;text-align:right;font-weight:600;">${h.value != null ? formatCurrency(h.value) : '—'}</td>
                                            <td style="padding:6px 10px;text-align:right;font-weight:600;color:${gain != null ? (gain >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)'};">
                                                ${gain != null ? `${gain >= 0 ? '+' : ''}${formatCurrency(gain)}` : '—'}
                                                ${gainPct != null ? `<div style="font-size:10px;font-weight:normal;">${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%</div>` : ''}
                                            </td>
                                        </tr>`;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                        ` : ''}
                        `;
                    }).join('')}
                </div>
                ` : `
                <div style="text-align:center;padding:24px 16px;">
                    <div style="font-size:36px;margin-bottom:12px;">&#127974;</div>
                    <p style="color:var(--text-muted);margin-bottom:16px;font-size:13px;">No accounts tracked yet. Add your bank accounts, investments, and property to track your net worth.</p>
                    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
                        ${isCloud ? '<button class="btn btn-primary btn-sm" id="settings-empty-connect-bank" style="display:flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg> Connect Bank</button>' : ''}
                        <button class="btn ${isCloud ? 'btn-secondary' : 'btn-primary'} btn-sm" id="settings-empty-add-account">+ Add Manually</button>
                    </div>
                </div>
                `}
            </div>
        </div>

        <input type="file" id="settings-ocr-file-input" accept=".jpg,.jpeg,.png,.webp" style="display:none;">
    `;
}
