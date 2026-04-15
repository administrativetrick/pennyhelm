import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';
import { showVehicleDetail } from './vehicle-detail.js';
import { auth } from '../auth.js';
import { capabilities } from '../mode/mode.js';
import { syncPlaidTransactions, hasPlaidConnections } from '../plaid.js';

let activeDebtsTab = 'debts';

const EXPENSE_CATEGORIES = {
    'groceries': { label: 'Groceries', color: '#22c55e' },
    'dining': { label: 'Dining', color: '#f97316' },
    'gas': { label: 'Gas', color: '#6366f1' },
    'transportation': { label: 'Transport', color: '#0ea5e9' },
    'shopping': { label: 'Shopping', color: '#ec4899' },
    'entertainment': { label: 'Entertainment', color: '#a855f7' },
    'healthcare': { label: 'Healthcare', color: '#ef4444' },
    'personal-care': { label: 'Personal Care', color: '#14b8a6' },
    'home': { label: 'Home', color: '#8b5cf6' },
    'utilities': { label: 'Utilities', color: '#eab308' },
    'education': { label: 'Education', color: '#3b82f6' },
    'travel': { label: 'Travel', color: '#06b6d4' },
    'gifts': { label: 'Gifts', color: '#f43f5e' },
    'subscriptions': { label: 'Subscriptions', color: '#64748b' },
    'pets': { label: 'Pets', color: '#d97706' },
    'other': { label: 'Other', color: '#94a3b8' }
};

function getExpenseCategoryBadge(category) {
    const cat = EXPENSE_CATEGORIES[category] || EXPENSE_CATEGORIES['other'];
    return `<span class="badge" style="background:${cat.color}20;color:${cat.color};border:1px solid ${cat.color}40;">${cat.label}</span>`;
}

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

