import { formatCurrency, escapeHtml, getOrdinal } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';
import { getMonthlyMultiplier, frequencyToMonthly } from '../services/financial-service.js';
import { openFormModal } from '../services/modal-manager.js';
import {
    renderTaxes,
    getSelectedYear, setSelectedYear,
    getActiveTab, setActiveTab,
    setActiveCategory, setActiveOwner
} from './taxes.js';
import { renderAssetsTab } from './assets.js';

// Tab state for Income & Taxes page
let activeIncomeTab = 'income'; // 'income' | 'documents' | 'deductions' | 'assets'

const FREQ_LABELS = {
    biweekly: 'Biweekly (every 2 weeks)',
    weekly: 'Weekly',
    semimonthly: 'Semi-Monthly (twice a month)',
    monthly: 'Monthly'
};

const OTHER_INCOME_CATEGORIES = {
    rental: 'Rental Income',
    dividend: 'Dividends / Investments',
    freelance: 'Freelance',
    'side-hustle': 'Side Hustle',
    interest: 'Interest',
    gift: 'Gift / Support',
    bonus: 'Bonus',
    refund: 'Refund',
    other: 'Other'
};

// Normalize legacy category values (e.g., mobile used labels like 'Side Hustle' instead of keys)
const LEGACY_CATEGORY_MAP = {
    'Side Hustle': 'side-hustle',
    'Investment': 'dividend',
    'Rental': 'rental',
    'Gift': 'gift',
    'Bonus': 'bonus',
    'Refund': 'refund',
    'Other': 'other',
    'Freelance': 'freelance',
    'Interest': 'interest',
    'Dividends': 'dividend',
    'Rental Income': 'rental',
    'Gift / Support': 'gift',
};

function normalizeCategoryKey(cat) {
    if (!cat) return 'other';
    if (OTHER_INCOME_CATEGORIES[cat]) return cat; // already a valid key
    if (LEGACY_CATEGORY_MAP[cat]) return LEGACY_CATEGORY_MAP[cat];
    return 'other';
}

const OTHER_INCOME_FREQ = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
    'one-time': 'One-Time',
    weekly: 'Weekly',
    biweekly: 'Biweekly'
};

const getOtherIncomeMonthly = (source) => frequencyToMonthly(source?.amount, source?.frequency);

let balanceHistoryView = 'monthly'; // 'daily' | 'monthly' | 'yearly'

function aggregateHistory(allHistory, view) {
    if (view === 'daily') {
        // Last 30 days
        return allHistory.slice(-30);
    }
    if (view === 'yearly') {
        // Group by year, take last entry per year
        const byYear = {};
        for (const h of allHistory) {
            const year = h.date.slice(0, 4);
            byYear[year] = h; // last entry wins
        }
        return Object.values(byYear).sort((a, b) => a.date.localeCompare(b.date));
    }
    // Monthly — group by month, take last entry per month
    const byMonth = {};
    for (const h of allHistory) {
        const month = h.date.slice(0, 7);
        byMonth[month] = h; // last entry wins
    }
    return Object.values(byMonth).sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
}

