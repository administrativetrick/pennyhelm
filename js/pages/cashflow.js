import { formatCurrency, escapeHtml } from '../utils.js';

let cfPeriodOffset = 0;

export function renderCashflow(container, store) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const income = store.getIncome();
    const bills = store.getBills();
    const dependentBills = store.getDependentBills();
    const depEnabled = store.isDependentEnabled();
    const paySchedule = store.getPaySchedule();
    const otherIncome = store.getOtherIncome();
    const combineDepIncome = income.combineDependentIncome !== false;
    const payDates = store.getPayDates();
    const accounts = store.getAccounts();

    // Monthly income calculation
    const monthlyMult = getMonthlyMultiplier(paySchedule.frequency);
    const userPayMonthly = income.user.payAmount * monthlyMult;
    const otherIncomeMonthly = otherIncome.reduce((s, src) => s + getOtherIncomeMonthly(src), 0);
    const depMonthlyPay = depEnabled && combineDepIncome ? (income.dependent.payAmount || 0) : 0;
    const totalMonthlyIncome = userPayMonthly + otherIncomeMonthly + depMonthlyPay;

    // Current month outflow
    const depCoveredBills = depEnabled ? dependentBills.filter(b => b.userCovering) : [];
    const depCoverageTotal = depCoveredBills.reduce((sum, b) => sum + b.amount, 0);

    const monthlyOutflow = bills.reduce((sum, b) => {
        if (b.frozen || b.excludeFromTotal) return sum;
        return sum + getBillMonthlyAmount(b, month);
    }, 0) + depCoverageTotal;

    const netCashflow = totalMonthlyIncome - monthlyOutflow;
    const savingsRate = totalMonthlyIncome > 0 ? (netCashflow / totalMonthlyIncome * 100) : 0;

    // Category breakdown for waterfall (annualized monthly)
    const categoryTotals = {};
    bills.filter(b => !b.frozen && !b.excludeFromTotal).forEach(bill => {
        const cat = bill.category || 'Uncategorized';
        if (!categoryTotals[cat]) categoryTotals[cat] = 0;
        categoryTotals[cat] += getBillAnnualizedMonthly(bill);
    });
    if (depCoverageTotal > 0) {
        categoryTotals['Dependent Coverage'] = depCoverageTotal;
    }
    const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const annualizedOutflow = sortedCategories.reduce((s, [, v]) => s + v, 0);
    const waterfallNet = totalMonthlyIncome - annualizedOutflow;

    // 6-month projection
    const projection = [];
    for (let i = 0; i < 6; i++) {
        const projMonth = (month + i) % 12;
        const monthExpenses = bills.reduce((sum, b) => {
            if (b.frozen || b.excludeFromTotal) return sum;
            return sum + getBillMonthlyAmount(b, projMonth);
        }, 0) + depCoverageTotal;
        projection.push({
            month: projMonth,
            label: new Date(year, month + i, 1).toLocaleDateString('en-US', { month: 'short' }),
            income: totalMonthlyIncome,
            expenses: monthExpenses,
            net: totalMonthlyIncome - monthExpenses
        });
    }
    const projMax = Math.max(...projection.map(p => Math.max(p.income, p.expenses)));

    // Income sources breakdown
    const incomeSources = [];
    if (userPayMonthly > 0) incomeSources.push({ name: store.getUserName() + "'s Pay", amount: userPayMonthly });
    if (depMonthlyPay > 0) incomeSources.push({ name: store.getDependentName() + "'s Pay", amount: depMonthlyPay });
    otherIncome.forEach(src => {
        const amt = getOtherIncomeMonthly(src);
        if (amt > 0) incomeSources.push({ name: src.name, amount: amt });
    });
    const incomeMax = incomeSources.length > 0 ? Math.max(...incomeSources.map(s => s.amount)) : 0;
    const expenseMax = sortedCategories.length > 0 ? sortedCategories[0][1] : 0;

    // Pay periods
    const payPeriods = buildPayPeriods(payDates, bills, store, income, year, month, depCoveredBills, otherIncome);
    const startingBalance = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);

    // Waterfall chart max value
    const waterfallMax = Math.max(totalMonthlyIncome, annualizedOutflow);

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const categoryColors = {
        'Mortgage': 'var(--blue)',
        'Housing': 'var(--accent)',
        'Necessity': 'var(--green)',
        'Credit Card': 'var(--red)',
        'Subscription': 'var(--purple)',
        'Car': 'var(--orange)',
        'Insurance': 'var(--yellow)',
        'Utilities': 'var(--cyan)',
        'Storage': 'var(--text-secondary)',
        'Dependent Coverage': 'var(--purple)',
        'Uncategorized': 'var(--text-muted)'
    };

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Cashflow</h2>
                <div class="subtitle">${monthNames[month]} ${year}</div>
            </div>
        </div>

        <!-- Summary Stat Cards -->
        <div class="card-grid">
            <div class="stat-card green">
                <div class="label">Monthly Income</div>
                <div class="value">${formatCurrency(totalMonthlyIncome)}</div>
                <div class="sub">${formatCurrency(userPayMonthly)} pay${otherIncomeMonthly > 0 ? ` + ${formatCurrency(otherIncomeMonthly)} other` : ''}${depMonthlyPay > 0 ? ` + ${formatCurrency(depMonthlyPay)} dep` : ''}</div>
            </div>
            <div class="stat-card red">
                <div class="label">Monthly Outflow</div>
                <div class="value">${formatCurrency(monthlyOutflow)}</div>
                <div class="sub">${bills.filter(b => !b.frozen && !b.excludeFromTotal).length} bills${depCoverageTotal > 0 ? ` + ${formatCurrency(depCoverageTotal)} dep coverage` : ''}</div>
            </div>
            <div class="stat-card ${netCashflow >= 0 ? 'green' : 'red'}">
                <div class="label">Net Cashflow</div>
                <div class="value">${netCashflow >= 0 ? '+' : ''}${formatCurrency(netCashflow)}</div>
                <div class="sub">${totalMonthlyIncome > 0 ? `${Math.abs(netCashflow / totalMonthlyIncome * 100).toFixed(1)}% of income` : 'Income minus outflow'}</div>
            </div>
            <div class="stat-card ${savingsRate >= 20 ? 'green' : savingsRate >= 0 ? 'blue' : 'red'}">
                <div class="label">Savings Rate</div>
                <div class="value">${savingsRate.toFixed(1)}%</div>
                <div class="sub">${savingsRate >= 20 ? 'Healthy' : savingsRate >= 10 ? 'Moderate' : savingsRate >= 0 ? 'Low' : 'Negative'}</div>
            </div>
        </div>

        <!-- Cashflow Waterfall -->
        <div class="card mb-24">
            <h3 class="mb-16">Cashflow Waterfall</h3>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Annualized monthly view — how income flows through expense categories to net cashflow</p>
            ${waterfallMax > 0 ? `
            <div class="waterfall-chart">
                <div class="waterfall-bar-wrapper">
                    <div class="waterfall-bar-value text-green">${formatCurrency(totalMonthlyIncome)}</div>
                    <div class="waterfall-bar positive" style="height:${(totalMonthlyIncome / waterfallMax * 100).toFixed(1)}%;"></div>
                    <div class="waterfall-bar-label">Income</div>
                </div>
                ${sortedCategories.map(([cat, amount]) => {
                    const pct = (amount / waterfallMax * 100).toFixed(1);
                    return `
                <div class="waterfall-bar-wrapper">
                    <div class="waterfall-bar-value text-red">${formatCurrency(amount)}</div>
                    <div class="waterfall-bar negative" style="height:${pct}%;"></div>
                    <div class="waterfall-bar-label">${escapeHtml(cat)}</div>
                </div>`;
                }).join('')}
                <div class="waterfall-bar-wrapper">
                    <div class="waterfall-bar-value" style="color:${waterfallNet >= 0 ? 'var(--green)' : 'var(--orange)'};">${waterfallNet >= 0 ? '+' : ''}${formatCurrency(waterfallNet)}</div>
                    <div class="waterfall-bar ${waterfallNet >= 0 ? 'net-positive' : 'net-negative'}" style="height:${(Math.abs(waterfallNet) / waterfallMax * 100).toFixed(1)}%;"></div>
                    <div class="waterfall-bar-label">Net</div>
                </div>
            </div>
            ` : '<div style="font-size:13px;color:var(--text-muted);padding:24px;text-align:center;">No income or bills data to display</div>'}
        </div>

        <!-- 6-Month Projection -->
        <div class="card mb-24">
            <div class="flex-between mb-16">
                <h3>6-Month Projection</h3>
                <div style="display:flex;align-items:center;gap:16px;font-size:11px;">
                    <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--green);border-radius:2px;display:inline-block;"></span> Income</span>
                    <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--red);border-radius:2px;display:inline-block;"></span> Expenses</span>
                </div>
            </div>
            ${projMax > 0 ? `
            <div class="timeline-chart">
                ${projection.map(p => {
                    const incH = (p.income / projMax * 100).toFixed(1);
                    const expH = (p.expenses / projMax * 100).toFixed(1);
                    return `
                <div class="timeline-month">
                    <div class="timeline-net" style="color:${p.net >= 0 ? 'var(--green)' : 'var(--red)'};">${p.net >= 0 ? '+' : ''}${formatCurrency(p.net)}</div>
                    <div class="timeline-bar-group">
                        <div class="timeline-bar income" style="height:${incH}%;"></div>
                        <div class="timeline-bar expense" style="height:${expH}%;"></div>
                    </div>
                    <div class="timeline-label">${p.label}</div>
                </div>`;
                }).join('')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:8px;text-align:center;">
                ${projection.map(p => `
                <div style="font-size:10px;">
                    <div style="color:var(--text-muted);">Exp: ${formatCurrency(p.expenses)}</div>
                </div>`).join('')}
            </div>
            ` : '<div style="font-size:13px;color:var(--text-muted);padding:24px;text-align:center;">No data to project</div>'}
        </div>

        <!-- Income vs Expenses Breakdown -->
        <div class="card mb-24">
            <h3 class="mb-16">Income vs. Expenses Breakdown</h3>
            <div class="breakdown-grid">
                <div>
                    <div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:12px;">Income Sources</div>
                    ${incomeSources.length > 0 ? incomeSources.map(src => {
                        const pct = totalMonthlyIncome > 0 ? (src.amount / totalMonthlyIncome * 100) : 0;
                        const barPct = incomeMax > 0 ? (src.amount / incomeMax * 100) : 0;
                        return `
                    <div class="breakdown-item">
                        <div class="flex-between" style="margin-bottom:4px;">
                            <span style="font-size:13px;font-weight:500;">${escapeHtml(src.name)}</span>
                            <span style="font-size:13px;font-weight:700;">${formatCurrency(src.amount)} <span style="font-size:11px;color:var(--text-muted);font-weight:400;">(${pct.toFixed(1)}%)</span></span>
                        </div>
                        <div class="breakdown-bar"><div class="breakdown-bar-fill green" style="width:${barPct.toFixed(1)}%;"></div></div>
                    </div>`;
                    }).join('') : '<div style="font-size:13px;color:var(--text-muted);">No income configured</div>'}
                    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:8px;">
                        <div class="flex-between" style="font-size:13px;font-weight:700;">
                            <span>Total Income</span>
                            <span class="text-green">${formatCurrency(totalMonthlyIncome)}</span>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:12px;">Expense Categories</div>
                    ${sortedCategories.length > 0 ? sortedCategories.map(([cat, amount]) => {
                        const pct = totalMonthlyIncome > 0 ? (amount / totalMonthlyIncome * 100) : 0;
                        const barPct = expenseMax > 0 ? (amount / expenseMax * 100) : 0;
                        return `
                    <div class="breakdown-item">
                        <div class="flex-between" style="margin-bottom:4px;">
                            <span style="font-size:13px;font-weight:500;">${escapeHtml(cat)}</span>
                            <span style="font-size:13px;font-weight:700;">${formatCurrency(amount)} <span style="font-size:11px;color:var(--text-muted);font-weight:400;">(${pct.toFixed(1)}%)</span></span>
                        </div>
                        <div class="breakdown-bar"><div class="breakdown-bar-fill red" style="width:${barPct.toFixed(1)}%;"></div></div>
                    </div>`;
                    }).join('') : '<div style="font-size:13px;color:var(--text-muted);">No bills configured</div>'}
                    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:8px;">
                        <div class="flex-between" style="font-size:13px;font-weight:700;">
                            <span>Total Expenses</span>
                            <span class="text-red">${formatCurrency(annualizedOutflow)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Pay Period Cashflow Detail -->
        ${payPeriods.length > 0 ? (() => {
            let currentIdx = payPeriods.findIndex(p => p.isCurrent);
            if (currentIdx === -1) currentIdx = 0;
            const startIdx = Math.max(0, Math.min(currentIdx + cfPeriodOffset, payPeriods.length - 1));
            const visiblePeriods = payPeriods.slice(startIdx, startIdx + 3);
            const canGoPrev = startIdx > 0;
            const canGoNext = startIdx + 3 < payPeriods.length;
            const showingCurrent = cfPeriodOffset === 0;

            // Running balance
            let runningBalance = startingBalance;
            // Subtract bills from prior periods
            for (let i = 0; i < startIdx; i++) {
                runningBalance += payPeriods[i].available;
            }

            return `
        <div class="card mb-24">
            <div class="flex-between mb-16">
                <div>
                    <h3>Pay Period Cashflow</h3>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Starting balance: ${formatCurrency(startingBalance)} (checking + savings)</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="btn-icon" id="cf-period-prev" ${!canGoPrev ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    ${!showingCurrent ? '<button class="btn btn-secondary btn-sm" id="cf-period-today" style="font-size:11px;padding:2px 8px;">Current</button>' : ''}
                    <button class="btn-icon" id="cf-period-next" ${!canGoNext ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
                ${visiblePeriods.map(period => {
                    const periodStart = runningBalance;
                    const periodEnd = runningBalance + period.available;
                    runningBalance = periodEnd;
                    const progressPct = periodStart > 0 ? Math.max(0, Math.min(100, (periodEnd / periodStart) * 100)) : 50;
                    const isCurrent = period.isCurrent;
                    const borderStyle = isCurrent ? 'border-color:var(--accent);background:rgba(79,140,255,0.04);' : '';
                    return `
                    <div class="card" style="padding:16px;${borderStyle}">
                        <div class="flex-between mb-16">
                            <div>
                                <div style="font-size:14px;font-weight:700;">
                                    ${isCurrent ? '<span style="display:inline-block;width:8px;height:8px;background:var(--accent);border-radius:50%;margin-right:6px;"></span>' : ''}
                                    ${period.label}
                                </div>
                                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                                    ${period.startLabel} &rarr; ${period.endLabel}
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:12px;color:var(--text-secondary);">${formatCurrency(periodStart)} &rarr;</div>
                                <div style="font-size:20px;font-weight:700;color:${periodEnd >= 0 ? 'var(--green)' : 'var(--red)'};">${formatCurrency(periodEnd)}</div>
                            </div>
                        </div>
                        <div style="background:var(--bg-input);border-radius:8px;height:8px;overflow:hidden;margin-bottom:12px;">
                            <div style="height:100%;width:${progressPct}%;background:${periodEnd >= periodStart ? 'var(--green)' : 'var(--red)'};border-radius:8px;"></div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
                            <div style="background:var(--bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                                <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">Income</div>
                                <div style="font-size:14px;font-weight:700;color:var(--green);">${formatCurrency(income.user.payAmount + period.otherIncomeTotal)}</div>
                            </div>
                            <div style="background:var(--bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                                <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">Bills</div>
                                <div style="font-size:14px;font-weight:700;color:var(--red);">${formatCurrency(period.billsTotal)}</div>
                            </div>
                            <div style="background:var(--bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                                <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">Net</div>
                                <div style="font-size:14px;font-weight:700;color:${period.available >= 0 ? 'var(--green)' : 'var(--red)'};">${period.available >= 0 ? '+' : ''}${formatCurrency(period.available)}</div>
                            </div>
                        </div>
                        ${period.bills.length > 0 ? `
                        <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:12px;">
                            ${period.bills.map(bill => {
                                const isExcluded = bill.excludeFromTotal;
                                const isVirtual = bill._virtual;
                                return `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;${isVirtual ? 'color:var(--purple);' : ''}${isExcluded ? 'opacity:0.45;' : ''}">
                                    <span>${escapeHtml(bill.name)} <span class="text-muted">(${bill.dueDay}${getOrdinal(bill.dueDay)})</span>${isExcluded ? ' <span style="font-size:9px;color:var(--yellow);">EXCL</span>' : ''}</span>
                                    <span class="font-bold">${formatCurrency(bill.amount)}</span>
                                </div>`;
                            }).join('')}
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
        })() : `
        <div class="card mb-24" style="border-color:var(--yellow);">
            <div class="flex-between">
                <div>
                    <h3 class="text-yellow">Set Up Pay Dates</h3>
                    <p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                        Go to <strong>Settings</strong> and add your pay dates to see pay period cashflow details.
                    </p>
                </div>
            </div>
        </div>`}
    `;

    // Event handlers for period navigation
    const prevBtn = container.querySelector('#cf-period-prev');
    const nextBtn = container.querySelector('#cf-period-next');
    const todayBtn = container.querySelector('#cf-period-today');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            cfPeriodOffset--;
            renderCashflow(container, store);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            cfPeriodOffset++;
            renderCashflow(container, store);
        });
    }
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            cfPeriodOffset = 0;
            renderCashflow(container, store);
        });
    }
}