function calculatePayoffStrategy(debts, monthlyBudget, strategy, cascade = true) {
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

    // Track current budget - decreases when cascade is OFF
    let currentBudget = monthlyBudget;

    while (balances.some(d => d.balance > 0.01) && months < maxMonths) {
        months++;
        let extraPayment = currentBudget;
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

                // Check if debt is paid off after minimum payment
                if (d.balance <= 0.01) {
                    d.balance = 0;
                    if (!payoffOrder.includes(d.name)) {
                        payoffOrder.push(d.name);
                    }
                    // If cascade is OFF, reduce budget by this debt's minimum
                    if (!cascade) {
                        currentBudget -= d.minPayment;
                    }
                }
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
                    if (!payoffOrder.includes(d.name)) {
                        payoffOrder.push(d.name);
                    }
                    // If cascade is OFF, reduce budget by this debt's minimum
                    if (!cascade) {
                        currentBudget -= d.minPayment;
                    }
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

function calculateMonthlyPayment(principal, annualRate, termMonths) {
    if (principal <= 0 || termMonths <= 0) return 0;
    if (annualRate <= 0) return principal / termMonths;
    const monthlyRate = annualRate / 100 / 12;
    return (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
           (Math.pow(1 + monthlyRate, termMonths) - 1);
}

function calculateTotalInterest(monthlyPayment, termMonths, principal) {
    return (monthlyPayment * termMonths) - principal;
}

function calculateIndividualPayoffMonths(balance, rate, payment) {
    if (balance <= 0) return 0;
    if (payment <= 0) return Infinity;

    const monthlyRate = rate / 100 / 12;
    if (monthlyRate <= 0) {
        return Math.ceil(balance / payment);
    }

    // Check if payment covers interest
    const monthlyInterest = balance * monthlyRate;
    if (payment <= monthlyInterest) return Infinity;

    // n = -ln(1 - (r * PV / P)) / ln(1 + r)
    const x = 1 - (monthlyRate * balance / payment);
    if (x <= 0) return Infinity;

    return Math.ceil(-Math.log(x) / Math.log(1 + monthlyRate));
}

function getIndividualDebtFreeDate(months) {
    if (months === Infinity || months >= 600) return { text: 'Never', color: 'var(--red)' };
    if (months === 0) return { text: 'Paid off!', color: 'var(--green)' };
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return {
        text: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        color: months <= 12 ? 'var(--green)' : months <= 36 ? 'var(--orange)' : 'var(--text-secondary)'
    };
}

export function renderDebts(container, store) {
    // Check URL hash for sub-tab
    const hash = window.location.hash;
    if (hash === '#debts/expenses') activeDebtsTab = 'expenses';
    else if (hash === '#debts' || hash === '#debts/debts') activeDebtsTab = 'debts';

    if (activeDebtsTab === 'expenses') {
        renderExpensesTab(container, store);
        return;
    }

    const debts = store.getDebts();
    const bills = store.getBills();
    const budget = store.getDebtBudget();
    const cascadeEnabled = budget.cascadeEnabled !== false; // Default to true

    const totalDebt = debts.reduce((sum, d) => sum + d.currentBalance, 0);
    const totalMinimum = debts.reduce((sum, d) => sum + d.minimumPayment, 0);
    const avgAPR = calculateWeightedAPR(debts);

    // Calculate with cascade ON (default behavior)
    const avalancheResult = calculatePayoffStrategy(debts, budget.totalMonthlyBudget, 'avalanche', true);
    const snowballResult = calculatePayoffStrategy(debts, budget.totalMonthlyBudget, 'snowball', true);

    // Calculate with cascade OFF (budget shrinks as debts are paid)
    const avalancheNoCascade = calculatePayoffStrategy(debts, budget.totalMonthlyBudget, 'avalanche', false);
    const snowballNoCascade = calculatePayoffStrategy(debts, budget.totalMonthlyBudget, 'snowball', false);

    // Use the appropriate results based on cascade toggle
    const activeAvalanche = cascadeEnabled ? avalancheResult : avalancheNoCascade;
    const activeSnowball = cascadeEnabled ? snowballResult : snowballNoCascade;
    const activeResult = budget.strategy === 'avalanche' ? activeAvalanche : activeSnowball;

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

        <div class="filter-chips" style="margin-bottom:20px;">
            <button class="filter-chip active" data-tab="debts">Debts</button>
            <button class="filter-chip" data-tab="expenses">Expenses</button>
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
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="margin:0;">Strategy Comparison</h3>
                    ${debts.length >= 2 ? `
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;" title="When ON: freed payments roll to next debt. When OFF: budget shrinks as debts are paid.">
                            <span style="font-size:12px;color:var(--text-muted);">Cascade Payments</span>
                            <div style="position:relative;width:44px;height:24px;">
                                <input type="checkbox" id="cascade-toggle" ${cascadeEnabled ? 'checked' : ''} style="opacity:0;width:100%;height:100%;position:absolute;cursor:pointer;z-index:1;">
                                <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:${cascadeEnabled ? 'var(--green)' : 'var(--bg-secondary)'};border-radius:12px;transition:background 0.2s;border:1px solid ${cascadeEnabled ? 'var(--green)' : 'var(--border)'};"></div>
                                <div style="position:absolute;top:2px;left:${cascadeEnabled ? '22px' : '2px'};width:18px;height:18px;background:white;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
                            </div>
                        </label>
                    ` : ''}
                </div>
                <div class="subtitle" style="margin-bottom:16px;">Monthly Budget: ${formatCurrency(budget.totalMonthlyBudget)}${budget.totalMonthlyBudget < totalMinimum ? ` <span class="text-red" style="font-size:12px;">(below ${formatCurrency(totalMinimum)} minimum — increase budget to see payoff timeline)</span>` : ''}</div>

                ${debts.length >= 2 && cascadeEnabled ? `
                    <div style="margin-bottom:16px;padding:12px;background:var(--accent)10;border-radius:8px;font-size:13px;border-left:3px solid var(--accent);">
                        <strong>💸 Cascade ON:</strong> When a debt is paid off, its payment rolls to the next debt in line.
                        ${(() => {
                            const withCascade = budget.strategy === 'avalanche' ? avalancheResult : snowballResult;
                            const noCascade = budget.strategy === 'avalanche' ? avalancheNoCascade : snowballNoCascade;
                            const monthsSaved = noCascade.monthsToPayoff - withCascade.monthsToPayoff;
                            const interestSaved = noCascade.totalInterestPaid - withCascade.totalInterestPaid;
                            if (monthsSaved > 0 && monthsSaved < Infinity) {
                                return `<br><span style="color:var(--green);">Saves ${formatMonths(monthsSaved)} and ${formatCurrency(interestSaved)} in interest vs. not cascading!</span>`;
                            }
                            return '';
                        })()}
                    </div>
                ` : ''}
                ${debts.length >= 2 && !cascadeEnabled ? `
                    <div style="margin-bottom:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;font-size:13px;border-left:3px solid var(--text-muted);">
                        <strong>Cascade OFF:</strong> When a debt is paid off, your budget shrinks (you keep the freed payment).
                    </div>
                ` : ''}

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
                    <div class="card" style="border:2px solid ${budget.strategy === 'avalanche' ? 'var(--accent)' : 'var(--border)'};">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                            <h4 style="margin:0;">Avalanche</h4>
                            ${budget.strategy === 'avalanche' ? '<span class="badge" style="background:var(--accent);color:white;">Active</span>' : ''}
                        </div>
                        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">Pay highest interest first</div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span>Time to payoff:</span>
                            <strong>${formatMonths(activeAvalanche.monthsToPayoff)}</strong>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                            <span>Total interest:</span>
                            <strong style="color:var(--red);">${activeAvalanche.totalInterestPaid === Infinity ? 'N/A' : formatCurrency(activeAvalanche.totalInterestPaid)}</strong>
                        </div>
                        ${activeAvalanche.payoffOrder.length > 0 ? `
                            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Payoff order:</div>
                            <div style="font-size:12px;">${activeAvalanche.payoffOrder.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('<br>')}</div>
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
                            <strong>${formatMonths(activeSnowball.monthsToPayoff)}</strong>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                            <span>Total interest:</span>
                            <strong style="color:var(--red);">${activeSnowball.totalInterestPaid === Infinity ? 'N/A' : formatCurrency(activeSnowball.totalInterestPaid)}</strong>
                        </div>
                        ${activeSnowball.payoffOrder.length > 0 ? `
                            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Payoff order:</div>
                            <div style="font-size:12px;">${activeSnowball.payoffOrder.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('<br>')}</div>
                        ` : ''}
                        ${budget.strategy !== 'snowball' ? `<button class="btn btn-sm btn-primary" style="margin-top:12px;width:100%;" id="switch-snowball">Switch to Snowball</button>` : ''}
                    </div>
                </div>
                ${activeAvalanche.totalInterestPaid < activeSnowball.totalInterestPaid ? `
                    <div style="margin-top:16px;padding:12px;background:var(--green)15;border-radius:8px;font-size:13px;">
                        Avalanche saves <strong>${formatCurrency(activeSnowball.totalInterestPaid - activeAvalanche.totalInterestPaid)}</strong> in interest
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
                <div class="table-wrapper debts-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Balance</th>
                                <th>APR</th>
                                <th>Min Payment</th>
                                <th>Payoff Date</th>
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
                                const payoffMonths = calculateIndividualPayoffMonths(debt.currentBalance, debt.interestRate, debt.minimumPayment);
                                const payoffInfo = getIndividualDebtFreeDate(payoffMonths);
                                return `
                                    <tr>
                                        <td>
                                            <div style="font-weight:600;">
                                                ${debt.type === 'auto-loan' && debt.linkedAccountId ? `<span class="vehicle-link" data-vehicle-id="${debt.linkedAccountId}">${escapeHtml(debt.name)}</span>` : escapeHtml(debt.name)}
                                                ${isLinked ? `<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;" title="${linkTitle}">&#128279; Linked</span>` : ''}
                                            </div>
                                            ${debt.notes ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(debt.notes)}</div>` : ''}
                                        </td>
                                        <td>
                                            ${getDebtTypeBadge(debt.type)}
                                            ${debt.chargeCard ? '<div style="font-size:10px;color:var(--orange);margin-top:2px;">Charge Card</div>' : ''}
                                        </td>
                                        <td>
                                            <div class="font-bold" style="color:var(--red);">${formatCurrency(debt.currentBalance)}</div>
                                            ${debt.lastPaymentAmount != null && debt.lastPaymentDate ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Last: ${formatCurrency(debt.lastPaymentAmount)} on ${new Date(debt.lastPaymentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>` : ''}
                                        </td>
                                        <td>${debt.interestRate.toFixed(1)}%${debt.manualOverrides?.interestRate ? '<span title="Manually set" style="font-size:9px;color:var(--accent);margin-left:3px;">✏</span>' : ''}</td>
                                        <td>
                                            ${formatCurrency(debt.minimumPayment)}${debt.chargeCard ? '<div style="font-size:10px;color:var(--orange);">Full balance</div>' : ''}${debt.manualOverrides?.minimumPayment ? '<span title="Manually set" style="font-size:9px;color:var(--accent);margin-left:3px;">✏</span>' : ''}
                                            ${debt.nextPaymentDueDate ? `<div style="font-size:10px;color:${debt.isOverdue ? 'var(--red)' : 'var(--text-muted)'};margin-top:2px;">${debt.isOverdue ? '⚠ Overdue' : 'Due'} ${new Date(debt.nextPaymentDueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${debt.manualOverrides?.nextPaymentDueDate ? '<span title="Manually set" style="font-size:9px;color:var(--accent);margin-left:3px;">✏</span>' : ''}</div>` : ''}
                                        </td>
                                        <td style="color:${payoffInfo.color};font-weight:500;">
                                            ${payoffInfo.text}
                                            ${payoffMonths > 0 && payoffMonths < Infinity ? `<div style="font-size:10px;color:var(--text-muted);font-weight:normal;">${formatMonths(payoffMonths)}</div>` : ''}
                                        </td>
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
                                                ${debt.type === 'auto-loan' ? `
                                                <button class="btn-icon refinance-debt" data-debt-id="${debt.id}" title="Refinance Calculator" style="color:var(--orange);">
                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
                                                </button>
                                                ` : ''}
                                                ${debt.type === 'mortgage' ? `
                                                <button class="btn-icon mortgage-refinance-debt" data-debt-id="${debt.id}" title="Mortgage Refinance Calculator" style="color:var(--green);">
                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
                                                </button>
                                                ` : ''}
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

    // Tab switching
    container.querySelectorAll('.filter-chip[data-tab]').forEach(chip => {
        chip.addEventListener('click', () => {
            activeDebtsTab = chip.dataset.tab;
            window.location.hash = chip.dataset.tab === 'debts' ? '#debts' : '#debts/expenses';
            refreshPage();
        });
    });

    // Event handlers
    container.querySelector('#add-debt-btn').addEventListener('click', () => showDebtForm(store));
    container.querySelector('#set-budget-btn').addEventListener('click', () => showBudgetForm(store, budget));

    const cascadeToggle = container.querySelector('#cascade-toggle');
    if (cascadeToggle) {
        cascadeToggle.addEventListener('change', () => {
            store.updateDebtBudget({ cascadeEnabled: cascadeToggle.checked });
            refreshPage();
        });
    }

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

    // Refinance calculator handlers
    container.querySelectorAll('.refinance-debt').forEach(btn => {
        btn.addEventListener('click', () => {
            const debt = debts.find(d => d.id === btn.dataset.debtId);
            if (debt) showRefinanceCalculator(debt);
        });
    });

    // Mortgage refinance calculator handlers
    container.querySelectorAll('.mortgage-refinance-debt').forEach(btn => {
        btn.addEventListener('click', () => {
            const debt = debts.find(d => d.id === btn.dataset.debtId);
            if (debt) showMortgageRefinanceCalculator(debt);
        });
    });

    // Vehicle detail links (auto-loan debts)
    container.querySelectorAll('.vehicle-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            showVehicleDetail(store, link.dataset.vehicleId);
        });
    });
}

