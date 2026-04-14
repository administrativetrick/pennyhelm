/**
 * RecurringService — detects recurring transactions from Plaid expense data
 * and suggests new bills. Also flags irregular/unusual charges.
 *
 * Pure functions — all operate on data passed in, no side effects.
 */

// ─── Recurring Transaction Detection ─────────────

/**
 * Analyze expenses to detect recurring patterns.
 *
 * Algorithm:
 * 1. Group transactions by normalized merchant name
 * 2. For each merchant group, analyze date intervals
 * 3. If intervals cluster around a frequency (weekly/biweekly/monthly/quarterly/yearly),
 *    flag as recurring with confidence score
 * 4. Filter out merchants already tracked as Bills
 * 5. Filter out dismissed suggestions
 *
 * @param {Array} expenses - All expenses from store
 * @param {Array} bills - Existing bills from store
 * @param {Array} dismissedIds - Merchant keys the user has dismissed
 * @returns {{ recurring: Array, irregular: Array }}
 */
export function detectRecurringTransactions(expenses, bills, dismissedIds = []) {
    if (!expenses || expenses.length === 0) return { recurring: [], irregular: [] };

    // Only analyze Plaid-sourced expenses (manual ones are already tracked)
    const plaidExpenses = expenses.filter(e => e.source === 'plaid');
    if (plaidExpenses.length === 0) return { recurring: [], irregular: [] };

    // Group by normalized merchant key
    const groups = groupByMerchant(plaidExpenses);

    const recurring = [];
    const irregular = [];

    // Existing bill names (normalized) for matching
    const billNames = new Set(
        (bills || []).map(b => normalizeMerchant(b.name))
    );

    const dismissedSet = new Set(dismissedIds || []);

    for (const [merchantKey, txns] of Object.entries(groups)) {
        // Need at least 2 transactions to detect a pattern
        if (txns.length < 2) continue;

        // Skip if already tracked as a bill
        if (billNames.has(merchantKey)) continue;

        // Skip if user dismissed this suggestion
        if (dismissedSet.has(merchantKey)) continue;

        // Sort by date ascending
        txns.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Analyze recurrence pattern
        const pattern = analyzePattern(txns);

        if (pattern.isRecurring) {
            recurring.push({
                merchantKey,
                merchantName: txns[txns.length - 1].name, // most recent name
                category: txns[txns.length - 1].category,
                frequency: pattern.frequency,
                averageAmount: pattern.averageAmount,
                lastAmount: txns[txns.length - 1].amount,
                lastDate: txns[txns.length - 1].date,
                estimatedDueDay: pattern.estimatedDueDay,
                occurrences: txns.length,
                confidence: pattern.confidence,
                amountVariance: pattern.amountVariance,
                transactions: txns.slice(-6), // last 6 for display
            });
        }

        // Check for irregular amounts within recurring charges
        if (txns.length >= 3) {
            const irregularTxn = detectIrregularAmount(txns);
            if (irregularTxn) {
                irregular.push(irregularTxn);
            }
        }
    }

    // Sort recurring by confidence (highest first), then by occurrence count
    recurring.sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);

    // Sort irregular by how unusual they are (highest deviation first)
    irregular.sort((a, b) => b.deviation - a.deviation);

    return { recurring, irregular };
}

// ─── Merchant Grouping ───────────────────────────

/**
 * Normalize a merchant name for grouping:
 * - Lowercase
 * - Strip trailing digits/IDs (e.g., "Netflix #12345" → "netflix")
 * - Strip common suffixes
 * - Collapse whitespace
 */
