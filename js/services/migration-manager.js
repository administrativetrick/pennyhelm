/**
 * MigrationManager — handles data format migrations for legacy compatibility.
 *
 * Extracted from Store so migration logic is isolated and testable.
 * All functions are pure — they mutate the data object and return whether changes were made.
 */

/**
 * Migrate legacy key names (e.g., hardcoded user names → generic user/dependent).
 * @param {object} data - The full data object
 * @returns {boolean} Whether any changes were made
 */
export function migrateKeyNames(data) {
    let changed = false;

    // Migrate legacy income keys to generic user/dependent
    const legacyUserKeys = ['curtis'];
    const legacyDepKeys = ['ivy'];

    legacyUserKeys.forEach(key => {
        if (data.income && data.income[key] && !data.income.user) {
            data.income.user = data.income[key];
            delete data.income[key];
            changed = true;
        }
        if (data.creditScores && data.creditScores[key] && !data.creditScores.user) {
            data.creditScores.user = data.creditScores[key];
            delete data.creditScores[key];
            changed = true;
        }
    });

    legacyDepKeys.forEach(key => {
        if (data.income && data.income[key] && !data.income.dependent) {
            data.income.dependent = data.income[key];
            delete data.income[key];
            changed = true;
        }
        if (data.creditScores && data.creditScores[key] && !data.creditScores.dependent) {
            data.creditScores.dependent = data.creditScores[key];
            delete data.creditScores[key];
            changed = true;
        }
    });

    // Migrate legacy dependent bills array name
    const legacyBillArrays = ['ivyBills'];
    legacyBillArrays.forEach(key => {
        if (data[key] && !data.dependentBills) {
            data.dependentBills = data[key];
            delete data[key];
            changed = true;
        }
    });

    // Migrate legacy covering field on dependent bills
    const depBills = data.dependentBills || [];
    const legacyCoveringKeys = ['curtisCovering'];
    depBills.forEach(bill => {
        legacyCoveringKeys.forEach(key => {
            if (key in bill) {
                bill.userCovering = bill[key];
                delete bill[key];
                changed = true;
            }
        });
    });

    // Migrate dependent bills into main bills array with owner field
    if (data.dependentBills && data.dependentBills.length > 0) {
        data.dependentBills.forEach(depBill => {
            if (!data.bills.find(b => b.id === depBill.id)) {
                data.bills.push({
                    ...depBill,
                    owner: 'dependent',
                    category: depBill.category || 'Dependent Bill',
                    frequency: depBill.frequency || 'monthly',
                    paymentSource: depBill.paymentSource || ''
                });
            }
        });
        data.dependentBills = [];
        changed = true;
    }

    // Ensure all bills have an owner field
    data.bills.forEach(bill => {
        if (!bill.owner) {
            bill.owner = 'user';
            changed = true;
        }
    });

    return changed;
}

/**
 * Normalize every stored category string to its canonical EXPENSE_CATEGORIES key.
 *
 * Before this existed, bills/rules/expenses/budgets were stored with whatever
 * case the user typed ("Mortgage", "Groceries", etc.). The budget matcher does
 * strict `===`, so a rule that wrote `"Mortgage"` never hit a `"mortgage"`
 * budget. This migration walks every stored value once and rewrites it to the
 * canonical key when we can confidently match.
 *
 * SAFETY: `normalizeFn` (injected so this module stays pure/testable) MUST
 * pass through unknown values unchanged. Custom user categories and garbage
 * strings both survive untouched — we only rewrite when we know the target.
 *
 * @param {object} data - The full data object (mutated in place)
 * @param {(value: string) => string|null} normalizeFn - canonical-key mapper
 * @returns {boolean} Whether any value was rewritten
 */
export function migrateCategoryKeys(data, normalizeFn) {
    if (!data || typeof normalizeFn !== 'function') return false;
    let changed = false;

    const normalizeField = (obj, field) => {
        if (!obj) return;
        const current = obj[field];
        if (current == null || current === '') return;
        const next = normalizeFn(current);
        if (next != null && next !== current) {
            obj[field] = next;
            changed = true;
        }
    };

    for (const expense of data.expenses || []) {
        normalizeField(expense, 'category');
    }
    for (const bill of data.bills || []) {
        normalizeField(bill, 'expenseCategory');
    }
    for (const rule of data.transactionRules || []) {
        if (rule && rule.actions) {
            normalizeField(rule.actions, 'category');
        }
    }
    for (const budget of data.categoryBudgets || []) {
        normalizeField(budget, 'category');
    }

    // Budgets have a uniqueness invariant (one per category). If normalization
    // collapsed two rows into the same key (e.g. "Mortgage" + "mortgage"),
    // keep the later entry — it was almost certainly the user's most recent
    // attempt to create the budget after the first one appeared to not work.
    if (Array.isArray(data.categoryBudgets)) {
        const byKey = new Map();
        for (const b of data.categoryBudgets) {
            const key = String(b?.category || '').toLowerCase();
            if (!key) continue;
            byKey.set(key, b); // later entries overwrite earlier
        }
        const deduped = [...byKey.values()];
        if (deduped.length !== data.categoryBudgets.length) {
            data.categoryBudgets = deduped;
            changed = true;
        }
    }

    return changed;
}

/**
 * Migrate old monthly balance history entries to daily format.
 * @param {Array} balanceHistory - The balance history array
 * @returns {boolean} Whether any changes were made
 */
export function migrateBalanceHistory(balanceHistory) {
    if (!balanceHistory) return false;
    let changed = false;

    for (const h of balanceHistory) {
        if (h.month && !h.date) {
            h.date = h.month + '-01';
            delete h.month;
            delete h.snapshotDate;
            changed = true;
        }
    }

    return changed;
}