function getExpenseTypeBadge(expense) {
    if (expense.expenseType === 'business') {
        var bName = expense.businessName ? escapeHtml(expense.businessName) : 'Business';
        return '<span class="badge" style="background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b40;">' + bName + '</span>';
    }
    return '<span class="badge" style="background:#3b82f620;color:#3b82f6;border:1px solid #3b82f640;">Personal</span>';
}

function getSourceBadge(expense) {
    if (expense.source === 'plaid') {
        return '<span style="font-size:10px;color:var(--text-muted);display:inline-flex;align-items:center;gap:2px;" title="Imported from bank"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/></svg> Auto</span>';
    }
    return '';
}

function renderExpensesTab(container, store) {
    const expenses = store.getExpenses();
    const usageType = store.getUsageType();
    const showTypeColumn = usageType === 'business' || usageType === 'both';
    const showPlaidSync = capabilities().plaid && hasPlaidConnections(store);

    // Summary calculations
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonthExpenses = expenses.filter(e => (e.date || '').startsWith(thisMonth));
    const thisMonthTotal = thisMonthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const avgExpense = expenses.length > 0 ? expenses.reduce((sum, e) => sum + (e.amount || 0), 0) / expenses.length : 0;

    // Business vs Personal totals
    const personalTotal = thisMonthExpenses.filter(e => e.expenseType !== 'business').reduce((sum, e) => sum + (e.amount || 0), 0);
    const businessTotal = thisMonthExpenses.filter(e => e.expenseType === 'business').reduce((sum, e) => sum + (e.amount || 0), 0);

    // Top category
    const catCounts = {};
    expenses.forEach(e => {
        const cat = e.category || 'other';
        catCounts[cat] = (catCounts[cat] || 0) + (e.amount || 0);
    });
    const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
    const topCategoryLabel = topCat ? (EXPENSE_CATEGORIES[topCat[0]]?.label || 'Other') : 'N/A';

    // Sort expenses by date descending
    const sorted = [...expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Last sync info
    const lastSync = store.getLastTransactionSync();
    const lastSyncLabel = lastSync ? new Date(lastSync).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never';

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Expenses</h2>
                <div class="subtitle">${expenses.length} expense${expenses.length !== 1 ? 's' : ''} tracked</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                ${showPlaidSync ? `<button class="btn btn-secondary btn-sm" id="sync-transactions-btn" title="Import transactions from connected banks">Sync Transactions</button>` : ''}
                <button class="btn btn-primary" id="add-expense-btn">+ Add Expense</button>
            </div>
        </div>

        <div class="filter-chips" style="margin-bottom:20px;">
            <button class="filter-chip" data-tab="debts">Debts</button>
            <button class="filter-chip active" data-tab="expenses">Expenses</button>
        </div>

        ${showPlaidSync ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">Last synced: ${lastSyncLabel}</div>` : ''}

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">This Month</div>
                <div class="stat-value" style="color:var(--red);">${formatCurrency(thisMonthTotal)}</div>
            </div>
            ${showTypeColumn ? `
            <div class="stat-card">
                <div class="stat-label">Personal</div>
                <div class="stat-value" style="color:#3b82f6;">${formatCurrency(personalTotal)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Business</div>
                <div class="stat-value" style="color:#f59e0b;">${formatCurrency(businessTotal)}</div>
            </div>
            ` : `
            <div class="stat-card">
                <div class="stat-label">Avg Expense</div>
                <div class="stat-value">${formatCurrency(avgExpense)}</div>
            </div>
            `}
            <div class="stat-card">
                <div class="stat-label">Top Category</div>
                <div class="stat-value" style="font-size:16px;">${topCategoryLabel}</div>
            </div>
        </div>

        ${sorted.length === 0 ? `
            <div class="card" style="text-align:center;padding:48px 24px;margin-top:24px;">
                <div style="font-size:48px;margin-bottom:16px;">&#128206;</div>
                <h3 style="margin-bottom:8px;">No expenses tracked</h3>
                <p style="color:var(--text-muted);margin-bottom:24px;">Start tracking your spending to see where your money goes${showPlaidSync ? ' or sync from your bank' : ''}</p>
                <div style="display:flex;gap:8px;justify-content:center;">
                    <button class="btn btn-primary" id="empty-add-expense">+ Add Your First Expense</button>
                    ${showPlaidSync ? `<button class="btn btn-secondary" id="empty-sync-btn">Sync From Bank</button>` : ''}
                </div>
            </div>
        ` : `
            <div class="card" style="margin-top:24px;">
                <h3 style="margin-bottom:16px;">Your Expenses</h3>
                <div class="table-wrapper expenses-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Name</th>
                                <th>Category</th>
                                ${showTypeColumn ? '<th>Type</th>' : ''}
                                <th>Vendor</th>
                                <th>Amount</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sorted.map(exp => `
                                <tr>
                                    <td style="white-space:nowrap;">${exp.date ? new Date(exp.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}</td>
                                    <td>
                                        <div style="font-weight:600;">${escapeHtml(exp.name || '')} ${getSourceBadge(exp)}</div>
                                        ${exp.notes ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(exp.notes)}</div>` : ''}
                                    </td>
                                    <td>${getExpenseCategoryBadge(exp.category)}</td>
                                    ${showTypeColumn ? `<td>${getExpenseTypeBadge(exp)}</td>` : ''}
                                    <td style="color:var(--text-secondary);">${escapeHtml(exp.vendor || '')}</td>
                                    <td><div class="font-bold" style="color:var(--red);">${formatCurrency(exp.amount || 0)}</div></td>
                                    <td>
                                        <div style="display:flex;gap:4px;">
                                            <button class="btn-icon edit-expense" data-expense-id="${exp.id}" title="Edit">
                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                            </button>
                                            <button class="btn-icon delete-expense" data-expense-id="${exp.id}" title="Delete" style="color:var(--red);">
                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `}
    `;

    // Tab switching
    container.querySelectorAll('.filter-chip[data-tab]').forEach(chip => {
        chip.addEventListener('click', () => {
            activeDebtsTab = chip.dataset.tab;
            window.location.hash = chip.dataset.tab === 'debts' ? '#debts' : '#debts/expenses';
            refreshPage();
        });
    });

    // Add expense button
    container.querySelector('#add-expense-btn').addEventListener('click', () => showExpenseForm(store));
    const emptyAddBtn = container.querySelector('#empty-add-expense');
    if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => showExpenseForm(store));
    }

    // Sync transactions button
    const syncBtn = container.querySelector('#sync-transactions-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true;
            syncBtn.textContent = 'Syncing...';
            try {
                const result = await syncPlaidTransactions(store);
                if (result.imported > 0) {
                    alert(`Imported ${result.imported} new transaction(s) as expenses.`);
                    refreshPage();
                } else {
                    alert('No new transactions to import.');
                    refreshPage();
                }
            } catch (err) {
                alert('Failed to sync transactions. Please try again.');
                syncBtn.disabled = false;
                syncBtn.textContent = 'Sync Transactions';
            }
        });
    }

    const emptySyncBtn = container.querySelector('#empty-sync-btn');
    if (emptySyncBtn) {
        emptySyncBtn.addEventListener('click', async () => {
            emptySyncBtn.disabled = true;
            emptySyncBtn.textContent = 'Syncing...';
            try {
                const result = await syncPlaidTransactions(store);
                if (result.imported > 0) {
                    alert(`Imported ${result.imported} new transaction(s) as expenses.`);
                }
                refreshPage();
            } catch (err) {
                alert('Failed to sync transactions. Please try again.');
                refreshPage();
            }
        });
    }

    // Edit/Delete expense handlers
    container.querySelectorAll('.edit-expense').forEach(btn => {
        btn.addEventListener('click', () => {
            const expense = expenses.find(e => e.id === btn.dataset.expenseId);
            if (expense) showExpenseForm(store, expense);
        });
    });

    container.querySelectorAll('.delete-expense').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Delete this expense?')) {
                store.deleteExpense(btn.dataset.expenseId);
                refreshPage();
            }
        });
    });
}

function showExpenseForm(store, existingExpense = null) {
    const isEdit = !!existingExpense;
    const expense = existingExpense || {
        name: '',
        amount: 0,
        category: 'other',
        date: new Date().toISOString().split('T')[0],
        vendor: '',
        notes: '',
        expenseType: 'personal',
        businessName: null
    };

    const usageType = store.getUsageType();
    const showTypeField = usageType === 'business' || usageType === 'both';
    const businessNames = store.getBusinessNames();

    const formHtml = `
        <div class="form-group">
            <label>Expense Name</label>
            <input type="text" class="form-input" id="expense-name" value="${escapeHtml(expense.name || '')}" placeholder="e.g., Weekly groceries">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" class="form-input" id="expense-amount" step="0.01" value="${expense.amount || ''}" placeholder="0.00">
            </div>
            <div class="form-group">
                <label>Date</label>
                <input type="date" class="form-input" id="expense-date" value="${expense.date || new Date().toISOString().split('T')[0]}">
            </div>
        </div>
        <div class="form-group">
            <label>Category</label>
            <select class="form-select" id="expense-category">
                ${Object.entries(EXPENSE_CATEGORIES).map(([key, val]) =>
                    `<option value="${key}" ${expense.category === key ? 'selected' : ''}>${val.label}</option>`
                ).join('')}
            </select>
        </div>
        ${showTypeField ? `
        <div class="form-row">
            <div class="form-group">
                <label>Expense Type</label>
                <select class="form-select" id="expense-type">
                    <option value="personal" ${expense.expenseType !== 'business' ? 'selected' : ''}>Personal</option>
                    <option value="business" ${expense.expenseType === 'business' ? 'selected' : ''}>Business</option>
                </select>
            </div>
            <div class="form-group" id="business-name-group" style="${expense.expenseType !== 'business' ? 'display:none;' : ''}">
                <label>Business Name</label>
                <select class="form-select" id="expense-business-name">
                    <option value="">Select business...</option>
                    ${businessNames.map(bn =>
                        `<option value="${escapeHtml(bn)}" ${expense.businessName === bn ? 'selected' : ''}>${escapeHtml(bn)}</option>`
                    ).join('')}
                </select>
            </div>
        </div>
        ` : ''}
        <div class="form-group">
            <label>Vendor (optional)</label>
            <input type="text" class="form-input" id="expense-vendor" value="${escapeHtml(expense.vendor || '')}" placeholder="e.g., Costco">
        </div>
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" class="form-input" id="expense-notes" value="${escapeHtml(expense.notes || '')}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Expense</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Expense' : 'Add Expense', formHtml);

    // Show/hide business name based on expense type
    const typeSelect = document.getElementById('expense-type');
    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            const group = document.getElementById('business-name-group');
            if (group) {
                group.style.display = typeSelect.value === 'business' ? '' : 'none';
            }
        });
    }

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const data = {
            name: document.getElementById('expense-name').value.trim(),
            amount: parseFloat(document.getElementById('expense-amount').value) || 0,
            date: document.getElementById('expense-date').value,
            category: document.getElementById('expense-category').value,
            vendor: document.getElementById('expense-vendor').value.trim(),
            notes: document.getElementById('expense-notes').value.trim()
        };

        // Expense type fields
        if (showTypeField) {
            data.expenseType = document.getElementById('expense-type').value;
            if (data.expenseType === 'business') {
                data.businessName = document.getElementById('expense-business-name').value || null;
            } else {
                data.businessName = null;
            }
        }

        if (!data.name) {
            alert('Please enter an expense name');
            return;
        }
        if (data.amount <= 0) {
            alert('Please enter a valid amount');
            return;
        }

        if (isEdit) {
            store.updateExpense(existingExpense.id, data);
        } else {
            store.addExpense(data);
        }

        closeModal();
        refreshPage();
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
        if (debtType === 'auto-loan') return 'vehicle';
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
            const typeLabel = { credit: 'Credit Card', property: 'Property', vehicle: 'Vehicle', checking: 'Checking', savings: 'Savings', investment: 'Investment', retirement: 'Retirement' }[a.type] || a.type;
            const balanceStr = (a.type === 'property' || a.type === 'vehicle')
                ? `${formatCurrency(a.balance)} value` + (a.amountOwed ? ` / ${formatCurrency(a.amountOwed)} owed` : '')
                : formatCurrency(a.balance);
            return `<option value="${a.id}" ${currentLinkedAccount && currentLinkedAccount.id === a.id ? 'selected' : ''}>${escapeHtml(a.name)} — ${balanceStr} (${typeLabel})</option>`;
        }).join('');
    };

    const autoLabel = debt.type === 'credit-card'
        ? 'Auto (create credit card account)'
        : 'None';
    const showAccountLink = debt.type === 'credit-card' || debt.type === 'mortgage' || debt.type === 'auto-loan' || currentLinkedAccount;

    // Check if this debt is Plaid-linked (directly or via linked account)
    const linkedAcct = isEdit && debt.linkedAccountId ? allAccounts.find(a => a.id === debt.linkedAccountId) : null;
    const isPlaidLinked = !!(debt.plaidAccountId || linkedAcct?.plaidAccountId);
    const overrides = debt.manualOverrides || {};

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
                <label>Interest Rate (APR %)${isPlaidLinked && overrides.interestRate ? ' <span style="font-size:10px;color:var(--accent);" title="This value is manually set and won\'t be overwritten by your bank sync">✏ Manual</span>' : ''}</label>
                <input type="number" class="form-input" id="debt-rate" step="0.01" value="${debt.interestRate}">
            </div>
            <div class="form-group">
                <label>Minimum Payment${isPlaidLinked && overrides.minimumPayment ? ' <span style="font-size:10px;color:var(--accent);" title="This value is manually set and won\'t be overwritten by your bank sync">✏ Manual</span>' : ''}</label>
                <input type="number" class="form-input" id="debt-min" step="0.01" value="${debt.chargeCard ? debt.currentBalance : debt.minimumPayment}" ${debt.chargeCard ? 'disabled' : ''}>
                <div id="charge-card-hint" style="font-size:11px;color:var(--accent);margin-top:4px;display:${debt.chargeCard ? '' : 'none'};">Set to full balance (charge card).</div>
            </div>
        </div>
        <div class="form-group">
            <label>Next Payment Due Date${isPlaidLinked && overrides.nextPaymentDueDate ? ' <span style="font-size:10px;color:var(--accent);" title="This value is manually set and won\'t be overwritten by your bank sync">✏ Manual</span>' : ''}</label>
            <input type="date" class="form-input" id="debt-due-date" value="${debt.nextPaymentDueDate ? debt.nextPaymentDueDate.substring(0, 10) : ''}">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Optional. Shown on the debts table and calendar.</div>
        </div>
        ${isPlaidLinked ? '<div style="font-size:11px;color:var(--text-muted);padding:8px 12px;background:var(--card-bg);border:1px solid var(--border);border-radius:6px;margin-bottom:12px;">🏦 This debt is synced with your bank. Values you change here for APR, minimum payment, or due date will be kept and <strong>won\'t be overwritten</strong> by future bank syncs.</div>' : ''}
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
        const shouldShow = newType === 'credit-card' || newType === 'mortgage' || newType === 'auto-loan';
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
        const newRate = parseFloat(document.getElementById('debt-rate').value) || 0;
        const newMin = isChargeCard ? currentBalance : (parseFloat(document.getElementById('debt-min').value) || 0);
        const newDueDate = document.getElementById('debt-due-date').value || '';
        const data = {
            name: document.getElementById('debt-name').value.trim(),
            type: document.getElementById('debt-type').value,
            currentBalance: currentBalance,
            originalBalance: parseFloat(document.getElementById('debt-original').value) || 0,
            interestRate: newRate,
            minimumPayment: newMin,
            chargeCard: isChargeCard,
            notes: document.getElementById('debt-notes').value.trim()
        };
        if (newDueDate) {
            data.nextPaymentDueDate = newDueDate;
        } else if (isEdit && existingDebt.nextPaymentDueDate) {
            // User cleared the due date
            data.nextPaymentDueDate = null;
        }

        // Track manual overrides for Plaid-linked debts
        if (isPlaidLinked && isEdit) {
            const prevOverrides = existingDebt.manualOverrides || {};
            const newOverrides = { ...prevOverrides };
            const prevDueDate = (existingDebt.nextPaymentDueDate || '').substring(0, 10);
            // Mark as overridden if user changed the value from what it was
            if (newRate !== (existingDebt.interestRate || 0)) newOverrides.interestRate = true;
            if (newMin !== (existingDebt.minimumPayment || 0)) newOverrides.minimumPayment = true;
            if (newDueDate !== prevDueDate) {
                if (newDueDate) {
                    newOverrides.nextPaymentDueDate = true;
                } else {
                    // User cleared the due date — remove the override so Plaid can populate it again
                    delete newOverrides.nextPaymentDueDate;
                }
            }
            data.manualOverrides = newOverrides;
        }

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

