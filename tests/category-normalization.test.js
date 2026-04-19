/**
 * Tests for category key normalization — the glue that lets budgets match
 * bill/expense/rule values regardless of whether the user typed "Mortgage"
 * or "mortgage" or the Plaid import wrote "Groceries".
 *
 * Covers three layers:
 *   1. normalizeCategoryKey()        — pure mapper, the canonical coercion
 *   2. budget-service case-insensitivity — the runtime safety net
 *   3. migrateCategoryKeys()         — the one-time data cleanup
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCategoryKey } from '../js/expense-categories.js';
import { computeBudgetStatus } from '../js/services/budget-service.js';
import { migrateCategoryKeys } from '../js/services/migration-manager.js';

// ─── normalizeCategoryKey ─────────────────────────────────────────────

describe('normalizeCategoryKey', () => {
    test('canonical lowercase key round-trips unchanged', () => {
        assert.equal(normalizeCategoryKey('mortgage'), 'mortgage');
        assert.equal(normalizeCategoryKey('groceries'), 'groceries');
        assert.equal(normalizeCategoryKey('gas'), 'gas');
    });

    test('uppercased key maps back to lowercase key', () => {
        assert.equal(normalizeCategoryKey('MORTGAGE'), 'mortgage');
        assert.equal(normalizeCategoryKey('Gas'), 'gas');
    });

    test('display label maps to its canonical key', () => {
        assert.equal(normalizeCategoryKey('Mortgage'), 'mortgage');
        assert.equal(normalizeCategoryKey('Groceries'), 'groceries');
        assert.equal(normalizeCategoryKey('Rent'), 'rent');
        assert.equal(normalizeCategoryKey('Gas / Fuel'), 'gas');
        assert.equal(normalizeCategoryKey('Credit Card Payment'), 'credit-card-payment');
    });

    test('label with mixed casing still matches', () => {
        assert.equal(normalizeCategoryKey('gROceries'), 'groceries');
        assert.equal(normalizeCategoryKey('CREDIT CARD PAYMENT'), 'credit-card-payment');
    });

    test('slugified label matches when an exact key exists', () => {
        // "Home (General)" is a label whose key is "home" — slug of the label
        // becomes "home-general" which is NOT a key, so we fall through to
        // pass-through. That's correct: we only coerce when confident.
        // But a slug that IS a key (e.g. typed with dashes) should match:
        assert.equal(normalizeCategoryKey('credit-card-payment'), 'credit-card-payment');
        assert.equal(normalizeCategoryKey('home-repair'), 'home-repair');
    });

    test('unknown custom category passes through trimmed', () => {
        assert.equal(normalizeCategoryKey('CashAppFees'), 'CashAppFees');
        assert.equal(normalizeCategoryKey('  my-custom-slug  '), 'my-custom-slug');
    });

    test('empty / null / undefined returns null', () => {
        assert.equal(normalizeCategoryKey(null), null);
        assert.equal(normalizeCategoryKey(undefined), null);
        assert.equal(normalizeCategoryKey(''), null);
        assert.equal(normalizeCategoryKey('   '), null);
    });

    test('ambiguous input — group name is NOT a category key', () => {
        // "Housing" is a group, not a category. Must pass through so we don't
        // accidentally map every "Housing" bill to "rent" or "mortgage".
        assert.equal(normalizeCategoryKey('Housing'), 'Housing');
        assert.equal(normalizeCategoryKey('Food & Drink'), 'Food & Drink');
    });

    test('custom category via store lookup maps to its key', () => {
        const store = {
            getCustomExpenseCategories: () => [
                { key: 'cash-app-fees', name: 'Cash App Fees', color: '#000' },
            ],
        };
        assert.equal(normalizeCategoryKey('Cash App Fees', store), 'cash-app-fees');
        assert.equal(normalizeCategoryKey('cash-app-fees', store), 'cash-app-fees');
    });
});

// ─── computeBudgetStatus — case-insensitive safety net ────────────────

describe('computeBudgetStatus is case-insensitive', () => {
    const budget = {
        id: 'b1', category: 'groceries', monthlyAmount: 500,
        rollover: false, startMonth: '2026-04',
    };

    test('expenses with display-label casing still count', () => {
        const expenses = [
            { date: '2026-04-01', amount: 100, category: 'Groceries' },  // capital
            { date: '2026-04-15', amount: 50,  category: 'groceries' },  // lowercase
            { date: '2026-04-20', amount: 25,  category: 'GROCERIES' },  // yelling
        ];
        const status = computeBudgetStatus(budget, expenses, '2026-04');
        assert.equal(status.expenseSpent, 175);
        assert.equal(status.spent, 175);
    });

    test('budget category stored with label casing still matches lowercase expenses', () => {
        const displayBudget = { ...budget, category: 'Groceries' };
        const expenses = [
            { date: '2026-04-01', amount: 100, category: 'groceries' },
        ];
        const status = computeBudgetStatus(displayBudget, expenses, '2026-04');
        assert.equal(status.expenseSpent, 100);
    });

    test('unrelated categories still do not match', () => {
        const expenses = [
            { date: '2026-04-01', amount: 100, category: 'dining' },
            { date: '2026-04-15', amount: 50,  category: 'Dining' },
        ];
        const status = computeBudgetStatus(budget, expenses, '2026-04');
        assert.equal(status.expenseSpent, 0);
    });
});

// ─── migrateCategoryKeys ──────────────────────────────────────────────

describe('migrateCategoryKeys', () => {
    const normalize = (v) => normalizeCategoryKey(v);

    test('no-op on already-canonical data', () => {
        const data = {
            expenses: [{ id: 'e1', category: 'mortgage', amount: 100 }],
            bills:    [{ id: 'b1', expenseCategory: 'rent' }],
            transactionRules: [{ id: 'r1', actions: { category: 'groceries' } }],
            categoryBudgets: [{ id: 'g1', category: 'mortgage', monthlyAmount: 2000 }],
        };
        const before = JSON.stringify(data);
        const changed = migrateCategoryKeys(data, normalize);
        assert.equal(changed, false);
        assert.equal(JSON.stringify(data), before);
    });

    test('rewrites display labels to canonical keys', () => {
        const data = {
            expenses: [
                { id: 'e1', category: 'Groceries', amount: 100 },    // will rewrite
                { id: 'e2', category: 'mortgage',  amount: 50  },   // unchanged
            ],
            bills: [
                { id: 'b1', expenseCategory: 'Mortgage' },          // will rewrite
                { id: 'b2', expenseCategory: null       },           // unchanged
            ],
            transactionRules: [
                { id: 'r1', actions: { category: 'Mortgage' } },    // will rewrite
                { id: 'r2', actions: { category: 'Groceries' } },   // will rewrite
            ],
            categoryBudgets: [
                { id: 'g1', category: 'mortgage', monthlyAmount: 2000 }, // unchanged
            ],
        };
        const changed = migrateCategoryKeys(data, normalize);
        assert.equal(changed, true);
        assert.equal(data.expenses[0].category, 'groceries');
        assert.equal(data.expenses[1].category, 'mortgage');
        assert.equal(data.bills[0].expenseCategory, 'mortgage');
        assert.equal(data.bills[1].expenseCategory, null);
        assert.equal(data.transactionRules[0].actions.category, 'mortgage');
        assert.equal(data.transactionRules[1].actions.category, 'groceries');
    });

    test('custom / unknown categories pass through unchanged', () => {
        const data = {
            expenses: [
                { id: 'e1', category: 'CashAppFees', amount: 10 },
                { id: 'e2', category: 'some-bespoke-thing', amount: 10 },
            ],
            bills: [{ id: 'b1', expenseCategory: 'TotallyCustom' }],
            transactionRules: [],
            categoryBudgets: [],
        };
        const changed = migrateCategoryKeys(data, normalize);
        assert.equal(changed, false);
        assert.equal(data.expenses[0].category, 'CashAppFees');
        assert.equal(data.expenses[1].category, 'some-bespoke-thing');
        assert.equal(data.bills[0].expenseCategory, 'TotallyCustom');
    });

    test('group names like "Housing" are NOT rewritten', () => {
        // Regression: bills[].category often stores "Housing" (group) — that
        // field isn't used for budgets, but migrations that touch it would
        // break unrelated UI. We only touch `expenseCategory`, not `category`,
        // on bills.
        const data = {
            expenses: [],
            bills: [{ id: 'b1', category: 'Housing', expenseCategory: undefined }],
            transactionRules: [],
            categoryBudgets: [],
        };
        const changed = migrateCategoryKeys(data, normalize);
        assert.equal(changed, false);
        assert.equal(data.bills[0].category, 'Housing'); // untouched
    });

    test('rules without an actions.category field are untouched', () => {
        const data = {
            expenses: [],
            bills: [],
            transactionRules: [
                { id: 'r1', actions: { rename: 'Cleaned up name' } },
                { id: 'r2', actions: { ignore: true } },
                { id: 'r3', actions: null },
                { id: 'r4' },
            ],
            categoryBudgets: [],
        };
        const changed = migrateCategoryKeys(data, normalize);
        assert.equal(changed, false);
    });

    test('collapses duplicate budgets across casing', () => {
        const data = {
            expenses: [],
            bills: [],
            transactionRules: [],
            categoryBudgets: [
                { id: 'first',  category: 'Mortgage', monthlyAmount: 2000 },
                { id: 'second', category: 'mortgage', monthlyAmount: 3475 },
            ],
        };
        const changed = migrateCategoryKeys(data, normalize);
        assert.equal(changed, true);
        assert.equal(data.categoryBudgets.length, 1);
        // Later row wins — it was almost certainly the user's retry after
        // the first one appeared to do nothing.
        assert.equal(data.categoryBudgets[0].id, 'second');
        assert.equal(data.categoryBudgets[0].monthlyAmount, 3475);
    });

    test('gracefully handles missing arrays', () => {
        const data = {};
        const changed = migrateCategoryKeys(data, normalize);
        assert.equal(changed, false);
    });

    test('returns false if normalizeFn is missing', () => {
        assert.equal(migrateCategoryKeys({}, null), false);
        assert.equal(migrateCategoryKeys({}, undefined), false);
    });
});
