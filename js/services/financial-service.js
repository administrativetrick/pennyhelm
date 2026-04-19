/**
 * FinancialService — pure functions for financial calculations.
 *
 * Extracted from Store and Dashboard to centralize business logic.
 * All functions are stateless and operate on data passed in.
 */

// ─── Bill category constants ──────────────────────
//
// Used by Financial Health Score DTI (mortgage-aware front-end / back-end
// ratios), and will be reused for cashflow reports, budget variance, and any
// future "housing vs. other debt" breakdown. Kept as Sets because that's how
// callers consume them (fast .has() lookup in .filter()).
//
// These ARE the canonical source of truth — don't redefine them inline.

export const HOUSING_BILL_CATEGORIES = new Set(['Mortgage', 'Rent']);

export const DEBT_BILL_CATEGORIES = new Set([
    'Auto Loan', 'Student Loan', 'Personal Loan',
    'Credit Card', 'Loan', 'Debt Payment'
]);

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

// ─── Debt helpers ─────────────────────────────────

/**
 * Sum of debt minimum payments, with optional filtering.
 *
 * Examples:
 *   sumDebtMinimums(debts)                       // all debts
 *   sumDebtMinimums(debts, { type: 'mortgage' }) // only mortgages
 *   sumDebtMinimums(debts, { excludeType: 'mortgage' }) // everything except mortgages
 */
export function sumDebtMinimums(debts, opts = {}) {
    if (!debts) return 0;
    const { type, excludeType } = opts;
    return debts
        .filter(d => {
            if (type && d.type !== type) return false;
            if (excludeType && d.type === excludeType) return false;
            return true;
        })
        .reduce((s, d) => s + (d.minimumPayment || 0), 0);
}

// ─── Frequency math ───────────────────────────────

/**
 * Multiplier that converts a periodic amount into its monthly equivalent.
 * 52/12 for weekly, 26/12 for biweekly, 2 for semimonthly, 1 otherwise.
 *
 * Narrow helper for income-style frequencies. For the full frequency vocabulary
 * used across bills, other-income, and chatbot totals, use frequencyToMonthly().
 */
export function getMonthlyMultiplier(freq) {
    switch (freq) {
        case 'weekly':      return 52 / 12;
        case 'biweekly':    return 26 / 12;
        case 'semimonthly': return 2;
        default:            return 1;
    }
}

/**
 * Canonical "amount + frequency → monthly equivalent" converter.
 *
 * Covers every frequency string the app persists: weekly, biweekly,
 * semimonthly/twice-monthly, monthly, quarterly, semiannual, yearly/annually,
 * one-time. Unknown frequencies are treated as monthly for backwards
 * compatibility with legacy data that sometimes omits the field.
 *
 * NOTE: per-paycheck is intentionally NOT handled here because its monthly
 * equivalent depends on actual pay-date count in the target month — callers
 * that need per-paycheck should use calculateBillMonthlyAmount() (annualized,
 * approximated as amount × 2) or getBillMonthlyAmount() (exact, month-specific).
 */
export function frequencyToMonthly(amount, frequency) {
    const amt = amount || 0;
    switch (frequency) {
        case 'weekly':        return amt * 52 / 12;
        case 'biweekly':      return amt * 26 / 12;
        case 'semimonthly':
        case 'twice-monthly': return amt * 2;
        case 'monthly':       return amt;
        case 'quarterly':     return amt / 3;
        case 'semiannual':
        case 'semi-annual':   return amt / 6;
        case 'yearly':
        case 'annually':      return amt / 12;
        case 'one-time':      return 0;
        default:              return amt;
    }
}

/**
 * Annualized monthly amount for a bill, used by the bills waterfall, dashboard
 * health score, and any other "what does this bill cost per month on average?"
 * consumer. Honors `frozen` and `excludeFromTotal` flags.
 *
 * per-paycheck bills are approximated at amount × 2 (≈ twice-monthly). For an
 * exact count that respects the actual pay-date distribution in a given month,
 * use getBillMonthlyAmount() in bills.js.
 */
