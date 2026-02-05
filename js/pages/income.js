import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';

const FREQ_LABELS = {
    biweekly: 'Biweekly (every 2 weeks)',
    weekly: 'Weekly',
    semimonthly: 'Semi-Monthly (twice a month)',
    monthly: 'Monthly'
};

const OTHER_INCOME_CATEGORIES = {
    rental: 'Rental Income',
    dividend: 'Dividends',
    freelance: 'Freelance',
    'side-hustle': 'Side Hustle',
    interest: 'Interest',
    gift: 'Gift / Support',
    other: 'Other'
};

const OTHER_INCOME_FREQ = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
    'one-time': 'One-Time',
    weekly: 'Weekly',
    biweekly: 'Biweekly'
};

function getMonthlyMultiplier(freq) {
    if (freq === 'biweekly') return 26 / 12;
    if (freq === 'weekly') return 52 / 12;
    if (freq === 'semimonthly') return 2;
    return 1;
}

function getOtherIncomeMonthly(source) {
    const amt = source.amount || 0;
    switch (source.frequency) {
        case 'weekly': return amt * 52 / 12;
        case 'biweekly': return amt * 26 / 12;
        case 'monthly': return amt;
        case 'quarterly': return amt / 3;
        case 'yearly': return amt / 12;
        case 'one-time': return 0; // doesn't count toward monthly
        default: return amt;
    }
}

function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

