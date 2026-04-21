import { formatCurrency, escapeHtml, getScoreRating, estimateScoreImpact } from '../utils.js';
import { openModal, closeModal, refreshPage, updateDependentNav } from '../app.js';
import { openFormModal } from '../services/modal-manager.js';
import { auth } from '../auth.js';
import { CATEGORY_COLORS } from '../categories.js';
import { hasPlaidConnections } from '../plaid.js';
import { getThemePreference, setThemePreference } from '../theme.js';
import { resetOnboarding, startOnboarding } from '../onboarding.js';
import { loadQrcodeSdk } from '../cloud-loader.js';
import { renderPlaidConfigCard, attachPlaidConfigHandlers } from './settings-plaid.js';

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
    const healthSettings = store.getHealthScoreSettings();
    const currentRiskTolerance = healthSettings.riskTolerance || 'balanced';
    const hasTaxableInvestments = accounts.some(a => a.type === 'investment');

    // Theme toggle in page header — cycles system → light → dark → system.
    // Tiny icon button replaces the old full-width Appearance card. Click
    // handler lives below with the rest of the settings wiring.
    const themeIcon = pref === 'light'
        ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : pref === 'dark'
            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
            : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
    const themeLabel = pref === 'light' ? 'Light' : pref === 'dark' ? 'Dark' : 'System';

    container.innerHTML = `
        <div class="page-header">
            <h2>Settings</h2>
            <div style="display:flex;gap:8px;align-items:center;">
                <button type="button" id="replay-onboarding-btn"
                    class="btn btn-secondary btn-sm"
                    title="Replay the app tour"
                    aria-label="Replay onboarding tour"
                    style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span style="font-size:12px;">Tour</span>
                </button>
                <button type="button" id="theme-cycle-btn"
                    class="btn btn-secondary btn-sm"
                    title="Theme: ${themeLabel} (click to cycle)"
                    aria-label="Cycle theme — currently ${themeLabel}"
                    style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;">
                    ${themeIcon}
                    <span style="font-size:12px;">${themeLabel}</span>
                </button>
            </div>
        </div>

        <!-- ───── Account ───── -->
        <div class="settings-section-header">Account</div>
        <div class="settings-grid">
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
            ` : ''}
        </div>

        <!-- ───── Accounts & Connections (full-width, data-heavy) ───── -->
        <div class="settings-section-header">Accounts & Connections</div>
        ${renderAccountsSection(store)}
        ${!auth.isCloud() ? renderPlaidConfigCard() : ''}

        ${auth.isCloud() ? `
        <!-- ───── Security ───── -->
        <div class="settings-section-header">Security</div>
        <div class="settings-grid">
            <div class="card mb-24">
                <div class="settings-section">
                    <h3>🔐 Two-Factor Authentication</h3>
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

            <div class="card mb-24">
                <div class="settings-section">
                    <h3>API Access</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Generate API keys for <strong>read-only</strong> access to your PennyHelm data.
                    Keys are scoped to your account only &mdash; they cannot view anyone else's data and cannot modify anything.
                </p>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">API Keys</div>
                        <div class="setting-desc" id="api-keys-count">Loading...</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="create-api-key-btn">Create Key</button>
                </div>
                <div id="api-keys-list" style="margin-top:12px;"></div>
                <div id="api-key-created-banner" style="display:none;margin-top:12px;padding:14px;background:var(--bg-secondary);border:1px solid var(--green);border-radius:var(--radius-sm);">
                    <div style="font-size:12px;font-weight:600;color:var(--green);margin-bottom:6px;">NEW API KEY CREATED</div>
                    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:4px;">
                        Copy this key now &mdash; it will not be shown again.
                    </p>
                    <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
                        Treat it like a password. Anyone with this key can read your financial data.
                        If it leaks, revoke it from the list below and create a new one.
                    </p>
                    <div class="flex-align-center gap-8">
                        <code id="api-key-value" style="flex:1;padding:8px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;font-size:13px;word-break:break-all;user-select:all;"></code>
                        <button class="btn btn-secondary btn-sm" id="copy-api-key-btn">Copy</button>
                    </div>
                </div>
                <details class="mt-16">
                    <summary style="font-size:12px;color:var(--text-secondary);cursor:pointer;user-select:none;">API Documentation</summary>
                    <div style="margin-top:8px;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;color:var(--text-secondary);">
                        <p style="margin:0 0 8px;font-weight:600;">Base URL</p>
                        <code style="display:block;padding:6px 8px;background:var(--bg-primary);border-radius:4px;margin-bottom:12px;font-size:11px;">${escapeHtml(window.location.origin)}/api/v1/</code>
                        <p style="margin:0 0 8px;font-weight:600;">Authentication</p>
                        <code style="display:block;padding:6px 8px;background:var(--bg-primary);border-radius:4px;margin-bottom:12px;font-size:11px;">Authorization: Bearer ph_live_...</code>
                        <p style="margin:0 0 6px;font-weight:600;">Endpoints <span style="font-weight:400;color:var(--text-muted);">(GET only &mdash; read-only)</span></p>
                        <div style="display:grid;gap:4px;">
                            <code style="padding:4px 8px;background:var(--bg-primary);border-radius:4px;font-size:11px;">GET /api/v1/bills</code>
                            <code style="padding:4px 8px;background:var(--bg-primary);border-radius:4px;font-size:11px;">GET /api/v1/accounts</code>
                            <code style="padding:4px 8px;background:var(--bg-primary);border-radius:4px;font-size:11px;">GET /api/v1/debts</code>
                            <code style="padding:4px 8px;background:var(--bg-primary);border-radius:4px;font-size:11px;">GET /api/v1/expenses</code>
                            <code style="padding:4px 8px;background:var(--bg-primary);border-radius:4px;font-size:11px;">GET /api/v1/summary</code>
                        </div>
                    </div>
                </details>
            </div>
        </div>
        </div>
        ` : ''}

        <!-- ───── Finance Tools ───── -->
        <div class="settings-section-header">Finance Tools</div>
        <div class="settings-grid">
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
                    <h3>Financial Health Score</h3>
                    <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                        Pick how much of your taxable brokerage balance should count toward your
                        <strong>Savings Cushion</strong> and <strong>Liquid Reserves</strong>. Retirement
                        accounts (401k / IRA) are never counted — the early-withdrawal penalty makes them
                        unsuitable as emergency reserves.
                    </p>

                    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
                        ${[
                            { value: 'conservative', label: 'Conservative', pct: '50%', desc: 'Assumes market drawdowns and taxes eat half your brokerage in an emergency.' },
                            { value: 'balanced', label: 'Balanced', pct: '75%', desc: 'Default. Reflects typical drawdown, capital gains, and settlement drag.' },
                            { value: 'aggressive', label: 'Aggressive', pct: '100%', desc: 'Full dollar-for-dollar credit. Best for diversified long-horizon investors.' },
                        ].map(opt => {
                            const active = currentRiskTolerance === opt.value;
                            return `
                            <button type="button" class="risk-option" data-risk-option="${opt.value}"
                                style="display:block;text-align:left;cursor:pointer;padding:12px;border-radius:var(--radius-sm);border:2px solid ${active ? 'var(--accent)' : 'var(--border)'};background:var(--bg-secondary);${active ? 'box-shadow:inset 0 0 0 9999px rgba(99,102,241,0.08);' : ''}transition:border-color 0.15s, background 0.15s;width:100%;font-family:inherit;">
                                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
                                    <span style="font-size:13px;font-weight:700;color:var(--text-primary);">${opt.label}${active ? ' ✓' : ''}</span>
                                    <span style="font-size:13px;font-weight:700;color:${active ? 'var(--accent)' : 'var(--text-muted)'};">${opt.pct}</span>
                                </div>
                                <div style="font-size:11px;color:var(--text-secondary);line-height:1.4;">${opt.desc}</div>
                            </button>`;
                        }).join('')}
                    </div>

                    ${hasTaxableInvestments ? '' : `
                        <div style="margin-top:12px;padding:10px 12px;background:var(--bg-secondary);border-radius:var(--radius-sm);border:1px dashed var(--border);font-size:11px;color:var(--text-muted);">
                            <span style="font-weight:600;">Tip:</span> this setting only matters once you have accounts marked as type "Investment". Retirement accounts aren't affected.
                        </div>
                    `}
                </div>
            </div>
        </div>

        <!-- ───── Partner & Sharing ───── -->
        <!-- One unified card: track a partner's bills (management on their
             behalf) and/or invite people to collaborate (active cooperation).
             These two concerns used to be separate cards but they describe
             different positions on the same spectrum: how involved is the
             other person in your finances? -->
        <div class="settings-section-header">Partner &amp; Sharing</div>
        <div class="card mb-24">
            <div class="settings-section">
                <h3>Partner &amp; Household</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Tracking alone lets you manage a partner's bills on their behalf.
                    Add an invite if you want them (or a CPA, financial planner) to view or edit alongside you.
                </p>

                <!-- Partner tracking toggle (works in any mode) -->
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Track a partner's bills</div>
                        <div class="setting-desc">${depEnabled ? `Tracking <strong>${escapeHtml(depName)}</strong>'s bills` : 'Disabled &mdash; turn on to add their bills to your dashboard'}</div>
                    </div>
                    <label class="toggle">
                        <input type="checkbox" ${depEnabled ? 'checked' : ''} id="dep-enabled-toggle">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                ${depEnabled ? `
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Partner's name</div>
                        <div class="setting-desc">Used in labels and totals. Currently: <strong>${escapeHtml(depName)}</strong></div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="edit-dep-name">Edit</button>
                </div>
                ` : ''}

                ${auth.isCloud() ? `
                <!-- Invites (cloud only). Visually separated with a rule so
                     the tracking toggle and the collaboration section are
                     distinct even though they live in one card. -->
                <div style="margin-top:18px;padding-top:18px;border-top:1px solid var(--border);">
                    <div class="settings-row">
                        <div>
                            <div class="setting-label">People with access</div>
                            <div class="setting-desc">Invite a partner, CPA, or financial planner to view or edit your finances</div>
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

                    <!-- Clarifying note for new users: the two controls above
                         sit on a spectrum. Tracking only = you manage alone.
                         Tracking + invite with edit = shared management. -->
                    <div style="margin-top:12px;font-size:11px;color:var(--text-muted);line-height:1.5;">
                        <strong>Tracking only</strong> &mdash; you manage their bills on their behalf.<br>
                        <strong>Tracking + Invite</strong> &mdash; you both see and collaborate on the finances.
                    </div>
                </div>
                ` : ''}
            </div>
        </div>

        <!-- ───── Categorization ───── -->
        <div class="settings-section-header">Categorization</div>
        <div class="settings-grid">
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
                <h3>Business Names</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Manage business names for categorizing expenses. Set your usage type and add businesses to track business expenses separately.
                </p>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Usage Type</div>
                        <div class="setting-desc">How do you use PennyHelm?</div>
                    </div>
                    <select class="form-select" id="usage-type-select" style="width:auto;min-width:120px;">
                        <option value="" ${!store.getUsageType() ? 'selected' : ''}>Not set</option>
                        <option value="personal" ${store.getUsageType() === 'personal' ? 'selected' : ''}>Personal</option>
                        <option value="business" ${store.getUsageType() === 'business' ? 'selected' : ''}>Business</option>
                        <option value="both" ${store.getUsageType() === 'both' ? 'selected' : ''}>Both</option>
                    </select>
                </div>
                <div id="business-names-section" style="${store.getUsageType() === 'business' || store.getUsageType() === 'both' ? '' : 'display:none;'}">
                    <div id="business-names-list">
                        ${store.getBusinessNames().map(bn => `
                            <div class="settings-row">
                                <div class="setting-label">${escapeHtml(bn)}</div>
                                <div style="display:flex;gap:6px;align-items:center;">
                                    <span class="text-muted" style="font-size:12px;">${store.getExpenses().filter(e => e.businessName === bn).length} expense(s)</span>
                                    <button class="btn-icon edit-business-name" data-name="${escapeHtml(bn)}" title="Rename">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button class="btn-icon remove-business-name" data-name="${escapeHtml(bn)}" title="Remove" style="color:var(--red);">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="margin-top:12px;display:flex;gap:8px;">
                        <input type="text" class="form-input" id="new-business-name-input" placeholder="New business name..." style="flex:1;">
                        <button class="btn btn-primary btn-sm" id="add-business-name-btn">Add</button>
                    </div>
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
        </div>

        <!-- ───── Data & Tools ───── -->
        <div class="settings-section-header">Data & Tools</div>
        <div class="settings-grid">
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

            <div class="card mb-24">
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
        </div>

        ${auth.isCloud() ? `
        <div class="card mb-24">
            <div class="settings-section">
                <h3>Referral Program</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Earn free months when friends become paid subscribers &mdash;
                    <strong>1 month at 1 referral, 3 months at 3, 6 months at 5, and a full year at 10.</strong>
                    Rewards are applied as credits to your Stripe balance.
                </p>
                <div id="referral-status-container">
                    <p style="color:var(--text-secondary);font-size:13px;">Loading referral info...</p>
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

        ${auth.isCloud() ? `
        <!-- ───── Danger Zone (cloud only) ─────
             Kept at the very bottom of the page, below Summary, so it's
             hard to land on accidentally while scanning settings. Deleting
             the account is irreversible, so it should be the furthest thing
             from an accidental tap. -->
        <div class="settings-section-header" style="color:var(--red);margin-top:32px;">Danger Zone</div>
        <div class="card mb-24" style="border:2px solid var(--red);">
            <div class="settings-section">
                <h3 style="color:var(--red);">⚠️ Delete Account</h3>
                <div class="settings-row">
                    <div>
                        <div class="setting-label" style="color:var(--red);">Permanently Delete Your Account</div>
                        <div class="setting-desc">This will permanently delete your account, all financial data, linked bank connections, and subscription. This action cannot be undone.</div>
                    </div>
                    <button class="btn btn-danger btn-sm" id="delete-account-btn">Delete Account</button>
                </div>
            </div>
        </div>
        ` : ''}

        <input type="file" id="import-file-input" accept=".json" style="display:none;">
    `;

    // Replay onboarding tour
    container.querySelector('#replay-onboarding-btn').addEventListener('click', () => {
        resetOnboarding();
        startOnboarding();
    });

    // Risk tolerance selector — clicking a card selects that preset and
    // re-renders the settings page so the active styling updates.
    // Mirrors the theme-toggle pattern which also uses buttons + data attrs.
    container.querySelectorAll('.risk-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.dataset.riskOption;
            if (!value) return;
            const current = store.getHealthScoreSettings().riskTolerance;
            if (value === current) return;
            store.updateHealthScoreSettings({ riskTolerance: value });
            renderSettings(container, store);
        });
    });

    // Edit user name
    container.querySelector('#edit-user-name').addEventListener('click', () => {
        openFormModal({
            title: 'Edit Your Name',
            refreshPage,
            fields: [{
                id: 'user-name-input', label: 'Your Name', type: 'text',
                value: userName, required: true, autofocus: true,
            }],
            onSave: (values) => {
                const val = values['user-name-input'];
                store.setUserName(val);
                // Update sidebar and page title dynamically
                const logoText = document.querySelector('.logo-text');
                if (logoText) logoText.textContent = val + ' Finances';
                const logo = document.querySelector('.logo');
                if (logo) logo.textContent = val.charAt(0).toUpperCase() + 'F';
                document.title = val + ' Finances';
            },
        });
    });

    // Theme cycle button in page header — system → light → dark → system
    const themeCycleBtn = container.querySelector('#theme-cycle-btn');
    if (themeCycleBtn) {
        themeCycleBtn.addEventListener('click', () => {
            const current = getThemePreference();
            const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
            setThemePreference(next);
            renderSettings(container, store);
        });
    }

    // Accounts summary link
    const acctLink = container.querySelector('#settings-go-to-accounts');
    if (acctLink) acctLink.addEventListener('click', (e) => { e.preventDefault(); window.location.hash = 'accounts'; });

    // Plaid config (selfhost only — card is not rendered in cloud mode)
    if (!auth.isCloud()) {
        attachPlaidConfigHandlers(container).catch(e => console.error('Plaid config handlers:', e));
    }

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
                            <div class="form-group mt-16">
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

                        // Render QR code (load QRCode lib on demand — cloud-only)
                        try {
                            await loadQrcodeSdk();
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

    // === API Keys Management (cloud mode only) ===
    if (auth.isCloud()) {
        const apiKeysCountEl = container.querySelector('#api-keys-count');
        const apiKeysListEl = container.querySelector('#api-keys-list');
        const createApiKeyBtn = container.querySelector('#create-api-key-btn');
        const apiKeyBanner = container.querySelector('#api-key-created-banner');
        const apiKeyValueEl = container.querySelector('#api-key-value');
        const copyApiKeyBtn = container.querySelector('#copy-api-key-btn');

        const renderApiKeysList = (keys) => {
            const activeKeys = keys.filter(k => k.status === 'active');
            apiKeysCountEl.textContent = activeKeys.length === 0
                ? 'No active API keys'
                : `${activeKeys.length} active key${activeKeys.length > 1 ? 's' : ''}`;

            if (keys.length === 0) {
                apiKeysListEl.innerHTML = '';
                return;
            }

            apiKeysListEl.innerHTML = keys.map(k => {
                const created = k.createdAt ? new Date(k.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
                const lastUsed = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
                const isRevoked = k.status === 'revoked';
                return `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;${isRevoked ? 'opacity:0.5;' : ''}">
                        <div style="min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${escapeHtml(k.name)}</div>
                            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                                <code style="font-size:11px;">${escapeHtml(k.keyPrefix)}...</code>
                                &middot; Created ${created} &middot; Last used: ${lastUsed}
                                ${isRevoked ? ' &middot; <span style="color:var(--red);font-weight:600;">Revoked</span>' : ''}
                            </div>
                        </div>
                        ${!isRevoked ? `<button class="btn btn-danger btn-sm revoke-api-key-btn" data-key-id="${k.keyId}" style="flex-shrink:0;margin-left:12px;">Revoke</button>` : ''}
                    </div>`;
            }).join('');

            // Attach revoke handlers
            apiKeysListEl.querySelectorAll('.revoke-api-key-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const keyId = btn.dataset.keyId;
                    if (!confirm('Revoke this API key? Any integrations using it will stop working immediately.')) return;
                    btn.disabled = true;
                    btn.textContent = 'Revoking...';
                    try {
                        const functions = firebase.functions();
                        const revokeApiKey = functions.httpsCallable('revokeApiKey');
                        await revokeApiKey({ keyId });
                        loadApiKeys();
                    } catch (e) {
                        console.error('Revoke API key error:', e);
                        alert('Failed to revoke API key.');
                        btn.disabled = false;
                        btn.textContent = 'Revoke';
                    }
                });
            });
        };

        const loadApiKeys = async () => {
            try {
                const functions = firebase.functions();
                const listApiKeys = functions.httpsCallable('listApiKeys');
                const result = await listApiKeys({});
                renderApiKeysList(result.data.keys || []);
            } catch (e) {
                console.error('Error loading API keys:', e);
                apiKeysCountEl.textContent = 'Error loading keys';
            }
        };

        loadApiKeys();

        if (createApiKeyBtn) {
            createApiKeyBtn.addEventListener('click', () => {
                openModal('Create API Key', `
                    <div style="padding:8px 0 16px;font-size:14px;">
                        <p style="margin-bottom:12px;">Give your API key a descriptive name so you can identify it later.</p>
                        <div class="form-group">
                            <label class="form-label" for="api-key-name">Key Name</label>
                            <input type="text" class="form-input" id="api-key-name" placeholder="e.g. Budget Spreadsheet, Home Automation" maxlength="64">
                        </div>
                        <div style="margin:14px 0;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-sm);font-size:12px;color:var(--text-secondary);line-height:1.5;">
                            <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">Before you continue</div>
                            <ul style="margin:0;padding-left:18px;">
                                <li>This key grants <strong>read-only</strong> access to <strong>your</strong> financial data (bills, accounts, debts, expenses, summary).</li>
                                <li>The full key is shown <strong>only once</strong> &mdash; copy it immediately and store it somewhere safe (a password manager).</li>
                                <li>Treat it like a password. Don't commit it to a public repo, paste it into a chat, or share it.</li>
                                <li>If it leaks, revoke it from this page right away and create a new one.</li>
                            </ul>
                        </div>
                        <div id="api-key-create-error" style="color:var(--red);font-size:13px;margin-bottom:8px;"></div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                        <button class="btn btn-primary" id="modal-create">Create Key</button>
                    </div>
                `);
                document.getElementById('api-key-name').focus();
                document.getElementById('modal-cancel').addEventListener('click', closeModal);
                document.getElementById('modal-create').addEventListener('click', async () => {
                    const name = document.getElementById('api-key-name').value.trim();
                    const errorDiv = document.getElementById('api-key-create-error');
                    const createBtn = document.getElementById('modal-create');
                    if (!name) {
                        errorDiv.textContent = 'Please enter a name for the API key.';
                        return;
                    }
                    createBtn.disabled = true;
                    createBtn.textContent = 'Creating...';
                    errorDiv.textContent = '';
                    try {
                        const functions = firebase.functions();
                        const createApiKey = functions.httpsCallable('createApiKey');
                        const result = await createApiKey({ name });
                        closeModal();
                        // Show the key in the banner
                        apiKeyValueEl.textContent = result.data.apiKey;
                        apiKeyBanner.style.display = 'block';
                        loadApiKeys();
                    } catch (e) {
                        createBtn.disabled = false;
                        createBtn.textContent = 'Create Key';
                        errorDiv.textContent = e.message || 'Failed to create API key.';
                    }
                });
            });
        }

        if (copyApiKeyBtn) {
            copyApiKeyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(apiKeyValueEl.textContent);
                copyApiKeyBtn.textContent = 'Copied!';
                setTimeout(() => { copyApiKeyBtn.textContent = 'Copy'; }, 2000);
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

    // Referral program status (cloud only). Backend contract:
    //   { referralCode, referralLink, paidReferralCount, targetCount,
    //     tiers: [{ threshold, totalMonths, reached, rewarded }, ...],
    //     nextTier: { threshold, totalMonths, remaining } | null,
    //     totalMonthsEarned, rewardEarned }
    const referralContainer = container.querySelector('#referral-status-container');
    if (referralContainer && auth.isCloud()) {
        (async () => {
            try {
                const getReferralStatus = firebase.functions().httpsCallable('getReferralStatus');
                const result = await getReferralStatus({});
                const data = result.data || {};

                const count = data.paidReferralCount || 0;
                const target = data.targetCount || 10;
                const pct = Math.min(100, Math.round((count / target) * 100));
                // Fall back gracefully if an older backend is deployed and
                // didn't return tiers yet — show a simple bar only.
                const tiers = Array.isArray(data.tiers) ? data.tiers : [];
                const nextTier = data.nextTier || null;
                const totalMonthsEarned = data.totalMonthsEarned || 0;

                // Celebration banner whenever the user has earned anything.
                // Different copy if they've fully maxed out (hit tier 10).
                const maxed = tiers.length > 0 && tiers.every(t => t.rewarded);
                const banner = totalMonthsEarned > 0 ? `
                    <div style="padding:12px;background:var(--green-bg);border:1px solid var(--green);border-radius:8px;margin-bottom:14px;">
                        <div style="font-weight:600;color:var(--green);font-size:14px;">
                            ${maxed ? 'Maxed out &mdash; you earned a free year!' : `You've earned ${totalMonthsEarned} free month${totalMonthsEarned === 1 ? '' : 's'}!`}
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
                            Credits are on your Stripe account and auto-apply to upcoming invoices.
                        </div>
                    </div>
                ` : '';

                // Progress line + bar
                const progressLine = nextTier
                    ? `<strong>${count}</strong> paid referral${count === 1 ? '' : 's'} &mdash; ${nextTier.remaining} more for ${nextTier.totalMonths} free month${nextTier.totalMonths === 1 ? '' : 's'}`
                    : `<strong>${count}</strong> paid referrals &mdash; you've hit every tier!`;

                // Tier ladder: ✓ earned, ● next-up, ○ future. Using inline SVG
                // would be heavier — Unicode bullets are fine for a settings row.
                const tierRows = tiers.map(t => {
                    const isNext = nextTier && nextTier.threshold === t.threshold;
                    const icon = t.rewarded ? '✓'
                        : (t.reached || isNext) ? '●'  // reached but not credited, or up next
                        : '○';
                    const iconColor = t.rewarded ? 'var(--green)'
                        : isNext ? 'var(--accent)'
                        : 'var(--text-muted)';
                    // Text stays primary (high contrast) for rows that are
                    // rewarded or up next, and secondary (not muted) for
                    // future rows so they're still legible in both themes.
                    const textStyle = t.rewarded
                        ? 'color:var(--text-primary);'
                        : isNext
                            ? 'color:var(--text-primary);font-weight:500;'
                            : 'color:var(--text-secondary);';
                    return `
                        <div style="display:flex;align-items:center;gap:10px;padding:4px 0;font-size:12px;${textStyle}">
                            <span style="display:inline-block;width:16px;text-align:center;color:${iconColor};font-weight:700;">${icon}</span>
                            <span style="flex:1;">${t.threshold} paid referral${t.threshold === 1 ? '' : 's'} &rarr; ${t.totalMonths} month${t.totalMonths === 1 ? '' : 's'} free</span>
                            ${t.rewarded ? '<span style="font-size:11px;color:var(--green);">Earned</span>' : isNext ? '<span style="font-size:11px;color:var(--accent);">Next</span>' : ''}
                        </div>
                    `;
                }).join('');

                const tierLadderHtml = tiers.length > 0 ? `
                    <div style="margin:10px 0 14px;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;">
                        ${tierRows}
                    </div>
                ` : '';

                // Share button URLs. Each one opens in a new tab and passes
                // the user's link plus a short pitch. Reddit and LinkedIn take
                // both a URL and a title; X/Twitter wants 'text' that includes
                // the URL; Facebook only takes a URL.
                const link = data.referralLink || '';
                const safeLink = encodeURIComponent(link);
                const shareTitle = encodeURIComponent('I use PennyHelm to manage my bills, debts, and cash flow. Get a month free when you sign up:');
                const shareTitleShort = encodeURIComponent('Try PennyHelm with me — get a month free:');
                const shareButtons = link ? `
                    <div style="margin-bottom:14px;">
                        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Share your link</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <a href="https://twitter.com/intent/tweet?text=${shareTitleShort}%20${safeLink}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm share-btn" data-network="twitter" style="display:inline-flex;align-items:center;gap:6px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                                X
                            </a>
                            <a href="https://www.linkedin.com/sharing/share-offsite/?url=${safeLink}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm share-btn" data-network="linkedin" style="display:inline-flex;align-items:center;gap:6px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14zM8.339 18.337V9.75H5.67v8.587h2.669zM7.005 8.575a1.548 1.548 0 1 0 0-3.095 1.548 1.548 0 0 0 0 3.095zm11.335 9.762v-4.907c0-2.315-.5-4.093-3.204-4.093-1.3 0-2.173.714-2.53 1.39h-.036V9.75H9.998v8.587h2.669v-4.245c0-1.12.212-2.205 1.6-2.205 1.369 0 1.387 1.28 1.387 2.276v4.174h2.686z"/></svg>
                                LinkedIn
                            </a>
                            <a href="https://www.reddit.com/submit?url=${safeLink}&title=${shareTitle}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm share-btn" data-network="reddit" style="display:inline-flex;align-items:center;gap:6px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12.08a2.2 2.2 0 0 0-3.73-1.58 10.72 10.72 0 0 0-5.83-1.85l1-4.7 3.27.7a1.56 1.56 0 1 0 .16-.89l-3.64-.77a.43.43 0 0 0-.51.33l-1.11 5.23a10.74 10.74 0 0 0-5.92 1.85 2.2 2.2 0 1 0-2.42 3.59 4.54 4.54 0 0 0-.05.66c0 3.38 3.93 6.12 8.77 6.12s8.77-2.74 8.77-6.12a4.54 4.54 0 0 0-.05-.66A2.2 2.2 0 0 0 22 12.08zM7 13.58a1.56 1.56 0 1 1 1.56 1.56A1.56 1.56 0 0 1 7 13.58zm8.78 4.16a4.88 4.88 0 0 1-3.26 1 4.88 4.88 0 0 1-3.26-1 .36.36 0 0 1 .5-.5 4.17 4.17 0 0 0 2.76.84 4.17 4.17 0 0 0 2.76-.84.36.36 0 1 1 .5.5zm-.33-2.6a1.56 1.56 0 1 1 1.56-1.56 1.56 1.56 0 0 1-1.56 1.56z"/></svg>
                                Reddit
                            </a>
                            <a href="https://www.facebook.com/sharer/sharer.php?u=${safeLink}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm share-btn" data-network="facebook" style="display:inline-flex;align-items:center;gap:6px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9.19 21.5v-8.56H6.31v-3.34h2.88V7.12c0-2.86 1.74-4.42 4.29-4.42 1.22 0 2.27.09 2.58.13v2.99h-1.77c-1.39 0-1.66.66-1.66 1.63v2.14h3.31l-.43 3.34h-2.88v8.56H9.19z"/></svg>
                                Facebook
                            </a>
                        </div>
                    </div>
                ` : '';

                referralContainer.innerHTML = `
                    ${banner}
                    <div style="font-size:13px;color:var(--text-primary);margin-bottom:8px;">
                        ${progressLine}
                    </div>
                    <div style="height:8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:6px;">
                        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:4px;transition:width 0.3s;"></div>
                    </div>
                    ${tierLadderHtml}
                    ${shareButtons}
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">Your referral link:</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <code id="referral-link-value" style="flex:1;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;font-size:12px;word-break:break-all;user-select:all;">${escapeHtml(data.referralLink || '')}</code>
                        <button class="btn btn-secondary btn-sm" id="copy-referral-link" style="white-space:nowrap;">Copy</button>
                    </div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:6px;">
                        Your code: <code style="background:var(--bg-input);padding:1px 4px;border-radius:3px;font-family:monospace;">${escapeHtml(data.referralCode || '')}</code>
                    </div>
                `;

                const copyBtn = referralContainer.querySelector('#copy-referral-link');
                if (copyBtn && data.referralLink) {
                    copyBtn.addEventListener('click', () => {
                        navigator.clipboard.writeText(data.referralLink);
                        copyBtn.textContent = 'Copied!';
                        setTimeout(() => copyBtn.textContent = 'Copy', 2000);
                    });
                }

                // Optional: fire a lightweight analytics ping when the user
                // clicks a share button so we can see which networks actually
                // get used. Graceful no-op if gtag isn't on the page.
                referralContainer.querySelectorAll('.share-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const network = btn.getAttribute('data-network');
                        if (typeof window.gtag === 'function') {
                            window.gtag('event', 'share', {
                                method: network,
                                content_type: 'referral_link',
                            });
                        }
                    });
                });
            } catch (err) {
                console.error('Error loading referral status:', err);
                referralContainer.innerHTML = '<p style="color:var(--red);font-size:13px;">Failed to load referral info.</p>';
            }
        })();
    }

    // Credit score - user
    container.querySelector('#update-user-score').addEventListener('click', () => {
        openFormModal({
            title: `Update ${userName}'s Credit Score`,
            refreshPage,
            fields: [{
                id: 'credit-score-input', label: 'FICO Score (300–850)',
                type: 'number', min: 300, max: 850,
                value: creditScores.user.score || '',
                required: true, autofocus: true,
            }],
            onSave: (values) => {
                store.updateCreditScore('user', Math.round(values['credit-score-input']));
            },
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
            openFormModal({
                title: `Update ${depName}'s Credit Score`,
                refreshPage,
                fields: [{
                    id: 'credit-score-input', label: 'FICO Score (300–850)',
                    type: 'number', min: 300, max: 850,
                    value: (creditScores.dependent && creditScores.dependent.score) || '',
                    required: true, autofocus: true,
                }],
                onSave: (values) => {
                    store.updateCreditScore('dependent', Math.round(values['credit-score-input']));
                },
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

    // Edit dependent (partner) name
    const editDepNameBtn = container.querySelector('#edit-dep-name');
    if (editDepNameBtn) {
        editDepNameBtn.addEventListener('click', () => {
            openFormModal({
                title: "Edit Partner's Name",
                refreshPage,
                fields: [{
                    id: 'dep-name-input', label: "Partner's name", type: 'text',
                    value: depName, required: true, autofocus: true,
                }],
                onSave: (values) => {
                    store.setDependentName(values['dep-name-input']);
                    updateDependentNav();
                },
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
            openFormModal({
                title: 'Rename Payment Source',
                refreshPage,
                fields: [{
                    id: 'rename-source-input', label: 'Source Name', type: 'text',
                    value: oldName, required: true, autofocus: true,
                }],
                onSave: (values) => {
                    const newName = values['rename-source-input'];
                    if (newName && newName !== oldName) {
                        store.renamePaymentSource(oldName, newName);
                    }
                },
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

    // === Business Names ===

    // Usage type selector
    const usageTypeSelect = container.querySelector('#usage-type-select');
    if (usageTypeSelect) {
        usageTypeSelect.addEventListener('change', () => {
            const val = usageTypeSelect.value || null;
            store.setUsageType(val);
            const section = container.querySelector('#business-names-section');
            if (section) {
                section.style.display = (val === 'business' || val === 'both') ? '' : 'none';
            }
        });
    }

    // Add business name
    const addBizBtn = container.querySelector('#add-business-name-btn');
    if (addBizBtn) {
        addBizBtn.addEventListener('click', () => {
            const input = container.querySelector('#new-business-name-input');
            const name = input.value.trim();
            if (!name) return;
            if (store.getBusinessNames().includes(name)) {
                alert('This business name already exists.');
                return;
            }
            store.addBusinessName(name);
            refreshPage();
        });

        const bizInput = container.querySelector('#new-business-name-input');
        if (bizInput) {
            bizInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addBizBtn.click();
            });
        }
    }

    // Edit business name
    container.querySelectorAll('.edit-business-name').forEach(btn => {
        btn.addEventListener('click', () => {
            const oldName = btn.dataset.name;
            const newName = prompt('Rename business:', oldName);
            if (newName && newName.trim() && newName.trim() !== oldName) {
                store.renameBusinessName(oldName, newName.trim());
                refreshPage();
            }
        });
    });

    // Remove business name
    container.querySelectorAll('.remove-business-name').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.name;
            const expCount = store.getExpenses().filter(e => e.businessName === name).length;
            let msg = `Remove business "${name}"?`;
            if (expCount > 0) {
                msg += ` ${expCount} expense(s) will keep their business tag but it won't appear in dropdowns.`;
            }
            if (confirm(msg)) {
                store.removeBusinessName(name);
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
                    <li>Bills (yours and partner's)</li>
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

    // Delete Account (cloud mode only)
    container.querySelector('#delete-account-btn')?.addEventListener('click', () => {
        openModal('Delete Account', `
            <div style="padding:8px 0 16px;font-size:14px;">
                <div style="background:rgba(220,38,38,0.08);border:1px solid var(--red);border-radius:8px;padding:16px;margin-bottom:16px;">
                    <p style="color:var(--red);font-weight:600;margin:0 0 8px;">⚠️ WARNING: This action is permanent and irreversible.</p>
                    <p style="margin:0;font-size:13px;color:var(--text-secondary);">Once deleted, your data cannot be recovered.</p>
                </div>
                <p style="font-size:13px;margin-bottom:8px;">This will permanently delete:</p>
                <ul style="margin-left:20px;margin-bottom:16px;color:var(--text-secondary);font-size:13px;">
                    <li>Your PennyHelm account and profile</li>
                    <li>All bills, accounts, debts, and financial data</li>
                    <li>All linked bank connections (Plaid)</li>
                    <li>Your subscription (if active)</li>
                    <li>All invites and registration codes</li>
                    <li>Two-factor authentication settings</li>
                </ul>
                <p style="font-size:13px;margin-bottom:8px;">Type <strong>DELETE</strong> to confirm:</p>
                <input type="text" id="delete-confirm-input" class="form-input" placeholder="Type DELETE" autocomplete="off">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-danger" id="modal-confirm" disabled>Delete My Account</button>
            </div>
        `);

        const input = document.getElementById('delete-confirm-input');
        const confirmBtn = document.getElementById('modal-confirm');
        input.addEventListener('input', () => {
            confirmBtn.disabled = input.value.trim() !== 'DELETE';
        });

        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        confirmBtn.addEventListener('click', () => {
            openModal('Final Confirmation', `
                <div style="text-align:center;padding:20px 0;">
                    <p style="color:var(--red);font-weight:700;font-size:18px;">This is your last chance.</p>
                    <p style="font-size:14px;margin:12px 0;">Your account and all data will be <strong>permanently erased</strong>.</p>
                    <p style="font-size:13px;color:var(--text-muted);">This cannot be undone. There is no recovery option.</p>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-danger" id="modal-final-confirm" disabled>Deleting in <span id="countdown">5</span>s...</button>
                </div>
            `);

            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            let seconds = 5;
            const countdownEl = document.getElementById('countdown');
            const finalBtn = document.getElementById('modal-final-confirm');
            const timer = setInterval(() => {
                seconds--;
                countdownEl.textContent = seconds;
                if (seconds <= 0) {
                    clearInterval(timer);
                    finalBtn.disabled = false;
                    finalBtn.textContent = 'Permanently Delete My Account';
                }
            }, 1000);

            finalBtn.addEventListener('click', async () => {
                finalBtn.disabled = true;
                finalBtn.textContent = 'Deleting...';
                try {
                    const deleteAccountFn = firebase.functions().httpsCallable('deleteAccount');
                    await deleteAccountFn();
                    closeModal();
                    await auth.signOut();
                    window.location.href = '/';
                } catch (err) {
                    console.error('Account deletion failed:', err);
                    alert('Account deletion failed: ' + (err.message || 'Unknown error. Please try again.'));
                    closeModal();
                }
            });
        });
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

// (Account management moved to dedicated Accounts page)

// === Accounts Summary (links to dedicated Accounts page) ===

function renderAccountsSection(store) {
    const accounts = store.getAccounts();
    const hasPlaid = hasPlaidConnections(store);

    const cashTotal = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);
    const creditTotal = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);
    const investTotal = accounts.filter(a => a.type === 'investment' || a.type === 'retirement').reduce((s, a) => s + a.balance, 0);
    const assetEquity = accounts.filter(a => a.type === 'property' || a.type === 'vehicle' || a.type === 'equipment' || a.type === 'other-asset').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const netTotal = cashTotal + investTotal + assetEquity - creditTotal;

    return `
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                        <h3 style="margin:0;">Accounts & Investments</h3>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
                            ${accounts.length} account${accounts.length !== 1 ? 's' : ''}
                            &middot; Net: <strong style="color:${netTotal >= 0 ? 'var(--green)' : 'var(--red)'};">${formatCurrency(netTotal)}</strong>
                            ${hasPlaid ? ' &middot; <span style="color:var(--green);">Bank connected</span>' : ''}
                        </div>
                    </div>
                    <a href="#accounts" id="settings-go-to-accounts" class="btn btn-secondary btn-sm icon-label gap-6">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg>
                        Manage Accounts
                    </a>
                </div>
            </div>
        </div>
    `;
}