export function normalizeMerchant(name) {
    if (!name) return 'unknown';
    return name
        .toLowerCase()
        .replace(/[*#]\s*\d+/g, '')       // Strip *1234, #5678
        .replace(/\s*(inc|llc|ltd|corp|co)\s*\.?$/i, '')  // Strip Inc, LLC, etc.
        .replace(/\s+\d{3,}$/g, '')        // Strip trailing ID numbers
        .replace(/[^\w\s]/g, '')           // Strip special chars
        .replace(/\s+/g, ' ')             // Collapse whitespace
        .trim();
}

function groupByMerchant(expenses) {
    const groups = {};
    for (const exp of expenses) {
        const key = normalizeMerchant(exp.vendor || exp.name);
        if (!groups[key]) groups[key] = [];
        groups[key].push(exp);
    }
    return groups;
}

// ─── Pattern Analysis ────────────────────────────

const FREQUENCY_RANGES = {
    weekly:     { min: 5,   max: 9,   label: 'weekly',     dayLabel: 'Weekly' },
    biweekly:   { min: 12,  max: 17,  label: 'biweekly',   dayLabel: 'Every 2 Weeks' },
    monthly:    { min: 26,  max: 35,  label: 'monthly',    dayLabel: 'Monthly' },
    quarterly:  { min: 85,  max: 100, label: 'quarterly',  dayLabel: 'Quarterly' },
    semiannual: { min: 170, max: 200, label: 'semi-annual', dayLabel: 'Semi-Annual' },
    yearly:     { min: 350, max: 380, label: 'yearly',     dayLabel: 'Yearly' },
};

function analyzePattern(txns) {
    const result = {
        isRecurring: false,
        frequency: null,
        averageAmount: 0,
        estimatedDueDay: null,
        confidence: 0,
        amountVariance: 0,
    };

    if (txns.length < 2) return result;

    // Calculate intervals between consecutive transactions (in days)
    const intervals = [];
    for (let i = 1; i < txns.length; i++) {
        const daysDiff = daysBetween(txns[i - 1].date, txns[i].date);
        if (daysDiff > 0) intervals.push(daysDiff);
    }

    if (intervals.length === 0) return result;

    // Average and median interval
    const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const medianInterval = median(intervals);

    // Match interval against known frequencies
    let bestMatch = null;
    let bestScore = 0;

    for (const [, freq] of Object.entries(FREQUENCY_RANGES)) {
        const mid = (freq.min + freq.max) / 2;
        const range = (freq.max - freq.min) / 2;

        // How many intervals fall within this frequency range (with tolerance)
        const tolerance = range * 0.5; // 50% extra tolerance
        const matchingIntervals = intervals.filter(
            i => i >= freq.min - tolerance && i <= freq.max + tolerance
        );
        const matchRate = matchingIntervals.length / intervals.length;

        // How close is median interval to this frequency's midpoint
        const proximityScore = 1 - Math.min(1, Math.abs(medianInterval - mid) / mid);

        const score = matchRate * 0.6 + proximityScore * 0.4;

        if (score > bestScore && matchRate >= 0.5) {
            bestScore = score;
            bestMatch = freq;
        }
    }

    if (!bestMatch || bestScore < 0.4) return result;

    // Calculate amounts
    const amounts = txns.map(t => t.amount);
    const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const amountStdDev = stdDev(amounts);
    const amountVariance = avgAmount > 0 ? amountStdDev / avgAmount : 0;

    // Amount consistency boosts confidence
    // Fixed amounts (subscriptions) get higher confidence
    const amountConsistencyBonus = amountVariance < 0.05 ? 0.2 : amountVariance < 0.15 ? 0.1 : 0;

    // More occurrences = higher confidence
    const occurrenceBonus = Math.min(0.2, txns.length * 0.03);

    const confidence = Math.min(1, bestScore + amountConsistencyBonus + occurrenceBonus);

    // Estimate due day from most recent transactions
    const recentDates = txns.slice(-3).map(t => new Date(t.date).getDate());
    const estimatedDueDay = Math.round(recentDates.reduce((s, v) => s + v, 0) / recentDates.length);

    result.isRecurring = confidence >= 0.45;
    result.frequency = bestMatch.label;
    result.averageAmount = Math.round(avgAmount * 100) / 100;
    result.estimatedDueDay = estimatedDueDay;
    result.confidence = Math.round(confidence * 100) / 100;
    result.amountVariance = Math.round(amountVariance * 100) / 100;

    return result;
}

// ─── Irregular Amount Detection ──────────────────

/**
 * Detect if the most recent transaction is unusually different from
 * the merchant's normal charges (>2 standard deviations).
 */
function detectIrregularAmount(txns) {
    const amounts = txns.map(t => t.amount);
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const sd = stdDev(amounts);

    if (sd === 0 || avg === 0) return null;

    const latest = txns[txns.length - 1];
    const deviation = Math.abs(latest.amount - avg) / sd;

    // Flag if >2 standard deviations from mean and differs by >$10
    if (deviation > 2 && Math.abs(latest.amount - avg) > 10) {
        return {
            merchantKey: normalizeMerchant(latest.vendor || latest.name),
            merchantName: latest.name,
            amount: latest.amount,
            expectedAmount: Math.round(avg * 100) / 100,
            date: latest.date,
            deviation: Math.round(deviation * 100) / 100,
            category: latest.category,
            direction: latest.amount > avg ? 'higher' : 'lower',
            differenceAmount: Math.round(Math.abs(latest.amount - avg) * 100) / 100,
        };
    }

    return null;
}

// ─── Utility Functions ───────────────────────────

function daysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return Math.round(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
}

function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(arr) {
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

// ─── Bill Suggestion Builder ─────────────────────

/**
 * Convert a recurring detection into a Bill-ready object.
 */
export function buildBillSuggestion(recurring) {
    return {
        name: recurring.merchantName,
        amount: recurring.amountVariance < 0.05
            ? recurring.lastAmount                          // fixed amount
            : Math.round(recurring.averageAmount * 100) / 100, // variable — use average
        frequency: recurring.frequency,
        dueDay: recurring.estimatedDueDay,
        category: mapExpenseCategoryToBillCategory(recurring.category),
        autoPay: false,
        frozen: false,
        notes: 'Auto-detected from transactions (' + recurring.occurrences + ' occurrences)',
    };
}

function mapExpenseCategoryToBillCategory(expenseCategory) {
    const map = {
        'groceries': 'Groceries',
        'dining': 'Dining',
        'gas': 'Transportation',
        'transportation': 'Transportation',
        'shopping': 'Shopping',
        'entertainment': 'Entertainment',
        'healthcare': 'Health',
        'personal-care': 'Personal',
        'home': 'Housing',
        'utilities': 'Utilities',
        'education': 'Education',
        'travel': 'Travel',
        'gifts': 'Other',
        'subscriptions': 'Subscriptions',
        'pets': 'Other',
        'other': 'Other',
    };
    return map[expenseCategory] || 'Other';
}
