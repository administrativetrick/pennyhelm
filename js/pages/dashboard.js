import { formatCurrency, getUpcomingBills, escapeHtml, getScoreRating, formatDate } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';

const GOAL_CATEGORIES = [
    { value: 'emergency', label: 'Emergency Fund', icon: '🛡️' },
    { value: 'vacation', label: 'Vacation', icon: '✈️' },
    { value: 'car', label: 'Vehicle', icon: '🚗' },
    { value: 'home', label: 'Home', icon: '🏠' },
    { value: 'education', label: 'Education', icon: '📚' },
    { value: 'retirement', label: 'Retirement', icon: '🏖️' },
    { value: 'other', label: 'Other', icon: '🎯' },
];

const DASHBOARD_WIDGETS = [
    { id: 'stats-grid',        label: 'Financial Summary',       icon: '📊' },
    { id: 'pay-periods',       label: 'Pay Period Breakdown',    icon: '📅' },
    { id: 'monthly-progress',  label: 'Monthly Progress',        icon: '📈' },
    { id: 'upcoming-bills',    label: 'Upcoming Bills',          icon: '🔔' },
    { id: 'spending-category', label: 'Spending by Category',    icon: '🏷️' },
    { id: 'payment-sources',   label: 'Bills by Payment Source', icon: '💳' },
    { id: 'savings-goals',     label: 'Savings Goals',           icon: '🎯' },
];

let periodOffset = 0; // 0 = starts at current period
let dashboardEditMode = false;
let activeDashboardTab = 'overview';

// ─────────────────────────────────────────────
// WIDGET BUILDER FUNCTIONS
// ─────────────────────────────────────────────

function buildStatsGridHtml(ctx) {
    var html = '<div class="card-grid">';
    // Monthly Income
    html += '<div class="stat-card green">';
    html += '<div class="label">Monthly Income</div>';
    html += '<div class="value">' + formatCurrency(ctx.userMonthlyIncome) + '</div>';
    html += '<div class="sub">' + formatCurrency(ctx.userPayMonthly) + ' pay';
    if (ctx.otherIncomeMonthly > 0) html += ' + ' + formatCurrency(ctx.otherIncomeMonthly) + ' other';
    if (ctx.depMonthlyPay > 0) html += ' + ' + formatCurrency(ctx.depMonthlyPay) + ' ' + escapeHtml(ctx.depName);
    html += '</div></div>';
    // Total Bills
    html += '<div class="stat-card red">';
    html += '<div class="label">Total Bills</div>';
    html += '<div class="value">' + formatCurrency(ctx.totalBills + ctx.depCoverageTotal) + '</div>';
    var billsSub = '';
    if (ctx.userMonthlyIncome > 0) {
        billsSub = ((ctx.totalBills + ctx.depCoverageTotal) / ctx.userMonthlyIncome * 100).toFixed(1) + '% of income';
    } else {
        billsSub = ctx.bills.filter(function(b) { return !b.frozen; }).length + ' active bills';
    }
    if (ctx.depEnabled && ctx.depCoverageTotal > 0) {
        billsSub += ' &middot; ' + ctx.depCoveredBills.length + ' covering ' + escapeHtml(ctx.depName);
    }
    html += '<div class="sub">' + billsSub + '</div></div>';
    // Remaining
    html += '<div class="stat-card ' + (ctx.remaining >= 0 ? 'blue' : 'orange') + '">';
    html += '<div class="label">Remaining</div>';
    html += '<div class="value">' + formatCurrency(ctx.remaining) + '</div>';
    html += '<div class="sub">' + (ctx.userMonthlyIncome > 0 ? (ctx.remaining / ctx.userMonthlyIncome * 100).toFixed(1) + '% of income' : 'After all bills') + '</div></div>';
    // Dependent coverage
    if (ctx.depEnabled) {
        html += '<div class="stat-card purple">';
        html += '<div class="label">Covering ' + escapeHtml(ctx.depName) + '</div>';
        html += '<div class="value">' + formatCurrency(ctx.depCoverageTotal) + '</div>';
        html += '<div class="sub">' + ctx.depCoveredBills.length + ' of ' + ctx.dependentBills.length + ' bills</div></div>';
    }
    // Bank Balance
    var bankAccounts = ctx.accounts.filter(function(a) { return a.type === 'checking' || a.type === 'savings'; });
    if (bankAccounts.length > 0) {
        html += '<div class="stat-card ' + (ctx.cashTotal >= 0 ? 'green' : 'red') + '">';
        html += '<div class="label">Bank Balance</div>';
        html += '<div class="value">' + formatCurrency(ctx.cashTotal) + '</div>';
        html += '<div class="sub">' + bankAccounts.length + ' account' + (bankAccounts.length !== 1 ? 's' : '') + ' tracked</div></div>';
    }
    // Investments
    if (ctx.investmentTotal > 0) {
        var invAccounts = ctx.accounts.filter(function(a) { return a.type === 'investment' || a.type === 'retirement'; });
        html += '<div class="stat-card green">';
        html += '<div class="label">Investments</div>';
        html += '<div class="value">' + formatCurrency(ctx.investmentTotal) + '</div>';
        html += '<div class="sub">' + invAccounts.length + ' account' + (invAccounts.length !== 1 ? 's' : '') + '</div></div>';
    }
    // Property Equity
    if (ctx.accounts.filter(function(a) { return a.type === 'property'; }).length > 0) {
        html += '<div class="stat-card ' + (ctx.propertyEquity >= 0 ? 'green' : 'red') + '">';
        html += '<div class="label">Property Equity</div>';
        html += '<div class="value">' + formatCurrency(ctx.propertyEquity) + '</div>';
        html += '<div class="sub">' + ctx.accounts.filter(function(a) { return a.type === 'property'; }).map(function(a) { return escapeHtml(a.name); }).join(', ') + '</div></div>';
    }
    // Vehicle Equity
    if (ctx.accounts.filter(function(a) { return a.type === 'vehicle'; }).length > 0) {
        html += '<div class="stat-card ' + (ctx.vehicleEquity >= 0 ? 'green' : 'red') + '">';
        html += '<div class="label">Vehicle Equity</div>';
        html += '<div class="value">' + formatCurrency(ctx.vehicleEquity) + '</div>';
        html += '<div class="sub">' + ctx.accounts.filter(function(a) { return a.type === 'vehicle'; }).map(function(a) { return escapeHtml(a.name); }).join(', ') + '</div></div>';
    }
    // Net Worth
    if (ctx.accounts.length > 0 || ctx.debts.length > 0) {
        html += '<div class="stat-card ' + (ctx.netBalance >= 0 ? 'blue' : 'red') + '">';
        html += '<div class="label">Net Worth</div>';
        html += '<div class="value">' + formatCurrency(ctx.netBalance) + '</div>';
        var parts = [];
        if (ctx.cashTotal > 0) parts.push(formatCurrency(ctx.cashTotal) + ' cash');
        if (ctx.investmentTotal > 0) parts.push(formatCurrency(ctx.investmentTotal) + ' invested');
        if (ctx.propertyEquity !== 0) parts.push(formatCurrency(Math.abs(ctx.propertyEquity)) + ' property');
        if (ctx.vehicleEquity !== 0) parts.push(formatCurrency(Math.abs(ctx.vehicleEquity)) + ' vehicles');
        if (ctx.creditOwed > 0) parts.push(formatCurrency(ctx.creditOwed) + ' credit owed');
        if (ctx.unlinkedDebtBalance > 0) parts.push(formatCurrency(ctx.unlinkedDebtBalance) + ' debt');
        html += '<div class="sub">' + (parts.length > 0 ? parts.join(' &middot; ') : 'No assets or debts tracked') + '</div></div>';
    }
    // Credit Scores
    if (ctx.userScore) {
        html += '<div class="stat-card">';
        html += '<div class="label">' + escapeHtml(ctx.userName) + '\'s Credit Score</div>';
        html += '<div class="value" style="color:' + ctx.userRating.color + ';">' + ctx.userScore + '</div>';
        html += '<div class="sub">' + ctx.userRating.label + '</div></div>';
    }
    if (ctx.dependentScore) {
        html += '<div class="stat-card">';
        html += '<div class="label">' + escapeHtml(ctx.depName) + '\'s Credit Score</div>';
        html += '<div class="value" style="color:' + ctx.dependentRating.color + ';">' + ctx.dependentScore + '</div>';
        html += '<div class="sub">' + ctx.dependentRating.label + '</div></div>';
    }
    html += '</div>';
    return html;
}

function buildPayPeriodsHtml(ctx) {
    if (ctx.payPeriods.length === 0) {
        return '<div class="card mb-24" style="border-color:var(--yellow);">' +
            '<div class="flex-between"><div>' +
            '<h3 class="text-yellow">Set Up Pay Dates</h3>' +
            '<p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">Go to <strong>Settings</strong> and add your pay dates to see a breakdown of available money between each payday.</p>' +
            '</div></div></div>';
    }
    var currentIdx = ctx.payPeriods.findIndex(function(p) { return p.isCurrent; });
    if (currentIdx === -1) currentIdx = 0;
    var startIdx = Math.max(0, Math.min(currentIdx + periodOffset, ctx.payPeriods.length - 1));
    var visiblePeriods = ctx.payPeriods.slice(startIdx, startIdx + 2);
    var canGoPrev = startIdx > 0;
    var canGoNext = startIdx + 2 < ctx.payPeriods.length;
    var showingCurrent = periodOffset === 0;

    var html = '<div class="card mb-24">';
    html += '<div class="flex-between mb-16"><h3>Pay Period Breakdown</h3>';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<button class="btn-icon" id="period-prev"' + (!canGoPrev ? ' disabled style="opacity:0.3;cursor:default;"' : '') + '>';
    html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';
    if (!showingCurrent) html += '<button class="btn btn-secondary btn-sm" id="period-today" style="font-size:11px;padding:2px 8px;">Current</button>';
    html += '<button class="btn-icon" id="period-next"' + (!canGoNext ? ' disabled style="opacity:0.3;cursor:default;"' : '') + '>';
    html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>';
    html += '</div></div>';

    html += '<div style="display:flex;flex-direction:column;gap:12px;">';
    visiblePeriods.forEach(function(period) {
        var availableClass = period.available >= 0 ? 'text-green' : 'text-red';
        var isCurrent = period.isCurrent;
        var borderStyle = isCurrent ? 'border-color:var(--accent);background:var(--accent-bg);' : '';
        html += '<div class="card" style="padding:16px;' + borderStyle + '">';
        html += '<div class="flex-between mb-16"><div>';
        html += '<div style="font-size:14px;font-weight:700;">';
        if (isCurrent) html += '<span style="display:inline-block;width:8px;height:8px;background:var(--accent);border-radius:50%;margin-right:6px;"></span>';
        html += period.label + '</div>';
        html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">' + period.startLabel + ' &rarr; ' + period.endLabel + '</div>';
        html += '</div><div style="text-align:right;">';
        html += '<div class="' + availableClass + '" style="font-size:20px;font-weight:700;">' + formatCurrency(period.available) + '</div>';
        html += '<div style="font-size:11px;color:var(--text-secondary);">available</div>';
        html += '</div></div>';
        var barWidth = Math.min(100, period.billsTotal > 0 && (ctx.income.user.payAmount + period.otherIncomeTotal) > 0 ? (period.billsTotal / (ctx.income.user.payAmount + period.otherIncomeTotal) * 100) : 0);
        html += '<div style="background:var(--bg-input);border-radius:8px;height:8px;overflow:hidden;margin-bottom:12px;">';
        html += '<div style="height:100%;width:' + barWidth + '%;background:' + (period.available >= 0 ? 'var(--accent)' : 'var(--red)') + ';border-radius:8px;"></div></div>';
        html += '<div class="flex-between" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">';
        html += '<span>Income: <strong class="text-green">' + formatCurrency(ctx.income.user.payAmount) + (period.otherIncomeTotal > 0 ? ' + ' + formatCurrency(period.otherIncomeTotal) : '') + '</strong></span>';
        html += '<span>Bills: <strong class="text-red">' + formatCurrency(period.billsTotal) + '</strong></span></div>';
        // Income items
        if (period.income.length > 0) {
            html += '<div style="border-top:1px solid var(--border);padding-top:8px;margin-bottom:4px;">';
            period.income.forEach(function(inc) {
                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;color:var(--green);">';
                html += '<span>' + escapeHtml(inc.name) + ' <span class="text-muted">(' + inc.payDay + getOrdinal(inc.payDay) + ')</span></span>';
                html += '<span class="font-bold">+' + formatCurrency(inc.amount) + '</span></div>';
            });
            html += '</div>';
        }
        // Bill items
        if (period.bills.length > 0) {
            html += '<div style="border-top:1px solid var(--border);padding-top:8px;">';
            period.bills.forEach(function(bill) {
                var isPaid = !bill._virtual && ctx.store.isBillPaid(bill.id, ctx.year, ctx.month);
                var isVirtual = bill._virtual;
                var isExcluded = bill.excludeFromTotal;
                var style = '';
                if (isPaid) style += 'opacity:0.4;text-decoration:line-through;';
                if (isVirtual) style += 'color:var(--purple);';
                if (isExcluded) style += 'opacity:0.45;';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;' + style + '">';
                html += '<span>' + escapeHtml(bill.name) + ' <span class="text-muted">(' + bill.dueDay + getOrdinal(bill.dueDay) + ')</span>';
                if (isExcluded) html += ' <span style="font-size:9px;color:var(--yellow);">EXCL</span>';
                html += '</span>';
                html += '<span class="font-bold">' + formatCurrency(bill.amount) + '</span></div>';
            });
            html += '</div>';
        } else {
            html += '<div style="font-size:12px;color:var(--text-muted);padding-top:4px;">No bills due this period</div>';
        }
        html += '</div>';
    });
    html += '</div></div>';
    return html;
}

