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
 * @param {object} budget
 * @param {Array} expenses
 * @param {string} asOfMonth — 'YYYY-MM'
 * @returns {{
 *   category: string,
 *   monthlyAmount: number,
 *   rollover: boolean,
 *   month: string,
 *   rolledIn: number,      // balance carried from prior month (0 if rollover:false)
 *   available: number,     // monthlyAmount + rolledIn
 *   spent: number,         // sum of qualifying expenses in this month
 *   remaining: number,     // available - spent (negative = over)
 *   rolledOut: number,     // carried to next month (always 0 if rollover:false)
 *   pctUsed: number        // spent / available, clamped [0, +∞)
 * }}
 */
export function computeBudgetStatus(budget, expenses, asOfMonth) {
    const startMonth = budget.startMonth || asOfMonth;
    if (isMonthBefore(asOfMonth, startMonth)) {
        // Budget hasn't started yet
        return {
            category: budget.category,
            monthlyAmount: budget.monthlyAmount,
            rollover: !!budget.rollover,
            month: asOfMonth,
            rolledIn: 0,
            available: 0,
            spent: 0,
            remaining: 0,
            rolledOut: 0,
            pctUsed: 0,
            notStarted: true,
        };
    }

    const qualifies = (e) =>
        !e.ignored
        && !(Array.isArray(e.splitChildren) && e.splitChildren.length > 0)
        && (e.category || 'other') === budget.category;

    // Walk every month from startMonth to asOfMonth, computing rolledOut each step.
    let rolledIn = 0;
    let cursor = startMonth;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const available = Number(budget.monthlyAmount || 0) + rolledIn;
        const spent = expenses
            .filter(e => qualifies(e) && (e.date || '').startsWith(cursor))
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

        if (cursor === asOfMonth) {
            const remaining = available - spent;
            return {
                category: budget.category,
                monthlyAmount: Number(budget.monthlyAmount || 0),
                rollover: !!budget.rollover,
                month: cursor,
                rolledIn,
                available,
                spent,
                remaining,
                rolledOut: budget.rollover ? remaining : 0,
                pctUsed: available > 0 ? spent / available : (spent > 0 ? Infinity : 0),
            };
        }

        // Advance: roll out into next month only if rollover is enabled.
        rolledIn = budget.rollover ? (available - spent) : 0;
        cursor = addMonth(cursor, 1);

        // Safety brake: stop if we somehow walk past asOfMonth without finding it.
        if (isMonthBefore(asOfMonth, cursor)) {
            return {
                category: budget.category,
                monthlyAmount: Number(budget.monthlyAmount || 0),
                rollover: !!budget.rollover,
                month: asOfMonth,
                rolledIn: 0,
                available: 0,
                spent: 0,
                remaining: 0,
                rolledOut: 0,
                pctUsed: 0,
                notStarted: true,
            };
        }
    }
}

/**
 * Compute statuses for every budget, as of a given month. Budgets without
 * statuses (not yet started) are included with `notStarted: true`.
 */
export function computeAllBudgetStatuses(budgets, expenses, asOfMonth) {
    return (budgets || []).map(b => computeBudgetStatus(b, expenses, asOfMonth));
}

/**
 * Aggregate top-line totals across all budgets for the given month.
 */
export function computeBudgetTotals(statuses) {
    const active = statuses.filter(s => !s.notStarted);
    const monthlyAmount = active.reduce((s, b) => s + b.monthlyAmount, 0);
    const rolledIn = active.reduce((s, b) => s + b.rolledIn, 0);
    const available = active.reduce((s, b) => s + b.available, 0);
    const spent = active.reduce((s, b) => s + b.spent, 0);
    const remaining = available - spent;
    return { monthlyAmount, rolledIn, available, spent, remaining };
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