// Helper: frequency to monthly multiplier
function getMonthlyMultiplier(freq) {
    switch (freq) {
        case 'weekly': return 52 / 12;
        case 'biweekly': return 26 / 12;
        case 'semimonthly': return 2;
        default: return 1;
    }
}

// Helper: other income source to monthly amount
function getOtherIncomeMonthly(src) {
    const amt = src.amount || 0;
    switch (src.frequency) {
        case 'weekly': return amt * 52 / 12;
        case 'biweekly': return amt * 26 / 12;
        case 'monthly': return amt;
        case 'quarterly': return amt / 3;
        case 'yearly': return amt / 12;
        default: return 0; // one-time = 0
    }
}

// Helper: bill amount for a specific month (respects frequency)
function getBillMonthlyAmount(bill, targetMonth) {
    if (bill.frozen || bill.excludeFromTotal) return 0;
    if (bill.frequency === 'per-paycheck') return bill.amount * 2;
    if (bill.frequency === 'yearly') {
        return bill.dueMonth === targetMonth ? bill.amount : 0;
    }
    if (bill.frequency === 'semi-annual') {
        const secondMonth = (bill.dueMonth + 6) % 12;
        return (bill.dueMonth === targetMonth || secondMonth === targetMonth) ? bill.amount : 0;
    }
    return bill.amount;
}