function buildMonthlyProgressHtml(ctx) {
    var progressPct = (ctx.totalBills + ctx.depCoverageTotal) > 0 ? (ctx.paidTotal / (ctx.totalBills + ctx.depCoverageTotal) * 100) : 0;
    var html = '<div class="card">';
    html += '<div class="flex-between mb-16"><h3>Monthly Progress</h3>';
    html += '<span class="text-muted" style="font-size:13px;">' + ctx.paidBills.length + '/' + ctx.bills.filter(function(b) { return !b.frozen; }).length + ' paid</span></div>';
    html += '<div style="background:var(--bg-input);border-radius:8px;height:12px;overflow:hidden;margin-bottom:12px;">';
    html += '<div style="height:100%;width:' + progressPct + '%;background:var(--green);border-radius:8px;transition:width 0.3s;"></div></div>';
    html += '<div class="flex-between">';
    html += '<span class="text-green" style="font-size:13px;font-weight:600;">Paid: ' + formatCurrency(ctx.paidTotal) + '</span>';
    html += '<span class="text-red" style="font-size:13px;font-weight:600;">Remaining: ' + formatCurrency(ctx.unpaidTotal + ctx.depCoverageTotal) + '</span>';
    html += '</div></div>';
    return html;
}

function buildUpcomingBillsHtml(ctx) {
    var html = '<div class="card">';
    html += '<h3 class="mb-16">Upcoming Bills (Next 7 Days)</h3>';
    html += '<div class="upcoming-list">';
    if (ctx.upcoming.length === 0) {
        html += '<div class="text-muted" style="padding:12px;font-size:13px;">No upcoming bills in the next 7 days</div>';
    }
    ctx.upcoming.forEach(function(bill) {
        html += '<div class="upcoming-item ' + (bill.isOverdue ? 'overdue' : '') + ' ' + (bill.isDueSoon ? 'due-soon' : '') + '">';
        html += '<div><div class="bill-name">' + escapeHtml(bill.name) + '</div>';
        html += '<div class="bill-due">';
        if (bill.daysUntil < 0) {
            html += '<span class="text-red">Overdue by ' + Math.abs(bill.daysUntil) + ' day' + (Math.abs(bill.daysUntil) !== 1 ? 's' : '') + '</span>';
        } else if (bill.daysUntil === 0) {
            html += '<span class="text-orange">Due today</span>';
        } else {
            html += 'Due in ' + bill.daysUntil + ' day' + (bill.daysUntil !== 1 ? 's' : '');
        }
        html += ' &middot; ' + escapeHtml(bill.paymentSource || 'No source');
        html += '</div></div>';
        html += '<div class="bill-amount">' + formatCurrency(bill.amount) + '</div></div>';
    });
    html += '</div></div>';
    return html;
}

function buildSpendingCategoryHtml(ctx) {
    var categoryTotals = {};
    ctx.bills.filter(function(b) { return !b.frozen && !b.excludeFromTotal; }).forEach(function(bill) {
        var cat = bill.category || 'Uncategorized';
        if (!categoryTotals[cat]) categoryTotals[cat] = { total: 0, count: 0, paid: 0 };
        var amt = bill.amount;
        if (bill.frequency === 'per-paycheck') amt = bill.amount * ctx.payDatesThisMonth;
        else if (bill.frequency === 'twice-monthly') amt = bill.amount * Math.min(ctx.payDatesThisMonth, 2);
        else if (bill.frequency === 'weekly') amt = bill.amount * ctx.countDayOfWeekInMonth((bill.dueDay || 0) % 7, ctx.year, ctx.month);
        else if (bill.frequency === 'biweekly') amt = bill.amount * Math.ceil(ctx.countDayOfWeekInMonth((bill.dueDay || 0) % 7, ctx.year, ctx.month) / 2);
        else if (bill.frequency === 'yearly') amt = bill.dueMonth === ctx.month ? bill.amount : 0;
        else if (bill.frequency === 'semi-annual') {
            var secondMonth = (bill.dueMonth + 6) % 12;
            amt = (bill.dueMonth === ctx.month || secondMonth === ctx.month) ? bill.amount : 0;
        }
        if (amt > 0) {
            categoryTotals[cat].total += amt;
            categoryTotals[cat].count++;
            if (ctx.store.isBillPaid(bill.id, ctx.year, ctx.month)) {
                categoryTotals[cat].paid += amt;
            }
        }
    });
    var sorted = Object.entries(categoryTotals).sort(function(a, b) { return b[1].total - a[1].total; });
    if (sorted.length === 0) return '';
    var maxTotal = sorted[0][1].total;
    var categoryColors = {
        'Mortgage': 'var(--blue)', 'Housing': 'var(--accent)', 'Necessity': 'var(--green)',
        'Credit Card': 'var(--red)', 'Subscription': 'var(--purple)', 'Car': 'var(--orange)',
        'Insurance': 'var(--yellow)', 'Utilities': 'var(--teal, #2dd4bf)', 'INTERNET': 'var(--cyan)',
        'Storage': 'var(--text-secondary)'
    };
    var html = '<div class="card mt-16"><h3 class="mb-16">Spending by Category</h3>';
    html += '<div style="display:flex;flex-direction:column;gap:10px;">';
    sorted.forEach(function(entry) {
        var cat = entry[0], data = entry[1];
        var pct = maxTotal > 0 ? (data.total / maxTotal * 100) : 0;
        var incomePct = ctx.userMonthlyIncome > 0 ? (data.total / ctx.userMonthlyIncome * 100).toFixed(1) : '0';
        var barColor = categoryColors[cat] || 'var(--accent)';
        html += '<div><div class="flex-between" style="margin-bottom:4px;">';
        html += '<span style="font-size:13px;font-weight:600;">' + escapeHtml(cat) + '</span>';
        html += '<span style="font-size:13px;font-weight:700;">' + formatCurrency(data.total) + ' <span class="text-muted" style="font-weight:400;font-size:11px;">(' + incomePct + '%)</span></span></div>';
        html += '<div style="background:var(--bg-input);border-radius:6px;height:8px;overflow:hidden;">';
        html += '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:6px;transition:width 0.3s;"></div></div>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + data.count + ' bill' + (data.count !== 1 ? 's' : '') + ' &middot; ' + formatCurrency(data.paid) + ' paid</div></div>';
    });
    html += '</div>';
    html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">';
    html += '<div class="flex-between" style="font-size:13px;">';
    html += '<span style="font-weight:600;">Total Monthly Spending</span>';
    html += '<span style="font-weight:700;">' + formatCurrency(ctx.totalBills + ctx.depCoverageTotal);
    if (ctx.userMonthlyIncome > 0) {
        html += ' <span class="text-muted" style="font-weight:400;font-size:11px;">(' + ((ctx.totalBills + ctx.depCoverageTotal) / ctx.userMonthlyIncome * 100).toFixed(1) + '% of income)</span>';
    }
    html += '</span></div></div></div>';
    return html;
}

function buildPaymentSourcesHtml(ctx) {
    var html = '<div class="card mt-16"><h3 class="mb-16">Bills by Payment Source</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">';
    html += getPaymentSourceBreakdown(ctx.bills, ctx.store, ctx.year, ctx.month);
    html += '</div></div>';
    return html;
}

function buildDependentAlertHtml(ctx) {
    if (!ctx.depEnabled || ctx.income.dependent.employed) return '';
    var html = '<div class="card mt-16" style="border-color:var(--orange);">';
    html += '<div class="flex-between mb-16"><h3 class="text-orange">' + escapeHtml(ctx.depName) + ' Coverage Alert</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">';
    html += escapeHtml(ctx.depName) + ' is currently marked as unemployed. You are covering ' + ctx.depCoveredBills.length + ' of their bills totaling ';
    html += '<strong class="text-orange">' + formatCurrency(ctx.depCoverageTotal) + '</strong>/month.</p>';
    html += '<p style="font-size:13px;color:var(--text-secondary);">';
    html += escapeHtml(ctx.depName) + '\'s total bills: <strong>' + formatCurrency(ctx.dependentBills.reduce(function(s, b) { return s + b.amount; }, 0)) + '</strong> &middot; ';
    html += 'Full income when employed: <strong>' + formatCurrency(ctx.income.dependent.payAmount) + '</strong></p></div>';
    return html;
}

// ─────────────────────────────────────────────
// EDIT MODE UI
// ─────────────────────────────────────────────

function buildEditToolbarHtml(layout) {
    var hiddenCount = layout.hidden.length;
    var html = '<div class="dashboard-edit-toolbar card mb-16">';
    html += '<div class="flex-between">';
    html += '<div><div style="font-size:14px;font-weight:600;">Customize Dashboard</div>';
    html += '<div style="font-size:12px;color:var(--text-secondary);">Drag to reorder or use arrows. Click the eye icon to hide widgets.</div></div>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<button class="btn btn-secondary btn-sm" id="dashboard-reset-layout">Reset</button>';
    html += '<button class="btn btn-primary btn-sm" id="dashboard-done-edit">Done</button>';
    html += '</div></div>';
    if (hiddenCount > 0) {
        html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">';
        html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Hidden Widgets (' + hiddenCount + ')</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
        layout.hidden.forEach(function(id) {
            var w = DASHBOARD_WIDGETS.find(function(w) { return w.id === id; });
            html += '<button class="btn btn-secondary btn-sm widget-show-btn" data-show-id="' + id + '" style="font-size:12px;">';
            html += (w ? w.icon + ' ' : '') + (w ? w.label : id);
            html += ' <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px;vertical-align:middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
            html += '</button>';
        });
        html += '</div></div>';
    }
    html += '</div>';
    return html;
}

