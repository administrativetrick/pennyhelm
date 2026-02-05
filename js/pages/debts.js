import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';

const DEBT_TYPES = {
    'credit-card': { label: 'Credit Card', color: 'var(--red)' },
    'student-loan': { label: 'Student Loan', color: 'var(--blue)' },
    'auto-loan': { label: 'Auto Loan', color: 'var(--orange)' },
    'mortgage': { label: 'Mortgage', color: 'var(--green)' },
    'personal-loan': { label: 'Personal Loan', color: 'var(--accent)' },
    'medical': { label: 'Medical', color: 'var(--pink, #ec4899)' },
    'other': { label: 'Other', color: 'var(--text-secondary)' }
};

function getDebtTypeLabel(type) {
    return DEBT_TYPES[type]?.label || 'Other';
}

function getDebtTypeBadge(type) {
    const t = DEBT_TYPES[type] || DEBT_TYPES['other'];
    return `<span class="badge" style="background:${t.color}20;color:${t.color};border:1px solid ${t.color}40;">${t.label}</span>`;
}

function calculateWeightedAPR(debts) {
    if (debts.length === 0) return 0;
    const totalBalance = debts.reduce((sum, d) => sum + d.currentBalance, 0);
    if (totalBalance === 0) return 0;
    const weighted = debts.reduce((sum, d) => sum + (d.interestRate * d.currentBalance), 0);
    return weighted / totalBalance;
}

function calculatePayoffStrategy(debts, monthlyBudget, strategy) {
    if (debts.length === 0 || monthlyBudget <= 0) {
        return { monthsToPayoff: 0, totalInterestPaid: 0, timeline: [], payoffOrder: [] };
    }

    // Clone debts for simulation
    let balances = debts.map(d => ({
        id: d.id,
        name: d.name,
        balance: d.currentBalance,
        rate: d.interestRate / 100 / 12, // monthly rate
        minPayment: d.minimumPayment
    }));

    // Sort by strategy
    if (strategy === 'avalanche') {
        balances.sort((a, b) => b.rate - a.rate); // highest rate first
    } else {
        balances.sort((a, b) => a.balance - b.balance); // lowest balance first
    }

    const totalMinimum = balances.reduce((sum, d) => sum + d.minPayment, 0);
    if (monthlyBudget < totalMinimum) {
        // Can't even cover minimums
        return { monthsToPayoff: Infinity, totalInterestPaid: Infinity, timeline: [], payoffOrder: [] };
    }

    let months = 0;
    let totalInterest = 0;
    const timeline = [];
    const payoffOrder = [];
    const maxMonths = 600; // 50 years cap

    while (balances.some(d => d.balance > 0.01) && months < maxMonths) {
        months++;
        let extraPayment = monthlyBudget;
        let monthInterest = 0;

        // Apply interest to all
        balances.forEach(d => {
            if (d.balance > 0) {
                const interest = d.balance * d.rate;
                d.balance += interest;
                monthInterest += interest;
            }
        });
        totalInterest += monthInterest;

        // Pay minimums on all active debts
        balances.forEach(d => {
            if (d.balance > 0) {
                const payment = Math.min(d.minPayment, d.balance);
                d.balance -= payment;
                extraPayment -= payment;
            }
        });

        // Apply extra to target debt (first in sorted list with balance)
        for (const d of balances) {
            if (d.balance > 0 && extraPayment > 0) {
                const payment = Math.min(extraPayment, d.balance);
                d.balance -= payment;
                extraPayment -= payment;
                if (d.balance <= 0.01) {
                    d.balance = 0;
                    payoffOrder.push(d.name);
                }
                break;
            }
        }

        // Record timeline every month for first 12 months
        if (months <= 12) {
            timeline.push({
                month: months,
                totalRemaining: balances.reduce((sum, d) => sum + d.balance, 0)
            });
        }
    }

    return {
        monthsToPayoff: months >= maxMonths ? Infinity : months,
        totalInterestPaid: totalInterest,
        timeline,
        payoffOrder
    };
}

