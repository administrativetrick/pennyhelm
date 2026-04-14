/**
 * FinancialService — pure functions for financial calculations.
 *
 * Extracted from Store and Dashboard to centralize business logic.
 * All functions are stateless and operate on data passed in.
 */

// ─── Net Worth ────────────────────────────────────

export function calculateNetWorth(accounts, debts) {
    if (!accounts) accounts = [];
    if (!debts) debts = [];

    const cashTotal = accounts
        .filter(a => a.type === 'checking' || a.type === 'savings')
        .reduce((s, a) => s + (a.balance || 0), 0);

    const investmentTotal = accounts
        .filter(a => a.type === 'investment' || a.type === 'retirement')
        .reduce((s, a) => s + (a.balance || 0), 0);

    const propertyEquity = accounts
        .filter(a => a.type === 'property')
        .reduce((s, a) => s + ((a.balance || 0) - (a.amountOwed || 0)), 0);

    const vehicleEquity = accounts
        .filter(a => a.type === 'vehicle')
        .reduce((s, a) => s + ((a.balance || 0) - (a.amountOwed || 0)), 0);

    const creditOwed = accounts
        .filter(a => a.type === 'credit')
        .reduce((s, a) => s + (a.balance || 0), 0);

    const unlinkedDebtBalance = debts
        .filter(d => !d.linkedAccountId)
        .reduce((s, d) => s + (d.currentBalance || 0), 0);

    const netWorth = cashTotal + investmentTotal + propertyEquity + vehicleEquity - creditOwed - unlinkedDebtBalance;

    return {
        cashTotal,
        investmentTotal,
        propertyEquity,
        vehicleEquity,
        creditOwed,
        unlinkedDebtBalance,
        netWorth
    };
}

// ─── Monthly Income ───────────────────────────────

export function calculateMonthlyIncome(income, otherIncomeSources) {
    if (!income) return { userPayMonthly: 0, depMonthlyPay: 0, otherIncomeMonthly: 0, totalMonthly: 0 };

    const freqMultiplier = {
        weekly: 52 / 12,
        biweekly: 26 / 12,
        semimonthly: 2,
        monthly: 1
    };

    const userFreq = income.user?.frequency || 'biweekly';
    const userPayMonthly = (income.user?.payAmount || 0) * (freqMultiplier[userFreq] || 1);

    const depFreq = income.dependent?.frequency || 'monthly';
    const depMonthlyPay = income.dependent?.employed
        ? (income.dependent?.payAmount || 0) * (freqMultiplier[depFreq] || 1)
        : 0;

    const otherIncomeMonthly = (otherIncomeSources || []).reduce((sum, src) => {
        const f = src.frequency || 'monthly';
        return sum + (src.amount || 0) * (freqMultiplier[f] || 1);
    }, 0);

    const totalMonthly = userPayMonthly + otherIncomeMonthly +
        (income.combineDependentIncome !== false ? depMonthlyPay : 0);

    return { userPayMonthly, depMonthlyPay, otherIncomeMonthly, totalMonthly };
}

// ─── Pay Dates ────────────────────────────────────