function showRefinanceCalculator(debt) {
    const currentBalance = debt.currentBalance;
    const currentRate = debt.interestRate;
    const currentPayment = debt.minimumPayment;

    // Estimate remaining term from current values (if we have balance, rate, payment)
    let estimatedRemainingMonths = 0;
    if (currentPayment > 0 && currentBalance > 0) {
        if (currentRate > 0) {
            const monthlyRate = currentRate / 100 / 12;
            // Solve for n: P = (r * PV) / (1 - (1+r)^-n)
            // n = -ln(1 - (r * PV / P)) / ln(1 + r)
            const x = 1 - (monthlyRate * currentBalance / currentPayment);
            if (x > 0) {
                estimatedRemainingMonths = Math.ceil(-Math.log(x) / Math.log(1 + monthlyRate));
            }
        } else {
            estimatedRemainingMonths = Math.ceil(currentBalance / currentPayment);
        }
    }

    const formHtml = `
        <div style="margin-bottom:20px;">
            <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${escapeHtml(debt.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">Current Balance: ${formatCurrency(currentBalance)}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
            <div class="card" style="padding:16px;">
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Current Loan</div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">APR:</span>
                    <strong>${currentRate.toFixed(2)}%</strong>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">Payment:</span>
                    <strong>${formatCurrency(currentPayment)}</strong>
                </div>
                ${estimatedRemainingMonths > 0 ? `
                <div style="display:flex;justify-content:space-between;">
                    <span style="font-size:13px;">Est. Remaining:</span>
                    <strong>${formatMonths(estimatedRemainingMonths)}</strong>
                </div>
                ` : ''}
            </div>
            <div class="card" style="padding:16px;border:2px solid var(--accent);">
                <div style="font-size:12px;color:var(--accent);margin-bottom:8px;">New Loan Estimate</div>
                <div id="refi-new-rate-display" style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">APR:</span>
                    <strong>--</strong>
                </div>
                <div id="refi-new-payment-display" style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">Payment:</span>
                    <strong style="color:var(--green);">--</strong>
                </div>
                <div id="refi-new-term-display" style="display:flex;justify-content:space-between;">
                    <span style="font-size:13px;">Term:</span>
                    <strong>--</strong>
                </div>
            </div>
        </div>

        <div class="form-group">
            <label>New Loan Amount</label>
            <input type="number" class="form-input" id="refi-amount" step="0.01" value="${currentBalance}" placeholder="Amount to refinance">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Enter the new loan principal (may differ if rolling in fees or paying down)</div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>New Interest Rate (APR %)</label>
                <input type="number" class="form-input" id="refi-rate" step="0.01" value="" placeholder="e.g., 5.5">
            </div>
            <div class="form-group">
                <label>New Loan Term</label>
                <select class="form-select" id="refi-term">
                    <option value="24">24 months (2 years)</option>
                    <option value="36">36 months (3 years)</option>
                    <option value="48">48 months (4 years)</option>
                    <option value="60" selected>60 months (5 years)</option>
                    <option value="72">72 months (6 years)</option>
                    <option value="84">84 months (7 years)</option>
                </select>
            </div>
        </div>

        <div id="refi-comparison" style="display:none;margin-top:20px;padding:16px;background:var(--bg-secondary);border-radius:8px;">
            <h4 style="margin:0 0 12px 0;">Comparison</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">
                <div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Monthly Savings</div>
                    <div id="refi-monthly-savings" style="font-size:18px;font-weight:700;color:var(--green);">--</div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Total Interest (Current)</div>
                    <div id="refi-current-interest" style="font-size:14px;font-weight:600;color:var(--red);">--</div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Total Interest (New)</div>
                    <div id="refi-new-interest" style="font-size:14px;font-weight:600;color:var(--orange);">--</div>
                </div>
            </div>
            <div id="refi-warning" style="margin-top:12px;padding:8px;background:var(--orange)15;border-radius:4px;font-size:12px;color:var(--orange);display:none;"></div>
        </div>

        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Close</button>
        </div>
    `;

    openModal('Auto Loan Refinance Calculator', formHtml);

    const amountInput = document.getElementById('refi-amount');
    const rateInput = document.getElementById('refi-rate');
    const termSelect = document.getElementById('refi-term');
    const comparisonDiv = document.getElementById('refi-comparison');

    const updateCalculation = () => {
        const newAmount = parseFloat(amountInput.value) || 0;
        const newRate = parseFloat(rateInput.value) || 0;
        const newTermMonths = parseInt(termSelect.value) || 60;

        // Update new loan display
        document.querySelector('#refi-new-rate-display strong').textContent = newRate > 0 ? `${newRate.toFixed(2)}%` : '--';
        document.querySelector('#refi-new-term-display strong').textContent = formatMonths(newTermMonths);

        if (newAmount > 0 && newRate >= 0 && newTermMonths > 0) {
            const newPayment = calculateMonthlyPayment(newAmount, newRate, newTermMonths);
            document.querySelector('#refi-new-payment-display strong').textContent = formatCurrency(newPayment);

            // Show comparison
            comparisonDiv.style.display = 'block';

            const monthlySavings = currentPayment - newPayment;
            const monthlySavingsEl = document.getElementById('refi-monthly-savings');
            if (monthlySavings > 0) {
                monthlySavingsEl.textContent = formatCurrency(monthlySavings);
                monthlySavingsEl.style.color = 'var(--green)';
            } else if (monthlySavings < 0) {
                monthlySavingsEl.textContent = '+' + formatCurrency(Math.abs(monthlySavings));
                monthlySavingsEl.style.color = 'var(--red)';
            } else {
                monthlySavingsEl.textContent = '$0';
                monthlySavingsEl.style.color = 'var(--text-muted)';
            }

            // Calculate total interest for current loan (remaining)
            const currentTotalInterest = estimatedRemainingMonths > 0
                ? calculateTotalInterest(currentPayment, estimatedRemainingMonths, currentBalance)
                : 0;
            document.getElementById('refi-current-interest').textContent = currentTotalInterest > 0 ? formatCurrency(currentTotalInterest) : '--';

            // Calculate total interest for new loan
            const newTotalInterest = calculateTotalInterest(newPayment, newTermMonths, newAmount);
            document.getElementById('refi-new-interest').textContent = formatCurrency(newTotalInterest);

            // Show warning if new loan costs more in interest
            const warningEl = document.getElementById('refi-warning');
            if (newTotalInterest > currentTotalInterest && currentTotalInterest > 0) {
                warningEl.textContent = `Note: While your monthly payment is lower, you'll pay ${formatCurrency(newTotalInterest - currentTotalInterest)} more in total interest over the life of the loan due to the longer term.`;
                warningEl.style.display = 'block';
            } else if (monthlySavings < 0) {
                warningEl.textContent = 'Your new monthly payment would be higher than your current payment.';
                warningEl.style.display = 'block';
            } else {
                warningEl.style.display = 'none';
            }
        } else {
            document.querySelector('#refi-new-payment-display strong').textContent = '--';
            comparisonDiv.style.display = 'none';
        }
    };

    amountInput.addEventListener('input', updateCalculation);
    rateInput.addEventListener('input', updateCalculation);
    termSelect.addEventListener('change', updateCalculation);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
}