function getBarLabel(h, view) {
    const d = new Date(h.date + 'T00:00:00');
    if (view === 'daily') {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (view === 'yearly') {
        return d.getFullYear().toString();
    }
    // monthly
    return d.toLocaleDateString('en-US', { month: 'short' }) + " '" + h.date.slice(2, 4);
}

function getChangeLabel(view) {
    if (view === 'daily') return 'vs Yesterday';
    if (view === 'yearly') return 'vs Last Year';
    return 'vs Last Month';
}

function buildBalanceHistoryHtml(store) {
    const allHistory = store.getBalanceHistory();
    if (allHistory.length === 0) {
        return '<div class="card mb-24" style="margin-top:24px;">' +
            '<h3 style="margin-bottom:8px;">Balance History</h3>' +
            '<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Monthly snapshots of your account balances over time</p>' +
            '<div style="text-align:center;padding:24px 16px;color:var(--text-muted);">' +
            '<div style="font-size:32px;margin-bottom:8px;">&#128200;</div>' +
            '<div style="font-size:13px;">No balance history yet.</div>' +
            '<div style="font-size:12px;margin-top:4px;">History will build automatically each day as you use PennyHelm. Add your accounts on the Assets tab to start tracking.</div>' +
            '</div></div>';
    }

    const view = balanceHistoryView;
    const history = aggregateHistory(allHistory, view);
    const latest = history[history.length - 1];

    // Find max value across all bars for scaling
    const maxVal = Math.max(...history.map(h => Math.max(h.checking || 0, h.savings || 0, h.investment || 0)), 1);

    // Build bar chart HTML
    let barsHtml = '';
    for (const h of history) {
        const chkH = ((h.checking || 0) / maxVal * 100).toFixed(1);
        const savH = ((h.savings || 0) / maxVal * 100).toFixed(1);
        const invH = ((h.investment || 0) / maxVal * 100).toFixed(1);
        const label = getBarLabel(h, view);
        const total = (h.checking || 0) + (h.savings || 0) + (h.investment || 0);
        barsHtml += '<div class="bh-month">' +
            '<div class="bh-values">' +
            '<div class="bh-value text-green" style="font-size:10px;">' + formatCurrency(total) + '</div>' +
            '</div>' +
            '<div class="bh-bar-group">' +
            (h.checking ? '<div class="bh-bar checking" style="height:' + chkH + '%;" title="Checking: ' + formatCurrency(h.checking) + '"></div>' : '') +
            (h.savings ? '<div class="bh-bar savings" style="height:' + savH + '%;" title="Savings: ' + formatCurrency(h.savings) + '"></div>' : '') +
            (h.investment ? '<div class="bh-bar investment" style="height:' + invH + '%;" title="Investments: ' + formatCurrency(h.investment) + '"></div>' : '') +
            '</div>' +
            '<div class="bh-label">' + label + '</div>' +
            '</div>';
    }

    // Period-over-period net worth change
    let changeHtml = '';
    if (history.length >= 2) {
        const previous = history[history.length - 2];
        const nwChange = latest.netWorth - previous.netWorth;
        const nwColor = nwChange >= 0 ? 'var(--green)' : 'var(--red)';
        changeHtml = '<div style="text-align:center;padding:8px;border-radius:var(--radius-sm);background:var(--bg-secondary);margin-top:8px;">' +
            '<div style="font-size:10px;color:var(--text-muted);">Net Worth ' + getChangeLabel(view) + '</div>' +
            '<div style="font-size:13px;font-weight:700;color:' + nwColor + ';">' + (nwChange >= 0 ? '+' : '') + formatCurrency(nwChange) + '</div>' +
            '</div>';
    }

    // Build legend — only show types that have values
    let legendHtml = '';
    if (latest.checking) legendHtml += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--green);border-radius:2px;display:inline-block;"></span> Checking</span>';
    if (latest.savings) legendHtml += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--accent);border-radius:2px;display:inline-block;"></span> Savings</span>';
    if (latest.investment) legendHtml += '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--purple);border-radius:2px;display:inline-block;"></span> Investments</span>';

    const nwColor = latest.netWorth >= 0 ? 'var(--green)' : 'var(--red)';

    // Summary cards
    let summaryHtml = '';
    const summaryItems = [];
    if (latest.checking) summaryItems.push({ label: 'Checking', value: latest.checking, color: 'var(--green)' });
    if (latest.savings) summaryItems.push({ label: 'Savings', value: latest.savings, color: 'var(--accent)' });
    if (latest.investment) summaryItems.push({ label: 'Investments', value: latest.investment, color: 'var(--purple)' });
    summaryItems.push({ label: 'Net Worth', value: latest.netWorth, color: nwColor });

    const cols = summaryItems.length;
    summaryHtml = '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:12px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">';
    for (const item of summaryItems) {
        summaryHtml += '<div style="text-align:center;">' +
            '<div style="font-size:11px;color:var(--text-muted);">' + item.label + '</div>' +
            '<div style="font-size:15px;font-weight:700;color:' + item.color + ';">' + formatCurrency(item.value) + '</div>' +
            '</div>';
    }
    summaryHtml += '</div>';

    // View toggle chips
    const toggleHtml = '<div style="display:flex;gap:6px;margin-bottom:16px;">' +
        '<button class="filter-chip bh-view-chip' + (view === 'daily' ? ' active' : '') + '" data-bh-view="daily">Daily</button>' +
        '<button class="filter-chip bh-view-chip' + (view === 'monthly' ? ' active' : '') + '" data-bh-view="monthly">Monthly</button>' +
        '<button class="filter-chip bh-view-chip' + (view === 'yearly' ? ' active' : '') + '" data-bh-view="yearly">Yearly</button>' +
        '</div>';

    const periodLabel = view === 'daily' ? history.length + ' days' : view === 'yearly' ? history.length + ' years' : history.length + ' months';

    return '<div class="card mb-24" style="margin-top:24px;">' +
        '<div class="flex-between mb-16">' +
        '<div>' +
        '<h3 style="margin-bottom:4px;">Balance History</h3>' +
        '<p style="font-size:12px;color:var(--text-muted);margin:0;">' + periodLabel + ' of account balances</p>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:12px;font-size:11px;flex-wrap:wrap;">' + legendHtml + '</div>' +
        '</div>' +
        toggleHtml +
        '<div class="balance-history-chart">' + barsHtml + '</div>' +
        summaryHtml +
        changeHtml +
        '</div>';
}

