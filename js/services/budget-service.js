/**
 * Category budget engine — pure functions for month-by-month rollover.
 *
 * A budget has this shape:
 *   {
 *     id: string,
 *     category: string,        // matches EXPENSE_CATEGORIES key
 *     monthlyAmount: number,
 *     rollover: boolean,       // carry unspent / overspent into next month
 *     startMonth: 'YYYY-MM',   // first month the budget applies to
 *     notes?: string
 *   }
 *
 * The month-by-month computation walks from the budget's startMonth up to
 * the requested month, tracking `rolledOut` each month and feeding it into
 * the next month's `rolledIn`. A budget's "status" for a given month is
 * therefore always derivable from (budget + all expenses from startMonth
 * through now) — no materialized history needed.
 */

// ─── Date helpers ─────────────────────────────────────────────────

/** 'YYYY-MM' for the month containing a given Date (or "now" if omitted). */
export function monthKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Next month key given 'YYYY-MM'. */
export function addMonth(key, delta = 1) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** True if monthA < monthB (both 'YYYY-MM'). */
export function isMonthBefore(a, b) {
    return a < b; // lexicographic comparison works for 'YYYY-MM'
}

// ─── Core calculation ─────────────────────────────────────────────

/**
 * Compute the status of a single budget for a given `asOfMonth`.
 *
 * Bills can contribute to a category budget by setting `bill.expenseCategory`
 * to a category key. Callers pass a `getBillSpendForMonth(category, monthKey)`
 * function that returns the total bill amount in that category in that month;
 * this keeps the core engine pure and avoids coupling it to the bill-occurrence
 * date math which lives in financial-service.
 *
 * @param {object} budget
 * @param {Array} expenses
 * @param {string} asOfMonth — 'YYYY-MM'
 * @param {(category: string, monthKey: string) => number} [getBillSpendForMonth]
 *   Optional callback returning the total bill amount for a category in a month.
 *   If omitted, budgets only count manual / Plaid expenses.
 * @returns {{
 *   category: string,
 *   monthlyAmount: number,
 *   rollover: boolean,
 *   month: string,
 *   rolledIn: number,        // balance carried from prior month (0 if rollover:false)
 *   available: number,       // monthlyAmount + rolledIn
 *   expenseSpent: number,    // sum of qualifying expenses this month
 *   billSpent: number,       // sum of bill occurrences in this category this month
 *   spent: number,           // expenseSpent + billSpent
 *   remaining: number,       // available - spent (negative = over)
 *   rolledOut: number,       // carried to next month (always 0 if rollover:false)
 *   pctUsed: number          // spent / available
 * }}
 */
export function computeBudgetStatus(budget, expenses, asOfMonth, getBillSpendForMonth) {
    const startMonth = budget.startMonth || asOfMonth;
    if (isMonthBefore(asOfMonth, startMonth)) {
        return emptyStatus(budget, asOfMonth, true);
    }

    // Compare categories case-insensitively. Legacy data + user-typed rule
    // values mix capitalized labels and lowercase keys (e.g. "Mortgage" vs
    // "mortgage", "Groceries" vs "groceries"). A one-time migration backfills
    // canonical keys, but this comparator is the safety net so a single
    // stray value can't silently zero out a whole budget.
    const budgetCat = String(budget.category || '').toLowerCase();
    const qualifies = (e) =>
        !e.ignored
        && !(Array.isArray(e.splitChildren) && e.splitChildren.length > 0)
        && String(e.category || 'other').toLowerCase() === budgetCat;

    // Walk every month from startMonth to asOfMonth, computing rolledOut each step.
    let rolledIn = 0;
    let cursor = startMonth;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const available = Number(budget.monthlyAmount || 0) + rolledIn;
        const expenseSpent = expenses
            .filter(e => qualifies(e) && (e.date || '').startsWith(cursor))
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const billSpent = typeof getBillSpendForMonth === 'function'
            ? Number(getBillSpendForMonth(budget.category, cursor)) || 0
            : 0;
        const spent = expenseSpent + billSpent;

        if (cursor === asOfMonth) {
            const remaining = available - spent;
            return {
                category: budget.category,
                monthlyAmount: Number(budget.monthlyAmount || 0),
                rollover: !!budget.rollover,
                month: cursor,
                rolledIn,
                available,
                expenseSpent,
                billSpent,
                spent,
                remaining,
                rolledOut: budget.rollover ? remaining : 0,
                pctUsed: available > 0 ? spent / available : (spent > 0 ? Infinity : 0),
            };
        }

        rolledIn = budget.rollover ? (available - spent) : 0;
        cursor = addMonth(cursor, 1);

        // Safety brake — shouldn't trigger in practice since asOfMonth >= startMonth.
        if (isMonthBefore(asOfMonth, cursor)) return emptyStatus(budget, asOfMonth, true);
    }
}

function emptyStatus(budget, month, notStarted = false) {
    return {
        category: budget.category,
        monthlyAmount: Number(budget.monthlyAmount || 0),
        rollover: !!budget.rollover,
        month,
        rolledIn: 0,
        available: 0,
        expenseSpent: 0,
        billSpent: 0,
        spent: 0,
        remaining: 0,
        rolledOut: 0,
        pctUsed: 0,
        ...(notStarted ? { notStarted: true } : {}),
    };
}

/**
 * Compute statuses for every budget, as of a given month. Budgets that haven't
 * started in `asOfMonth` come back with `notStarted: true`.
 */
export function computeAllBudgetStatuses(budgets, expenses, asOfMonth, getBillSpendForMonth) {
    return (budgets || []).map(b => computeBudgetStatus(b, expenses, asOfMonth, getBillSpendForMonth));
}

/**
 * Aggregate top-line totals across all budgets for the given month.
 */
export function computeBudgetTotals(statuses) {
    const active = statuses.filter(s => !s.notStarted);
    const monthlyAmount = active.reduce((s, b) => s + b.monthlyAmount, 0);
    const rolledIn = active.reduce((s, b) => s + b.rolledIn, 0);
    const available = active.reduce((s, b) => s + b.available, 0);
    const expenseSpent = active.reduce((s, b) => s + (b.expenseSpent || 0), 0);
    const billSpent = active.reduce((s, b) => s + (b.billSpent || 0), 0);
    const spent = active.reduce((s, b) => s + b.spent, 0);
    const remaining = available - spent;
    return { monthlyAmount, rolledIn, available, expenseSpent, billSpent, spent, remaining };
}

/** Basic shape validation before persisting. */
export function validateBudget(budget) {
    if (!budget || typeof budget !== 'object') return 'Budget must be an object';
    if (!budget.category || typeof budget.category !== 'string') return 'Category is required';
    const amount = Number(budget.monthlyAmount);
    if (!Number.isFinite(amount) || amount <= 0) return 'Monthly amount must be a positive number';
    if (!budget.startMonth || !/^\d{4}-\d{2}$/.test(budget.startMonth)) return 'Start month must be in YYYY-MM format';
    return null;
}