function showMortgageRefinanceCalculator(debt) {
    const currentBalance = debt.currentBalance;
    const currentRate = debt.interestRate;
    const currentPayment = debt.minimumPayment;

    // Estimate remaining term from current values
    let estimatedRemainingMonths = 0;
    if (currentPayment > 0 && currentBalance > 0) {
        if (currentRate > 0) {
            const monthlyRate = currentRate / 100 / 12;
            const x = 1 - (monthlyRate * currentBalance / currentPayment);
            if (x > 0) {
                estimatedRemainingMonths = Math.ceil(-Math.log(x) / Math.log(1 + monthlyRate));
            }
        } else {
            estimatedRemainingMonths = Math.ceil(currentBalance / currentPayment);
        }
    }

    const formHtml = `
        <div style="margin-bottom:20px;">
            <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${escapeHtml(debt.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">Current Balance: ${formatCurrency(currentBalance)}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
            <div class="card" style="padding:16px;">
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Current Mortgage</div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">APR:</span>
                    <strong>${currentRate.toFixed(2)}%</strong>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">Payment:</span>
                    <strong>${formatCurrency(currentPayment)}</strong>
                </div>
                ${estimatedRemainingMonths > 0 ? `
                <div style="display:flex;justify-content:space-between;">
                    <span style="font-size:13px;">Est. Remaining:</span>
                    <strong>${formatMonths(estimatedRemainingMonths)}</strong>
                </div>
                ` : ''}
            </div>
            <div class="card" style="padding:16px;border:2px solid var(--accent);">
                <div style="font-size:12px;color:var(--accent);margin-bottom:8px;">New Mortgage Estimate</div>
                <div id="mrefi-new-rate-display" style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">APR:</span>
                    <strong>--</strong>
                </div>
                <div id="mrefi-new-payment-display" style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:13px;">Payment:</span>
                    <strong style="color:var(--green);">--</strong>
                </div>
                <div id="mrefi-new-term-display" style="display:flex;justify-content:space-between;">
                    <span style="font-size:13px;">Term:</span>
                    <strong>--</strong>
                </div>
            </div>
        </div>

        <div class="form-group">
            <label>New Loan Amount</label>
            <input type="number" class="form-input" id="mrefi-amount" step="0.01" value="${currentBalance}" placeholder="Amount to refinance">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">New loan principal (may differ if rolling in closing costs or paying down balance)</div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>New Interest Rate (APR %)</label>
                <input type="number" class="form-input" id="mrefi-rate" step="0.01" value="" placeholder="e.g., 6.25">
            </div>
            <div class="form-group">
                <label>New Loan Term</label>
                <select class="form-select" id="mrefi-term">
                    <option value="120">10 years</option>
                    <option value="180">15 years</option>
                    <option value="240">20 years</option>
                    <option value="300">25 years</option>
                    <option value="360" selected>30 years</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label>Estimated Closing Costs</label>
            <input type="number" class="form-input" id="mrefi-closing" step="0.01" value="" placeholder="e.g., 5000">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Typically 2-5% of the loan amount. Included in break-even calculation.</div>
        </div>

        <div id="mrefi-comparison" style="display:none;margin-top:20px;padding:16px;background:var(--bg-secondary);border-radius:8px;">
            <h4 style="margin:0 0 12px 0;">Comparison</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;margin-bottom:12px;">
                <div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Monthly Savings</div>
                    <div id="mrefi-monthly-savings" style="font-size:18px;font-weight:700;color:var(--green);">--</div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Break-Even</div>
                    <div id="mrefi-breakeven" style="font-size:18px;font-weight:700;color:var(--accent);">--</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;">
                <div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Total Interest (Current)</div>
                    <div id="mrefi-current-interest" style="font-size:14px;font-weight:600;color:var(--red);">--</div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Total Interest (New)</div>
                    <div id="mrefi-new-interest" style="font-size:14px;font-weight:600;color:var(--orange);">--</div>
                </div>
            </div>
            <div id="mrefi-lifetime" style="margin-top:12px;padding:8px;background:var(--bg-primary);border-radius:4px;font-size:12px;color:var(--text-secondary);display:none;"></div>
            <div id="mrefi-warning" style="margin-top:8px;padding:8px;background:var(--orange)15;border-radius:4px;font-size:12px;color:var(--orange);display:none;"></div>
        </div>

        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Close</button>
        </div>
    `;

    openModal('Mortgage Refinance Calculator', formHtml);

    const amountInput = document.getElementById('mrefi-amount');
    const rateInput = document.getElementById('mrefi-rate');
    const termSelect = document.getElementById('mrefi-term');
    const closingInput = document.getElementById('mrefi-closing');
    const comparisonDiv = document.getElementById('mrefi-comparison');

    const updateCalculation = () => {
        const newAmount = parseFloat(amountInput.value) || 0;
        const newRate = parseFloat(rateInput.value) || 0;
        const newTermMonths = parseInt(termSelect.value) || 360;
        const closingCosts = parseFloat(closingInput.value) || 0;

        // Update new loan display
        document.querySelector('#mrefi-new-rate-display strong').textContent = newRate > 0 ? `${newRate.toFixed(2)}%` : '--';
        document.querySelector('#mrefi-new-term-display strong').textContent = formatMonths(newTermMonths);

        if (newAmount > 0 && newRate >= 0 && newTermMonths > 0) {
            const newPayment = calculateMonthlyPayment(newAmount, newRate, newTermMonths);
            document.querySelector('#mrefi-new-payment-display strong').textContent = formatCurrency(newPayment);

            // Show comparison
            comparisonDiv.style.display = 'block';

            const monthlySavings = currentPayment - newPayment;
            const monthlySavingsEl = document.getElementById('mrefi-monthly-savings');
            if (monthlySavings > 0) {
                monthlySavingsEl.textContent = formatCurrency(monthlySavings);
                monthlySavingsEl.style.color = 'var(--green)';
            } else if (monthlySavings < 0) {
                monthlySavingsEl.textContent = '+' + formatCurrency(Math.abs(monthlySavings));
                monthlySavingsEl.style.color = 'var(--red)';
            } else {
                monthlySavingsEl.textContent = '$0';
                monthlySavingsEl.style.color = 'var(--text-muted)';
            }

            // Break-even calculation (months until closing costs are recouped)
            const breakevenEl = document.getElementById('mrefi-breakeven');
            if (monthlySavings > 0 && closingCosts > 0) {
                const breakevenMonths = Math.ceil(closingCosts / monthlySavings);
                breakevenEl.textContent = formatMonths(breakevenMonths);
                breakevenEl.style.color = 'var(--accent)';
            } else if (monthlySavings > 0 && closingCosts === 0) {
                breakevenEl.textContent = 'Immediate';
                breakevenEl.style.color = 'var(--green)';
            } else {
                breakevenEl.textContent = 'N/A';
                breakevenEl.style.color = 'var(--text-muted)';
            }

            // Calculate total interest for current loan (remaining)
            const currentTotalInterest = estimatedRemainingMonths > 0
                ? calculateTotalInterest(currentPayment, estimatedRemainingMonths, currentBalance)
                : 0;
            document.getElementById('mrefi-current-interest').textContent = currentTotalInterest > 0 ? formatCurrency(currentTotalInterest) : '--';

            // Calculate total interest for new loan
            const newTotalInterest = calculateTotalInterest(newPayment, newTermMonths, newAmount);
            document.getElementById('mrefi-new-interest').textContent = formatCurrency(newTotalInterest);

            // Lifetime cost comparison (interest + closing costs)
            const lifetimeEl = document.getElementById('mrefi-lifetime');
            if (currentTotalInterest > 0) {
                const newTotalCost = newTotalInterest + closingCosts;
                const lifetimeDiff = newTotalCost - currentTotalInterest;
                if (lifetimeDiff < 0) {
                    lifetimeEl.innerHTML = `<span style="color:var(--green);font-weight:600;">You'd save ${formatCurrency(Math.abs(lifetimeDiff))} over the life of the loan</span> (including ${formatCurrency(closingCosts)} in closing costs).`;
                    lifetimeEl.style.display = 'block';
                } else if (lifetimeDiff > 0) {
                    lifetimeEl.innerHTML = `<span style="color:var(--red);font-weight:600;">You'd pay ${formatCurrency(lifetimeDiff)} more over the life of the loan</span> (including ${formatCurrency(closingCosts)} in closing costs).`;
                    lifetimeEl.style.display = 'block';
                } else {
                    lifetimeEl.style.display = 'none';
                }
            } else {
                lifetimeEl.style.display = 'none';
            }

            // Show warning if applicable
            const warningEl = document.getElementById('mrefi-warning');
            if (newTotalInterest > currentTotalInterest && currentTotalInterest > 0 && monthlySavings > 0) {
                warningEl.textContent = `Note: While your monthly payment is lower, you'll pay ${formatCurrency(newTotalInterest - currentTotalInterest)} more in total interest over the life of the loan due to the longer term.`;
                warningEl.style.display = 'block';
            } else if (monthlySavings < 0) {
                warningEl.textContent = 'Your new monthly payment would be higher than your current payment.';
                warningEl.style.display = 'block';
            } else {
                warningEl.style.display = 'none';
            }
        } else {
            document.querySelector('#mrefi-new-payment-display strong').textContent = '--';
            comparisonDiv.style.display = 'none';
        }
    };

    amountInput.addEventListener('input', updateCalculation);
    rateInput.addEventListener('input', updateCalculation);
    termSelect.addEventListener('change', updateCalculation);
    closingInput.addEventListener('input', updateCalculation);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
}

// Cascade is now an inline toggle in the Strategy Comparison section