export function generatePayDates(schedule, rangeStartStr, rangeEndStr) {
    if (!schedule || !schedule.startDate) return [];

    const anchor = new Date(schedule.startDate + 'T00:00:00');
    const now = new Date();
    const rangeStart = rangeStartStr
        ? new Date(rangeStartStr + 'T00:00:00')
        : new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const rangeEnd = rangeEndStr
        ? new Date(rangeEndStr + 'T00:00:00')
        : new Date(now.getFullYear(), now.getMonth() + 4, 0);

    const dates = [];
    const freq = schedule.frequency;

    if (freq === 'biweekly') {
        let cursor = new Date(anchor);
        while (cursor > rangeStart) cursor = new Date(cursor.getTime() - 14 * 86400000);
        while (cursor <= rangeEnd) {
            if (cursor >= rangeStart) dates.push(new Date(cursor));
            cursor = new Date(cursor.getTime() + 14 * 86400000);
        }
    } else if (freq === 'weekly') {
        let cursor = new Date(anchor);
        while (cursor > rangeStart) cursor = new Date(cursor.getTime() - 7 * 86400000);
        while (cursor <= rangeEnd) {
            if (cursor >= rangeStart) dates.push(new Date(cursor));
            cursor = new Date(cursor.getTime() + 7 * 86400000);
        }
    } else if (freq === 'semimonthly') {
        const day1 = anchor.getDate();
        const day2 = day1 <= 15 ? day1 + 15 : day1 - 15;
        let curYear = rangeStart.getFullYear();
        let curMonth = rangeStart.getMonth();
        while (true) {
            const d1 = new Date(curYear, curMonth, Math.min(day1, 28));
            const d2 = new Date(curYear, curMonth, Math.min(day2, 28));
            if (d1 > rangeEnd && d2 > rangeEnd) break;
            if (d1 >= rangeStart && d1 <= rangeEnd) dates.push(d1);
            if (d2 >= rangeStart && d2 <= rangeEnd) dates.push(d2);
            curMonth++;
            if (curMonth > 11) { curMonth = 0; curYear++; }
        }
        dates.sort((a, b) => a - b);
    } else if (freq === 'monthly') {
        const day = anchor.getDate();
        let curYear = rangeStart.getFullYear();
        let curMonth = rangeStart.getMonth();
        while (true) {
            const d = new Date(curYear, curMonth, Math.min(day, 28));
            if (d > rangeEnd) break;
            if (d >= rangeStart) dates.push(d);
            curMonth++;
            if (curMonth > 11) { curMonth = 0; curYear++; }
        }
    }

    return dates;
}

// ─── Balance Snapshot ─────────────────────────────

export function createBalanceSnapshot(accounts, debts) {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    let checking = 0, savings = 0, investment = 0;
    for (const a of (accounts || [])) {
        switch (a.type) {
            case 'checking': checking += (a.balance || 0); break;
            case 'savings': savings += (a.balance || 0); break;
            case 'investment':
            case 'retirement': investment += (a.balance || 0); break;
        }
    }

    const { netWorth } = calculateNetWorth(accounts, debts);

    return { date: dateKey, checking, savings, investment, netWorth };
}

// ─── Bill Expansion ───────────────────────────────