function wrapWidgetForEdit(id, innerHtml) {
    var w = DASHBOARD_WIDGETS.find(function(w) { return w.id === id; });
    var label = w ? w.label : id;
    var html = '<div class="dashboard-widget-wrapper" data-widget-id="' + id + '" draggable="true">';
    html += '<div class="widget-drag-handle">';
    // Grip icon (desktop)
    html += '<svg class="widget-grip-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" opacity="0.4">';
    html += '<circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/>';
    html += '<circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';
    html += '<span class="widget-label">' + label + '</span>';
    // Mobile move controls
    html += '<div class="widget-mobile-controls">';
    html += '<button class="btn-icon widget-move-up" data-move-id="' + id + '" title="Move up">';
    html += '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>';
    html += '<button class="btn-icon widget-move-down" data-move-id="' + id + '" title="Move down">';
    html += '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>';
    html += '</div>';
    // Hide button
    html += '<button class="btn-icon widget-hide-btn" data-hide-id="' + id + '" title="Hide this widget">';
    html += '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">';
    html += '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>';
    html += '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>';
    html += '<line x1="1" y1="1" x2="23" y2="23"/></svg></button>';
    html += '</div>';
    html += innerHtml;
    html += '</div>';
    return html;
}

// ─────────────────────────────────────────────
// MAIN RENDER
// ─────────────────────────────────────────────

export function renderDashboard(container, store, subTab) {
    // Handle sub-tab routing
    if (subTab === 'reports') {
        activeDashboardTab = 'reports';
    } else {
        activeDashboardTab = 'overview';
    }

    if (activeDashboardTab === 'reports') {
        renderReportsTab(container, store);
        return;
    }

    // Reset period offset to current period on each navigation to dashboard
    if (!dashboardEditMode) periodOffset = 0;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const userName = store.getUserName();
    const depName = store.getDependentName();
    const depEnabled = store.isDependentEnabled();
    const income = store.getIncome();
    const bills = store.getBills();
    const dependentBills = bills.filter(b => b.owner === 'dependent');
    const payDates = store.getPayDates();

    // Calculate totals
    const paySchedule = store.getPaySchedule();
    const otherIncome = store.getOtherIncome();
    const combineDepIncome = income.combineDependentIncome !== false;
    const monthlyMultiplier = paySchedule.frequency === 'weekly' ? 52/12 : paySchedule.frequency === 'biweekly' ? 26/12 : paySchedule.frequency === 'semimonthly' ? 2 : 1;
    const userPayMonthly = income.user.payAmount * monthlyMultiplier;
    const otherIncomeMonthly = otherIncome.reduce((s, src) => {
        const amt = src.amount || 0;
        switch (src.frequency) {
            case 'weekly': return s + amt * 52 / 12;
            case 'biweekly': return s + amt * 26 / 12;
            case 'monthly': return s + amt;
            case 'quarterly': return s + amt / 3;
            case 'yearly': return s + amt / 12;
            default: return s;
        }
    }, 0);
    const depMonthlyPay = depEnabled && combineDepIncome ? (income.dependent.payAmount || 0) : 0;
    const userMonthlyIncome = userPayMonthly + otherIncomeMonthly + depMonthlyPay;
    const countDayOfWeekInMonth = (targetDay, yr, mo) => {
        const lastOfMonth = new Date(yr, mo + 1, 0);
        let count = 0;
        let d = new Date(yr, mo, 1);
        while (d.getDay() !== targetDay) d = new Date(d.getTime() + 86400000);
        while (d <= lastOfMonth) { count++; d = new Date(d.getTime() + 7 * 86400000); }
        return count;
    };
    const payDatesAll = store.getPayDates();
    const payDatesThisMonth = payDatesAll.filter(d => d.getFullYear() === year && d.getMonth() === month).length || 2;

    const totalBills = bills.reduce((sum, b) => {
        if (b.frozen || b.excludeFromTotal) return sum;
        if (b.frequency === 'per-paycheck') return sum + b.amount * payDatesThisMonth;
        if (b.frequency === 'twice-monthly') return sum + b.amount * Math.min(payDatesThisMonth, 2);
        if (b.frequency === 'weekly') return sum + b.amount * countDayOfWeekInMonth((b.dueDay || 0) % 7, year, month);
        if (b.frequency === 'biweekly') return sum + b.amount * Math.ceil(countDayOfWeekInMonth((b.dueDay || 0) % 7, year, month) / 2);
        if (b.frequency === 'yearly') return sum + (b.dueMonth === month ? b.amount : 0);
        if (b.frequency === 'semi-annual') {
            const secondMonth = (b.dueMonth + 6) % 12;
            return sum + (b.dueMonth === month || secondMonth === month ? b.amount : 0);
        }
        return sum + b.amount;
    }, 0);
    const paidBills = bills.filter(b => store.isBillPaid(b.id, year, month) && !b.frozen && !b.excludeFromTotal);
    const paidTotal = paidBills.reduce((sum, b) => {
        if (b.frequency === 'per-paycheck') return sum + b.amount * payDatesThisMonth;
        if (b.frequency === 'twice-monthly') return sum + b.amount * Math.min(payDatesThisMonth, 2);
        if (b.frequency === 'weekly') return sum + b.amount * countDayOfWeekInMonth((b.dueDay || 0) % 7, year, month);
        if (b.frequency === 'biweekly') return sum + b.amount * Math.ceil(countDayOfWeekInMonth((b.dueDay || 0) % 7, year, month) / 2);
        if (b.frequency === 'yearly') return sum + (b.dueMonth === month ? b.amount : 0);
        if (b.frequency === 'semi-annual') {
            const secondMonth = (b.dueMonth + 6) % 12;
            return sum + (b.dueMonth === month || secondMonth === month ? b.amount : 0);
        }
        return sum + b.amount;
    }, 0);
    const unpaidTotal = totalBills - paidTotal;

    const depCoveredBills = depEnabled ? dependentBills.filter(b => b.userCovering) : [];
    const depCoverageTotal = depCoveredBills.reduce((sum, b) => sum + b.amount, 0);
    const remaining = userMonthlyIncome - totalBills - depCoverageTotal;

    const accounts = store.getAccounts();
    const cashTotal = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);
    const creditOwed = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);
    const investmentTotal = accounts.filter(a => a.type === 'investment' || a.type === 'retirement').reduce((s, a) => s + a.balance, 0);
    const propertyEquity = accounts.filter(a => a.type === 'property').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const vehicleEquity = accounts.filter(a => a.type === 'vehicle').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const debts = store.getDebts();
    const unlinkedDebtBalance = debts.filter(d => !d.linkedAccountId).reduce((s, d) => s + (d.currentBalance || 0), 0);
    const totalDebtBalance = debts.reduce((s, d) => s + (d.currentBalance || 0), 0);
    const netBalance = cashTotal + investmentTotal + propertyEquity + vehicleEquity - creditOwed - unlinkedDebtBalance;

    const creditScores = store.getCreditScores();
    const userScore = creditScores.user ? creditScores.user.score : null;
    const userRating = userScore ? getScoreRating(userScore) : null;
    const dependentScore = depEnabled && creditScores.dependent ? creditScores.dependent.score : null;
    const dependentRating = dependentScore ? getScoreRating(dependentScore) : null;

    const upcoming = getUpcomingBills(bills, store, 7);
    const payPeriods = buildPayPeriods(payDates, bills, store, income, year, month, depCoveredBills, otherIncome);

    // Context object passed to widget builders
    const ctx = {
        store, year, month, userName, depName, depEnabled, income, bills, dependentBills,
        payDates, paySchedule, otherIncome, userPayMonthly, otherIncomeMonthly, depMonthlyPay,
        userMonthlyIncome, payDatesThisMonth, countDayOfWeekInMonth, totalBills, paidBills,
        paidTotal, unpaidTotal, depCoveredBills, depCoverageTotal, remaining, accounts,
        cashTotal, creditOwed, investmentTotal, propertyEquity, vehicleEquity, debts,
        unlinkedDebtBalance, totalDebtBalance, netBalance, creditScores, userScore, userRating,
        dependentScore, dependentRating, upcoming, payPeriods
    };

    // Widget renderers map
    const widgetRenderers = {
        'stats-grid':        () => buildStatsGridHtml(ctx),
        'pay-periods':       () => buildPayPeriodsHtml(ctx),
        'monthly-progress':  () => buildMonthlyProgressHtml(ctx),
        'upcoming-bills':    () => buildUpcomingBillsHtml(ctx),
        'spending-category': () => buildSpendingCategoryHtml(ctx),
        'payment-sources':   () => buildPaymentSourcesHtml(ctx),
        'savings-goals':     () => renderSavingsGoals(store),
    };

    const layout = store.getDashboardLayout();

    // Build widgets HTML in layout order
    var widgetsHtml = '';
    layout.order.forEach(function(id) {
        if (layout.hidden.includes(id)) return;
        var renderer = widgetRenderers[id];
        if (!renderer) return;
        var html = renderer();
        if (!html || html.trim() === '') return;
        if (dashboardEditMode) {
            widgetsHtml += wrapWidgetForEdit(id, html);
        } else {
            widgetsHtml += html;
        }
    });

    // Dependent alert (not a widget, always shown when applicable)
    var depAlertHtml = buildDependentAlertHtml(ctx);

    // Page header
    var gearSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

    container.innerHTML =
        '<div class="page-header">' +
            '<div>' +
                '<h2>Dashboard</h2>' +
                '<div class="subtitle">' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '</div>' +
            '</div>' +
            '<button class="btn-icon" id="dashboard-customize-btn" title="Customize dashboard">' + gearSvg + '</button>' +
        '</div>' +
        '<div class="filters" style="margin-bottom:20px;">' +
            '<button class="filter-chip active" data-tab="overview">Overview</button>' +
            '<button class="filter-chip" data-tab="reports">Reports</button>' +
        '</div>' +
        (dashboardEditMode ? buildEditToolbarHtml(layout) : '') +
        '<div id="dashboard-widgets-container">' + widgetsHtml + '</div>' +
        depAlertHtml;

    // ── Event Handlers ──

    // Pay period navigation
    const prevBtn = container.querySelector('#period-prev');
    const nextBtn = container.querySelector('#period-next');
    const todayBtn = container.querySelector('#period-today');

    // Savings Goals event handlers
    setupSavingsGoalHandlers(container, store);

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            periodOffset--;
            renderDashboard(container, store);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            periodOffset++;
            renderDashboard(container, store);
        });
    }
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            periodOffset = 0;
            renderDashboard(container, store);
        });
    }

    // Tab switching
    container.querySelectorAll('.filters .filter-chip[data-tab]').forEach(function(chip) {
        chip.addEventListener('click', function() {
            var tab = chip.dataset.tab;
            activeDashboardTab = tab;
            if (tab === 'overview') {
                window.location.hash = 'dashboard';
            } else {
                window.location.hash = 'dashboard/' + tab;
            }
        });
    });

    // Customize button
    const customizeBtn = container.querySelector('#dashboard-customize-btn');
    if (customizeBtn) {
        customizeBtn.addEventListener('click', () => {
            dashboardEditMode = true;
            renderDashboard(container, store);
        });
    }

    // Edit mode handlers
    if (dashboardEditMode) {
        // Done
        const doneBtn = container.querySelector('#dashboard-done-edit');
        if (doneBtn) {
            doneBtn.addEventListener('click', () => {
                dashboardEditMode = false;
                renderDashboard(container, store);
            });
        }
        // Reset
        const resetBtn = container.querySelector('#dashboard-reset-layout');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                store.resetDashboardLayout();
                dashboardEditMode = false;
                renderDashboard(container, store);
            });
        }
        // Hide widget
        container.querySelectorAll('.widget-hide-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const widgetId = btn.dataset.hideId;
                const layout = store.getDashboardLayout();
                if (!layout.hidden.includes(widgetId)) {
                    layout.hidden.push(widgetId);
                }
                store.updateDashboardLayout(layout);
                renderDashboard(container, store);
            });
        });
        // Show (restore) widget
        container.querySelectorAll('.widget-show-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const widgetId = btn.dataset.showId;
                const layout = store.getDashboardLayout();
                layout.hidden = layout.hidden.filter(id => id !== widgetId);
                store.updateDashboardLayout(layout);
                renderDashboard(container, store);
            });
        });
        // Move up
        container.querySelectorAll('.widget-move-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.moveId;
                const layout = store.getDashboardLayout();
                const visibleOrder = layout.order.filter(wid => !layout.hidden.includes(wid));
                const visIdx = visibleOrder.indexOf(id);
                if (visIdx <= 0) return;
                const fullIdx = layout.order.indexOf(id);
                const prevVisible = visibleOrder[visIdx - 1];
                const prevFullIdx = layout.order.indexOf(prevVisible);
                layout.order.splice(fullIdx, 1);
                layout.order.splice(prevFullIdx, 0, id);
                store.updateDashboardLayout(layout);
                renderDashboard(container, store);
            });
        });
        // Move down
        container.querySelectorAll('.widget-move-down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.moveId;
                const layout = store.getDashboardLayout();
                const visibleOrder = layout.order.filter(wid => !layout.hidden.includes(wid));
                const visIdx = visibleOrder.indexOf(id);
                if (visIdx >= visibleOrder.length - 1) return;
                const fullIdx = layout.order.indexOf(id);
                const nextVisible = visibleOrder[visIdx + 1];
                const nextFullIdx = layout.order.indexOf(nextVisible);
                layout.order.splice(fullIdx, 1);
                const insertIdx = nextFullIdx > fullIdx ? nextFullIdx : nextFullIdx + 1;
                layout.order.splice(insertIdx, 0, id);
                store.updateDashboardLayout(layout);
                renderDashboard(container, store);
            });
        });
        // Drag and drop
        setupDragAndDrop(container, store);
    }
}