export function calculateBillMonthlyAmount(bill) {
    if (!bill) return 0;
    if (bill.frozen || bill.excludeFromTotal) return 0;
    if (bill.frequency === 'per-paycheck') return (bill.amount || 0) * 2;
    return frequencyToMonthly(bill.amount, bill.frequency);
}

// ─── Monthly Income ───────────────────────────────

/**
 * Roll user pay + dependent pay + other-income sources into a monthly total.
 *
 * `paySchedule` is optional — when provided, its `.frequency` overrides
 * `income.user.frequency` (the real store keeps pay frequency on the
 * separate paySchedule object; legacy callers / tests inline it on
 * income.user instead). Callers supplying a paySchedule get the correct
 * answer for real app data.
 *
 * Returns { userPayMonthly, depMonthlyPay, otherIncomeMonthly, totalMonthly }.
 */
export function calculateMonthlyIncome(income, otherIncomeSources, paySchedule) {
    if (!income) return { userPayMonthly: 0, depMonthlyPay: 0, otherIncomeMonthly: 0, totalMonthly: 0 };

    const userFreq = paySchedule?.frequency || income.user?.frequency || 'biweekly';
    const userPayMonthly = frequencyToMonthly(income.user?.payAmount, userFreq);

    const depFreq = income.dependent?.frequency || 'monthly';
    const depMonthlyPay = income.dependent?.employed
        ? frequencyToMonthly(income.dependent?.payAmount, depFreq)
        : 0;

    const otherIncomeMonthly = (otherIncomeSources || []).reduce(
        (sum, src) => sum + frequencyToMonthly(src.amount, src.frequency || 'monthly'),
        0,
    );

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

// ─── Plaid Payment Matching ──────────────────────

/**
 * Decide whether a bill was paid based on Plaid transaction evidence.
 *
 * Problem this solves: the manual paid/unpaid flag punishes users who
 * pay on autopay but forget to tick the checkbox. This checks whether a
 * Plaid-synced expense exists around the bill's due date with a matching
 * amount. If so, the bill is inferred to have been paid regardless of
 * the manual flag.
 *
 * @param {object} bill — bill record (needs `amount`)
 * @param {Date}   dueDate — expected due date for this period
 * @param {Array}  expenses — all expenses (only source:'plaid' are considered)
 * @param {object} [options]
 * @param {number} [options.amountTolerance=0.05] — ±5% of bill amount
 * @param {number} [options.amountFloor=1]         — or ±$1 absolute, whichever larger
 * @param {number} [options.dateToleranceDays=3]   — ±N days from due date
 * @returns {{ matched: boolean, expense: object|null }}
 */
export function matchBillToPlaidTransactions(bill, dueDate, expenses, options = {}) {
    const amountTolerance = options.amountTolerance ?? 0.05;
    const amountFloor = options.amountFloor ?? 1;
    const dateToleranceDays = options.dateToleranceDays ?? 3;

    if (!bill || !bill.amount || !dueDate || !Array.isArray(expenses)) {
        return { matched: false, expense: null };
    }

    const billAmount = Number(bill.amount);
    if (!billAmount || billAmount <= 0) {
        return { matched: false, expense: null };
    }

    const windowMs = dateToleranceDays * 24 * 60 * 60 * 1000;
    const dueMs = dueDate.getTime();
    const allowedDiff = Math.max(billAmount * amountTolerance, amountFloor);

    for (const exp of expenses) {
        if (!exp || exp.source !== 'plaid' || exp.ignored) continue;
        if (!exp.amount || !exp.date) continue;

        const expDate = new Date(exp.date);
        if (isNaN(expDate.getTime())) continue;

        const dateDiff = Math.abs(expDate.getTime() - dueMs);
        if (dateDiff > windowMs) continue;

        const amountDiff = Math.abs(Math.abs(Number(exp.amount)) - billAmount);
        if (amountDiff > allowedDiff) continue;

        return { matched: true, expense: exp };
    }

    return { matched: false, expense: null };
}

// ─── Financial Health Score ──────────────────────

/**
 * Calculate a 0-100 Financial Health Score from up to five weighted components:
 *   1. Debt-to-Income Ratio  (25 pts)
 *   2. Savings Cushion        (25 pts)
 *   3. Bill Payment History  (25 pts)
 *   4. Credit Score           (15 pts)
 *   5. Liquid Reserves        (10 pts)  — cash + taxable investments (at haircut)
 *
 * Components with no usable input are EXCLUDED (not defaulted to a
 * middle value that looks like real signal). The remaining components'
 * weights are renormalized so they sum to 1.0. This prevents a new user
 * with no credit score and no bill history from getting a fake "Fair"
 * grade driven by 40% synthetic defaults.
 *
 * Returns:
 *   { score, grade, components[], missingComponents[], completeness }
 * where:
 *   - `score` is 0-100 computed from scored components only
 *   - `components` only contains components that had real data
 *   - `missingComponents` is the list of names skipped (for UI nudge)
 *   - `completeness` is 'full' (5/5), 'partial' (3-4), or 'insufficient' (<3)
 */
/**
 * Map a user-facing risk-tolerance preset to the haircut applied to
 * taxable investments when computing Savings Cushion / Liquid Reserves.
 *
 *   conservative (0.50) — treats stocks as unreliable in an emergency.
 *                          Good choice for people close to retirement or
 *                          living paycheck-to-paycheck.
 *   balanced (0.75)      — default. Reflects market drawdown, realized
 *                          capital gains, and 1-3 day settlement drag.
 *   aggressive (1.00)    — stocks count dollar-for-dollar. Appropriate
 *                          for diversified long-horizon investors who
 *                          are confident they can weather a drawdown
 *                          without forced selling.
 */
export const INVESTMENT_HAIRCUT_BY_RISK_TOLERANCE = {
    conservative: 0.50,
    balanced: 0.75,
    aggressive: 1.00,
};

export function resolveInvestmentHaircut(riskTolerance) {
    const value = INVESTMENT_HAIRCUT_BY_RISK_TOLERANCE[riskTolerance];
    return typeof value === 'number' ? value : 0.75; // default = balanced
}

export function calculateFinancialHealthScore({
    monthlyIncome,
    totalMonthlyBills,
    totalDebtBalance,
    monthlyDebtPayments,
    cashTotal,
    savingsBalance,
    billPaymentRate,
    creditScore,
    taxableInvestmentBalance = 0,  // brokerage only (NOT 401k/IRA)
    investmentHaircut = 0.75,      // 0.50 / 0.75 / 1.00 — see risk-tolerance presets
    // Mortgage-aware DTI inputs — when provided, we score housing and total
    // debt separately (lender-standard front-end / back-end DTI) instead
    // of lumping all bills into one ratio.
    monthlyHousingPayment = 0,     // mortgage/rent + escrow-equivalent
    monthlyNonHousingDebt = 0,     // auto loans, student loans, credit cards, etc.
    hasDebtsWithoutMinimumPayment = false, // true when user has debts but no minimums set
}) {
    // Guard: clamp haircut to [0, 1] in case a caller passes garbage.
    const haircut = Math.max(0, Math.min(1, Number(investmentHaircut) || 0));
    // Each entry is evaluated, and only added to `components` if it has
    // enough input data to mean something. `missingComponents` collects
    // the rest for UI onboarding prompts.
    const components = [];
    const missingComponents = [];

    // ── 1. Debt-to-Income (25%) ──────────────
    // Uses the lender-standard split: front-end DTI is housing cost
    // over gross income (healthy ≤28%), back-end DTI is all debt
    // obligations over gross income (healthy ≤36%, FHA max 43%).
    // A mortgage doesn't "ruin" DTI the way credit-card debt does —
    // lenders explicitly expect a housing payment and score it on a
    // separate ratio. We take the WORSE of the two so a user can't get
    // a 100 by having $0 housing if their consumer debt is crushing them.
    //
    // Callers that haven't been updated still pass the legacy
    // monthlyDebtPayments + totalMonthlyBills pair — we fall back to the
    // blended ratio in that case (behaviour-preserving).
    const hasHousingAwareInputs = monthlyHousingPayment > 0 || monthlyNonHousingDebt > 0;
    const hasDtiData = monthlyIncome > 0 ||
        (totalMonthlyBills > 0 || monthlyDebtPayments > 0 || hasHousingAwareInputs);

    if (hasDebtsWithoutMinimumPayment && monthlyDebtPayments === 0 && !hasHousingAwareInputs) {
        // User has debts on file but hasn't set minimum payments.
        // Computing DTI from this would be a lie — surface it as
        // missing data instead so the health score renormalizes and
        // the UI can nudge the user to fill in minimums.
        missingComponents.push({
            name: 'Debt-to-Income',
            icon: '📉',
            tip: 'Add a minimum monthly payment to each debt so DTI can be scored.'
        });
    } else if (hasDtiData) {
        let dtiScore = 100;
        let tipText;
        if (monthlyIncome > 0) {
            if (hasHousingAwareInputs) {
                // Lender-standard breakdown
                const frontEndDti = monthlyHousingPayment / monthlyIncome;
                const backEndDti = (monthlyHousingPayment + monthlyNonHousingDebt) / monthlyIncome;

                const scoreFrontEnd = (r) => {
                    if (r <= 0.28) return 100;
                    if (r <= 0.35) return 85 - (r - 0.28) * (25 / 0.07);   // 85→60
                    if (r <= 0.43) return 60 - (r - 0.35) * (30 / 0.08);   // 60→30
                    return Math.max(0, 30 - (r - 0.43) * 100);
                };
                const scoreBackEnd = (r) => {
                    if (r <= 0.36) return 100;
                    if (r <= 0.43) return 85 - (r - 0.36) * (25 / 0.07);   // 85→60 (FHA band)
                    if (r <= 0.50) return 60 - (r - 0.43) * (30 / 0.07);   // 60→30
                    return Math.max(0, 30 - (r - 0.50) * 100);
                };
                dtiScore = Math.min(scoreFrontEnd(frontEndDti), scoreBackEnd(backEndDti));

                const feP = Math.round(frontEndDti * 100);
                const beP = Math.round(backEndDti * 100);
                tipText = `Housing ${feP}% / total ${beP}% of income. `
                    + (dtiScore >= 80 ? 'Both ratios are in healthy ranges.'
                    : dtiScore >= 50 ? (frontEndDti > 0.28 ? 'Housing ratio is high (aim for ≤28%).'
                                                            : 'Non-housing debt is pushing your back-end ratio up (aim for ≤36%).')
                    : 'Both housing and total-debt ratios are stretched — focus on paying down non-mortgage debt first.');
            } else {
                // Legacy blended calculation
                const dti = (monthlyDebtPayments + totalMonthlyBills) / monthlyIncome;
                if (dti <= 0.30) dtiScore = 100;
                else if (dti <= 0.40) dtiScore = 80 - (dti - 0.30) * 200; // 80→60
                else if (dti <= 0.50) dtiScore = 60 - (dti - 0.40) * 300; // 60→30
                else dtiScore = Math.max(0, 30 - (dti - 0.50) * 100);

                tipText = dtiScore >= 80 ? 'Great! Your debt load is manageable.'
                    : dtiScore >= 50 ? 'Consider reducing monthly obligations.'
                    : 'High debt relative to income — focus on payoff.';
            }
        } else {
            dtiScore = 0; // bills/debt but no income
            tipText = 'Add your income to score this component.';
        }
        dtiScore = clamp(dtiScore);
        components.push({
            name: 'Debt-to-Income',
            score: Math.round(dtiScore),
            weight: 0.25,
            weighted: Math.round(dtiScore * 0.25),
            icon: '📉',
            tip: tipText
        });
    } else {
        missingComponents.push({
            name: 'Debt-to-Income',
            icon: '📉',
            tip: 'Add your income to score this component.'
        });
    }

    // ── 2. Savings Cushion (25%) ─────────────
    // Measures months of expenses a user could cover from their
    // emergency buffer. Counts dedicated savings accounts PLUS taxable
    // investments at 75% (same haircut as Liquid Reserves — reflects
    // market risk, capital gains, and settlement delay). Retirement
    // accounts are NOT counted: the 10% early-withdrawal penalty plus
    // income tax makes them an expensive backstop.
    const savingsInvestmentCredit = Math.max(0, Number(taxableInvestmentBalance) || 0) * haircut;
    const effectiveSavings = (savingsBalance || 0) + savingsInvestmentCredit;
    const monthlyExpenses = totalMonthlyBills + monthlyDebtPayments;
    const hasSavingsData = monthlyExpenses > 0 || effectiveSavings > 0;
    if (hasSavingsData) {
        let savingsScore = 0;
        if (monthlyExpenses > 0) {
            const monthsCovered = effectiveSavings / monthlyExpenses;
            if (monthsCovered >= 6) savingsScore = 100;
            else savingsScore = (monthsCovered / 6) * 100;
        } else if (effectiveSavings > 0) {
            savingsScore = 100; // reserves and no tracked expenses
        }
        savingsScore = clamp(savingsScore);
        const hasInvestedPortion = savingsInvestmentCredit > 0;
        components.push({
            name: 'Savings Cushion',
            score: Math.round(savingsScore),
            weight: 0.25,
            weighted: Math.round(savingsScore * 0.25),
            icon: '🏦',
            tip: savingsScore >= 80
                ? (hasInvestedPortion
                    ? 'Excellent buffer — savings + taxable investments cover 6+ months.'
                    : 'Excellent savings buffer!')
                : savingsScore >= 50
                    ? 'Building toward 6 months of expenses (cash or brokerage counts).'
                    : 'Try to build an emergency fund — savings or taxable brokerage both count.'
        });
    } else {
        missingComponents.push({
            name: 'Savings Cushion',
            icon: '🏦',
            tip: 'Add bills, a savings balance, or a taxable brokerage account to score this.'
        });
    }

    // ── 3. Bill Payment History (25%) ────────
    // Requires actual payment-rate data. null = insufficient history.
    if (billPaymentRate != null) {
        const paymentScore = clamp(billPaymentRate * 100);
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
    } else {
        missingComponents.push({
            name: 'Payment History',
            icon: '✅',
            tip: 'Add bills and track payments to score this component.'
        });
    }

    // ── 4. Credit Score (15%) ────────────────
    // Requires a user-provided credit score in the valid FICO range.
    if (creditScore && creditScore >= 300) {
        const creditSubScore = clamp(((creditScore - 300) / 550) * 100);
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
    } else {
        missingComponents.push({
            name: 'Credit Score',
            icon: '📊',
            tip: 'Add your credit score in Settings to score this component.'
        });
    }

    // ── 5. Liquid Reserves (10%) ─────────────
    // Emergency-fund component. Counts cash (checking/savings) PLUS
    // taxable investments at 75% to reflect market risk (~10-20%
    // drawdown), capital-gains tax (~15-20% on realized gains), and
    // 1-3 day settlement. Retirement accounts are EXCLUDED — the 10%
    // early-withdrawal penalty plus income tax makes them a poor
    // emergency backstop. Caller passes `taxableInvestmentBalance`
    // from `type === 'investment'` accounts only.
    const investmentCredit = Math.max(0, Number(taxableInvestmentBalance) || 0) * haircut;
    const liquidReserves = cashTotal + investmentCredit;
    const hasLiquidityData = monthlyIncome > 0 || liquidReserves > 0;
    if (hasLiquidityData) {
        let liquidityScore = 0;
        if (monthlyIncome > 0) {
            const liquidMonths = liquidReserves / monthlyIncome;
            if (liquidMonths >= 3) liquidityScore = 100;
            else liquidityScore = (liquidMonths / 3) * 100;
        } else if (liquidReserves > 0) {
            liquidityScore = 75;
        }
        liquidityScore = clamp(liquidityScore);
        const hasInvestedPortion = investmentCredit > 0;
        components.push({
            name: 'Liquid Reserves',
            score: Math.round(liquidityScore),
            weight: 0.10,
            weighted: Math.round(liquidityScore * 0.10),
            icon: '💵',
            tip: liquidityScore >= 80
                ? (hasInvestedPortion
                    ? 'Strong liquidity — cash + taxable investments cover 3+ months.'
                    : 'Strong cash position!')
                : liquidityScore >= 40
                    ? 'Building toward 3 months of income in liquid assets.'
                    : 'Aim for 3 months of income in cash or taxable brokerage.'
        });
    } else {
        missingComponents.push({
            name: 'Liquid Reserves',
            icon: '💵',
            tip: 'Add an income or account balance (cash or brokerage) to score this component.'
        });
    }

    // ── Overall Score (renormalized) ─────────
    // If Credit Score is missing we don't want a 15pt hole in the total —
    // the remaining components expand proportionally to cover the gap.
    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    let totalScore = 0;
    if (totalWeight > 0) {
        totalScore = components.reduce(
            (s, c) => s + c.score * (c.weight / totalWeight),
            0
        );
    }
    totalScore = Math.round(clamp(totalScore));

    // ── Completeness ─────────────────────────
    // 'full'         — all 5 components had data
    // 'partial'      — 3-4 components (score is meaningful but flagged)
    // 'insufficient' — 0-2 components (show as "not ready yet")
    let completeness;
    if (components.length >= 5) completeness = 'full';
    else if (components.length >= 3) completeness = 'partial';
    else completeness = 'insufficient';

    return {
        score: totalScore,
        grade: getHealthGrade(totalScore),
        components,
        missingComponents,
        completeness,
    };
}

function clamp(v) {
    return Math.max(0, Math.min(100, v));
}

function getHealthGrade(score) {
    // Emojis chosen to read as grade badges, not system alerts — no
    // "⚠️" or "🚨" which look like calculation errors in UI chrome.
    if (score >= 90) return { label: 'Excellent',  color: 'var(--green)',  emoji: '🌟' };
    if (score >= 75) return { label: 'Good',       color: 'var(--accent)', emoji: '👍' };
    if (score >= 55) return { label: 'Fair',        color: 'var(--yellow)', emoji: '📊' };
    if (score >= 35) return { label: 'Needs Work',  color: 'var(--orange)', emoji: '📉' };
    return                   { label: 'Critical',   color: 'var(--red)',    emoji: '🔻' };
}

// ─── Pay Period Building ──────────────────────────

/**
 * Build the per-paycheck cashflow "pay periods" structure used by the bills
 * cashflow view and dashboard widget. Each period runs from one pay date to
 * the next, with bills and other-income occurrences assigned to it.
 *
 * @param {Date[]} payDates — sorted ascending
 * @param {Array}  bills
 * @param {object} store
 * @param {object} income — must expose .user.payAmount
 * @param {number} year
 * @param {number} month
 * @param {Array}  [coveredDepBills]
 * @param {Array}  [otherIncomeSources]
 */
export function buildPayPeriods(payDates, bills, store, income, year, month, coveredDepBills = [], otherIncomeSources = []) {
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

            // Expand recurring bills into individual occurrences
            const expanded = expandBillOccurrences(bill, periodStart, periodEnd, payDatesInPeriod);
            if (expanded !== null) {
                periodBills.push(...expanded);
            } else {
                // Monthly bill — check due day
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