export function renderIncome(container, store, subTab = null) {
    // Handle sub-tab from URL (e.g., #income/documents)
    if (subTab === 'documents') {
        activeIncomeTab = 'documents';
        setActiveTab('documents');
    } else if (subTab === 'deductions') {
        activeIncomeTab = 'deductions';
        setActiveTab('deductions');
    } else if (subTab === 'assets') {
        activeIncomeTab = 'assets';
    } else {
        activeIncomeTab = 'income';
    }

    // Delegate to sub-tab renderers
    if (activeIncomeTab === 'assets') {
        renderAssetsTab(container, store);
        return;
    }
    if (activeIncomeTab === 'documents' || activeIncomeTab === 'deductions') {
        setActiveTab(activeIncomeTab);
        renderTaxes(container, store);
        return;
    }

    // Income tab content
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
                <h2>Income & Taxes</h2>
                <div class="subtitle">${formatCurrency(totalMonthlyIncome)}/month ${depEnabled && combineDepIncome ? 'total household income' : 'total income'}</div>
            </div>
            <button class="btn btn-primary btn-sm" id="add-other-income-header">+ Add Income</button>
        </div>

        <div class="filters" style="margin-bottom:20px;">
            <button class="filter-chip ${activeIncomeTab === 'income' ? 'active' : ''}" data-tab="income">Income</button>
            <button class="filter-chip ${activeIncomeTab === 'documents' ? 'active' : ''}" data-tab="documents">Documents</button>
            <button class="filter-chip ${activeIncomeTab === 'deductions' ? 'active' : ''}" data-tab="deductions">Deductions</button>
            <button class="filter-chip ${activeIncomeTab === 'assets' ? 'active' : ''}" data-tab="assets">Assets</button>
        </div>

        <div class="stats-grid">
            <div class="stat-card" style="position:relative;">
                <button class="btn-icon stat-card-edit" data-edit-target="user-pay" title="Edit pay amount"
                    style="position:absolute;top:10px;right:10px;padding:4px 8px;font-size:11px;color:var(--text-muted);background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;">
                    Edit
                </button>
                <div class="stat-label">${escapeHtml(userName)}'s Pay</div>
                <div class="stat-value">${formatCurrency(userMonthlyPay)}</div>
                <div class="stat-sub">/month (${formatCurrency(income.user.payAmount)}/${paySchedule.frequency === 'biweekly' ? 'check' : paySchedule.frequency === 'weekly' ? 'week' : 'mo'})</div>
            </div>
            ${depEnabled ? `
            <div class="stat-card${!combineDepIncome ? ' muted' : ''}" style="position:relative;">
                <button class="btn-icon stat-card-edit" data-edit-target="dependent-pay" title="Edit partner's pay"
                    style="position:absolute;top:10px;right:10px;padding:4px 8px;font-size:11px;color:var(--text-muted);background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;">
                    Edit
                </button>
                <div class="stat-label">${escapeHtml(depName)}'s Pay${!combineDepIncome ? ' <span style="font-size:10px;color:var(--text-muted);">(separate)</span>' : ''}</div>
                <div class="stat-value">${formatCurrency(depMonthlyPay)}</div>
                <div class="stat-sub">/month ${income.dependent.employed ? '' : '<span style="color:var(--orange);">(Unemployed)</span>'}</div>
            </div>
            ` : ''}
            ${otherIncome.length > 0 ? `
            <div class="stat-card" style="position:relative;">
                <button class="btn-icon stat-card-edit" data-edit-target="other-income" title="Manage other income sources"
                    style="position:absolute;top:10px;right:10px;padding:4px 8px;font-size:11px;color:var(--text-muted);background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;">
                    Manage
                </button>
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

        <!-- 12-Month Balance History -->
        ${buildBalanceHistoryHtml(store)}

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
                <!-- Desktop: Table view -->
                <div class="table-wrapper other-income-desktop">
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
                                const catLabel = OTHER_INCOME_CATEGORIES[normalizeCategoryKey(src.category)] || src.category;
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
                <!-- Mobile: Card view with visible edit/delete -->
                <div class="other-income-mobile">
                    ${otherIncome.map(src => {
                        const monthlyEquiv = getOtherIncomeMonthly(src);
                        const catLabel = OTHER_INCOME_CATEGORIES[normalizeCategoryKey(src.category)] || src.category;
                        const freqLbl = OTHER_INCOME_FREQ[src.frequency] || src.frequency;
                        return `
                            <div class="other-income-card">
                                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                                    <div style="flex:1;min-width:0;">
                                        <div style="font-weight:600;font-size:14px;">${escapeHtml(src.name)}</div>
                                        <div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap;">
                                            <span class="badge" style="background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;font-size:11px;">${catLabel}</span>
                                            <span style="font-size:12px;color:var(--text-secondary);">${freqLbl}</span>
                                        </div>
                                        ${src.notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${escapeHtml(src.notes)}</div>` : ''}
                                    </div>
                                    <div style="text-align:right;flex-shrink:0;">
                                        <div class="font-bold text-green" style="font-size:15px;">${formatCurrency(src.amount)}</div>
                                        <div style="font-size:11px;color:var(--text-secondary);">${monthlyEquiv > 0 ? formatCurrency(monthlyEquiv) + '/mo' : 'One-time'}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
                                    <button class="btn btn-secondary btn-sm edit-other-income" data-id="${src.id}" style="flex:1;font-size:12px;">
                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        Edit
                                    </button>
                                    <button class="btn btn-sm delete-other-income" data-id="${src.id}" style="flex:1;font-size:12px;background:transparent;border:1px solid var(--red);color:var(--red);">
                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                        Delete
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
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

    // Balance history view toggle (daily/monthly/yearly)
    container.querySelectorAll('.bh-view-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            balanceHistoryView = chip.dataset.bhView;
            renderIncome(container, store);
        });
    });

    // Tab switching
    container.querySelectorAll('.filters .filter-chip[data-tab]').forEach(chip => {
        chip.addEventListener('click', () => {
            const tab = chip.dataset.tab;
            activeIncomeTab = tab;
            // Update URL hash
            if (tab === 'income') {
                window.location.hash = 'income';
            } else {
                window.location.hash = `income/${tab}`;
            }
        });
    });

    // Add income header button
    const addIncomeHeaderBtn = container.querySelector('#add-other-income-header');
    if (addIncomeHeaderBtn) {
        addIncomeHeaderBtn.addEventListener('click', () => {
            showOtherIncomeForm(store);
        });
    }

    // Quick-edit buttons on summary cards — click routes to the existing
    // in-page editor for that income type. Keeps users off the Settings
    // page for basic pay/partner/other-income tweaks.
    container.querySelectorAll('.stat-card-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.editTarget;
            if (target === 'user-pay') {
                const el = container.querySelector('#edit-user-pay');
                if (el) el.click();
            } else if (target === 'dependent-pay') {
                const el = container.querySelector('#edit-dependent-pay');
                if (el) el.click();
                else {
                    // Partner tracking isn't enabled or the partner card is
                    // rendering in a degraded state — fall back to scrolling
                    // to the partner income section if it exists.
                    const section = container.querySelector('.settings-section h3')
                        && Array.from(container.querySelectorAll('.settings-section'))
                            .find(s => /Income$/.test(s.querySelector('h3')?.textContent || ''));
                    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } else if (target === 'other-income') {
                const list = container.querySelector('#add-other-income');
                if (list) {
                    list.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // Subtle flash so the user sees where they landed.
                    const card = list.closest('.card');
                    if (card) {
                        const orig = card.style.boxShadow;
                        card.style.boxShadow = '0 0 0 2px var(--accent)';
                        setTimeout(() => { card.style.boxShadow = orig; }, 900);
                    }
                }
            }
        });
    });

    // Edit user pay
    container.querySelector('#edit-user-pay').addEventListener('click', () => {
        openFormModal({
            title: 'Edit Pay Amount',
            refreshPage,
            fields: [{
                id: 'user-pay-input', label: 'Pay Amount (per check)',
                type: 'number', step: '0.01', value: income.user.payAmount,
                required: true, min: 0.01, autofocus: true,
            }],
            onSave: (values) => {
                store.updateIncome('user', { payAmount: values['user-pay-input'] });
            },
        });
    });

    // Edit pay frequency
    container.querySelector('#edit-pay-freq').addEventListener('click', () => {
        openFormModal({
            title: 'Change Pay Frequency',
            refreshPage,
            fields: [{
                id: 'pay-freq-select', label: 'How often do you get paid?',
                type: 'select', value: paySchedule.frequency,
                options: [
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'biweekly', label: 'Biweekly (every 2 weeks)' },
                    { value: 'semimonthly', label: 'Semi-Monthly (1st & 15th, etc.)' },
                    { value: 'monthly', label: 'Monthly' },
                ],
            }],
            onSave: (values) => {
                store.updatePaySchedule({ frequency: values['pay-freq-select'] });
            },
        });
    });

    // Edit pay start date
    container.querySelector('#edit-pay-start').addEventListener('click', () => {
        openFormModal({
            title: 'Set Known Pay Date',
            refreshPage,
            fields: [{
                id: 'pay-start-input', label: 'Enter any date you got (or will get) paid',
                type: 'date', value: paySchedule.startDate || '', required: true,
                hint: 'This anchors the schedule. All other pay dates are calculated from this date using your frequency.',
            }],
            onSave: (values) => {
                store.updatePaySchedule({ startDate: values['pay-start-input'] });
            },
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
            openFormModal({
                title: `Edit ${depName} Pay`,
                refreshPage,
                fields: [{
                    id: 'dependent-pay-input', label: 'Monthly Pay Amount',
                    type: 'number', step: '0.01', value: income.dependent.payAmount,
                    required: true, min: 0, autofocus: true,
                }],
                onSave: (values) => {
                    store.updateIncome('dependent', { payAmount: values['dependent-pay-input'] });
                },
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
    const raw = existing || { name: '', amount: 0, frequency: 'monthly', category: 'other', payDay: 1, notes: '' };
    // Normalize category for proper dropdown selection
    const src = { ...raw, category: normalizeCategoryKey(raw.category) };

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