export function renderIncome(container, store) {
    const userName = store.getUserName();
    const depName = store.getDependentName();
    const depEnabled = store.isDependentEnabled();
    const income = store.getIncome();
    const paySchedule = store.getPaySchedule();
    const otherIncome = store.getOtherIncome();

    const combineDepIncome = income.combineDependentIncome !== false; // default true
    const freqLabel = FREQ_LABELS[paySchedule.frequency] || paySchedule.frequency;
    const monthlyMultiplier = getMonthlyMultiplier(paySchedule.frequency);
    const userMonthlyPay = income.user.payAmount * monthlyMultiplier;
    const depMonthlyPay = depEnabled ? (income.dependent.payAmount || 0) : 0;
    const otherMonthlyTotal = otherIncome.reduce((s, src) => s + getOtherIncomeMonthly(src), 0);
    const totalMonthlyIncome = userMonthlyPay + (depEnabled && combineDepIncome ? depMonthlyPay : 0) + otherMonthlyTotal;

    // Preview next 6 generated pay dates
    const previewDates = store.getPayDates();
    const now = new Date();
    const upcomingDates = previewDates
        .filter(d => d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        .slice(0, 6);

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Income</h2>
                <div class="subtitle">${formatCurrency(totalMonthlyIncome)}/month ${depEnabled && combineDepIncome ? 'total household income' : 'total income'}</div>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">${escapeHtml(userName)}'s Pay</div>
                <div class="stat-value">${formatCurrency(userMonthlyPay)}</div>
                <div class="stat-sub">/month (${formatCurrency(income.user.payAmount)}/${paySchedule.frequency === 'biweekly' ? 'check' : paySchedule.frequency === 'weekly' ? 'week' : 'mo'})</div>
            </div>
            ${depEnabled ? `
            <div class="stat-card${!combineDepIncome ? ' muted' : ''}">
                <div class="stat-label">${escapeHtml(depName)}'s Pay${!combineDepIncome ? ' <span style="font-size:10px;color:var(--text-muted);">(separate)</span>' : ''}</div>
                <div class="stat-value">${formatCurrency(depMonthlyPay)}</div>
                <div class="stat-sub">/month ${income.dependent.employed ? '' : '<span style="color:var(--orange);">(Unemployed)</span>'}</div>
            </div>
            ` : ''}
            ${otherIncome.length > 0 ? `
            <div class="stat-card">
                <div class="stat-label">Other Income</div>
                <div class="stat-value">${formatCurrency(otherMonthlyTotal)}</div>
                <div class="stat-sub">/month from ${otherIncome.length} source${otherIncome.length !== 1 ? 's' : ''}</div>
            </div>
            ` : ''}
            <div class="stat-card blue">
                <div class="stat-label">${depEnabled && combineDepIncome ? 'Total Household' : 'Total Income'}</div>
                <div class="stat-value">${formatCurrency(totalMonthlyIncome)}</div>
                <div class="stat-sub">/month${depEnabled && !combineDepIncome ? ' (yours only)' : ''}</div>
            </div>
        </div>

        <!-- Primary Pay Schedule -->
        <div class="card mb-24" style="margin-top:24px;">
            <div class="settings-section">
                <h3>${escapeHtml(userName)}'s Pay Schedule</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Your primary employment income. Pay dates are calculated automatically.
                </p>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Pay Amount (per check)</div>
                        <div class="setting-desc">Current: ${formatCurrency(income.user.payAmount)} &middot; ~${formatCurrency(userMonthlyPay)}/month</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="edit-user-pay">Edit</button>
                </div>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Pay Frequency</div>
                        <div class="setting-desc">${freqLabel}</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="edit-pay-freq">Change</button>
                </div>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Known Pay Date</div>
                        <div class="setting-desc">${paySchedule.startDate ? new Date(paySchedule.startDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'}</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="edit-pay-start">Edit</button>
                </div>
            </div>
        </div>

        <!-- Upcoming Pay Dates -->
        <div class="card mb-24">
            <div class="settings-section">
                <h3>Upcoming Pay Dates</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Auto-generated from your pay schedule above.
                </p>
                ${upcomingDates.length > 0 ? `
                <div>
                    ${upcomingDates.map(d => {
                        const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                        return `
                            <div class="settings-row">
                                <div class="setting-label text-green">${label}</div>
                                <span style="font-size:13px;font-weight:600;">${formatCurrency(income.user.payAmount)}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                ` : '<div class="text-muted" style="padding:8px 0;font-size:13px;">Set a known pay date above to see generated dates.</div>'}
            </div>
        </div>

        <!-- Dependent Income -->
        ${depEnabled ? `
        <div class="card mb-24">
            <div class="settings-section">
                <h3>${escapeHtml(depName)}'s Income</h3>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Employment Status</div>
                        <div class="setting-desc">${income.dependent.employed ? '<span class="text-green">Employed</span>' : '<span class="text-orange">Unemployed</span>'}</div>
                    </div>
                    <label class="toggle">
                        <input type="checkbox" ${income.dependent.employed ? 'checked' : ''} id="dependent-employed-toggle">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div class="settings-row">
                    <div>
                        <div class="setting-label">Pay Amount (monthly)</div>
                        <div class="setting-desc">Current: ${formatCurrency(income.dependent.payAmount)}</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="edit-dependent-pay">Edit</button>
                </div>
                <div class="settings-row" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px;">
                    <div>
                        <div class="setting-label">Combine with Household Income</div>
                        <div class="setting-desc">${combineDepIncome ? 'Included in your total household income' : 'Tracked separately — not included in your totals'}</div>
                    </div>
                    <label class="toggle">
                        <input type="checkbox" ${combineDepIncome ? 'checked' : ''} id="combine-dep-income-toggle">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
        </div>
        ` : ''}

        <!-- Other Income Sources -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div>
                        <h3 style="margin-bottom:4px;">Other Income Sources</h3>
                        <p style="font-size:12px;color:var(--text-secondary);margin:0;">
                            Rental income, dividends, freelance, side hustles, etc.
                        </p>
                    </div>
                    <button class="btn btn-primary btn-sm" id="add-other-income">+ Add</button>
                </div>
                ${otherIncome.length > 0 ? `
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Source</th>
                                <th>Category</th>
                                <th>Amount</th>
                                <th>Frequency</th>
                                <th>Pay Day</th>
                                <th>Monthly Equiv.</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${otherIncome.map(src => {
                                const monthlyEquiv = getOtherIncomeMonthly(src);
                                const catLabel = OTHER_INCOME_CATEGORIES[src.category] || src.category;
                                const freqLbl = OTHER_INCOME_FREQ[src.frequency] || src.frequency;
                                return `
                                    <tr>
                                        <td>
                                            <div style="font-weight:600;">${escapeHtml(src.name)}</div>
                                            ${src.notes ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(src.notes)}</div>` : ''}
                                        </td>
                                        <td><span class="badge" style="background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;">${catLabel}</span></td>
                                        <td class="font-bold text-green">${formatCurrency(src.amount)}</td>
                                        <td style="font-size:12px;">${freqLbl}</td>
                                        <td style="font-size:12px;">${src.payDay && src.frequency !== 'one-time' ? src.payDay + getOrdinal(src.payDay) : '<span class="text-muted">&mdash;</span>'}</td>
                                        <td style="font-size:12px;color:var(--text-secondary);">${monthlyEquiv > 0 ? formatCurrency(monthlyEquiv) + '/mo' : 'One-time'}</td>
                                        <td>
                                            <div style="display:flex;gap:4px;">
                                                <button class="btn-icon edit-other-income" data-id="${src.id}" title="Edit">
                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                                </button>
                                                <button class="btn-icon delete-other-income" data-id="${src.id}" title="Delete" style="color:var(--red);">
                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="card mt-16" style="background:var(--bg-secondary);">
                    <div class="flex-between">
                        <span style="font-size:13px;color:var(--text-secondary);">Total Other Income (monthly)</span>
                        <span class="font-bold text-green">${formatCurrency(otherMonthlyTotal)}</span>
                    </div>
                </div>
                ` : `
                <div style="text-align:center;padding:24px 16px;color:var(--text-muted);">
                    <div style="font-size:32px;margin-bottom:8px;">&#128176;</div>
                    <div style="font-size:13px;">No additional income sources yet.</div>
                    <div style="font-size:12px;margin-top:4px;">Add rental income, dividends, freelance pay, etc.</div>
                </div>
                `}
            </div>
        </div>
    `;

    // === Event Handlers ===

    // Edit user pay
    container.querySelector('#edit-user-pay').addEventListener('click', () => {
        openModal('Edit Pay Amount', `
            <div class="form-group">
                <label>Pay Amount (per check)</label>
                <input type="number" class="form-input" id="user-pay-input" step="0.01" value="${income.user.payAmount}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Save</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', () => {
            const val = parseFloat(document.getElementById('user-pay-input').value);
            if (val > 0) {
                store.updateIncome('user', { payAmount: val });
                closeModal();
                refreshPage();
            }
        });
    });

    // Edit pay frequency
    container.querySelector('#edit-pay-freq').addEventListener('click', () => {
        openModal('Change Pay Frequency', `
            <div class="form-group">
                <label>How often do you get paid?</label>
                <select class="form-select" id="pay-freq-select">
                    <option value="weekly" ${paySchedule.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="biweekly" ${paySchedule.frequency === 'biweekly' ? 'selected' : ''}>Biweekly (every 2 weeks)</option>
                    <option value="semimonthly" ${paySchedule.frequency === 'semimonthly' ? 'selected' : ''}>Semi-Monthly (1st & 15th, etc.)</option>
                    <option value="monthly" ${paySchedule.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Save</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', () => {
            const val = document.getElementById('pay-freq-select').value;
            store.updatePaySchedule({ frequency: val });
            closeModal();
            refreshPage();
        });
    });

    // Edit pay start date
    container.querySelector('#edit-pay-start').addEventListener('click', () => {
        openModal('Set Known Pay Date', `
            <div class="form-group">
                <label>Enter any date you got (or will get) paid</label>
                <input type="date" class="form-input" id="pay-start-input" value="${paySchedule.startDate || ''}">
                <p style="font-size:11px;color:var(--text-secondary);margin-top:6px;">
                    This anchors the schedule. All other pay dates are calculated from this date using your frequency.
                </p>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Save</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', () => {
            const val = document.getElementById('pay-start-input').value;
            if (val) {
                store.updatePaySchedule({ startDate: val });
                closeModal();
                refreshPage();
            }
        });
    });

    // Dependent employment toggle
    const dependentEmployedToggle = container.querySelector('#dependent-employed-toggle');
    if (dependentEmployedToggle) {
        dependentEmployedToggle.addEventListener('change', (e) => {
            store.updateIncome('dependent', { employed: e.target.checked });
            refreshPage();
        });
    }

    // Combine dependent income toggle
    const combineDepToggle = container.querySelector('#combine-dep-income-toggle');
    if (combineDepToggle) {
        combineDepToggle.addEventListener('change', (e) => {
            store.updateIncome(null, { combineDependentIncome: e.target.checked });
            refreshPage();
        });
    }

    // Edit dependent pay
    const editDependentPayBtn = container.querySelector('#edit-dependent-pay');
    if (editDependentPayBtn) {
        editDependentPayBtn.addEventListener('click', () => {
            openModal(`Edit ${escapeHtml(depName)} Pay`, `
                <div class="form-group">
                    <label>Monthly Pay Amount</label>
                    <input type="number" class="form-input" id="dependent-pay-input" step="0.01" value="${income.dependent.payAmount}">
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Save</button>
                </div>
            `);
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', () => {
                const val = parseFloat(document.getElementById('dependent-pay-input').value);
                if (val >= 0) {
                    store.updateIncome('dependent', { payAmount: val });
                    closeModal();
                    refreshPage();
                }
            });
        });
    }

    // Add other income
    container.querySelector('#add-other-income').addEventListener('click', () => {
        showOtherIncomeForm(store);
    });

    // Edit other income
    container.querySelectorAll('.edit-other-income').forEach(btn => {
        btn.addEventListener('click', () => {
            const src = otherIncome.find(s => s.id === btn.dataset.id);
            if (src) showOtherIncomeForm(store, src);
        });
    });

    // Delete other income
    container.querySelectorAll('.delete-other-income').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Delete this income source?')) {
                store.deleteOtherIncome(btn.dataset.id);
                refreshPage();
            }
        });
    });
}

function showOtherIncomeForm(store, existing = null) {
    const isEdit = !!existing;
    const src = existing || { name: '', amount: 0, frequency: 'monthly', category: 'other', payDay: 1, notes: '' };

    const formHtml = `
        <div class="form-group">
            <label>Source Name</label>
            <input type="text" class="form-input" id="oi-name" value="${escapeHtml(src.name)}" placeholder="e.g., Rental Property, Stock Dividends">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" class="form-input" id="oi-amount" step="0.01" value="${src.amount}">
            </div>
            <div class="form-group">
                <label>Frequency</label>
                <select class="form-select" id="oi-frequency">
                    ${Object.entries(OTHER_INCOME_FREQ).map(([key, label]) =>
                        `<option value="${key}" ${src.frequency === key ? 'selected' : ''}>${label}</option>`
                    ).join('')}
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Category</label>
                <select class="form-select" id="oi-category">
                    ${Object.entries(OTHER_INCOME_CATEGORIES).map(([key, label]) =>
                        `<option value="${key}" ${src.category === key ? 'selected' : ''}>${label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group" id="oi-payday-group" style="${src.frequency === 'one-time' ? 'display:none;' : ''}">
                <label>Pay Day (day of month)</label>
                <input type="number" class="form-input" id="oi-payday" min="1" max="31" value="${src.payDay || 1}">
            </div>
        </div>
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" class="form-input" id="oi-notes" value="${escapeHtml(src.notes || '')}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Income Source</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Income Source' : 'Add Income Source', formHtml);

    // Show/hide payDay based on frequency
    const freqSelect = document.getElementById('oi-frequency');
    const payDayGroup = document.getElementById('oi-payday-group');
    freqSelect.addEventListener('change', () => {
        payDayGroup.style.display = freqSelect.value === 'one-time' ? 'none' : '';
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const freq = document.getElementById('oi-frequency').value;
        const data = {
            name: document.getElementById('oi-name').value.trim(),
            amount: parseFloat(document.getElementById('oi-amount').value) || 0,
            frequency: freq,
            category: document.getElementById('oi-category').value,
            payDay: freq !== 'one-time' ? (parseInt(document.getElementById('oi-payday').value) || 1) : null,
            notes: document.getElementById('oi-notes').value.trim()
        };

        if (!data.name) {
            alert('Please enter a source name');
            return;
        }

        if (isEdit) {
            store.updateOtherIncome(existing.id, data);
        } else {
            store.addOtherIncome(data);
        }

        closeModal();
        refreshPage();
    });
}