// ─────────────────────────────────────────────
// DRAG AND DROP
// ─────────────────────────────────────────────

function setupDragAndDrop(container, store) {
    const widgetsContainer = container.querySelector('#dashboard-widgets-container');
    if (!widgetsContainer) return;

    let draggedId = null;

    widgetsContainer.querySelectorAll('.dashboard-widget-wrapper').forEach(widget => {
        widget.addEventListener('dragstart', (e) => {
            draggedId = widget.dataset.widgetId;
            widget.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => { widget.style.opacity = '0.4'; }, 0);
        });

        widget.addEventListener('dragend', () => {
            widget.classList.remove('dragging');
            widget.style.opacity = '';
            draggedId = null;
            widgetsContainer.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
                el.classList.remove('drag-over-top', 'drag-over-bottom');
            });
        });

        widget.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const targetId = widget.dataset.widgetId;
            if (targetId === draggedId) return;

            widgetsContainer.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
                el.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            const rect = widget.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                widget.classList.add('drag-over-top');
            } else {
                widget.classList.add('drag-over-bottom');
            }
        });

        widget.addEventListener('dragleave', () => {
            widget.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        widget.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetId = widget.dataset.widgetId;
            if (targetId === draggedId || !draggedId) return;

            const layout = store.getDashboardLayout();
            const fromIdx = layout.order.indexOf(draggedId);
            const toIdx = layout.order.indexOf(targetId);
            if (fromIdx === -1 || toIdx === -1) return;

            // Remove dragged item
            layout.order.splice(fromIdx, 1);

            // Determine insert position
            const rect = widget.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const newToIdx = layout.order.indexOf(targetId);
            const insertIdx = e.clientY < midY ? newToIdx : newToIdx + 1;
            layout.order.splice(insertIdx, 0, draggedId);

            store.updateDashboardLayout(layout);
            renderDashboard(container, store);
        });
    });
}

// ─────────────────────────────────────────────
// PAY PERIOD HELPERS
// ─────────────────────────────────────────────

// Expand a recurring bill into individual dated occurrences within a date range
function expandBillOccurrences(bill, rangeStart, rangeEnd, payDatesInRange = []) {
    const occurrences = [];
    const freq = bill.frequency;

    if (freq === 'weekly') {
        const targetDay = (bill.dueDay || 0) % 7;
        let cursor = new Date(rangeStart);
        while (cursor.getDay() !== targetDay) cursor = new Date(cursor.getTime() + 86400000);
        while (cursor <= rangeEnd) {
            occurrences.push({
                ...bill,
                _occurrenceDate: new Date(cursor),
                _occurrenceKey: `${bill.id}_w_${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`,
            });
            cursor = new Date(cursor.getTime() + 7 * 86400000);
        }
    } else if (freq === 'biweekly') {
        const targetDay = (bill.dueDay || 0) % 7;
        let cursor = new Date(rangeStart);
        while (cursor.getDay() !== targetDay) cursor = new Date(cursor.getTime() + 86400000);
        while (cursor <= rangeEnd) {
            occurrences.push({
                ...bill,
                _occurrenceDate: new Date(cursor),
                _occurrenceKey: `${bill.id}_bw_${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`,
            });
            cursor = new Date(cursor.getTime() + 14 * 86400000);
        }
    } else if (freq === 'per-paycheck') {
        payDatesInRange.forEach((pd, idx) => {
            const payDate = new Date(pd);
            if (payDate >= rangeStart && payDate <= rangeEnd) {
                occurrences.push({
                    ...bill,
                    _occurrenceDate: payDate,
                    _occurrenceKey: `${bill.id}_pp_${idx}_${payDate.getTime()}`,
                });
            }
        });
    } else if (freq === 'twice-monthly') {
        const byMonth = {};
        payDatesInRange.forEach(pd => {
            const d = new Date(pd);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            if (!byMonth[key]) byMonth[key] = [];
            byMonth[key].push(d);
        });
        Object.values(byMonth).forEach(monthDates => {
            monthDates.sort((a, b) => a - b);
            const first = monthDates[0];
            const last = monthDates[monthDates.length - 1];
            if (first >= rangeStart && first <= rangeEnd) {
                occurrences.push({ ...bill, _occurrenceDate: first, _occurrenceKey: `${bill.id}_tm_first_${first.getTime()}` });
            }
            if (last.getTime() !== first.getTime() && last >= rangeStart && last <= rangeEnd) {
                occurrences.push({ ...bill, _occurrenceDate: last, _occurrenceKey: `${bill.id}_tm_last_${last.getTime()}` });
            }
        });
    } else {
        return null; // monthly, yearly, semi-annual — no expansion
    }
    return occurrences;
}

function buildPayPeriods(payDates, bills, store, income, year, month, coveredDepBills = [], otherIncomeSources = []) {
    if (!payDates || payDates.length === 0) return [];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeBills = bills.filter(b => !b.frozen && b.amount > 0);
    const sorted = [...payDates].sort((a, b) => a - b);

    const periods = [];

    for (let i = 0; i < sorted.length; i++) {
        const periodStart = sorted[i];
        const periodEnd = sorted[i + 1]
            ? new Date(sorted[i + 1].getTime() - 24 * 60 * 60 * 1000)
            : new Date(periodStart.getTime() + 13 * 24 * 60 * 60 * 1000);

        const periodBills = [];
        const startMonth = periodStart.getMonth();
        const startYear = periodStart.getFullYear();
        const payDatesInPeriod = sorted.filter(d => d >= periodStart && d <= periodEnd);

        activeBills.forEach(bill => {
            if (bill.frequency === 'yearly' && bill.dueMonth != null) {
                const dueDate = new Date(startYear, bill.dueMonth, bill.dueDay);
                const dueDateNextYear = new Date(startYear + 1, bill.dueMonth, bill.dueDay);
                if ((dueDate >= periodStart && dueDate <= periodEnd) ||
                    (dueDateNextYear >= periodStart && dueDateNextYear <= periodEnd)) {
                    periodBills.push(bill);
                }
                return;
            }
            if (bill.frequency === 'semi-annual' && bill.dueMonth != null) {
                const secondMonth = (bill.dueMonth + 6) % 12;
                const dueDate1 = new Date(startYear, bill.dueMonth, bill.dueDay);
                const dueDate2 = new Date(startYear, secondMonth, bill.dueDay);
                const dueDate1Next = new Date(startYear + 1, bill.dueMonth, bill.dueDay);
                const dueDate2Next = new Date(startYear + 1, secondMonth, bill.dueDay);
                if ((dueDate1 >= periodStart && dueDate1 <= periodEnd) ||
                    (dueDate2 >= periodStart && dueDate2 <= periodEnd) ||
                    (dueDate1Next >= periodStart && dueDate1Next <= periodEnd) ||
                    (dueDate2Next >= periodStart && dueDate2Next <= periodEnd)) {
                    periodBills.push(bill);
                }
                return;
            }

            const expanded = expandBillOccurrences(bill, periodStart, periodEnd, payDatesInPeriod);
            if (expanded !== null) {
                periodBills.push(...expanded);
            } else {
                const dueDayThisMonth = new Date(startYear, startMonth, bill.dueDay);
                const dueDayNextMonth = new Date(startYear, startMonth + 1, bill.dueDay);

                if (dueDayThisMonth >= periodStart && dueDayThisMonth <= periodEnd) {
                    periodBills.push(bill);
                } else if (dueDayNextMonth >= periodStart && dueDayNextMonth <= periodEnd) {
                    periodBills.push(bill);
                }
            }
        });

        coveredDepBills.forEach(depBill => {
            if (!depBill.amount || depBill.amount <= 0) return;
            const dueDayThisMonth = new Date(startYear, startMonth, depBill.dueDay || 1);
            const dueDayNextMonth = new Date(startYear, startMonth + 1, depBill.dueDay || 1);
            if (dueDayThisMonth >= periodStart && dueDayThisMonth <= periodEnd) {
                periodBills.push({ name: depBill.name, amount: depBill.amount, dueDay: depBill.dueDay || 1, _virtual: true });
            } else if (dueDayNextMonth >= periodStart && dueDayNextMonth <= periodEnd) {
                periodBills.push({ name: depBill.name, amount: depBill.amount, dueDay: depBill.dueDay || 1, _virtual: true });
            }
        });

        const periodIncome = [];
        const recurringOtherIncome = otherIncomeSources.filter(s => s.payDay && s.frequency !== 'one-time' && s.amount > 0);
        recurringOtherIncome.forEach(src => {
            const payDayThisMonth = new Date(startYear, startMonth, src.payDay);
            const payDayNextMonth = new Date(startYear, startMonth + 1, src.payDay);
            if (payDayThisMonth >= periodStart && payDayThisMonth <= periodEnd) {
                periodIncome.push({ name: src.name, amount: src.amount, payDay: src.payDay, _income: true });
            } else if (payDayNextMonth >= periodStart && payDayNextMonth <= periodEnd) {
                periodIncome.push({ name: src.name, amount: src.amount, payDay: src.payDay, _income: true });
            }
        });

        periodBills.sort((a, b) => (a.dueDay || 0) - (b.dueDay || 0));
        periodIncome.sort((a, b) => (a.payDay || 0) - (b.payDay || 0));

        const billsTotal = periodBills.reduce((s, b) => s + (b.excludeFromTotal ? 0 : b.amount), 0);
        const otherIncomeTotal = periodIncome.reduce((s, i) => s + i.amount, 0);
        const available = income.user.payAmount + otherIncomeTotal - billsTotal;

        const isCurrent = today >= periodStart && today <= periodEnd;

        const dateOpts = { month: 'short', day: 'numeric' };
        periods.push({
            label: `Pay Period ${i + 1}`,
            startLabel: periodStart.toLocaleDateString('en-US', dateOpts),
            endLabel: periodEnd.toLocaleDateString('en-US', dateOpts),
            start: periodStart,
            end: periodEnd,
            bills: periodBills,
            billsTotal,
            income: periodIncome,
            otherIncomeTotal,
            available,
            isCurrent
        });
    }

    return periods;
}

function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