function formatMonths(months) {
    if (months === Infinity || months >= 600) return 'Never';
    if (months === 0) return 'Paid off';
    const years = Math.floor(months / 12);
    const remaining = months % 12;
    if (years === 0) return `${months} months`;
    if (remaining === 0) return `${years} year${years > 1 ? 's' : ''}`;
    return `${years}y ${remaining}m`;
}

function getDebtFreeDate(months) {
    if (months === Infinity || months >= 600) return 'Never';
    if (months === 0) return 'Today';
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function renderDebts(container, store) {
    const debts = store.getDebts();
    const bills = store.getBills();
    const budget = store.getDebtBudget();

    const totalDebt = debts.reduce((sum, d) => sum + d.currentBalance, 0);
    const totalMinimum = debts.reduce((sum, d) => sum + d.minimumPayment, 0);
    const avgAPR = calculateWeightedAPR(debts);

    const avalancheResult = calculatePayoffStrategy(debts, budget.totalMonthlyBudget, 'avalanche');
    const snowballResult = calculatePayoffStrategy(debts, budget.totalMonthlyBudget, 'snowball');
    const activeResult = budget.strategy === 'avalanche' ? avalancheResult : snowballResult;

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Debts</h2>
                <div class="subtitle">${debts.length} debt${debts.length !== 1 ? 's' : ''} &middot; ${formatCurrency(totalDebt)} total</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" id="set-budget-btn">Set Budget</button>
                <button class="btn btn-primary" id="add-debt-btn">+ Add Debt</button>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Debt</div>
                <div class="stat-value" style="color:var(--red);">${formatCurrency(totalDebt)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Monthly Minimum</div>
                <div class="stat-value">${formatCurrency(totalMinimum)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Avg APR</div>
                <div class="stat-value">${avgAPR.toFixed(1)}%</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Debt-Free Date</div>
                <div class="stat-value" style="color:var(--green);">${getDebtFreeDate(activeResult.monthsToPayoff)}</div>
            </div>
        </div>

        ${debts.length > 0 && budget.totalMonthlyBudget > 0 ? `
            <div class="card" style="margin-top:24px;">
                <h3 style="margin-bottom:16px;">Strategy Comparison</h3>
                <div class="subtitle" style="margin-bottom:16px;">Monthly Budget: ${formatCurrency(budget.totalMonthlyBudget)}${budget.totalMonthlyBudget < totalMinimum ? ` <span class="text-red" style="font-size:12px;">(below ${formatCurrency(totalMinimum)} minimum — increase budget to see payoff timeline)</span>` : ''}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
                    <div class="card" style="border:2px solid ${budget.strategy === 'avalanche' ? 'var(--accent)' : 'var(--border)'};">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                            <h4 style="margin:0;">Avalanche</h4>
                            ${budget.strategy === 'avalanche' ? '<span class="badge" style="background:var(--accent);color:white;">Active</span>' : ''}
                        </div>
                        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">Pay highest interest first</div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span>Time to payoff:</span>
                            <strong>${formatMonths(avalancheResult.monthsToPayoff)}</strong>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                            <span>Total interest:</span>
                            <strong style="color:var(--red);">${avalancheResult.totalInterestPaid === Infinity ? 'N/A' : formatCurrency(avalancheResult.totalInterestPaid)}</strong>
                        </div>
                        ${avalancheResult.payoffOrder.length > 0 ? `
                            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Payoff order:</div>
                            <div style="font-size:12px;">${avalancheResult.payoffOrder.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('<br>')}</div>
                        ` : ''}
                        ${budget.strategy !== 'avalanche' ? `<button class="btn btn-sm btn-primary" style="margin-top:12px;width:100%;" id="switch-avalanche">Switch to Avalanche</button>` : ''}
                    </div>
                    <div class="card" style="border:2px solid ${budget.strategy === 'snowball' ? 'var(--accent)' : 'var(--border)'};">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                            <h4 style="margin:0;">Snowball</h4>
                            ${budget.strategy === 'snowball' ? '<span class="badge" style="background:var(--accent);color:white;">Active</span>' : ''}
                        </div>
                        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">Pay smallest balance first</div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span>Time to payoff:</span>
                            <strong>${formatMonths(snowballResult.monthsToPayoff)}</strong>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                            <span>Total interest:</span>
                            <strong style="color:var(--red);">${snowballResult.totalInterestPaid === Infinity ? 'N/A' : formatCurrency(snowballResult.totalInterestPaid)}</strong>
                        </div>
                        ${snowballResult.payoffOrder.length > 0 ? `
                            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Payoff order:</div>
                            <div style="font-size:12px;">${snowballResult.payoffOrder.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('<br>')}</div>
                        ` : ''}
                        ${budget.strategy !== 'snowball' ? `<button class="btn btn-sm btn-primary" style="margin-top:12px;width:100%;" id="switch-snowball">Switch to Snowball</button>` : ''}
                    </div>
                </div>
                ${avalancheResult.totalInterestPaid < snowballResult.totalInterestPaid ? `
                    <div style="margin-top:16px;padding:12px;background:var(--green)15;border-radius:8px;font-size:13px;">
                        Avalanche saves <strong>${formatCurrency(snowballResult.totalInterestPaid - avalancheResult.totalInterestPaid)}</strong> in interest
                    </div>
                ` : ''}
            </div>
        ` : ''}

        ${debts.length === 0 ? `
            <div class="card" style="text-align:center;padding:48px 24px;margin-top:24px;">
                <div style="font-size:48px;margin-bottom:16px;">&#128176;</div>
                <h3 style="margin-bottom:8px;">No debts tracked</h3>
                <p style="color:var(--text-muted);margin-bottom:24px;">Add your debts to start tracking your payoff progress</p>
                <button class="btn btn-primary" id="empty-add-debt">+ Add Your First Debt</button>
            </div>
        ` : `
            <div class="card" style="margin-top:24px;">
                <h3 style="margin-bottom:16px;">Your Debts</h3>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Balance</th>
                                <th>APR</th>
                                <th>Min Payment</th>
                                <th>Progress</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="debts-tbody">
                            ${debts.map(debt => {
                                const progress = debt.originalBalance > 0
                                    ? Math.max(0, Math.min(100, ((debt.originalBalance - debt.currentBalance) / debt.originalBalance) * 100))
                                    : 0;
                                const hasLinkedAccount = !!debt.linkedAccountId;
                                const hasLinkedBill = bills.some(b => b.linkedDebtId === debt.id);
                                const isLinked = hasLinkedAccount || hasLinkedBill;
                                const linkTitle = hasLinkedAccount && hasLinkedBill ? 'Linked to account & bill' : hasLinkedAccount ? 'Linked to account' : 'Linked to bill';
                                return `
                                    <tr>
                                        <td>
                                            <div style="font-weight:600;">
                                                ${escapeHtml(debt.name)}
                                                ${isLinked ? `<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;" title="${linkTitle}">&#128279; Linked</span>` : ''}
                                            </div>
                                            ${debt.notes ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(debt.notes)}</div>` : ''}
                                        </td>
                                        <td>
                                            ${getDebtTypeBadge(debt.type)}
                                            ${debt.chargeCard ? '<div style="font-size:10px;color:var(--orange);margin-top:2px;">Charge Card</div>' : ''}
                                        </td>
                                        <td class="font-bold" style="color:var(--red);">${formatCurrency(debt.currentBalance)}</td>
                                        <td>${debt.interestRate.toFixed(1)}%</td>
                                        <td>${formatCurrency(debt.minimumPayment)}${debt.chargeCard ? '<div style="font-size:10px;color:var(--orange);">Full balance</div>' : ''}</td>
                                        <td style="min-width:120px;">
                                            <div style="display:flex;align-items:center;gap:8px;">
                                                <div style="flex:1;height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden;">
                                                    <div style="width:${progress}%;height:100%;background:var(--green);transition:width 0.3s;"></div>
                                                </div>
                                                <span style="font-size:11px;color:var(--text-muted);min-width:35px;">${progress.toFixed(0)}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div style="display:flex;gap:4px;">
                                                <button class="btn-icon edit-debt" data-debt-id="${debt.id}" title="Edit">
                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                                </button>
                                                <button class="btn-icon delete-debt" data-debt-id="${debt.id}" title="Delete" style="color:var(--red);">
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
            </div>
        `}

        ${debts.length > 0 && activeResult.timeline.length > 0 ? `
            ${(() => {
                const tl = activeResult.timeline;
                const balances = tl.map(p => p.totalRemaining);
                const maxBal = Math.max(...balances);
                const minBal = Math.min(...balances);
                const range = maxBal - minBal;
                // Add 10% padding above and below so bars don't hit the edges
                const padding = range > 0 ? range * 0.1 : maxBal * 0.1;
                const scaleMin = Math.max(0, minBal - padding);
                const scaleMax = maxBal + padding;
                const scaleRange = scaleMax - scaleMin;
                return `
            <div class="card" style="margin-top:24px;">
                <h3 style="margin-bottom:16px;">12-Month Projection</h3>
                <div style="position:relative;height:180px;">
                    <div style="position:absolute;top:0;left:0;right:0;bottom:24px;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:10px;color:var(--text-muted);min-width:70px;text-align:right;">${formatCurrency(scaleMax)}</span>
                            <div style="flex:1;border-bottom:1px dashed var(--border);"></div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:10px;color:var(--text-muted);min-width:70px;text-align:right;">${formatCurrency(scaleMin + scaleRange / 2)}</span>
                            <div style="flex:1;border-bottom:1px dashed var(--border);"></div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:10px;color:var(--text-muted);min-width:70px;text-align:right;">${formatCurrency(scaleMin)}</span>
                            <div style="flex:1;border-bottom:1px dashed var(--border);"></div>
                        </div>
                    </div>
                    <div style="position:absolute;top:0;left:82px;right:0;bottom:0;display:flex;align-items:flex-end;gap:8px;padding-bottom:24px;">
                        ${tl.map((point, i) => {
                            const height = scaleRange > 0 ? ((point.totalRemaining - scaleMin) / scaleRange) * 100 : 50;
                            return `
                                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                                    <div style="width:100%;background:var(--accent);border-radius:4px 4px 0 0;height:${height}%;min-height:2px;transition:height 0.3s;opacity:${0.6 + (1 - i / tl.length) * 0.4};"></div>
                                    <span style="font-size:10px;color:var(--text-muted);">M${point.month}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:var(--text-muted);">
                    <span>Now: ${formatCurrency(totalDebt)}</span>
                    <span>Month 12: ${formatCurrency(tl[11]?.totalRemaining || 0)}</span>
                </div>
            </div>`;
            })()}
        ` : ''}
    `;

    // Event handlers
    container.querySelector('#add-debt-btn').addEventListener('click', () => showDebtForm(store));
    container.querySelector('#set-budget-btn').addEventListener('click', () => showBudgetForm(store, budget));

    const emptyAddBtn = container.querySelector('#empty-add-debt');
    if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => showDebtForm(store));
    }

    const switchAvalanche = container.querySelector('#switch-avalanche');
    if (switchAvalanche) {
        switchAvalanche.addEventListener('click', () => {
            store.updateDebtBudget({ strategy: 'avalanche' });
            refreshPage();
        });
    }

    const switchSnowball = container.querySelector('#switch-snowball');
    if (switchSnowball) {
        switchSnowball.addEventListener('click', () => {
            store.updateDebtBudget({ strategy: 'snowball' });
            refreshPage();
        });
    }

    // Edit/Delete handlers
    container.querySelectorAll('.edit-debt').forEach(btn => {
        btn.addEventListener('click', () => {
            const debt = debts.find(d => d.id === btn.dataset.debtId);
            if (debt) showDebtForm(store, debt);
        });
    });

    container.querySelectorAll('.delete-debt').forEach(btn => {
        btn.addEventListener('click', () => {
            const debt = debts.find(d => d.id === btn.dataset.debtId);
            const hasLinkedAccount = debt && debt.linkedAccountId;
            const hasLinkedBill = debt && bills.some(b => b.linkedDebtId === debt.id);
            let msg = 'Delete this debt?';
            if (hasLinkedAccount && hasLinkedBill) {
                msg = 'Delete this debt? This will also remove the linked account and payment bill.';
            } else if (hasLinkedAccount) {
                msg = 'Delete this debt? This will also remove the linked account.';
            } else if (hasLinkedBill) {
                msg = 'Delete this debt? This will also remove the linked payment bill.';
            }
            if (confirm(msg)) {
                store.deleteDebt(btn.dataset.debtId);
                refreshPage();
            }
        });
    });
}

function showDebtForm(store, existingDebt = null) {
    const isEdit = !!existingDebt;
    const debt = existingDebt || {
        name: '',
        type: 'credit-card',
        currentBalance: 0,
        originalBalance: 0,
        interestRate: 0,
        minimumPayment: 0,
        notes: ''
    };

    // Build account linking options
    const allAccounts = store.getAccounts();
    const currentLinkedAccount = isEdit && debt.linkedAccountId
        ? allAccounts.find(a => a.id === debt.linkedAccountId) : null;
    // Available accounts: unlinked, or the one already linked to THIS debt
    const availableAccounts = allAccounts.filter(a =>
        !a.linkedDebtId || (isEdit && a.linkedDebtId === debt.id)
    );
    // Build matching account type filter function
    const accountTypeForDebt = (debtType) => {
        if (debtType === 'credit-card') return 'credit';
        if (debtType === 'mortgage') return 'property';
        return null; // show all for other debt types
    };

    // Build bill linking options
    const allBills = store.getBills();
    const allDebts = store.getDebts();
    // Find the bill currently linked to this debt (if editing)
    const currentLinkedBill = isEdit ? allBills.find(b => b.linkedDebtId === debt.id) : null;
    // Available bills: unlinked bills, OR bills linked to THIS debt
    const availableBills = allBills.filter(b =>
        !b.linkedDebtId || (isEdit && b.linkedDebtId === debt.id)
    );

    // Helper: render account options filtered by debt type
    const renderAccountOptions = (debtType) => {
        const matchType = accountTypeForDebt(debtType);
        const filtered = matchType
            ? availableAccounts.filter(a => a.type === matchType)
            : availableAccounts;
        return filtered.map(a => {
            const typeLabel = { credit: 'Credit Card', property: 'Property', checking: 'Checking', savings: 'Savings', investment: 'Investment', retirement: 'Retirement' }[a.type] || a.type;
            const balanceStr = a.type === 'property'
                ? `${formatCurrency(a.balance)} value` + (a.amountOwed ? ` / ${formatCurrency(a.amountOwed)} owed` : '')
                : formatCurrency(a.balance);
            return `<option value="${a.id}" ${currentLinkedAccount && currentLinkedAccount.id === a.id ? 'selected' : ''}>${escapeHtml(a.name)} — ${balanceStr} (${typeLabel})</option>`;
        }).join('');
    };

    const autoLabel = debt.type === 'credit-card'
        ? 'Auto (create credit card account)'
        : 'None';
    const showAccountLink = debt.type === 'credit-card' || debt.type === 'mortgage' || currentLinkedAccount;

    const formHtml = `
        <div class="form-group">
            <label>Debt Name</label>
            <input type="text" class="form-input" id="debt-name" value="${escapeHtml(debt.name)}" placeholder="e.g., Chase Sapphire">
        </div>
        <div class="form-group">
            <label>Type</label>
            <select class="form-select" id="debt-type">
                ${Object.entries(DEBT_TYPES).map(([key, val]) =>
                    `<option value="${key}" ${debt.type === key ? 'selected' : ''}>${val.label}</option>`
                ).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Current Balance</label>
                <input type="number" class="form-input" id="debt-balance" step="0.01" value="${debt.currentBalance}">
            </div>
            <div class="form-group">
                <label>Original Balance</label>
                <input type="number" class="form-input" id="debt-original" step="0.01" value="${debt.originalBalance}" placeholder="For progress tracking">
            </div>
        </div>
        <div id="charge-card-group" style="display:${debt.type === 'credit-card' ? '' : 'none'};">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:12px;">
                <input type="checkbox" id="debt-charge-card" ${debt.chargeCard ? 'checked' : ''}>
                <span style="font-size:13px;">This is a Charge Card</span>
                <span style="font-size:11px;color:var(--text-muted);">(balance must be paid in full each month)</span>
            </label>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Interest Rate (APR %)</label>
                <input type="number" class="form-input" id="debt-rate" step="0.01" value="${debt.interestRate}">
            </div>
            <div class="form-group">
                <label>Minimum Payment</label>
                <input type="number" class="form-input" id="debt-min" step="0.01" value="${debt.chargeCard ? debt.currentBalance : debt.minimumPayment}" ${debt.chargeCard ? 'disabled' : ''}>
                <div id="charge-card-hint" style="font-size:11px;color:var(--accent);margin-top:4px;display:${debt.chargeCard ? '' : 'none'};">Set to full balance (charge card).</div>
            </div>
        </div>
        <div class="form-group" id="account-link-group" style="display:${showAccountLink ? '' : 'none'};">
            <label>Link to Account</label>
            <select class="form-select" id="debt-linked-account">
                <option value="auto"${!currentLinkedAccount ? ' selected' : ''}>${autoLabel}</option>
                <option value="none">None (no linked account)</option>
                ${renderAccountOptions(debt.type)}
            </select>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Link to an existing account so balances stay in sync.</div>
        </div>
        <div class="form-group">
            <label>Link to Bill</label>
            <select class="form-select" id="debt-linked-bill">
                <option value="auto"${!currentLinkedBill ? ' selected' : ''}>Auto (create/sync bill from min payment)</option>
                <option value="none">None (no linked bill)</option>
                ${availableBills.map(b => `<option value="${b.id}" ${currentLinkedBill && currentLinkedBill.id === b.id ? 'selected' : ''}>${escapeHtml(b.name)} — ${formatCurrency(b.amount)}${b.category ? ' (' + escapeHtml(b.category) + ')' : ''}</option>`).join('')}
            </select>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Link to an existing bill, or let the system auto-create one from the minimum payment.</div>
        </div>
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" class="form-input" id="debt-notes" value="${escapeHtml(debt.notes || '')}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Debt</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Debt' : 'Add New Debt', formHtml);

    // Dynamic: show/hide account link & update options when debt type changes
    const typeSelect = document.getElementById('debt-type');
    const accountLinkGroup = document.getElementById('account-link-group');
    const accountLinkSelect = document.getElementById('debt-linked-account');
    const chargeCardGroup = document.getElementById('charge-card-group');
    const chargeCardCheckbox = document.getElementById('debt-charge-card');
    const minPaymentInput = document.getElementById('debt-min');
    const balanceInput = document.getElementById('debt-balance');
    const chargeCardHint = document.getElementById('charge-card-hint');

    // Charge card toggle: set min payment = balance, disable input
    const updateChargeCard = () => {
        if (chargeCardCheckbox.checked) {
            minPaymentInput.value = balanceInput.value;
            minPaymentInput.disabled = true;
            chargeCardHint.style.display = '';
        } else {
            minPaymentInput.disabled = false;
            chargeCardHint.style.display = 'none';
        }
    };
    chargeCardCheckbox.addEventListener('change', updateChargeCard);
    // When balance changes and charge card is on, sync min payment
    balanceInput.addEventListener('input', () => {
        if (chargeCardCheckbox.checked) {
            minPaymentInput.value = balanceInput.value;
        }
    });

    typeSelect.addEventListener('change', () => {
        const newType = typeSelect.value;
        const shouldShow = newType === 'credit-card' || newType === 'mortgage';
        accountLinkGroup.style.display = shouldShow ? '' : 'none';
        // Show/hide charge card checkbox
        chargeCardGroup.style.display = newType === 'credit-card' ? '' : 'none';
        if (newType !== 'credit-card') {
            chargeCardCheckbox.checked = false;
            updateChargeCard();
        }
        if (shouldShow) {
            // Update auto label and rebuild options
            const newAutoLabel = newType === 'credit-card'
                ? 'Auto (create credit card account)' : 'None';
            accountLinkSelect.innerHTML =
                `<option value="auto" selected>${newAutoLabel}</option>` +
                `<option value="none">None (no linked account)</option>` +
                renderAccountOptions(newType);
        }
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const linkedBillValue = document.getElementById('debt-linked-bill').value;
        const linkedAccountValue = document.getElementById('debt-linked-account').value;
        const isChargeCard = chargeCardCheckbox.checked;
        const currentBalance = parseFloat(document.getElementById('debt-balance').value) || 0;
        const data = {
            name: document.getElementById('debt-name').value.trim(),
            type: document.getElementById('debt-type').value,
            currentBalance: currentBalance,
            originalBalance: parseFloat(document.getElementById('debt-original').value) || 0,
            interestRate: parseFloat(document.getElementById('debt-rate').value) || 0,
            minimumPayment: isChargeCard ? currentBalance : (parseFloat(document.getElementById('debt-min').value) || 0),
            chargeCard: isChargeCard,
            notes: document.getElementById('debt-notes').value.trim()
        };

        if (!data.name) {
            alert('Please enter a debt name');
            return;
        }

        // If original balance not set, use current balance
        if (data.originalBalance === 0 && data.currentBalance > 0) {
            data.originalBalance = data.currentBalance;
        }

        // Handle account linking via transient fields
        if (accountLinkGroup.style.display !== 'none') {
            if (linkedAccountValue === 'none') {
                data._unlinkAccount = true;
            } else if (linkedAccountValue !== 'auto') {
                data._linkedAccountId = linkedAccountValue;
            }
            // 'auto' = default behavior (sync engine auto-creates for credit-card, does nothing for others)
        }

        // Handle bill linking via transient fields
        if (linkedBillValue === 'none') {
            data._unlinkBill = true;
        } else if (linkedBillValue !== 'auto') {
            data._linkedBillId = linkedBillValue;
        }
        // 'auto' = default behavior (sync engine creates/updates bill automatically)

        if (isEdit) {
            store.updateDebt(existingDebt.id, data);
        } else {
            store.addDebt(data);
        }

        closeModal();
        refreshPage();
    });
}

function showBudgetForm(store, budget) {
    const formHtml = `
        <div class="form-group">
            <label>Total Monthly Payment Budget</label>
            <input type="number" class="form-input" id="budget-amount" step="0.01" value="${budget.totalMonthlyBudget}" placeholder="How much can you pay toward debts each month?">
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Include all debt payments (minimums + extra)</div>
        </div>
        <div class="form-group">
            <label>Payoff Strategy</label>
            <select class="form-select" id="budget-strategy">
                <option value="avalanche" ${budget.strategy === 'avalanche' ? 'selected' : ''}>Avalanche (Highest interest first)</option>
                <option value="snowball" ${budget.strategy === 'snowball' ? 'selected' : ''}>Snowball (Smallest balance first)</option>
            </select>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
                Avalanche saves money on interest. Snowball provides faster wins for motivation.
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">Save Budget</button>
        </div>
    `;

    openModal('Set Debt Payoff Budget', formHtml);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const data = {
            totalMonthlyBudget: parseFloat(document.getElementById('budget-amount').value) || 0,
            strategy: document.getElementById('budget-strategy').value
        };

        store.updateDebtBudget(data);
        closeModal();
        refreshPage();
    });
}
