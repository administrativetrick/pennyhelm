import { formatCurrency, escapeHtml, getScoreRating, estimateScoreImpact } from '../utils.js';
import { openModal, closeModal, refreshPage, updateDependentNav } from '../app.js';

export function renderSettings(container, store) {
    const userName = store.getUserName();
    const depName = store.getDependentName();
    const depEnabled = store.isDependentEnabled();
    const sources = store.getPaymentSources();
    const bills = store.getBills();
    const dependentBills = store.getDependentBills();
    const accounts = store.getAccounts();
    const creditScores = store.getCreditScores();
    const totalCreditLimit = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);

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
                    ${totalCreditLimit > 0 ? '' : '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Add credit card accounts on the Accounts page for more accurate estimates.</div>'}
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
                    <span class="text-muted">Bank Accounts</span>
                    <span class="font-bold">${accounts.length}</span>
                </div>
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
        // When enabling, auto-cover all dependent bills
        if (e.target.checked) {
            store.getDependentBills().forEach(b => {
                if (!b.userCovering) store.toggleDependentCovering(b.id);
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

    // Export
    container.querySelector('#export-btn').addEventListener('click', () => {
        const json = store.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${userName.toLowerCase()}-finances-${new Date().toISOString().slice(0, 10)}.json`;
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
                    mod.seedData();
                    refreshPage();
                });
            }
        }
    });
}

// Account management has been moved to accounts.js page