function getPaymentSourceBreakdown(bills, store, year, month) {
    const sources = {};
    bills.filter(b => !b.frozen && !b.excludeFromTotal && b.paymentSource).forEach(bill => {
        const src = bill.paymentSource;
        if (!sources[src]) sources[src] = { total: 0, paid: 0, count: 0 };
        sources[src].total += bill.amount;
        sources[src].count++;
        if (store.isBillPaid(bill.id, year, month)) {
            sources[src].paid += bill.amount;
        }
    });

    return Object.entries(sources).map(([name, data]) =>
        '<div style="background:var(--bg-secondary);padding:12px 14px;border-radius:var(--radius-sm);border:1px solid var(--border);">' +
        '<div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:4px;">' + escapeHtml(name) + '</div>' +
        '<div style="font-size:18px;font-weight:700;">' + formatCurrency(data.total) + '</div>' +
        '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">' + data.count + ' bills &middot; ' + formatCurrency(data.paid) + ' paid</div></div>'
    ).join('');
}

// ─────────────────────────────────────────────
// SAVINGS GOALS
// ─────────────────────────────────────────────

function getGoalCategoryInfo(category) {
    const found = GOAL_CATEGORIES.find(c => c.value === category);
    return found || GOAL_CATEGORIES[6]; // Default to 'other'
}

function renderSavingsGoals(store) {
    const goals = store.getSavingsGoals();

    if (goals.length === 0) {
        return '<div class="card mt-16">' +
            '<div class="flex-between mb-16"><h3>Savings Goals</h3>' +
            '<button class="btn btn-primary btn-sm" id="add-goal-btn">+ Add Goal</button></div>' +
            '<div style="text-align:center;padding:32px 16px;">' +
            '<div style="font-size:48px;margin-bottom:12px;">🎯</div>' +
            '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">No savings goals yet</div>' +
            '<div style="font-size:12px;color:var(--text-muted);max-width:300px;margin:0 auto;">Set goals to track your progress toward financial milestones like an emergency fund, vacation, or home purchase.</div>' +
            '</div></div>';
    }

    const totalTarget = goals.reduce((s, g) => s + (g.targetAmount || 0), 0);
    const totalCurrent = goals.reduce((s, g) => s + (g.currentAmount || 0), 0);
    const overallProgress = totalTarget > 0 ? (totalCurrent / totalTarget * 100) : 0;

    var html = '<div class="card mt-16">';
    html += '<div class="flex-between mb-16"><h3>Savings Goals</h3>';
    html += '<button class="btn btn-primary btn-sm" id="add-goal-btn">+ Add Goal</button></div>';

    // Summary bar
    html += '<div style="background:var(--bg-secondary);padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:16px;">';
    html += '<div class="flex-between" style="margin-bottom:8px;">';
    html += '<span style="font-size:12px;color:var(--text-muted);">Overall Progress</span>';
    html += '<span style="font-size:13px;font-weight:600;">' + formatCurrency(totalCurrent) + ' of ' + formatCurrency(totalTarget) + '</span></div>';
    html += '<div style="background:var(--bg-input);border-radius:8px;height:8px;overflow:hidden;">';
    html += '<div style="height:100%;width:' + Math.min(100, overallProgress) + '%;background:' + (overallProgress >= 100 ? 'var(--green)' : 'var(--accent)') + ';border-radius:8px;transition:width 0.3s;"></div></div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">' + overallProgress.toFixed(1) + '% complete</div></div>';

    // Individual goals
    html += '<div style="display:flex;flex-direction:column;gap:12px;">';
    goals.forEach(function(goal) {
        const progress = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
        const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
        const categoryInfo = getGoalCategoryInfo(goal.category);
        const isComplete = progress >= 100;

        html += '<div class="goal-card" data-goal-id="' + goal.id + '" style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius-sm);border:1px solid var(--border);cursor:pointer;transition:border-color 0.2s;">';
        html += '<div class="flex-between" style="margin-bottom:12px;"><div style="display:flex;align-items:center;gap:10px;">';
        html += '<div style="font-size:24px;">' + categoryInfo.icon + '</div><div>';
        html += '<div style="font-size:14px;font-weight:600;">' + escapeHtml(goal.name) + '</div>';
        html += '<div style="font-size:11px;color:var(--text-muted);">' + categoryInfo.label + '</div></div></div>';
        html += '<div style="text-align:right;">';
        html += '<div style="font-size:16px;font-weight:700;' + (isComplete ? 'color:var(--green);' : '') + '">' + formatCurrency(goal.currentAmount) + '</div>';
        html += '<div style="font-size:11px;color:var(--text-muted);">of ' + formatCurrency(goal.targetAmount) + '</div></div></div>';
        html += '<div style="background:var(--bg-input);border-radius:6px;height:8px;overflow:hidden;margin-bottom:8px;">';
        html += '<div style="height:100%;width:' + progress + '%;background:' + (isComplete ? 'var(--green)' : 'var(--accent)') + ';border-radius:6px;transition:width 0.3s;"></div></div>';
        html += '<div class="flex-between" style="font-size:11px;">';
        html += '<span style="color:var(--text-muted);">' + progress.toFixed(0) + '% complete</span>';
        if (isComplete) {
            html += '<span style="color:var(--green);font-weight:600;">Goal reached! 🎉</span>';
        } else {
            html += '<span style="color:var(--text-secondary);">' + formatCurrency(remaining) + ' to go</span>';
        }
        html += '</div>';
        if (goal.targetDate) {
            html += '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;">Target: ' + new Date(goal.targetDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + '</div>';
        }
        html += '</div>';
    });
    html += '</div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;text-align:center;">Click a goal to edit or delete</div>';
    html += '</div>';
    return html;
}

function setupSavingsGoalHandlers(container, store) {
    const addBtn = container.querySelector('#add-goal-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openGoalModal(store, null));
    }

    container.querySelectorAll('.goal-card').forEach(card => {
        card.addEventListener('click', () => {
            const goalId = card.dataset.goalId;
            const goals = store.getSavingsGoals();
            const goal = goals.find(g => g.id === goalId);
            if (goal) {
                openGoalModal(store, goal);
            }
        });
    });
}

function openGoalModal(store, existingGoal) {
    const isEdit = !!existingGoal;
    const title = isEdit ? 'Edit Savings Goal' : 'Add Savings Goal';

    var modalHtml = '<div class="form-group"><label>Goal Name</label>';
    modalHtml += '<input type="text" class="form-input" id="goal-name" placeholder="e.g., Emergency Fund" value="' + (isEdit ? escapeHtml(existingGoal.name) : '') + '"></div>';
    modalHtml += '<div class="form-group"><label>Category</label>';
    modalHtml += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px;">';
    GOAL_CATEGORIES.forEach(function(cat) {
        var checked = (!isEdit && cat.value === 'other') || (isEdit && existingGoal.category === cat.value);
        var style = checked ? 'border-color:var(--accent);background:var(--accent-bg);' : '';
        modalHtml += '<label style="display:flex;flex-direction:column;align-items:center;padding:10px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;text-align:center;' + style + '">';
        modalHtml += '<input type="radio" name="goal-category" value="' + cat.value + '"' + (checked ? ' checked' : '') + ' style="display:none;">';
        modalHtml += '<span style="font-size:20px;margin-bottom:4px;">' + cat.icon + '</span>';
        modalHtml += '<span style="font-size:10px;color:var(--text-secondary);">' + cat.label + '</span></label>';
    });
    modalHtml += '</div></div>';
    modalHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    modalHtml += '<div class="form-group"><label>Target Amount</label>';
    modalHtml += '<input type="number" class="form-input" id="goal-target" placeholder="10000" min="0" step="0.01" value="' + (isEdit ? existingGoal.targetAmount : '') + '"></div>';
    modalHtml += '<div class="form-group"><label>Current Amount</label>';
    modalHtml += '<input type="number" class="form-input" id="goal-current" placeholder="0" min="0" step="0.01" value="' + (isEdit ? existingGoal.currentAmount : '') + '"></div></div>';
    modalHtml += '<div class="form-group"><label>Target Date (optional)</label>';
    modalHtml += '<input type="month" class="form-input" id="goal-date" value="' + (isEdit && existingGoal.targetDate ? existingGoal.targetDate.slice(0, 7) : '') + '"></div>';
    modalHtml += '<div class="modal-actions">';
    if (isEdit) modalHtml += '<button class="btn btn-danger" id="modal-delete" style="margin-right:auto;">Delete</button>';
    modalHtml += '<button class="btn btn-secondary" id="modal-cancel">Cancel</button>';
    modalHtml += '<button class="btn btn-primary" id="modal-save">' + (isEdit ? 'Save Changes' : 'Add Goal') + '</button></div>';
    modalHtml += '<style>.form-group label:has(input[type="radio"]:checked){border-color:var(--accent)!important;background:var(--accent-bg);}</style>';

    openModal(title, modalHtml);

    document.querySelectorAll('input[name="goal-category"]').forEach(radio => {
        radio.addEventListener('change', () => {
            document.querySelectorAll('input[name="goal-category"]').forEach(r => {
                r.parentElement.style.borderColor = 'var(--border)';
                r.parentElement.style.background = 'transparent';
            });
            if (radio.checked) {
                radio.parentElement.style.borderColor = 'var(--accent)';
                radio.parentElement.style.background = 'var(--accent-bg)';
            }
        });
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    document.getElementById('modal-save').addEventListener('click', () => {
        const name = document.getElementById('goal-name').value.trim();
        const category = document.querySelector('input[name="goal-category"]:checked')?.value || 'other';
        const targetAmount = parseFloat(document.getElementById('goal-target').value) || 0;
        const currentAmount = parseFloat(document.getElementById('goal-current').value) || 0;
        const targetDateInput = document.getElementById('goal-date').value;
        const targetDate = targetDateInput ? targetDateInput + '-01' : null;

        if (!name) { alert('Please enter a goal name'); return; }
        if (targetAmount <= 0) { alert('Please enter a target amount greater than 0'); return; }

        if (isEdit) {
            store.updateSavingsGoal(existingGoal.id, { name, category, targetAmount, currentAmount, targetDate });
        } else {
            store.addSavingsGoal({ name, category, targetAmount, currentAmount, targetDate });
        }

        closeModal();
        refreshPage();
    });

    const deleteBtn = document.getElementById('modal-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (confirm(`Delete "${existingGoal.name}"? This cannot be undone.`)) {
                store.deleteSavingsGoal(existingGoal.id);
                closeModal();
                refreshPage();
            }
        });
    }
}

// ─────────────────────────────────────────────
// REPORTS TAB
// ─────────────────────────────────────────────