// Helper: annualized monthly amount for waterfall (spreads yearly/semi-annual evenly)
function getBillAnnualizedMonthly(bill) {
    if (bill.frozen || bill.excludeFromTotal) return 0;
    if (bill.frequency === 'per-paycheck') return bill.amount * 2;
    if (bill.frequency === 'yearly') return bill.amount / 12;
    if (bill.frequency === 'semi-annual') return bill.amount / 6;
    return bill.amount;
}

// Helper: ordinal suffix
function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

// Copied from dashboard.js — same bill-to-period assignment logic
function buildPayPeriods(payDates, bills, store, income, year, month, coveredDepBills = [], otherIncomeSources = []) {
    if (!payDates || payDates.length === 0) return [];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeBills = bills.filter(b => !b.frozen && b.amount > 0);
    const regularBills = activeBills.filter(b => b.frequency !== 'per-paycheck');
    const perPaycheckBills = activeBills.filter(b => b.frequency === 'per-paycheck');

    const sorted = [...payDates].sort((a, b) => a - b);

    const paychecksPerMonth = {};
    sorted.forEach(d => {
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!paychecksPerMonth[key]) paychecksPerMonth[key] = [];
        paychecksPerMonth[key].push(d.getTime());
    });

    const periods = [];

    for (let i = 0; i < sorted.length; i++) {
        const periodStart = sorted[i];
        const periodEnd = sorted[i + 1]
            ? new Date(sorted[i + 1].getTime() - 24 * 60 * 60 * 1000)
            : new Date(periodStart.getTime() + 13 * 24 * 60 * 60 * 1000);

        const periodBills = [];
        const startMonth = periodStart.getMonth();
        const startYear = periodStart.getFullYear();

        regularBills.forEach(bill => {
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

            const dueDayThisMonth = new Date(startYear, startMonth, bill.dueDay);
            const dueDayNextMonth = new Date(startYear, startMonth + 1, bill.dueDay);

            if (dueDayThisMonth >= periodStart && dueDayThisMonth <= periodEnd) {
                periodBills.push(bill);
            } else if (dueDayNextMonth >= periodStart && dueDayNextMonth <= periodEnd) {
                periodBills.push(bill);
            }
        });

        perPaycheckBills.forEach(bill => {
            const monthKey = `${periodStart.getFullYear()}-${periodStart.getMonth()}`;
            const monthPaychecks = paychecksPerMonth[monthKey] || [];
            if (monthPaychecks.length >= 3) {
                const first = Math.min(...monthPaychecks);
                const last = Math.max(...monthPaychecks);
                if (periodStart.getTime() === first || periodStart.getTime() === last) {
                    periodBills.push(bill);
                }
            } else {
                periodBills.push(bill);
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
