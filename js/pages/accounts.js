import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';
import { auth } from '../auth.js';
import { capabilities } from '../mode/mode.js';
import { connectBank, refreshPlaidBalances, hasPlaidConnections } from '../plaid.js';
import { showVehicleDetail } from './vehicle-detail.js';
import { requireMFAForUpload } from '../mfa-guard.js';

export function renderAccounts(container, store) {
    const accounts = store.getAccounts();
    const plaidAvailable = capabilities().plaid;
    const hasPlaid = hasPlaidConnections(store);

    // Calculate totals
    const cashTotal = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);
    const creditTotal = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);
    const investTotal = accounts.filter(a => a.type === 'investment' || a.type === 'retirement').reduce((s, a) => s + a.balance, 0);
    const propEquity = accounts.filter(a => a.type === 'property').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const propCount = accounts.filter(a => a.type === 'property').length;
    const vehicleEquity = accounts.filter(a => a.type === 'vehicle').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const vehicleCount = accounts.filter(a => a.type === 'vehicle').length;
    const equipEquity = accounts.filter(a => a.type === 'equipment').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const equipCount = accounts.filter(a => a.type === 'equipment').length;
    const otherAssetEquity = accounts.filter(a => a.type === 'other-asset').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const otherAssetCount = accounts.filter(a => a.type === 'other-asset').length;
    const netTotal = cashTotal + investTotal + propEquity + vehicleEquity + equipEquity + otherAssetEquity - creditTotal;

    const typeLabels = { credit: 'Credit Card', savings: 'Savings', checking: 'Checking', investment: 'Brokerage/Investment', retirement: '401(k) / Retirement', property: 'Property', vehicle: 'Vehicle', equipment: 'Equipment', 'other-asset': 'Other Asset' };

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Accounts & Investments</h2>
                <div class="subtitle">${accounts.length} account${accounts.length !== 1 ? 's' : ''} &middot; Net: ${formatCurrency(netTotal)}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${plaidAvailable ? '<button class="btn btn-secondary" id="connect-bank-btn" style="display:flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg> Connect Bank</button>' : ''}
                <button class="btn btn-secondary" id="scan-statement-btn">Scan Statement</button>
                <button class="btn btn-primary" id="add-account-btn">+ Add Account</button>
            </div>
        </div>

        ${accounts.length > 0 ? `
        <div class="card-grid">
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
        <div style="margin-top:16px;display:flex;justify-content:flex-end;">
            <button class="btn btn-secondary btn-sm" id="refresh-plaid-btn" style="display:flex;align-items:center;gap:6px;font-size:12px;">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh Connected Balances
            </button>
        </div>
        ` : ''}

        <div class="card" style="margin-top:${hasPlaid ? '12' : '24'}px;">
            <h3 class="mb-16">All Accounts</h3>
            <div id="accounts-list">
                ${accounts.map(a => {
                    const updated = a.lastUpdated ? new Date(a.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
                    const typeLabel = typeLabels[a.type] || 'Checking';
                    const balanceClass = a.type === 'credit' ? 'text-red' : 'text-green';
                    const isLinked = !!a.linkedDebtId;
                    const isPlaid = !!a.plaidAccountId;
                    const linkedDebt = isLinked ? store.getDebts().find(d => d.id === a.linkedDebtId) : null;
                    const isAssetWithLoan = a.type === 'property' || a.type === 'vehicle' || a.type === 'equipment' || a.type === 'other-asset';
                    const owedLabel = a.type === 'vehicle' ? 'Amount Owed (Auto Loan)' : a.type === 'equipment' ? 'Amount Owed (Equipment Loan)' : a.type === 'other-asset' ? 'Amount Owed' : 'Amount Owed (Mortgage)';
                    const isInvestment = a.type === 'investment' || a.type === 'retirement';
                    const holdings = a.holdings || [];
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
                                ${isPlaid ? `<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--green-bg);color:var(--green);border:1px solid var(--green);border-radius:4px;vertical-align:middle;" title="${escapeHtml(a.plaidInstitution || 'Bank')} &middot; ****${a.plaidMask || ''}">&#127974; ${escapeHtml(a.plaidInstitution || 'Bank')}</span>` : ''}
                                ${isLinked ? '<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;" title="Linked to debt">&#128279; Linked</span>' : ''}
                                ${isInvestment && holdings.length > 0 ? `<span class="toggle-holdings" data-account-id="${a.id}" style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent);border-radius:4px;cursor:pointer;vertical-align:middle;" title="Show holdings">📊 ${holdings.length} holdings</span>` : ''}
                            </div>
                            <div class="setting-desc">${typeLabel} &middot; Updated ${updated}${linkedDebt ? `${linkedDebt.interestRate ? ` &middot; ${linkedDebt.interestRate.toFixed(1)}% APR` : ''}${linkedDebt.minimumPayment ? ` &middot; ${formatCurrency(linkedDebt.minimumPayment)} min` : ''}` : ''}</div>
                        </div>
                        <div class="flex-align-center gap-8">
                            ${balanceHtml}
                            <button class="btn btn-secondary btn-sm update-balance-btn" data-account-id="${a.id}" style="font-size:11px;padding:2px 8px;">Update</button>
                            <button class="btn-icon edit-account-btn" data-account-id="${a.id}" title="Edit">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button class="btn-icon delete-account-btn" data-account-id="${a.id}" title="Delete" style="color:var(--red);">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                    ${isInvestment && holdings.length > 0 ? `
                    <div class="holdings-panel" id="holdings-${a.id}" style="display:none;padding:0 0 12px 0;border-bottom:1px solid var(--border);">
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
                                ${holdings.map(h => {
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
        </div>
        ` : `
        <div class="card" style="text-align:center;padding:48px 24px;margin-top:24px;">
            <div style="font-size:48px;margin-bottom:16px;">&#127974;</div>
            <h3 class="mb-8">No accounts tracked</h3>
            <p style="color:var(--text-muted);margin-bottom:24px;">Add your bank accounts, investments, and property to track your net worth.</p>
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                ${plaidAvailable ? '<button class="btn btn-primary" id="empty-connect-bank" style="display:flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg> Connect Bank</button>' : ''}
                <button class="btn ${plaidAvailable ? 'btn-secondary' : 'btn-primary'}" id="empty-add-account">+ Add Manually</button>
            </div>
        </div>
        `}

        <input type="file" id="ocr-file-input" accept=".jpg,.jpeg,.png,.webp" style="display:none;">
    `;

    // Event handlers
    container.querySelector('#add-account-btn').addEventListener('click', () => {
        showAccountForm(store);
    });

    const emptyAddBtn = container.querySelector('#empty-add-account');
    if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => showAccountForm(store));
    }

    const emptyConnectBtn = container.querySelector('#empty-connect-bank');
    if (emptyConnectBtn) {
        emptyConnectBtn.addEventListener('click', () => {
            connectBank(store, () => refreshPage());
        });
    }

    // Connect Bank button (cloud only)
    const connectBankBtn = container.querySelector('#connect-bank-btn');
    if (connectBankBtn) {
        connectBankBtn.addEventListener('click', () => {
            connectBank(store, () => refreshPage());
        });
    }

    // Refresh Connected Balances button (rate limited to once per 15 minutes)
    const refreshPlaidBtn = container.querySelector('#refresh-plaid-btn');
    if (refreshPlaidBtn) {
        const REFRESH_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
        const STORAGE_KEY = 'pennyhelm_last_plaid_refresh';
        const refreshIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

        function getRemainingCooldown() {
            const last = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
            const elapsed = Date.now() - last;
            return elapsed < REFRESH_COOLDOWN_MS ? REFRESH_COOLDOWN_MS - elapsed : 0;
        }

        function formatCountdown(ms) {
            const mins = Math.floor(ms / 60000);
            const secs = Math.floor((ms % 60000) / 1000);
            return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        }

        let cooldownTimer = null;
        function startCooldownTimer() {
            function tick() {
                const remaining = getRemainingCooldown();
                if (remaining <= 0) {
                    refreshPlaidBtn.disabled = false;
                    refreshPlaidBtn.innerHTML = `${refreshIcon} Refresh Connected Balances`;
                    cooldownTimer = null;
                    return;
                }
                refreshPlaidBtn.disabled = true;
                refreshPlaidBtn.innerHTML = `${refreshIcon} Retry in ${formatCountdown(remaining)}`;
                cooldownTimer = setTimeout(tick, 1000);
            }
            tick();
        }

        // Check if still in cooldown on render
        if (getRemainingCooldown() > 0) {
            startCooldownTimer();
        }

        refreshPlaidBtn.addEventListener('click', async () => {
            if (getRemainingCooldown() > 0) return;
            refreshPlaidBtn.disabled = true;
            refreshPlaidBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refreshing...
            `;
            try {
                const result = await refreshPlaidBalances(store);
                localStorage.setItem(STORAGE_KEY, Date.now().toString());
                if (result.errors > 0) {
                    alert(`Refreshed ${result.updated} account(s), but ${result.errors} connection(s) had errors.`);
                }
                refreshPage();
            } catch (err) {
                console.error('Refresh error:', err);
                alert('Failed to refresh balances. Please try again.');
                refreshPlaidBtn.disabled = false;
                refreshPlaidBtn.innerHTML = `${refreshIcon} Refresh Connected Balances`;
            }
        });
    }

    container.querySelector('#scan-statement-btn').addEventListener('click', () => {
        requireMFAForUpload(() => container.querySelector('#ocr-file-input').click());
    });
    container.querySelector('#ocr-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleOcrImport(file, store, accounts);
        e.target.value = '';
    });

    // Update balance (quick)
    container.querySelectorAll('.update-balance-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            if (!account) return;
            const isAssetAcct = account.type === 'property' || account.type === 'vehicle' || account.type === 'equipment' || account.type === 'other-asset';
            const isCredit = account.type === 'credit';
            const linkedDebt = isCredit && account.linkedDebtId ? store.getDebts().find(d => d.id === account.linkedDebtId) : null;
            const owedLabel = account.type === 'vehicle' ? 'Amount Owed (Auto Loan)' : account.type === 'equipment' ? 'Amount Owed (Equipment Loan)' : account.type === 'other-asset' ? 'Amount Owed' : 'Amount Owed (Mortgage)';
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
    container.querySelectorAll('.edit-account-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            if (account) showAccountForm(store, account);
        });
    });

    // Delete account
    container.querySelectorAll('.delete-account-btn').forEach(btn => {
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

    // Toggle investment holdings panel
    container.querySelectorAll('.toggle-holdings').forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = document.getElementById(`holdings-${btn.dataset.accountId}`);
            if (panel) {
                const isHidden = panel.style.display === 'none';
                panel.style.display = isHidden ? 'block' : 'none';
                btn.style.background = isHidden ? 'var(--accent)' : 'var(--accent-bg)';
                btn.style.color = isHidden ? '#fff' : '';
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
}

export function showAccountForm(store, existingAccount = null) {
    const isEdit = !!existingAccount;
    const account = existingAccount || { name: '', type: 'checking', balance: 0, amountOwed: 0 };
    const isAsset = account.type === 'property' || account.type === 'vehicle' || account.type === 'equipment' || account.type === 'other-asset';
    const isProperty = account.type === 'property';
    const isVehicle = account.type === 'vehicle';
    const isEquipment = account.type === 'equipment';
    const isOtherAsset = account.type === 'other-asset';
    const isCredit = account.type === 'credit';

    // Pull APR + min payment from linked debt (if editing existing linked credit card)
    let linkedAPR = 0;
    let linkedMinPayment = 0;
    if (isEdit && account.linkedDebtId) {
        const linkedDebt = store.getDebts().find(d => d.id === account.linkedDebtId);
        if (linkedDebt) {
            linkedAPR = linkedDebt.interestRate || 0;
            linkedMinPayment = linkedDebt.minimumPayment || 0;
        }
    }

    const formHtml = `
        <div class="form-group">
            <label>Account Name</label>
            <input type="text" class="form-input" id="account-name" value="${escapeHtml(account.name)}" placeholder="e.g. Bills Checking, Chase Savings">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Account Type</label>
                <select class="form-select" id="account-type">
                    <option value="checking" ${account.type === 'checking' ? 'selected' : ''}>Checking</option>
                    <option value="savings" ${account.type === 'savings' ? 'selected' : ''}>Savings</option>
                    <option value="credit" ${account.type === 'credit' ? 'selected' : ''}>Credit Card</option>
                    <option value="investment" ${account.type === 'investment' ? 'selected' : ''}>Brokerage / Investment</option>
                    <option value="retirement" ${account.type === 'retirement' ? 'selected' : ''}>401(k) / Retirement</option>
                    <option value="property" ${account.type === 'property' ? 'selected' : ''}>Property</option>
                    <option value="vehicle" ${account.type === 'vehicle' ? 'selected' : ''}>Vehicle</option>
                    <option value="equipment" ${account.type === 'equipment' ? 'selected' : ''}>Equipment</option>
                    <option value="other-asset" ${account.type === 'other-asset' ? 'selected' : ''}>Other Asset</option>
                </select>
            </div>
            <div class="form-group">
                <label id="balance-label">${isAsset ? 'Estimated Value' : 'Current Balance'}</label>
                <input type="number" class="form-input" id="account-balance" step="0.01" value="${account.balance}">
            </div>
        </div>
        <div class="form-group" id="amount-owed-group" style="display:${isAsset ? '' : 'none'};">
            <label id="amount-owed-label">${isVehicle ? 'Amount Owed (Auto Loan)' : isEquipment ? 'Amount Owed (Equipment Loan)' : isOtherAsset ? 'Amount Owed' : 'Amount Owed (Mortgage)'}</label>
            <input type="number" class="form-input" id="account-amount-owed" step="0.01" value="${account.amountOwed || 0}">
        </div>
        <div id="credit-fields-group" style="display:${isCredit ? '' : 'none'};">
            <div class="form-row">
                <div class="form-group">
                    <label>Interest Rate (APR %)</label>
                    <input type="number" class="form-input" id="account-apr" step="0.01" value="${linkedAPR}">
                </div>
                <div class="form-group">
                    <label>Minimum Payment</label>
                    <input type="number" class="form-input" id="account-min-payment" step="0.01" value="${linkedMinPayment}">
                </div>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:-8px;margin-bottom:12px;">
                &#128279; Linked to Debts page — changes here update the linked debt &amp; bill automatically.
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Account</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Account' : 'Add Account', formHtml);

    // Dynamic form behavior for property/credit type
    const typeSelect = document.getElementById('account-type');
    const amountOwedGroup = document.getElementById('amount-owed-group');
    const creditFieldsGroup = document.getElementById('credit-fields-group');
    const balanceLabel = document.getElementById('balance-label');
    const amountOwedLabel = document.getElementById('amount-owed-label');
    typeSelect.addEventListener('change', () => {
        const isProp = typeSelect.value === 'property';
        const isVeh = typeSelect.value === 'vehicle';
        const isEquip = typeSelect.value === 'equipment';
        const isOther = typeSelect.value === 'other-asset';
        const isAssetType = isProp || isVeh || isEquip || isOther;
        const isCred = typeSelect.value === 'credit';
        amountOwedGroup.style.display = isAssetType ? '' : 'none';
        creditFieldsGroup.style.display = isCred ? '' : 'none';
        balanceLabel.textContent = isAssetType ? 'Estimated Value' : 'Current Balance';
        amountOwedLabel.textContent = isVeh ? 'Amount Owed (Auto Loan)' : isEquip ? 'Amount Owed (Equipment Loan)' : isOther ? 'Amount Owed' : 'Amount Owed (Mortgage)';
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const data = {
            name: document.getElementById('account-name').value.trim(),
            type: document.getElementById('account-type').value,
            balance: parseFloat(document.getElementById('account-balance').value) || 0
        };

        if (data.type === 'property' || data.type === 'vehicle' || data.type === 'equipment' || data.type === 'other-asset') {
            data.amountOwed = parseFloat(document.getElementById('account-amount-owed').value) || 0;
        }

        if (data.type === 'credit') {
            // Pass APR + min payment as transient fields for the sync engine
            data._interestRate = parseFloat(document.getElementById('account-apr').value) || 0;
            data._minimumPayment = parseFloat(document.getElementById('account-min-payment').value) || 0;
        }

        if (!data.name) { alert('Please enter an account name'); return; }

        if (isEdit) {
            store.updateAccount(existingAccount.id, data);
        } else {
            store.addAccount(data);
        }

        closeModal();
        refreshPage();
    });
}

// ===== OCR Import =====

function parseOcrText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const accounts = [];
    const balanceRegex = /\$?\s*([\d,]+\.?\d{0,2})\s*$/;
    const closedRegex = /\b(closed|inactive|cancelled|canceled)\b/i;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip closed accounts
        if (closedRegex.test(line)) continue;

        const match = line.match(balanceRegex);
        if (!match) continue;

        const rawAmount = match[1].replace(/,/g, '');
        const balance = parseFloat(rawAmount);
        if (isNaN(balance) || balance <= 0) continue;

        // Account name is the text before the dollar amount on this line,
        // or the previous line if this line is mostly just a number
        let name = line.replace(balanceRegex, '').replace(/[\$\s]+$/, '').trim();

        // Clean up common OCR artifacts
        name = name.replace(/^[\-\—\–\|\s]+/, '').replace(/[\-\—\–\|\s]+$/, '').trim();

        // If name is too short or empty, try previous line
        if (name.length < 2 && i > 0) {
            const prevLine = lines[i - 1];
            if (!closedRegex.test(prevLine) && !balanceRegex.test(prevLine)) {
                name = prevLine.replace(/^[\-\—\–\|\s]+/, '').replace(/[\-\—\–\|\s]+$/, '').trim();
            }
        }

        // Skip if we still don't have a usable name
        if (name.length < 2) continue;

        // Check if previous line indicates closed
        if (i > 0 && closedRegex.test(lines[i - 1])) continue;
        // Check if next line indicates closed
        if (i < lines.length - 1 && closedRegex.test(lines[i + 1])) continue;

        accounts.push({ name, balance, type: 'credit' });
    }

    return accounts;
}

export async function handleOcrImport(file, store, existingAccounts) {
    // Show processing modal with image preview
    const imageUrl = URL.createObjectURL(file);

    openModal('Scanning Image...', `
        <img src="${imageUrl}" class="ocr-preview" alt="Uploaded image">
        <div style="text-align:center;padding:20px 0;">
            <div class="ocr-spinner"></div>
            <span style="font-size:14px;color:var(--text-secondary);">Processing image with OCR...</span>
            <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">This may take a few seconds on first use (downloading language data)</div>
        </div>
    `);

    try {
        // Dynamic import of Tesseract.js from CDN
        const Tesseract = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
        const worker = await Tesseract.createWorker('eng');
        const result = await worker.recognize(file);
        await worker.terminate();

        const ocrText = result.data.text;
        const parsed = parseOcrText(ocrText);

        // Filter out accounts that already exist by name
        const existingNames = new Set(existingAccounts.map(a => a.name.toLowerCase()));
        const newAccounts = parsed.filter(a => !existingNames.has(a.name.toLowerCase()));

        URL.revokeObjectURL(imageUrl);
        showOcrResults(newAccounts, ocrText, store);
    } catch (err) {
        URL.revokeObjectURL(imageUrl);
        console.error('OCR error:', err);
        openModal('Scan Failed', `
            <div style="text-align:center;padding:16px 0;">
                <div style="font-size:14px;color:var(--red);margin-bottom:12px;">Failed to process image</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">${escapeHtml(err.message || 'Unknown error')}</div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Close</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
    }
}

function showOcrResults(accounts, rawText, store) {
    if (accounts.length === 0) {
        openModal('No Accounts Found', `
            <div style="padding:16px 0;">
                <div style="font-size:14px;color:var(--text-muted);margin-bottom:12px;">
                    No credit card accounts could be detected in this image.
                </div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Tips:</div>
                <ul style="font-size:12px;color:var(--text-secondary);padding-left:20px;margin-bottom:16px;">
                    <li>Use a clear, high-resolution screenshot</li>
                    <li>Make sure account names and balances are visible</li>
                    <li>Crop to show only the relevant section</li>
                </ul>
                ${rawText ? `
                <details style="margin-top:12px;">
                    <summary style="font-size:11px;color:var(--text-muted);cursor:pointer;">Show raw OCR text</summary>
                    <pre style="font-size:10px;color:var(--text-muted);margin-top:8px;white-space:pre-wrap;max-height:150px;overflow-y:auto;background:var(--bg-input);padding:8px;border-radius:4px;">${escapeHtml(rawText)}</pre>
                </details>
                ` : ''}
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Close</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        return;
    }

    const accountCards = accounts.map((a, idx) => `
        <div class="ocr-account-card" data-ocr-idx="${idx}" id="ocr-card-${idx}">
            <button class="ocr-remove-btn" data-ocr-remove="${idx}" title="Remove">&times;</button>
            <div class="mb-8">
                <span class="badge-unverified">Unverified</span>
            </div>
            <div class="form-group mb-8">
                <label>Account Name</label>
                <input type="text" class="form-input ocr-name" data-ocr-idx="${idx}" value="${escapeHtml(a.name)}" style="font-size:13px;padding:6px 10px;">
            </div>
            <div class="form-row" style="gap:8px;">
                <div class="form-group" style="margin-bottom:0;">
                    <label>Balance</label>
                    <input type="number" class="form-input ocr-balance" data-ocr-idx="${idx}" step="0.01" value="${a.balance}" style="font-size:13px;padding:6px 10px;">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label>Type</label>
                    <select class="form-select ocr-type" data-ocr-idx="${idx}" style="font-size:13px;padding:6px 10px;">
                        <option value="credit" selected>Credit Card</option>
                        <option value="checking">Checking</option>
                        <option value="savings">Savings</option>
                        <option value="investment">Brokerage / Investment</option>
                        <option value="retirement">401(k) / Retirement</option>
                        <option value="property">Property</option>
                    </select>
                </div>
            </div>
        </div>
    `).join('');

    openModal(`${accounts.length} Account${accounts.length !== 1 ? 's' : ''} Found`, `
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
            Review and edit the detected accounts below. Remove any that are incorrect.
        </div>
        <div id="ocr-cards-container">
            ${accountCards}
        </div>
        ${rawText ? `
        <details style="margin-top:8px;">
            <summary style="font-size:11px;color:var(--text-muted);cursor:pointer;">Show raw OCR text</summary>
            <pre style="font-size:10px;color:var(--text-muted);margin-top:8px;white-space:pre-wrap;max-height:120px;overflow-y:auto;background:var(--bg-input);padding:8px;border-radius:4px;">${escapeHtml(rawText)}</pre>
        </details>
        ` : ''}
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="ocr-save-all">Save All (<span id="ocr-count">${accounts.length}</span> accounts)</button>
        </div>
    `);

    // Remove buttons
    document.querySelectorAll('.ocr-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = document.getElementById(`ocr-card-${btn.dataset.ocrRemove}`);
            if (card) {
                card.remove();
                const remaining = document.querySelectorAll('.ocr-account-card').length;
                const countEl = document.getElementById('ocr-count');
                if (countEl) countEl.textContent = remaining;
                if (remaining === 0) {
                    document.getElementById('ocr-save-all').disabled = true;
                    document.getElementById('ocr-save-all').style.opacity = '0.4';
                }
            }
        });
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    document.getElementById('ocr-save-all').addEventListener('click', () => {
        const cards = document.querySelectorAll('.ocr-account-card');
        let added = 0;
        cards.forEach(card => {
            const idx = card.dataset.ocrIdx;
            const name = card.querySelector('.ocr-name').value.trim();
            const balance = parseFloat(card.querySelector('.ocr-balance').value) || 0;
            const type = card.querySelector('.ocr-type').value;
            if (name) {
                store.addAccount({ name, type, balance });
                added++;
            }
        });
        closeModal();
        if (added > 0) {
            refreshPage();
        }
    });
}