function renderReportsTab(container, store) {
    var html = '<div class="page-header">';
    html += '<div><h2>Dashboard</h2>';
    html += '<div class="subtitle">' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '</div></div></div>';

    // Tab chips
    html += '<div class="filters" style="margin-bottom:20px;">';
    html += '<button class="filter-chip" data-tab="overview">Overview</button>';
    html += '<button class="filter-chip active" data-tab="reports">Reports</button>';
    html += '</div>';

    // Reports content
    html += '<div class="card mb-24">';
    html += '<h3 class="mb-16" style="display:flex;align-items:center;gap:8px;">';
    html += '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    html += 'PDF Reports</h3>';
    html += '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Generate printable PDF reports of your financial data. Each report opens in a print-ready view that you can save as PDF.</p>';
    html += '<div class="report-grid">';

    // PDF report cards
    var pdfReports = [
        { id: 'dashboard-summary', icon: '📊', title: 'Dashboard Summary', desc: 'Financial overview, monthly progress, spending by category, and pay period breakdown.' },
        { id: 'income-report', icon: '💰', title: 'Income Report', desc: 'Pay schedule, other income sources, and total household income breakdown.' },
        { id: 'bills-report', icon: '📋', title: 'Bills & Expenses', desc: 'Complete bill listing, payment status, categories, and payment source breakdown.' },
        { id: 'debts-report', icon: '💳', title: 'Debt Summary', desc: 'All debts with balances, interest rates, minimum payments, and payoff strategy.' },
        { id: 'accounts-report', icon: '🏦', title: 'Accounts Summary', desc: 'All accounts with balances, net worth breakdown, and investment holdings.' },
        { id: 'goals-report', icon: '🎯', title: 'Savings Goals', desc: 'All savings goals with progress, target dates, and overall savings summary.' },
    ];
    pdfReports.forEach(function(r) {
        html += '<div class="report-card">';
        html += '<div style="font-size:32px;margin-bottom:8px;">' + r.icon + '</div>';
        html += '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + r.title + '</div>';
        html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">' + r.desc + '</div>';
        html += '<button class="btn btn-primary btn-sm pdf-report-btn" data-report="' + r.id + '">';
        html += '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:middle;"><path d="M6 9l6 6 6-6"/></svg>';
        html += 'Generate PDF</button></div>';
    });
    html += '</div></div>';

    // CSV Export section
    html += '<div class="card mb-24">';
    html += '<h3 class="mb-16" style="display:flex;align-items:center;gap:8px;">';
    html += '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    html += 'CSV Data Exports</h3>';
    html += '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Export your financial data as CSV files for use in spreadsheets or for your accountant.</p>';
    html += '<div class="report-grid">';

    var csvExports = [
        { id: 'csv-bills', icon: '📋', title: 'Bills', desc: 'All bills with amounts, due dates, categories, frequencies, and payment sources.' },
        { id: 'csv-accounts', icon: '🏦', title: 'Accounts', desc: 'All accounts with types, balances, and linked debt information.' },
        { id: 'csv-debts', icon: '💳', title: 'Debts', desc: 'All debts with balances, interest rates, minimum payments, and linked accounts.' },
        { id: 'csv-income', icon: '💰', title: 'Income Sources', desc: 'Pay schedule and all other income sources with frequencies and amounts.' },
        { id: 'csv-expenses', icon: '🧾', title: 'Expenses', desc: 'All tracked expenses with dates, categories, vendors, and amounts.' },
        { id: 'csv-goals', icon: '🎯', title: 'Savings Goals', desc: 'All savings goals with targets, current progress, and categories.' },
        { id: 'csv-all', icon: '📦', title: 'Complete Data Export', desc: 'All financial data in a single multi-sheet ZIP file for comprehensive backup.' },
    ];
    csvExports.forEach(function(r) {
        html += '<div class="report-card">';
        html += '<div style="font-size:32px;margin-bottom:8px;">' + r.icon + '</div>';
        html += '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + r.title + '</div>';
        html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">' + r.desc + '</div>';
        html += '<button class="btn btn-secondary btn-sm csv-export-btn" data-export="' + r.id + '">';
        html += '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        html += 'Download CSV</button></div>';
    });
    html += '</div></div>';

    container.innerHTML = html;

    // Tab switching
    container.querySelectorAll('.filters .filter-chip[data-tab]').forEach(function(chip) {
        chip.addEventListener('click', function() {
            var tab = chip.dataset.tab;
            activeDashboardTab = tab;
            if (tab === 'overview') {
                window.location.hash = 'dashboard';
            } else {
                window.location.hash = 'dashboard/' + tab;
            }
        });
    });

    // PDF report buttons
    container.querySelectorAll('.pdf-report-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var reportId = btn.dataset.report;
            generatePdfReport(store, reportId);
        });
    });

    // CSV export buttons
    container.querySelectorAll('.csv-export-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var exportId = btn.dataset.export;
            generateCsvExport(store, exportId);
        });
    });
}

// ─────────────────────────────────────────────
// CSV GENERATION HELPERS
// ─────────────────────────────────────────────

function escapeCsvField(value) {
    if (value == null) return '';
    var str = String(value);
    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function buildCsvString(headers, rows) {
    var lines = [headers.map(escapeCsvField).join(',')];
    rows.forEach(function(row) {
        lines.push(row.map(escapeCsvField).join(','));
    });
    return lines.join('\n');
}

function downloadCsv(filename, csvContent) {
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function buildBillsCsv(store) {
    var bills = store.getBills();
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var headers = ['Name', 'Amount', 'Category', 'Due Day', 'Frequency', 'Payment Source', 'Auto Pay', 'Frozen', 'Exclude From Total', 'Owner', 'Paid This Month', 'Notes'];
    var rows = bills.map(function(b) {
        return [
            b.name, b.amount, b.category || '', b.dueDay || '', b.frequency || 'monthly',
            b.paymentSource || '', b.autoPay ? 'Yes' : 'No', b.frozen ? 'Yes' : 'No',
            b.excludeFromTotal ? 'Yes' : 'No', b.owner || 'user',
            store.isBillPaid(b.id, year, month) ? 'Yes' : 'No', b.notes || ''
        ];
    });
    return buildCsvString(headers, rows);
}

function buildAccountsCsv(store) {
    var accounts = store.getAccounts();
    var headers = ['Name', 'Type', 'Balance', 'Amount Owed', 'Equity', 'Connected Via Plaid', 'Institution', 'Last Updated'];
    var rows = accounts.map(function(a) {
        var equity = (a.type === 'property' || a.type === 'vehicle') ? (a.balance - (a.amountOwed || 0)) : '';
        return [
            a.name, a.type, a.balance, a.amountOwed || '', equity,
            a.plaidAccountId ? 'Yes' : 'No', a.plaidInstitution || '',
            a.lastUpdated ? new Date(a.lastUpdated).toLocaleDateString() : ''
        ];
    });
    return buildCsvString(headers, rows);
}

function buildDebtsCsv(store) {
    var debts = store.getDebts();
    var headers = ['Name', 'Type', 'Current Balance', 'Original Balance', 'Interest Rate (%)', 'Minimum Payment', 'Linked Account', 'Linked Bill', 'Last Payment Amount', 'Last Payment Date', 'Notes'];
    var rows = debts.map(function(d) {
        var linkedAcct = '';
        if (d.linkedAccountId) {
            var acct = store.getAccounts().find(function(a) { return a.id === d.linkedAccountId; });
            linkedAcct = acct ? acct.name : d.linkedAccountId;
        }
        var linkedBill = '';
        if (d.linkedBillId) {
            var bill = store.getBills().find(function(b) { return b.id === d.linkedBillId; });
            linkedBill = bill ? bill.name : d.linkedBillId;
        }
        return [
            d.name, d.type || '', d.currentBalance || 0, d.originalBalance || '',
            d.interestRate || 0, d.minimumPayment || '', linkedAcct, linkedBill,
            d.lastPaymentAmount || '', d.lastPaymentDate || '', d.notes || ''
        ];
    });
    return buildCsvString(headers, rows);
}

function buildIncomeCsv(store) {
    var income = store.getIncome();
    var otherIncome = store.getOtherIncome();
    var paySchedule = store.getPaySchedule();
    var headers = ['Source', 'Type', 'Amount', 'Frequency', 'Pay Day', 'Category', 'Notes'];
    var rows = [];
    // User primary income
    rows.push(['Primary Income (User)', 'Primary', income.user.payAmount || 0, paySchedule.frequency || 'biweekly', '', '', '']);
    // Dependent income
    if (store.isDependentEnabled()) {
        rows.push([store.getDependentName() + ' Income', 'Dependent', income.dependent.payAmount || 0, income.dependent.frequency || 'biweekly', '', '', income.dependent.employed ? 'Employed' : 'Unemployed']);
    }
    // Other income sources
    otherIncome.forEach(function(src) {
        rows.push([src.name || '', 'Other', src.amount || 0, src.frequency || '', src.payDay || '', src.category || '', src.notes || '']);
    });
    return buildCsvString(headers, rows);
}

function buildExpensesCsv(store) {
    var expenses = store.getExpenses();
    var headers = ['Date', 'Name', 'Category', 'Vendor', 'Amount', 'Notes'];
    var rows = expenses.map(function(e) {
        return [
            e.date || '', e.name || '', e.category || '', e.vendor || '', e.amount || 0, e.notes || ''
        ];
    });
    return buildCsvString(headers, rows);
}

function buildGoalsCsv(store) {
    var goals = store.getSavingsGoals();
    var headers = ['Name', 'Category', 'Target Amount', 'Current Amount', 'Progress (%)', 'Target Date', 'Created Date', 'Notes'];
    var rows = goals.map(function(g) {
        var progress = g.targetAmount > 0 ? ((g.currentAmount / g.targetAmount) * 100).toFixed(1) : '0';
        return [
            g.name, g.category || '', g.targetAmount || 0, g.currentAmount || 0,
            progress, g.targetDate || '', g.createdDate || '', g.notes || ''
        ];
    });
    return buildCsvString(headers, rows);
}

function generateCsvExport(store, exportId) {
    var dateStr = new Date().toISOString().slice(0, 10);
    switch (exportId) {
        case 'csv-bills':
            downloadCsv('pennyhelm-bills-' + dateStr + '.csv', buildBillsCsv(store));
            break;
        case 'csv-accounts':
            downloadCsv('pennyhelm-accounts-' + dateStr + '.csv', buildAccountsCsv(store));
            break;
        case 'csv-debts':
            downloadCsv('pennyhelm-debts-' + dateStr + '.csv', buildDebtsCsv(store));
            break;
        case 'csv-income':
            downloadCsv('pennyhelm-income-' + dateStr + '.csv', buildIncomeCsv(store));
            break;
        case 'csv-expenses':
            downloadCsv('pennyhelm-expenses-' + dateStr + '.csv', buildExpensesCsv(store));
            break;
        case 'csv-goals':
            downloadCsv('pennyhelm-goals-' + dateStr + '.csv', buildGoalsCsv(store));
            break;
        case 'csv-all':
            downloadAllCsvs(store, dateStr);
            break;
    }
}

function downloadAllCsvs(store, dateStr) {
    // Download all CSVs individually (no ZIP library needed)
    var exports = [
        { name: 'pennyhelm-bills-' + dateStr + '.csv', data: buildBillsCsv(store) },
        { name: 'pennyhelm-accounts-' + dateStr + '.csv', data: buildAccountsCsv(store) },
        { name: 'pennyhelm-debts-' + dateStr + '.csv', data: buildDebtsCsv(store) },
        { name: 'pennyhelm-income-' + dateStr + '.csv', data: buildIncomeCsv(store) },
        { name: 'pennyhelm-expenses-' + dateStr + '.csv', data: buildExpensesCsv(store) },
        { name: 'pennyhelm-goals-' + dateStr + '.csv', data: buildGoalsCsv(store) },
    ];
    // Download each with a small delay so browser handles multiple downloads
    exports.forEach(function(exp, i) {
        setTimeout(function() {
            downloadCsv(exp.name, exp.data);
        }, i * 300);
    });
}

// ─────────────────────────────────────────────
// PDF REPORT GENERATION
// ─────────────────────────────────────────────

function generatePdfReport(store, reportId) {
    var reportHtml = '';
    var reportTitle = '';
    var now = new Date();
    var dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    switch (reportId) {
        case 'dashboard-summary':
            reportTitle = 'Dashboard Summary';
            reportHtml = buildDashboardPdfContent(store, dateLabel);
            break;
        case 'income-report':
            reportTitle = 'Income Report';
            reportHtml = buildIncomePdfContent(store, dateLabel);
            break;
        case 'bills-report':
            reportTitle = 'Bills & Expenses Report';
            reportHtml = buildBillsPdfContent(store, dateLabel);
            break;
        case 'debts-report':
            reportTitle = 'Debt Summary';
            reportHtml = buildDebtsPdfContent(store, dateLabel);
            break;
        case 'accounts-report':
            reportTitle = 'Accounts Summary';
            reportHtml = buildAccountsPdfContent(store, dateLabel);
            break;
        case 'goals-report':
            reportTitle = 'Savings Goals Report';
            reportHtml = buildGoalsPdfContent(store, dateLabel);
            break;
        default:
            return;
    }

    openPrintWindow(reportTitle, reportHtml, dateLabel);
}

function openPrintWindow(title, bodyHtml, dateLabel) {
    var printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) {
        alert('Please allow pop-ups to generate PDF reports.');
        return;
    }
    var fullHtml = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    fullHtml += '<title>PennyHelm - ' + title + '</title>';
    fullHtml += '<style>';
    fullHtml += '* { margin: 0; padding: 0; box-sizing: border-box; }';
    fullHtml += 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a2e; padding: 40px; max-width: 900px; margin: 0 auto; font-size: 13px; line-height: 1.5; }';
    fullHtml += '.report-header { text-align: center; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #e0e0e0; }';
    fullHtml += '.report-header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }';
    fullHtml += '.report-header .date { font-size: 13px; color: #666; }';
    fullHtml += '.report-header .brand { font-size: 11px; color: #999; margin-top: 4px; }';
    fullHtml += 'h2 { font-size: 16px; margin: 24px 0 12px 0; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0; }';
    fullHtml += 'h3 { font-size: 14px; margin: 16px 0 8px 0; }';
    fullHtml += 'table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }';
    fullHtml += 'th { background: #f5f5f5; text-align: left; padding: 8px 10px; border: 1px solid #ddd; font-weight: 600; font-size: 11px; text-transform: uppercase; color: #555; }';
    fullHtml += 'td { padding: 7px 10px; border: 1px solid #ddd; }';
    fullHtml += 'tr:nth-child(even) { background: #fafafa; }';
    fullHtml += '.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }';
    fullHtml += '.summary-card { border: 1px solid #ddd; border-radius: 8px; padding: 14px; }';
    fullHtml += '.summary-card .label { font-size: 11px; color: #666; text-transform: uppercase; font-weight: 600; }';
    fullHtml += '.summary-card .value { font-size: 20px; font-weight: 700; margin-top: 4px; }';
    fullHtml += '.summary-card .sub { font-size: 11px; color: #888; margin-top: 2px; }';
    fullHtml += '.text-green { color: #22c55e; } .text-red { color: #ef4444; } .text-blue { color: #3b82f6; } .text-orange { color: #f97316; }';
    fullHtml += '.progress-bar { background: #e5e7eb; border-radius: 6px; height: 10px; overflow: hidden; margin: 6px 0; }';
    fullHtml += '.progress-fill { height: 100%; border-radius: 6px; }';
    fullHtml += '.bar-green { background: #22c55e; } .bar-blue { background: #3b82f6; } .bar-accent { background: #6366f1; }';
    fullHtml += '.status-paid { color: #22c55e; font-weight: 600; } .status-unpaid { color: #ef4444; }';
    fullHtml += '.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 10px; color: #999; }';
    fullHtml += '.print-btn { display: block; margin: 0 auto 24px; padding: 10px 32px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }';
    fullHtml += '.print-btn:hover { background: #4f46e5; }';
    fullHtml += '@media print { .print-btn { display: none !important; } .no-print { display: none !important; } }';
    fullHtml += '@page { margin: 0.5in; }';
    fullHtml += '</style></head><body>';
    fullHtml += '<button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>';
    fullHtml += '<div class="report-header">';
    fullHtml += '<h1>' + title + '</h1>';
    fullHtml += '<div class="date">Generated: ' + dateLabel + '</div>';
    fullHtml += '<div class="brand">PennyHelm Financial Dashboard</div>';
    fullHtml += '</div>';
    fullHtml += bodyHtml;
    fullHtml += '<div class="footer">Generated by PennyHelm &middot; ' + dateLabel + '</div>';
    fullHtml += '</body></html>';

    printWin.document.write(fullHtml);
    printWin.document.close();
}

