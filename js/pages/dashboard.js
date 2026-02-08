import { formatCurrency, getUpcomingBills, escapeHtml, getScoreRating } from '../utils.js';
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

let periodOffset = 0; // 0 = starts at current period

export function renderDashboard(container, store) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const userName = store.getUserName();
    const depName = store.getDependentName();
    const depEnabled = store.isDependentEnabled();
    const income = store.getIncome();
    const bills = store.getBills();
    // Dependent bills are now in the main bills array with owner: 'dependent'
    const dependentBills = bills.filter(b => b.owner === 'dependent');
    const payDates = store.getPayDates(); // Returns Date objects now

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
    const totalBills = bills.reduce((sum, b) => {
        if (b.frozen || b.excludeFromTotal) return sum;
        // Per-paycheck bills are paid twice per month (standard months)
        if (b.frequency === 'per-paycheck') return sum + b.amount * 2;
        // Weekly bills are paid ~4 times per month
        if (b.frequency === 'weekly') return sum + b.amount * 4;
        // Biweekly bills are paid ~2 times per month
        if (b.frequency === 'biweekly') return sum + b.amount * 2;
        // Yearly/semi-annual only count at full amount when due this month
        if (b.frequency === 'yearly') {
            return sum + (b.dueMonth === month ? b.amount : 0);
        }
        if (b.frequency === 'semi-annual') {
            const secondMonth = (b.dueMonth + 6) % 12;
            return sum + (b.dueMonth === month || secondMonth === month ? b.amount : 0);
        }
        return sum + b.amount;
    }, 0);
    const paidBills = bills.filter(b => store.isBillPaid(b.id, year, month) && !b.frozen && !b.excludeFromTotal);
    const paidTotal = paidBills.reduce((sum, b) => {
        if (b.frequency === 'per-paycheck') return sum + b.amount * 2;
        if (b.frequency === 'weekly') return sum + b.amount * 4;
        if (b.frequency === 'biweekly') return sum + b.amount * 2;
        if (b.frequency === 'yearly') return sum + (b.dueMonth === month ? b.amount : 0);
        if (b.frequency === 'semi-annual') {
            const secondMonth = (b.dueMonth + 6) % 12;
            return sum + (b.dueMonth === month || secondMonth === month ? b.amount : 0);
        }
        return sum + b.amount;
    }, 0);
    const unpaidTotal = totalBills - paidTotal;

    // Dependent coverage
    const depCoveredBills = depEnabled ? dependentBills.filter(b => b.userCovering) : [];
    const depCoverageTotal = depCoveredBills.reduce((sum, b) => sum + b.amount, 0);

    const remaining = userMonthlyIncome - totalBills - depCoverageTotal;

    // Account balances
    const accounts = store.getAccounts();
    const cashTotal = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);
    const creditOwed = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);
    const investmentTotal = accounts.filter(a => a.type === 'investment' || a.type === 'retirement').reduce((s, a) => s + a.balance, 0);
    const propertyEquity = accounts.filter(a => a.type === 'property').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    // Debts (credit cards, loans, etc. from Debts page)
    const debts = store.getDebts();
    // Exclude linked debts — their balances are already counted via accounts (creditOwed, propertyEquity)
    const unlinkedDebtBalance = debts.filter(d => !d.linkedAccountId).reduce((s, d) => s + (d.currentBalance || 0), 0);
    const totalDebtBalance = debts.reduce((s, d) => s + (d.currentBalance || 0), 0);

    const netBalance = cashTotal + investmentTotal + propertyEquity - creditOwed - unlinkedDebtBalance;

    // Credit scores
    const creditScores = store.getCreditScores();
    const userScore = creditScores.user ? creditScores.user.score : null;
    const userRating = userScore ? getScoreRating(userScore) : null;
    const dependentScore = depEnabled && creditScores.dependent ? creditScores.dependent.score : null;
    const dependentRating = dependentScore ? getScoreRating(dependentScore) : null;

    // Upcoming bills
    const upcoming = getUpcomingBills(bills, store, 7);

    // Pay period breakdown
    const payPeriods = buildPayPeriods(payDates, bills, store, income, year, month, depCoveredBills, otherIncome);

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Dashboard</h2>
                <div class="subtitle">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
            </div>
        </div>

        <div class="card-grid">
            <div class="stat-card green">
                <div class="label">Monthly Income</div>
                <div class="value">${formatCurrency(userMonthlyIncome)}</div>
                <div class="sub">${formatCurrency(userPayMonthly)} pay${otherIncomeMonthly > 0 ? ` + ${formatCurrency(otherIncomeMonthly)} other` : ''}${depMonthlyPay > 0 ? ` + ${formatCurrency(depMonthlyPay)} ${escapeHtml(depName)}` : ''}</div>
            </div>
            <div class="stat-card red">
                <div class="label">Total Bills</div>
                <div class="value">${formatCurrency(totalBills + depCoverageTotal)}</div>
                <div class="sub">${userMonthlyIncome > 0 ? `${((totalBills + depCoverageTotal) / userMonthlyIncome * 100).toFixed(1)}% of income` : `${bills.filter(b => !b.frozen).length} active bills`}${depEnabled && depCoverageTotal > 0 ? ` &middot; ${depCoveredBills.length} covering ${escapeHtml(depName)}` : ''}</div>
            </div>
            <div class="stat-card ${remaining >= 0 ? 'blue' : 'orange'}">
                <div class="label">Remaining</div>
                <div class="value">${formatCurrency(remaining)}</div>
                <div class="sub">${userMonthlyIncome > 0 ? `${(remaining / userMonthlyIncome * 100).toFixed(1)}% of income` : 'After all bills'}</div>
            </div>
            ${depEnabled ? `
            <div class="stat-card purple">
                <div class="label">Covering ${escapeHtml(depName)}</div>
                <div class="value">${formatCurrency(depCoverageTotal)}</div>
                <div class="sub">${depCoveredBills.length} of ${dependentBills.length} bills</div>
            </div>
            ` : ''}
            ${accounts.filter(a => a.type === 'checking' || a.type === 'savings').length > 0 ? `
            <div class="stat-card ${cashTotal >= 0 ? 'green' : 'red'}">
                <div class="label">Bank Balance</div>
                <div class="value">${formatCurrency(cashTotal)}</div>
                <div class="sub">${accounts.filter(a => a.type === 'checking' || a.type === 'savings').length} account${accounts.filter(a => a.type === 'checking' || a.type === 'savings').length !== 1 ? 's' : ''} tracked</div>
            </div>
            ` : ''}
            ${investmentTotal > 0 ? `
            <div class="stat-card green">
                <div class="label">Investments</div>
                <div class="value">${formatCurrency(investmentTotal)}</div>
                <div class="sub">${accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length} account${accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length !== 1 ? 's' : ''}</div>
            </div>
            ` : ''}
            ${accounts.filter(a => a.type === 'property').length > 0 ? `
            <div class="stat-card ${propertyEquity >= 0 ? 'green' : 'red'}">
                <div class="label">Property Equity</div>
                <div class="value">${formatCurrency(propertyEquity)}</div>
                <div class="sub">${accounts.filter(a => a.type === 'property').map(a => escapeHtml(a.name)).join(', ')}</div>
            </div>
            ` : ''}
            ${accounts.length > 0 || debts.length > 0 ? `
            <div class="stat-card ${netBalance >= 0 ? 'blue' : 'red'}">
                <div class="label">Net Worth</div>
                <div class="value">${formatCurrency(netBalance)}</div>
                <div class="sub">${(() => {
                    const parts = [];
                    if (cashTotal > 0) parts.push(formatCurrency(cashTotal) + ' cash');
                    if (investmentTotal > 0) parts.push(formatCurrency(investmentTotal) + ' invested');
                    if (propertyEquity !== 0) parts.push(formatCurrency(Math.abs(propertyEquity)) + ' equity');
                    if (creditOwed > 0) parts.push(formatCurrency(creditOwed) + ' credit owed');
                    if (unlinkedDebtBalance > 0) parts.push(formatCurrency(unlinkedDebtBalance) + ' debt');
                    return parts.length > 0 ? parts.join(' &middot; ') : 'No assets or debts tracked';
                })()}</div>
            </div>
            ` : ''}
            ${userScore ? `
            <div class="stat-card">
                <div class="label">${escapeHtml(userName)}'s Credit Score</div>
                <div class="value" style="color:${userRating.color};">${userScore}</div>
                <div class="sub">${userRating.label}</div>
            </div>
            ` : ''}
            ${dependentScore ? `
            <div class="stat-card">
                <div class="label">${escapeHtml(depName)}'s Credit Score</div>
                <div class="value" style="color:${dependentRating.color};">${dependentScore}</div>
                <div class="sub">${dependentRating.label}</div>
            </div>
            ` : ''}
        </div>

        ${payPeriods.length > 0 ? (() => {
            // Find current period index
            let currentIdx = payPeriods.findIndex(p => p.isCurrent);
            if (currentIdx === -1) currentIdx = 0;
            const startIdx = Math.max(0, Math.min(currentIdx + periodOffset, payPeriods.length - 1));
            const visiblePeriods = payPeriods.slice(startIdx, startIdx + 2);
            const canGoPrev = startIdx > 0;
            const canGoNext = startIdx + 2 < payPeriods.length;
            const showingCurrent = periodOffset === 0;
            return `
        <div class="card mb-24">
            <div class="flex-between mb-16">
                <h3>Pay Period Breakdown</h3>
                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="btn-icon" id="period-prev" ${!canGoPrev ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    ${!showingCurrent ? '<button class="btn btn-secondary btn-sm" id="period-today" style="font-size:11px;padding:2px 8px;">Current</button>' : ''}
                    <button class="btn-icon" id="period-next" ${!canGoNext ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
                ${visiblePeriods.map((period) => {
                    const availableClass = period.available >= 0 ? 'text-green' : 'text-red';
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
                                    <div class="${availableClass}" style="font-size:20px;font-weight:700;">${formatCurrency(period.available)}</div>
                                    <div style="font-size:11px;color:var(--text-secondary);">available</div>
                                </div>
                            </div>
                            <div style="background:var(--bg-input);border-radius:8px;height:8px;overflow:hidden;margin-bottom:12px;">
                                <div style="height:100%;width:${Math.min(100, period.billsTotal > 0 ? (period.billsTotal / (income.user.payAmount + period.otherIncomeTotal) * 100) : 0)}%;background:${period.available >= 0 ? 'var(--accent)' : 'var(--red)'};border-radius:8px;"></div>
                            </div>
                            <div class="flex-between" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
                                <span>Income: <strong class="text-green">${formatCurrency(income.user.payAmount)}${period.otherIncomeTotal > 0 ? ` + ${formatCurrency(period.otherIncomeTotal)}` : ''}</strong></span>
                                <span>Bills: <strong class="text-red">${formatCurrency(period.billsTotal)}</strong></span>
                            </div>
                            ${period.income.length > 0 ? `
                            <div style="border-top:1px solid var(--border);padding-top:8px;margin-bottom:4px;">
                                ${period.income.map(inc => `
                                    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;color:var(--green);">
                                        <span>${escapeHtml(inc.name)} <span class="text-muted">(${inc.payDay}${getOrdinal(inc.payDay)})</span></span>
                                        <span class="font-bold">+${formatCurrency(inc.amount)}</span>
                                    </div>
                                `).join('')}
                            </div>
                            ` : ''}
                            ${period.bills.length > 0 ? `
                            <div style="border-top:1px solid var(--border);padding-top:8px;">
                                ${period.bills.map(bill => {
                                    const isPaid = !bill._virtual && store.isBillPaid(bill.id, year, month);
                                    const isVirtual = bill._virtual;
                                    const isExcluded = bill.excludeFromTotal;
                                    return `
                                        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;${isPaid ? 'opacity:0.4;text-decoration:line-through;' : ''}${isVirtual ? 'color:var(--purple);' : ''}${isExcluded ? 'opacity:0.45;' : ''}">
                                            <span>${escapeHtml(bill.name)} <span class="text-muted">(${bill.dueDay}${getOrdinal(bill.dueDay)})</span>${isExcluded ? ' <span style="font-size:9px;color:var(--yellow);">EXCL</span>' : ''}</span>
                                            <span class="font-bold">${formatCurrency(bill.amount)}</span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                            ` : '<div style="font-size:12px;color:var(--text-muted);padding-top:4px;">No bills due this period</div>'}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        `;
        })() : `
        <div class="card mb-24" style="border-color:var(--yellow);">
            <div class="flex-between">
                <div>
                    <h3 class="text-yellow">Set Up Pay Dates</h3>
                    <p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                        Go to <strong>Settings</strong> and add your pay dates to see a breakdown of available money between each payday.
                    </p>
                </div>
            </div>
        </div>
        `}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="card">
                <div class="flex-between mb-16">
                    <h3>Monthly Progress</h3>
                    <span class="text-muted" style="font-size:13px;">${paidBills.length}/${bills.filter(b => !b.frozen).length} paid</span>
                </div>
                <div style="background: var(--bg-input); border-radius: 8px; height: 12px; overflow: hidden; margin-bottom: 12px;">
                    <div style="height: 100%; width: ${(totalBills + depCoverageTotal) > 0 ? (paidTotal / (totalBills + depCoverageTotal) * 100) : 0}%; background: var(--green); border-radius: 8px; transition: width 0.3s;"></div>
                </div>
                <div class="flex-between">
                    <span class="text-green" style="font-size:13px;font-weight:600;">Paid: ${formatCurrency(paidTotal)}</span>
                    <span class="text-red" style="font-size:13px;font-weight:600;">Remaining: ${formatCurrency(unpaidTotal + depCoverageTotal)}</span>
                </div>
            </div>

            <div class="card">
                <h3 class="mb-16">Upcoming Bills (Next 7 Days)</h3>
                <div class="upcoming-list">
                    ${upcoming.length === 0 ? '<div class="text-muted" style="padding:12px;font-size:13px;">No upcoming bills in the next 7 days</div>' : ''}
                    ${upcoming.map(bill => `
                        <div class="upcoming-item ${bill.isOverdue ? 'overdue' : ''} ${bill.isDueSoon ? 'due-soon' : ''}">
                            <div>
                                <div class="bill-name">${escapeHtml(bill.name)}</div>
                                <div class="bill-due">
                                    ${bill.daysUntil < 0 ? `<span class="text-red">Overdue by ${Math.abs(bill.daysUntil)} day${Math.abs(bill.daysUntil) !== 1 ? 's' : ''}</span>` :
                                      bill.daysUntil === 0 ? '<span class="text-orange">Due today</span>' :
                                      `Due in ${bill.daysUntil} day${bill.daysUntil !== 1 ? 's' : ''}`}
                                    &middot; ${escapeHtml(bill.paymentSource || 'No source')}
                                </div>
                            </div>
                            <div class="bill-amount">${formatCurrency(bill.amount)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        ${(() => {
            const categoryTotals = {};
            bills.filter(b => !b.frozen && !b.excludeFromTotal).forEach(bill => {
                const cat = bill.category || 'Uncategorized';
                if (!categoryTotals[cat]) categoryTotals[cat] = { total: 0, count: 0, paid: 0 };
                let amt = bill.amount;
                if (bill.frequency === 'per-paycheck') amt = bill.amount * 2;
                else if (bill.frequency === 'weekly') amt = bill.amount * 4;
                else if (bill.frequency === 'biweekly') amt = bill.amount * 2;
                else if (bill.frequency === 'yearly') amt = bill.dueMonth === month ? bill.amount : 0;
                else if (bill.frequency === 'semi-annual') {
                    const secondMonth = (bill.dueMonth + 6) % 12;
                    amt = (bill.dueMonth === month || secondMonth === month) ? bill.amount : 0;
                }
                if (amt > 0) {
                    categoryTotals[cat].total += amt;
                    categoryTotals[cat].count++;
                    if (store.isBillPaid(bill.id, year, month)) {
                        categoryTotals[cat].paid += amt;
                    }
                }
            });
            const sorted = Object.entries(categoryTotals).sort((a, b) => b[1].total - a[1].total);
            if (sorted.length === 0) return '';
            const maxTotal = sorted[0][1].total;
            const categoryColors = {
                'Mortgage': 'var(--blue, #4f8cff)',
                'Housing': 'var(--accent, #4f8cff)',
                'Necessity': 'var(--green, #34d399)',
                'Credit Card': 'var(--red, #f87171)',
                'Subscription': 'var(--purple, #a78bfa)',
                'Car': 'var(--orange, #fb923c)',
                'Insurance': 'var(--yellow, #fbbf24)',
                'Utilities': 'var(--teal, #2dd4bf)',
                'INTERNET': 'var(--cyan, #22d3ee)',
                'Storage': 'var(--text-secondary, #94a3b8)'
            };
            return `
        <div class="card mt-16">
            <h3 class="mb-16">Spending by Category</h3>
            <div style="display:flex;flex-direction:column;gap:10px;">
                ${sorted.map(([cat, data]) => {
                    const pct = maxTotal > 0 ? (data.total / maxTotal * 100) : 0;
                    const incomePct = userMonthlyIncome > 0 ? (data.total / userMonthlyIncome * 100).toFixed(1) : '0';
                    const barColor = categoryColors[cat] || 'var(--accent, #4f8cff)';
                    return `
                    <div>
                        <div class="flex-between" style="margin-bottom:4px;">
                            <span style="font-size:13px;font-weight:600;">${escapeHtml(cat)}</span>
                            <span style="font-size:13px;font-weight:700;">${formatCurrency(data.total)} <span class="text-muted" style="font-weight:400;font-size:11px;">(${incomePct}%)</span></span>
                        </div>
                        <div style="background:var(--bg-input);border-radius:6px;height:8px;overflow:hidden;">
                            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;transition:width 0.3s;"></div>
                        </div>
                        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${data.count} bill${data.count !== 1 ? 's' : ''} &middot; ${formatCurrency(data.paid)} paid</div>
                    </div>`;
                }).join('')}
            </div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
                <div class="flex-between" style="font-size:13px;">
                    <span style="font-weight:600;">Total Monthly Spending</span>
                    <span style="font-weight:700;">${formatCurrency(totalBills + depCoverageTotal)}${userMonthlyIncome > 0 ? ` <span class="text-muted" style="font-weight:400;font-size:11px;">(${((totalBills + depCoverageTotal) / userMonthlyIncome * 100).toFixed(1)}% of income)</span>` : ''}</span>
                </div>
            </div>
        </div>`;
        })()}

        ${depEnabled && !income.dependent.employed ? `
        <div class="card mt-16" style="border-color: var(--orange);">
            <div class="flex-between mb-16">
                <h3 class="text-orange">${escapeHtml(depName)} Coverage Alert</h3>
            </div>
            <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
                ${escapeHtml(depName)} is currently marked as unemployed. You are covering ${depCoveredBills.length} of their bills totaling
                <strong class="text-orange">${formatCurrency(depCoverageTotal)}</strong>/month.
            </p>
            <p style="font-size:13px;color:var(--text-secondary);">
                ${escapeHtml(depName)}'s total bills: <strong>${formatCurrency(dependentBills.reduce((s, b) => s + b.amount, 0))}</strong> &middot;
                Full income when employed: <strong>${formatCurrency(income.dependent.payAmount)}</strong>
            </p>
        </div>
        ` : ''}

        <div class="card mt-16">
            <h3 class="mb-16">Bills by Payment Source</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
                ${getPaymentSourceBreakdown(bills, store, year, month)}
            </div>
        </div>

        ${renderSavingsGoals(store)}
    `;

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
}

function buildPayPeriods(payDates, bills, store, income, year, month, coveredDepBills = [], otherIncomeSources = []) {
    if (!payDates || payDates.length === 0) return [];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeBills = bills.filter(b => !b.frozen && b.amount > 0);
    const regularBills = activeBills.filter(b =>
        b.frequency !== 'per-paycheck' && b.frequency !== 'weekly' && b.frequency !== 'biweekly'
    );
    const perPaycheckBills = activeBills.filter(b => b.frequency === 'per-paycheck');
    const weeklyBills = activeBills.filter(b => b.frequency === 'weekly');
    const biweeklyBills = activeBills.filter(b => b.frequency === 'biweekly');

    // payDates are already Date objects from store.getPayDates()
    const sorted = [...payDates].sort((a, b) => a - b);

    // Pre-compute which months have 3 paychecks for per-paycheck bill logic
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
            ? new Date(sorted[i + 1].getTime() - 24 * 60 * 60 * 1000) // day before next payday
            : new Date(periodStart.getTime() + 13 * 24 * 60 * 60 * 1000); // assume 14-day period if no next date

        // Find regular bills due in this period (by day of month falling between start and end)
        const periodBills = [];
        const startMonth = periodStart.getMonth();
        const startYear = periodStart.getFullYear();

        regularBills.forEach(bill => {
            // For yearly/semi-annual bills, only show in their due month(s)
            if (bill.frequency === 'yearly' && bill.dueMonth != null) {
                const dueDate = new Date(startYear, bill.dueMonth, bill.dueDay);
                // Also check if it falls in the next year's occurrence
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
                // Check next year too for wrap-around
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

        // Add per-paycheck bills (e.g. Child Support)
        // On 3-check months, only include on first and last check of that month
        perPaycheckBills.forEach(bill => {
            const monthKey = `${periodStart.getFullYear()}-${periodStart.getMonth()}`;
            const monthPaychecks = paychecksPerMonth[monthKey] || [];
            if (monthPaychecks.length >= 3) {
                // Only first and last paycheck of this month
                const first = Math.min(...monthPaychecks);
                const last = Math.max(...monthPaychecks);
                if (periodStart.getTime() === first || periodStart.getTime() === last) {
                    periodBills.push(bill);
                }
            } else {
                // 2 or fewer checks this month — include on all
                periodBills.push(bill);
            }
        });

        // Add weekly bills - they occur every week, so always show in every pay period
        // For a ~2 week pay period, show the bill once (represents ~2 occurrences)
        weeklyBills.forEach(bill => {
            periodBills.push(bill);
        });

        // Add biweekly bills - they occur every other week
        // Show in every pay period (roughly aligns with biweekly paychecks)
        biweeklyBills.forEach(bill => {
            periodBills.push(bill);
        });

        // Add covered dependent bills as virtual line items by their individual due dates
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

        // Find other income sources that land in this period
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

        // Sort bills by due day, income by pay day
        periodBills.sort((a, b) => (a.dueDay || 0) - (b.dueDay || 0));
        periodIncome.sort((a, b) => (a.payDay || 0) - (b.payDay || 0));

        const billsTotal = periodBills.reduce((s, b) => s + (b.excludeFromTotal ? 0 : b.amount), 0);
        const otherIncomeTotal = periodIncome.reduce((s, i) => s + i.amount, 0);
        const available = income.user.payAmount + otherIncomeTotal - billsTotal;

        // Is this the current period?
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

    return Object.entries(sources).map(([name, data]) => `
        <div style="background:var(--bg-secondary);padding:12px 14px;border-radius:var(--radius-sm);border:1px solid var(--border);">
            <div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:4px;">${escapeHtml(name)}</div>
            <div style="font-size:18px;font-weight:700;">${formatCurrency(data.total)}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${data.count} bills &middot; ${formatCurrency(data.paid)} paid</div>
        </div>
    `).join('');
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
        return `
        <div class="card mt-16">
            <div class="flex-between mb-16">
                <h3>Savings Goals</h3>
                <button class="btn btn-primary btn-sm" id="add-goal-btn">+ Add Goal</button>
            </div>
            <div style="text-align:center;padding:32px 16px;">
                <div style="font-size:48px;margin-bottom:12px;">🎯</div>
                <div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">No savings goals yet</div>
                <div style="font-size:12px;color:var(--text-muted);max-width:300px;margin:0 auto;">
                    Set goals to track your progress toward financial milestones like an emergency fund, vacation, or home purchase.
                </div>
            </div>
        </div>`;
    }

    // Calculate totals
    const totalTarget = goals.reduce((s, g) => s + (g.targetAmount || 0), 0);
    const totalCurrent = goals.reduce((s, g) => s + (g.currentAmount || 0), 0);
    const overallProgress = totalTarget > 0 ? (totalCurrent / totalTarget * 100) : 0;

    return `
    <div class="card mt-16">
        <div class="flex-between mb-16">
            <h3>Savings Goals</h3>
            <button class="btn btn-primary btn-sm" id="add-goal-btn">+ Add Goal</button>
        </div>

        <!-- Summary bar -->
        <div style="background:var(--bg-secondary);padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:16px;">
            <div class="flex-between" style="margin-bottom:8px;">
                <span style="font-size:12px;color:var(--text-muted);">Overall Progress</span>
                <span style="font-size:13px;font-weight:600;">${formatCurrency(totalCurrent)} of ${formatCurrency(totalTarget)}</span>
            </div>
            <div style="background:var(--bg-input);border-radius:8px;height:8px;overflow:hidden;">
                <div style="height:100%;width:${Math.min(100, overallProgress)}%;background:${overallProgress >= 100 ? 'var(--green)' : 'var(--accent)'};border-radius:8px;transition:width 0.3s;"></div>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${overallProgress.toFixed(1)}% complete</div>
        </div>

        <!-- Individual goals -->
        <div style="display:flex;flex-direction:column;gap:12px;">
            ${goals.map(goal => {
                const progress = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
                const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
                const categoryInfo = getGoalCategoryInfo(goal.category);
                const isComplete = progress >= 100;

                return `
                <div class="goal-card" data-goal-id="${goal.id}" style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius-sm);border:1px solid var(--border);cursor:pointer;transition:border-color 0.2s;">
                    <div class="flex-between" style="margin-bottom:12px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="font-size:24px;">${categoryInfo.icon}</div>
                            <div>
                                <div style="font-size:14px;font-weight:600;">${escapeHtml(goal.name)}</div>
                                <div style="font-size:11px;color:var(--text-muted);">${categoryInfo.label}</div>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:16px;font-weight:700;${isComplete ? 'color:var(--green);' : ''}">${formatCurrency(goal.currentAmount)}</div>
                            <div style="font-size:11px;color:var(--text-muted);">of ${formatCurrency(goal.targetAmount)}</div>
                        </div>
                    </div>
                    <div style="background:var(--bg-input);border-radius:6px;height:8px;overflow:hidden;margin-bottom:8px;">
                        <div style="height:100%;width:${progress}%;background:${isComplete ? 'var(--green)' : 'var(--accent)'};border-radius:6px;transition:width 0.3s;"></div>
                    </div>
                    <div class="flex-between" style="font-size:11px;">
                        <span style="color:var(--text-muted);">${progress.toFixed(0)}% complete</span>
                        ${isComplete
                            ? '<span style="color:var(--green);font-weight:600;">Goal reached! 🎉</span>'
                            : `<span style="color:var(--text-secondary);">${formatCurrency(remaining)} to go</span>`
                        }
                    </div>
                    ${goal.targetDate ? `
                    <div style="font-size:10px;color:var(--text-muted);margin-top:6px;">
                        Target: ${new Date(goal.targetDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </div>` : ''}
                </div>`;
            }).join('')}
        </div>

        <div style="font-size:11px;color:var(--text-muted);margin-top:12px;text-align:center;">
            Click a goal to edit or delete
        </div>
    </div>`;
}

function setupSavingsGoalHandlers(container, store) {
    // Add goal button
    const addBtn = container.querySelector('#add-goal-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openGoalModal(store, null));
    }

    // Click on goal cards to edit
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

    openModal(title, `
        <div class="form-group">
            <label>Goal Name</label>
            <input type="text" class="form-input" id="goal-name" placeholder="e.g., Emergency Fund" value="${isEdit ? escapeHtml(existingGoal.name) : ''}">
        </div>
        <div class="form-group">
            <label>Category</label>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px;">
                ${GOAL_CATEGORIES.map(cat => `
                    <label style="display:flex;flex-direction:column;align-items:center;padding:10px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;text-align:center;${isEdit && existingGoal.category === cat.value ? 'border-color:var(--accent);background:rgba(79,140,255,0.1);' : ''}">
                        <input type="radio" name="goal-category" value="${cat.value}" ${(!isEdit && cat.value === 'other') || (isEdit && existingGoal.category === cat.value) ? 'checked' : ''} style="display:none;">
                        <span style="font-size:20px;margin-bottom:4px;">${cat.icon}</span>
                        <span style="font-size:10px;color:var(--text-secondary);">${cat.label}</span>
                    </label>
                `).join('')}
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
                <label>Target Amount</label>
                <input type="number" class="form-input" id="goal-target" placeholder="10000" min="0" step="0.01" value="${isEdit ? existingGoal.targetAmount : ''}">
            </div>
            <div class="form-group">
                <label>Current Amount</label>
                <input type="number" class="form-input" id="goal-current" placeholder="0" min="0" step="0.01" value="${isEdit ? existingGoal.currentAmount : ''}">
            </div>
        </div>
        <div class="form-group">
            <label>Target Date (optional)</label>
            <input type="month" class="form-input" id="goal-date" value="${isEdit && existingGoal.targetDate ? existingGoal.targetDate.slice(0, 7) : ''}">
        </div>
        <div class="modal-actions">
            ${isEdit ? '<button class="btn btn-danger" id="modal-delete" style="margin-right:auto;">Delete</button>' : ''}
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Save Changes' : 'Add Goal'}</button>
        </div>
        <style>
            .form-group label:has(input[type="radio"]:checked) {
                border-color: var(--accent) !important;
                background: rgba(79, 140, 255, 0.1);
            }
        </style>
    `);

    // Category selection styling
    document.querySelectorAll('input[name="goal-category"]').forEach(radio => {
        radio.addEventListener('change', () => {
            document.querySelectorAll('input[name="goal-category"]').forEach(r => {
                r.parentElement.style.borderColor = 'var(--border)';
                r.parentElement.style.background = 'transparent';
            });
            if (radio.checked) {
                radio.parentElement.style.borderColor = 'var(--accent)';
                radio.parentElement.style.background = 'rgba(79, 140, 255, 0.1)';
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

        if (!name) {
            alert('Please enter a goal name');
            return;
        }
        if (targetAmount <= 0) {
            alert('Please enter a target amount greater than 0');
            return;
        }

        if (isEdit) {
            store.updateSavingsGoal(existingGoal.id, {
                name,
                category,
                targetAmount,
                currentAmount,
                targetDate
            });
        } else {
            store.addSavingsGoal({
                name,
                category,
                targetAmount,
                currentAmount,
                targetDate
            });
        }

        closeModal();
        refreshPage();
    });

    // Delete handler
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