export function expandBillOccurrences(bill, rangeStart, rangeEnd, payDatesInRange = []) {
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

// ─── Financial Health Score ──────────────────────

/**
 * Calculate a 0-100 Financial Health Score from five weighted components:
 *   1. Debt-to-Income Ratio  (25 pts)
 *   2. Savings Rate          (25 pts)
 *   3. Bill Payment History  (25 pts)
 *   4. Credit Score           (15 pts)
 *   5. Emergency Fund          (10 pts)
 *
 * Each sub-score is 0-100, then multiplied by its weight.
 * Returns { score, grade, components[] } where each component
 * has { name, score, weight, weighted, color, tip }.
 */
export function calculateFinancialHealthScore({
    monthlyIncome,
    totalMonthlyBills,
    totalDebtBalance,
    monthlyDebtPayments,
    cashTotal,
    savingsBalance,
    billPaymentRate,
    creditScore,
}) {
    const components = [];

    // ── 1. Debt-to-Income (25%) ──────────────
    // DTI = monthly debt payments / gross monthly income
    // 0% = perfect (100), >50% = poor (0)
    let dtiScore = 100;
    if (monthlyIncome > 0) {
        const dti = (monthlyDebtPayments + totalMonthlyBills) / monthlyIncome;
        if (dti <= 0.30) dtiScore = 100;
        else if (dti <= 0.40) dtiScore = 80 - (dti - 0.30) * 200; // 80-60
        else if (dti <= 0.50) dtiScore = 60 - (dti - 0.40) * 300; // 60-30
        else dtiScore = Math.max(0, 30 - (dti - 0.50) * 100);
    } else if (totalMonthlyBills > 0 || monthlyDebtPayments > 0) {
        dtiScore = 0; // debt but no income
    }
    dtiScore = clamp(dtiScore);
    components.push({
        name: 'Debt-to-Income',
        score: Math.round(dtiScore),
        weight: 0.25,
        weighted: Math.round(dtiScore * 0.25),
        icon: '📉',
        tip: dtiScore >= 80 ? 'Great! Your debt load is manageable.'
            : dtiScore >= 50 ? 'Consider reducing monthly obligations.'
            : 'High debt relative to income — focus on payoff.'
    });

    // ── 2. Savings Rate (25%) ────────────────
    // Savings as months of expenses covered
    // 6+ months = 100, 0 = 0
    let savingsScore = 0;
    const monthlyExpenses = totalMonthlyBills + monthlyDebtPayments;
    if (monthlyExpenses > 0) {
        const monthsCovered = savingsBalance / monthlyExpenses;
        if (monthsCovered >= 6) savingsScore = 100;
        else savingsScore = (monthsCovered / 6) * 100;
    } else if (savingsBalance > 0) {
        savingsScore = 100; // savings and no expenses
    }
    savingsScore = clamp(savingsScore);
    components.push({
        name: 'Savings Cushion',
        score: Math.round(savingsScore),
        weight: 0.25,
        weighted: Math.round(savingsScore * 0.25),
        icon: '🏦',
        tip: savingsScore >= 80 ? 'Excellent savings buffer!'
            : savingsScore >= 50 ? 'Building toward 6 months of expenses.'
            : 'Try to build an emergency fund.'
    });

    // ── 3. Bill Payment History (25%) ────────
    // % of bills paid on time over recent months
    // 100% = 100, 0% = 0
    let paymentScore = billPaymentRate != null ? billPaymentRate * 100 : 50; // default 50 if no history
    paymentScore = clamp(paymentScore);
    components.push({
        name: 'Payment History',
        score: Math.round(paymentScore),
        weight: 0.25,
        weighted: Math.round(paymentScore * 0.25),
        icon: '✅',
        tip: paymentScore >= 90 ? 'Outstanding payment track record!'
            : paymentScore >= 70 ? 'Good — try to pay all bills on time.'
            : 'Late or missed payments hurt your score.'
    });

    // ── 4. Credit Score (15%) ────────────────
    // Map 300-850 range to 0-100
    let creditSubScore = 50; // default if not set
    if (creditScore && creditScore >= 300) {
        creditSubScore = ((creditScore - 300) / 550) * 100;
    }
    creditSubScore = clamp(creditSubScore);
    components.push({
        name: 'Credit Score',
        score: Math.round(creditSubScore),
        weight: 0.15,
        weighted: Math.round(creditSubScore * 0.15),
        icon: '📊',
        tip: creditSubScore >= 80 ? 'Excellent credit standing!'
            : creditSubScore >= 55 ? 'Good credit — keep it up.'
            : 'Work on improving your credit score.'
    });

    // ── 5. Emergency Fund (10%) ──────────────
    // Cash + savings as ratio of monthly income
    // 3+ months income in cash = 100
    let emergencyScore = 0;
    if (monthlyIncome > 0) {
        const cashMonths = cashTotal / monthlyIncome;
        if (cashMonths >= 3) emergencyScore = 100;
        else emergencyScore = (cashMonths / 3) * 100;
    } else if (cashTotal > 0) {
        emergencyScore = 75;
    }
    emergencyScore = clamp(emergencyScore);
    components.push({
        name: 'Cash Reserves',
        score: Math.round(emergencyScore),
        weight: 0.10,
        weighted: Math.round(emergencyScore * 0.10),
        icon: '💵',
        tip: emergencyScore >= 80 ? 'Strong cash position!'
            : emergencyScore >= 40 ? 'Building your cash reserves.'
            : 'Try to keep 3 months of income liquid.'
    });

    // ── Overall Score ────────────────────────
    const totalScore = Math.round(
        dtiScore * 0.25 +
        savingsScore * 0.25 +
        paymentScore * 0.25 +
        creditSubScore * 0.15 +
        emergencyScore * 0.10
    );

    return {
        score: clamp(totalScore),
        grade: getHealthGrade(totalScore),
        components
    };
}

function clamp(v) {
    return Math.max(0, Math.min(100, v));
}

function getHealthGrade(score) {
    if (score >= 90) return { label: 'Excellent',  color: 'var(--green)',  emoji: '🌟' };
    if (score >= 75) return { label: 'Good',       color: 'var(--accent)', emoji: '👍' };
    if (score >= 55) return { label: 'Fair',        color: 'var(--yellow)', emoji: '⚡' };
    if (score >= 35) return { label: 'Needs Work',  color: 'var(--orange)', emoji: '⚠️' };
    return                   { label: 'Critical',   color: 'var(--red)',    emoji: '🚨' };
}