function buildDashboardPdfContent(store, dateLabel) {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var income = store.getIncome();
    var bills = store.getBills();
    var accounts = store.getAccounts();
    var debts = store.getDebts();
    var paySchedule = store.getPaySchedule();
    var otherIncome = store.getOtherIncome();

    var monthlyMult = paySchedule.frequency === 'weekly' ? 52/12 : paySchedule.frequency === 'biweekly' ? 26/12 : paySchedule.frequency === 'semimonthly' ? 2 : 1;
    var userPayMonthly = income.user.payAmount * monthlyMult;
    var otherIncomeMonthly = otherIncome.reduce(function(s, src) {
        var amt = src.amount || 0;
        if (src.frequency === 'weekly') return s + amt * 52 / 12;
        if (src.frequency === 'biweekly') return s + amt * 26 / 12;
        if (src.frequency === 'monthly') return s + amt;
        if (src.frequency === 'quarterly') return s + amt / 3;
        if (src.frequency === 'yearly') return s + amt / 12;
        return s;
    }, 0);
    var depEnabled = store.isDependentEnabled();
    var combineDepIncome = income.combineDependentIncome !== false;
    var depMonthlyPay = depEnabled && combineDepIncome ? (income.dependent.payAmount || 0) : 0;
    var totalMonthlyIncome = userPayMonthly + otherIncomeMonthly + depMonthlyPay;

    var payDatesAll = store.getPayDates();
    var payDatesThisMonth = payDatesAll.filter(function(d) { return d.getFullYear() === year && d.getMonth() === month; }).length || 2;
    var countDayOfWeekInMonth = function(targetDay, yr, mo) {
        var lastOfMonth = new Date(yr, mo + 1, 0);
        var count = 0;
        var d = new Date(yr, mo, 1);
        while (d.getDay() !== targetDay) d = new Date(d.getTime() + 86400000);
        while (d <= lastOfMonth) { count++; d = new Date(d.getTime() + 7 * 86400000); }
        return count;
    };
    var totalBills = bills.reduce(function(sum, b) {
        if (b.frozen || b.excludeFromTotal) return sum;
        if (b.frequency === 'per-paycheck') return sum + b.amount * payDatesThisMonth;
        if (b.frequency === 'twice-monthly') return sum + b.amount * Math.min(payDatesThisMonth, 2);
        if (b.frequency === 'weekly') return sum + b.amount * countDayOfWeekInMonth((b.dueDay || 0) % 7, year, month);
        if (b.frequency === 'biweekly') return sum + b.amount * Math.ceil(countDayOfWeekInMonth((b.dueDay || 0) % 7, year, month) / 2);
        if (b.frequency === 'yearly') return sum + (b.dueMonth === month ? b.amount : 0);
        if (b.frequency === 'semi-annual') {
            var sm = (b.dueMonth + 6) % 12;
            return sum + (b.dueMonth === month || sm === month ? b.amount : 0);
        }
        return sum + b.amount;
    }, 0);
    var paidBills = bills.filter(function(b) { return store.isBillPaid(b.id, year, month) && !b.frozen && !b.excludeFromTotal; });
    var paidTotal = paidBills.reduce(function(sum, b) { return sum + b.amount; }, 0);
    var remaining = totalMonthlyIncome - totalBills;

    var cashTotal = accounts.filter(function(a) { return a.type === 'checking' || a.type === 'savings'; }).reduce(function(s, a) { return s + a.balance; }, 0);
    var creditOwed = accounts.filter(function(a) { return a.type === 'credit'; }).reduce(function(s, a) { return s + a.balance; }, 0);
    var investmentTotal = accounts.filter(function(a) { return a.type === 'investment' || a.type === 'retirement'; }).reduce(function(s, a) { return s + a.balance; }, 0);
    var propertyEquity = accounts.filter(function(a) { return a.type === 'property'; }).reduce(function(s, a) { return s + (a.balance - (a.amountOwed || 0)); }, 0);
    var vehicleEquity = accounts.filter(function(a) { return a.type === 'vehicle'; }).reduce(function(s, a) { return s + (a.balance - (a.amountOwed || 0)); }, 0);
    var unlinkedDebtBalance = debts.filter(function(d) { return !d.linkedAccountId; }).reduce(function(s, d) { return s + (d.currentBalance || 0); }, 0);
    var netWorth = cashTotal + investmentTotal + propertyEquity + vehicleEquity - creditOwed - unlinkedDebtBalance;

    var html = '<h2>Financial Overview</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">Monthly Income</div><div class="value text-green">' + formatCurrency(totalMonthlyIncome) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Total Bills</div><div class="value text-red">' + formatCurrency(totalBills) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Remaining</div><div class="value ' + (remaining >= 0 ? 'text-blue' : 'text-red') + '">' + formatCurrency(remaining) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Net Worth</div><div class="value ' + (netWorth >= 0 ? 'text-blue' : 'text-red') + '">' + formatCurrency(netWorth) + '</div></div>';
    if (cashTotal > 0) html += '<div class="summary-card"><div class="label">Bank Balance</div><div class="value">' + formatCurrency(cashTotal) + '</div></div>';
    if (investmentTotal > 0) html += '<div class="summary-card"><div class="label">Investments</div><div class="value">' + formatCurrency(investmentTotal) + '</div></div>';
    html += '</div>';

    // Monthly progress
    var progressPct = totalBills > 0 ? (paidTotal / totalBills * 100) : 0;
    html += '<h2>Monthly Progress</h2>';
    html += '<p>' + paidBills.length + ' of ' + bills.filter(function(b) { return !b.frozen; }).length + ' bills paid (' + progressPct.toFixed(0) + '%)</p>';
    html += '<div class="progress-bar"><div class="progress-fill bar-green" style="width:' + progressPct + '%;"></div></div>';
    html += '<p>Paid: ' + formatCurrency(paidTotal) + ' &middot; Remaining: ' + formatCurrency(totalBills - paidTotal) + '</p>';

    // Spending by Category
    var categoryTotals = {};
    bills.filter(function(b) { return !b.frozen && !b.excludeFromTotal; }).forEach(function(b) {
        var cat = b.category || 'Uncategorized';
        if (!categoryTotals[cat]) categoryTotals[cat] = 0;
        categoryTotals[cat] += b.amount;
    });
    var sorted = Object.entries(categoryTotals).sort(function(a, b) { return b[1] - a[1]; });
    if (sorted.length > 0) {
        html += '<h2>Spending by Category</h2>';
        html += '<table><tr><th>Category</th><th style="text-align:right;">Amount</th><th style="text-align:right;">% of Income</th></tr>';
        sorted.forEach(function(entry) {
            var pct = totalMonthlyIncome > 0 ? (entry[1] / totalMonthlyIncome * 100).toFixed(1) : '0';
            html += '<tr><td>' + entry[0] + '</td><td style="text-align:right;">' + formatCurrency(entry[1]) + '</td><td style="text-align:right;">' + pct + '%</td></tr>';
        });
        html += '</table>';
    }

    return html;
}

function buildIncomePdfContent(store, dateLabel) {
    var income = store.getIncome();
    var otherIncome = store.getOtherIncome();
    var paySchedule = store.getPaySchedule();
    var depEnabled = store.isDependentEnabled();

    var monthlyMult = paySchedule.frequency === 'weekly' ? 52/12 : paySchedule.frequency === 'biweekly' ? 26/12 : paySchedule.frequency === 'semimonthly' ? 2 : 1;
    var userPayMonthly = income.user.payAmount * monthlyMult;

    var html = '<h2>Primary Income</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">' + store.getUserName() + '\'s Pay</div><div class="value">' + formatCurrency(income.user.payAmount) + '</div><div class="sub">Per ' + (paySchedule.frequency || 'paycheck') + '</div></div>';
    html += '<div class="summary-card"><div class="label">Monthly Equivalent</div><div class="value text-green">' + formatCurrency(userPayMonthly) + '</div></div>';
    html += '</div>';

    if (depEnabled) {
        html += '<h2>Dependent Income</h2>';
        html += '<div class="summary-grid">';
        html += '<div class="summary-card"><div class="label">' + store.getDependentName() + '</div><div class="value">' + formatCurrency(income.dependent.payAmount || 0) + '</div><div class="sub">' + (income.dependent.employed ? 'Employed' : 'Unemployed') + '</div></div>';
        html += '</div>';
    }

    if (otherIncome.length > 0) {
        html += '<h2>Other Income Sources</h2>';
        html += '<table><tr><th>Source</th><th>Frequency</th><th style="text-align:right;">Amount</th><th>Category</th></tr>';
        otherIncome.forEach(function(src) {
            html += '<tr><td>' + escapeHtml(src.name || '') + '</td><td>' + (src.frequency || '') + '</td><td style="text-align:right;">' + formatCurrency(src.amount || 0) + '</td><td>' + (src.category || '') + '</td></tr>';
        });
        html += '</table>';
    }

    // Total
    var otherMonthly = otherIncome.reduce(function(s, src) {
        var amt = src.amount || 0;
        if (src.frequency === 'weekly') return s + amt * 52 / 12;
        if (src.frequency === 'biweekly') return s + amt * 26 / 12;
        if (src.frequency === 'monthly') return s + amt;
        if (src.frequency === 'quarterly') return s + amt / 3;
        if (src.frequency === 'yearly') return s + amt / 12;
        return s;
    }, 0);
    var totalHousehold = userPayMonthly + otherMonthly + (depEnabled ? (income.dependent.payAmount || 0) : 0);
    html += '<h2>Total Household Income</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">Total Monthly</div><div class="value text-green">' + formatCurrency(totalHousehold) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Total Annual (est.)</div><div class="value">' + formatCurrency(totalHousehold * 12) + '</div></div>';
    html += '</div>';

    return html;
}

