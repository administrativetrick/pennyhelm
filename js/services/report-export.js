/**
 * report-export — CSV data exports + printable PDF reports for the dashboard.
 * Extracted from dashboard.js. Two entry points are used by the dashboard
 * export UI: generateCsvExport(store, exportId) and generatePdfReport(store,
 * reportId); everything else is an internal builder.
 */
import { formatCurrency, escapeHtml } from '../utils.js';
import { calculateMonthlyIncome, calculateBillMonthlyAmount, frequencyToMonthly, getMonthlyMultiplier, addDays, spendingExpenses } from './financial-service.js';
import { getGoalCategoryInfo } from './goal-categories.js';
import { showToast } from './modal-manager.js';

// eslint-disable-next-line no-unused-vars
export function generateCsvExport(store, exportId) { return _generateCsvExport(store, exportId); }
export function generatePdfReport(store, reportId) { return _generatePdfReport(store, reportId); }

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

function _generateCsvExport(store, exportId) {
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

function _generatePdfReport(store, reportId) {
    var reportHtml = '';
    var reportTitle = '';
    var now = new Date();
    var dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    switch (reportId) {
        case 'dashboard-summary':
            reportTitle = 'Dashboard Summary';
            reportHtml = buildDashboardPdfContent(store, dateLabel);
            break;
        case 'cashflow-report':
            reportTitle = 'Cashflow Report';
            reportHtml = buildCashflowPdfContent(store, dateLabel);
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
        showToast('Please allow pop-ups to generate PDF reports.', 'error');
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

    var monthlyMult = getMonthlyMultiplier(paySchedule.frequency);
    var depEnabled = store.isDependentEnabled();
    var combineDepIncome = income.combineDependentIncome !== false;
    var incomeBreakdown = calculateMonthlyIncome(income, otherIncome, paySchedule);
    var userPayMonthly = incomeBreakdown.userPayMonthly;
    var otherIncomeMonthly = incomeBreakdown.otherIncomeMonthly;
    var depMonthlyPay = depEnabled && combineDepIncome ? incomeBreakdown.depMonthlyPay : 0;
    var totalMonthlyIncome = userPayMonthly + otherIncomeMonthly + depMonthlyPay;

    var payDatesAll = store.getPayDates();
    var payDatesThisMonth = payDatesAll.filter(function(d) { return d.getFullYear() === year && d.getMonth() === month; }).length || 2;
    var countDayOfWeekInMonth = function(targetDay, yr, mo) {
        var lastOfMonth = new Date(yr, mo + 1, 0);
        var count = 0;
        var d = new Date(yr, mo, 1);
        while (d.getDay() !== targetDay) d = addDays(d, 1);
        while (d <= lastOfMonth) { count++; d = addDays(d, 7); }
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

    var incomeBreakdown = calculateMonthlyIncome(income, otherIncome, paySchedule);
    var userPayMonthly = incomeBreakdown.userPayMonthly;

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
    var otherMonthly = incomeBreakdown.otherIncomeMonthly;
    var totalHousehold = userPayMonthly + otherMonthly + (depEnabled ? incomeBreakdown.depMonthlyPay : 0);
    html += '<h2>Total Household Income</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">Total Monthly</div><div class="value text-green">' + formatCurrency(totalHousehold) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Total Annual (est.)</div><div class="value">' + formatCurrency(totalHousehold * 12) + '</div></div>';
    html += '</div>';

    return html;
}

function buildCashflowPdfContent(store, dateLabel) {
    var now = new Date();
    var income = store.getIncome();
    var otherIncome = store.getOtherIncome();
    var paySchedule = store.getPaySchedule();
    var bills = store.getBills();
    var depEnabled = store.isDependentEnabled();
    var combineDepIncome = income.combineDependentIncome !== false;

    // Monthly income (via shared financial-service helper)
    var incomeBreakdown = calculateMonthlyIncome(income, otherIncome, paySchedule);
    var userPayMonthly = incomeBreakdown.userPayMonthly;
    var otherIncomeMonthly = incomeBreakdown.otherIncomeMonthly;
    var depMonthlyPay = depEnabled && combineDepIncome ? incomeBreakdown.depMonthlyPay : 0;
    var totalMonthlyIncome = userPayMonthly + otherIncomeMonthly + depMonthlyPay;

    // Income sources list
    var incomeSources = [];
    if (userPayMonthly > 0) incomeSources.push({ name: store.getUserName() + "'s Pay", amount: userPayMonthly });
    if (depMonthlyPay > 0) incomeSources.push({ name: store.getDependentName() + "'s Pay", amount: depMonthlyPay });
    otherIncome.forEach(function(src) {
        var m = frequencyToMonthly(src.amount, src.frequency);
        if (m > 0) incomeSources.push({ name: src.name || 'Other income', amount: m });
    });

    // Expense categories — prefer 30-day transactions, fall back to bills.
    // spendingExpenses drops transfers/card payments (double counting) and
    // ignored/split-parent rows, and remaps interest charges to 'interest'.
    var allExpenses = spendingExpenses((store.getExpenses ? store.getExpenses() : []) || []);
    // Lexical ISO compare (not Date parsing, which reads date-only strings as
    // UTC midnight) so this window agrees with the bills-page Sankey to the day.
    var pad2 = function(n) { return String(n).padStart(2, '0'); };
    var isoOf = function(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var thirtyDaysAgoIso = isoOf(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    var nowIso = isoOf(now);
    var recentExpenses = allExpenses.filter(function(e) {
        return e && e.date && e.date >= thirtyDaysAgoIso && e.date <= nowIso && (e.amount || 0) > 0;
    });

    var categoryTotals = {};
    var source = 'bills';
    if (recentExpenses.length >= 3) {
        source = 'transactions';
        recentExpenses.forEach(function(e) {
            var cat = (e.category || 'Uncategorized').replace(/^\w/, function(c) { return c.toUpperCase(); });
            categoryTotals[cat] = (categoryTotals[cat] || 0) + (e.amount || 0);
        });
    } else {
        bills.filter(function(b) { return !b.frozen && !b.excludeFromTotal; }).forEach(function(bill) {
            var cat = bill.category || 'Uncategorized';
            categoryTotals[cat] = (categoryTotals[cat] || 0) + calculateBillMonthlyAmount(bill);
        });
    }
    var sortedCategories = Object.entries(categoryTotals).sort(function(a, b) { return b[1] - a[1]; });
    var totalOutflow = sortedCategories.reduce(function(s, e) { return s + e[1]; }, 0);
    var netCashflow = totalMonthlyIncome - totalOutflow;
    var savingsRate = totalMonthlyIncome > 0 ? (netCashflow / totalMonthlyIncome * 100) : 0;

    var periodLabel = source === 'transactions' ? 'Based on actual spending (last 30 days, ' + recentExpenses.length + ' transactions; transfers &amp; card payments excluded)' : 'Based on recurring bills (monthly equivalent)';

    // Summary
    var html = '<p style="font-size:12px;color:#666;margin-bottom:16px;">' + periodLabel + '</p>';
    html += '<h2>Cashflow Summary</h2>';
    html += '<div class="summary-grid">';
    html += '<div class="summary-card"><div class="label">Monthly Income</div><div class="value text-green">' + formatCurrency(totalMonthlyIncome) + '</div><div class="sub">' + incomeSources.length + ' source' + (incomeSources.length === 1 ? '' : 's') + '</div></div>';
    html += '<div class="summary-card"><div class="label">Monthly Outflow</div><div class="value text-red">' + formatCurrency(totalOutflow) + '</div><div class="sub">' + sortedCategories.length + ' categor' + (sortedCategories.length === 1 ? 'y' : 'ies') + '</div></div>';
    html += '<div class="summary-card"><div class="label">Net Cashflow</div><div class="value ' + (netCashflow >= 0 ? 'text-green' : 'text-red') + '">' + (netCashflow >= 0 ? '+' : '') + formatCurrency(netCashflow) + '</div></div>';
    html += '<div class="summary-card"><div class="label">Savings Rate</div><div class="value ' + (savingsRate >= 20 ? 'text-green' : savingsRate >= 0 ? 'text-blue' : 'text-red') + '">' + savingsRate.toFixed(1) + '%</div><div class="sub">' + (savingsRate >= 20 ? 'Healthy' : savingsRate >= 10 ? 'Moderate' : savingsRate >= 0 ? 'Low' : 'Negative') + '</div></div>';
    html += '</div>';

    // Income sources
    html += '<h2>Income Sources</h2>';
    if (incomeSources.length === 0) {
        html += '<p style="color:#666;font-size:12px;">No income sources configured.</p>';
    } else {
        html += '<table><tr><th>Source</th><th style="text-align:right;">Monthly Amount</th><th style="text-align:right;">% of Income</th></tr>';
        incomeSources.sort(function(a, b) { return b.amount - a.amount; }).forEach(function(src) {
            var pct = totalMonthlyIncome > 0 ? (src.amount / totalMonthlyIncome * 100) : 0;
            html += '<tr><td>' + escapeHtml(src.name) + '</td><td style="text-align:right;">' + formatCurrency(src.amount) + '</td><td style="text-align:right;">' + pct.toFixed(1) + '%</td></tr>';
        });
        html += '<tr style="font-weight:700;background:#f5f5f5;"><td>Total</td><td style="text-align:right;" class="text-green">' + formatCurrency(totalMonthlyIncome) + '</td><td style="text-align:right;">100%</td></tr>';
        html += '</table>';
    }

    // Expense categories (with inline bar)
    html += '<h2>Expense Categories</h2>';
    if (sortedCategories.length === 0) {
        html += '<p style="color:#666;font-size:12px;">No expenses recorded.</p>';
    } else {
        var maxCat = sortedCategories[0][1];
        html += '<table><tr><th>Category</th><th style="text-align:right;">Amount</th><th style="text-align:right;">% of Income</th><th style="text-align:right;">% of Outflow</th><th style="width:140px;">Share</th></tr>';
        sortedCategories.forEach(function(entry) {
            var cat = entry[0];
            var amt = entry[1];
            var pctIncome = totalMonthlyIncome > 0 ? (amt / totalMonthlyIncome * 100) : 0;
            var pctOutflow = totalOutflow > 0 ? (amt / totalOutflow * 100) : 0;
            var barPct = maxCat > 0 ? (amt / maxCat * 100) : 0;
            html += '<tr>';
            html += '<td>' + escapeHtml(cat) + '</td>';
            html += '<td style="text-align:right;">' + formatCurrency(amt) + '</td>';
            html += '<td style="text-align:right;">' + pctIncome.toFixed(1) + '%</td>';
            html += '<td style="text-align:right;">' + pctOutflow.toFixed(1) + '%</td>';
            html += '<td><div class="progress-bar"><div class="progress-fill bar-accent" style="width:' + barPct.toFixed(1) + '%;"></div></div></td>';
            html += '</tr>';
        });
        html += '<tr style="font-weight:700;background:#f5f5f5;"><td>Total</td><td style="text-align:right;" class="text-red">' + formatCurrency(totalOutflow) + '</td><td style="text-align:right;">' + (totalMonthlyIncome > 0 ? (totalOutflow / totalMonthlyIncome * 100).toFixed(1) : '0.0') + '%</td><td style="text-align:right;">100%</td><td></td></tr>';
        html += '</table>';
    }

    // Flow summary
    html += '<h2>Cashflow Narrative</h2>';
    html += '<table>';
    html += '<tr><td>Total monthly income</td><td style="text-align:right;" class="text-green">' + formatCurrency(totalMonthlyIncome) + '</td></tr>';
    html += '<tr><td>Total monthly outflow</td><td style="text-align:right;" class="text-red">&minus;' + formatCurrency(totalOutflow) + '</td></tr>';
    html += '<tr style="font-weight:700;"><td>Net</td><td style="text-align:right;" class="' + (netCashflow >= 0 ? 'text-green' : 'text-red') + '">' + (netCashflow >= 0 ? '+' : '') + formatCurrency(netCashflow) + '</td></tr>';
    html += '</table>';

    if (source === 'transactions') {
        // Top merchants from recent transactions
        var merchantTotals = {};
        recentExpenses.forEach(function(e) {
            var key = e.vendor || e.name || 'Unknown';
            merchantTotals[key] = (merchantTotals[key] || 0) + (e.amount || 0);
        });
        var topMerchants = Object.entries(merchantTotals).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);
        if (topMerchants.length > 0) {
            html += '<h2>Top Merchants (Last 30 Days)</h2>';
            html += '<table><tr><th>Merchant</th><th style="text-align:right;">Total Spent</th><th style="text-align:right;">% of Outflow</th></tr>';
            topMerchants.forEach(function(m) {
                var pct = totalOutflow > 0 ? (m[1] / totalOutflow * 100) : 0;
                html += '<tr><td>' + escapeHtml(m[0]) + '</td><td style="text-align:right;">' + formatCurrency(m[1]) + '</td><td style="text-align:right;">' + pct.toFixed(1) + '%</td></tr>';
            });
            html += '</table>';
        }
    }

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