function buildBillsPdfContent(store, dateLabel) {
    var bills = store.getBills();
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    var html = '<h2>Bills for ' + monthName + '</h2>';
    html += '<table><tr><th>Name</th><th>Category</th><th style="text-align:center;">Due Day</th><th>Frequency</th><th>Payment Source</th><th style="text-align:right;">Amount</th><th style="text-align:center;">Status</th></tr>';
    var activeBills = bills.filter(function(b) { return !b.frozen; });
    activeBills.sort(function(a, b) { return (a.dueDay || 0) - (b.dueDay || 0); });
    var totalActive = 0;
    activeBills.forEach(function(b) {
        var isPaid = store.isBillPaid(b.id, year, month);
        totalActive += b.excludeFromTotal ? 0 : b.amount;
        html += '<tr>';
        html += '<td>' + escapeHtml(b.name) + (b.autoPay ? ' <span style="font-size:10px;color:#666;">(auto)</span>' : '') + '</td>';
        html += '<td>' + (b.category || '') + '</td>';
        html += '<td style="text-align:center;">' + (b.dueDay || '') + '</td>';
        html += '<td>' + (b.frequency || 'monthly') + '</td>';
        html += '<td>' + escapeHtml(b.paymentSource || '') + '</td>';
        html += '<td style="text-align:right;">' + formatCurrency(b.amount) + '</td>';
        html += '<td style="text-align:center;" class="' + (isPaid ? 'status-paid' : 'status-unpaid') + '">' + (isPaid ? 'Paid' : 'Unpaid') + '</td>';
        html += '</tr>';
    });
    html += '</table>';

    // Frozen bills
    var frozen = bills.filter(function(b) { return b.frozen; });
    if (frozen.length > 0) {
        html += '<h2>Frozen Bills (Inactive)</h2>';
        html += '<table><tr><th>Name</th><th>Category</th><th style="text-align:right;">Amount</th><th>Notes</th></tr>';
        frozen.forEach(function(b) {
            html += '<tr><td>' + escapeHtml(b.name) + '</td><td>' + (b.category || '') + '</td><td style="text-align:right;">' + formatCurrency(b.amount) + '</td><td>' + escapeHtml(b.notes || '') + '</td></tr>';
        });
        html += '</table>';
    }

    // Summary
    html += '<h2>Summary</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">Active Bills</div><div class="value">' + activeBills.length + '</div></div>';
    html += '<div class="summary-card"><div class="label">Monthly Total</div><div class="value text-red">' + formatCurrency(totalActive) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Frozen Bills</div><div class="value">' + frozen.length + '</div></div>';
    html += '</div>';

    return html;
}

function buildDebtsPdfContent(store, dateLabel) {
    var debts = store.getDebts();

    var totalDebt = debts.reduce(function(s, d) { return s + (d.currentBalance || 0); }, 0);
    var totalMinPayment = debts.reduce(function(s, d) { return s + (d.minimumPayment || 0); }, 0);
    var avgApr = debts.length > 0 ? debts.reduce(function(s, d) { return s + (d.interestRate || 0); }, 0) / debts.length : 0;

    var html = '<h2>Debt Overview</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">Total Debt</div><div class="value text-red">' + formatCurrency(totalDebt) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Monthly Minimums</div><div class="value">' + formatCurrency(totalMinPayment) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Average APR</div><div class="value">' + avgApr.toFixed(1) + '%</div></div>';
    html += '<div class="summary-card"><div class="label">Number of Debts</div><div class="value">' + debts.length + '</div></div>';
    html += '</div>';

    if (debts.length > 0) {
        html += '<h2>Debt Details</h2>';
        html += '<table><tr><th>Name</th><th>Type</th><th style="text-align:right;">Balance</th><th style="text-align:right;">Original</th><th style="text-align:right;">APR</th><th style="text-align:right;">Min. Payment</th><th style="text-align:right;">Progress</th></tr>';
        debts.forEach(function(d) {
            var progress = d.originalBalance > 0 ? (((d.originalBalance - (d.currentBalance || 0)) / d.originalBalance) * 100).toFixed(0) : '0';
            html += '<tr>';
            html += '<td>' + escapeHtml(d.name) + '</td>';
            html += '<td>' + (d.type || '') + '</td>';
            html += '<td style="text-align:right;">' + formatCurrency(d.currentBalance || 0) + '</td>';
            html += '<td style="text-align:right;">' + (d.originalBalance ? formatCurrency(d.originalBalance) : 'N/A') + '</td>';
            html += '<td style="text-align:right;">' + (d.interestRate || 0) + '%</td>';
            html += '<td style="text-align:right;">' + formatCurrency(d.minimumPayment || 0) + '</td>';
            html += '<td style="text-align:right;">' + progress + '%</td>';
            html += '</tr>';
        });
        html += '</table>';
    }

    return html;
}

function buildAccountsPdfContent(store, dateLabel) {
    var accounts = store.getAccounts();
    var debts = store.getDebts();

    var cashTotal = accounts.filter(function(a) { return a.type === 'checking' || a.type === 'savings'; }).reduce(function(s, a) { return s + a.balance; }, 0);
    var creditOwed = accounts.filter(function(a) { return a.type === 'credit'; }).reduce(function(s, a) { return s + a.balance; }, 0);
    var investmentTotal = accounts.filter(function(a) { return a.type === 'investment' || a.type === 'retirement'; }).reduce(function(s, a) { return s + a.balance; }, 0);
    var propertyEquity = accounts.filter(function(a) { return a.type === 'property'; }).reduce(function(s, a) { return s + (a.balance - (a.amountOwed || 0)); }, 0);
    var vehicleEquity = accounts.filter(function(a) { return a.type === 'vehicle'; }).reduce(function(s, a) { return s + (a.balance - (a.amountOwed || 0)); }, 0);
    var unlinkedDebtBalance = debts.filter(function(d) { return !d.linkedAccountId; }).reduce(function(s, d) { return s + (d.currentBalance || 0); }, 0);
    var netWorth = cashTotal + investmentTotal + propertyEquity + vehicleEquity - creditOwed - unlinkedDebtBalance;

    var html = '<h2>Net Worth Summary</h2>';
    html += '<div class="summary-grid">';
    if (cashTotal > 0) html += '<div class="summary-card"><div class="label">Cash</div><div class="value text-green">' + formatCurrency(cashTotal) + '</div></div>';
    if (investmentTotal > 0) html += '<div class="summary-card"><div class="label">Investments</div><div class="value text-green">' + formatCurrency(investmentTotal) + '</div></div>';
    if (propertyEquity !== 0) html += '<div class="summary-card"><div class="label">Property Equity</div><div class="value">' + formatCurrency(propertyEquity) + '</div></div>';
    if (vehicleEquity !== 0) html += '<div class="summary-card"><div class="label">Vehicle Equity</div><div class="value">' + formatCurrency(vehicleEquity) + '</div></div>';
    if (creditOwed > 0) html += '<div class="summary-card"><div class="label">Credit Owed</div><div class="value text-red">' + formatCurrency(creditOwed) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Net Worth</div><div class="value ' + (netWorth >= 0 ? 'text-blue' : 'text-red') + '">' + formatCurrency(netWorth) + '</div></div>';
    html += '</div>';

    // Group by type
    var types = ['checking', 'savings', 'credit', 'investment', 'retirement', 'property', 'vehicle', 'equipment', 'other-asset'];
    var typeLabels = { checking: 'Checking', savings: 'Savings', credit: 'Credit Cards', investment: 'Investment', retirement: 'Retirement', property: 'Property', vehicle: 'Vehicles', equipment: 'Equipment', 'other-asset': 'Other Assets' };

    types.forEach(function(type) {
        var typeAccounts = accounts.filter(function(a) { return a.type === type; });
        if (typeAccounts.length === 0) return;
        html += '<h2>' + (typeLabels[type] || type) + '</h2>';
        html += '<table><tr><th>Name</th><th style="text-align:right;">Balance</th>';
        if (type === 'property' || type === 'vehicle') html += '<th style="text-align:right;">Owed</th><th style="text-align:right;">Equity</th>';
        html += '<th>Last Updated</th></tr>';
        typeAccounts.forEach(function(a) {
            html += '<tr><td>' + escapeHtml(a.name) + '</td>';
            html += '<td style="text-align:right;">' + formatCurrency(a.balance) + '</td>';
            if (type === 'property' || type === 'vehicle') {
                html += '<td style="text-align:right;">' + formatCurrency(a.amountOwed || 0) + '</td>';
                html += '<td style="text-align:right;">' + formatCurrency(a.balance - (a.amountOwed || 0)) + '</td>';
            }
            html += '<td>' + (a.lastUpdated ? new Date(a.lastUpdated).toLocaleDateString() : '') + '</td>';
            html += '</tr>';
        });
        html += '</table>';
    });

    return html;
}

function buildGoalsPdfContent(store, dateLabel) {
    var goals = store.getSavingsGoals();

    if (goals.length === 0) {
        return '<p style="text-align:center;color:#666;padding:40px 0;">No savings goals set yet.</p>';
    }

    var totalTarget = goals.reduce(function(s, g) { return s + (g.targetAmount || 0); }, 0);
    var totalCurrent = goals.reduce(function(s, g) { return s + (g.currentAmount || 0); }, 0);
    var overallProgress = totalTarget > 0 ? (totalCurrent / totalTarget * 100) : 0;

    var html = '<h2>Overall Progress</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">Total Saved</div><div class="value text-green">' + formatCurrency(totalCurrent) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Total Target</div><div class="value">' + formatCurrency(totalTarget) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Overall Progress</div><div class="value">' + overallProgress.toFixed(1) + '%</div></div>';
    html += '<div class="summary-card"><div class="label">Goals Count</div><div class="value">' + goals.length + '</div></div>';
    html += '</div>';

    html += '<h2>Individual Goals</h2>';
    html += '<table><tr><th>Goal</th><th>Category</th><th style="text-align:right;">Current</th><th style="text-align:right;">Target</th><th style="text-align:right;">Progress</th><th>Target Date</th></tr>';
    goals.forEach(function(g) {
        var progress = g.targetAmount > 0 ? ((g.currentAmount / g.targetAmount) * 100) : 0;
        var categoryInfo = getGoalCategoryInfo(g.category);
        html += '<tr>';
        html += '<td>' + categoryInfo.icon + ' ' + escapeHtml(g.name) + '</td>';
        html += '<td>' + categoryInfo.label + '</td>';
        html += '<td style="text-align:right;">' + formatCurrency(g.currentAmount || 0) + '</td>';
        html += '<td style="text-align:right;">' + formatCurrency(g.targetAmount || 0) + '</td>';
        html += '<td style="text-align:right;' + (progress >= 100 ? 'color:#22c55e;font-weight:600;' : '') + '">' + progress.toFixed(0) + '%</td>';
        html += '<td>' + (g.targetDate ? new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '') + '</td>';
        html += '</tr>';
    });
    html += '</table>';

    return html;
}
