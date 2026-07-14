/**
 * One category set for bills / budgets / rules.
 *
 * Covers the one-shot migration (bill taxonomy labels → canonical
 * expense-category keys, unknown labels becoming custom categories) and the
 * blending contract: bills follow their own category and count as a
 * FORECAST until a matching transaction lands (reconciliation) — then the
 * actual counts and the forecast is suppressed. No double counting, no
 * invisible upcoming bills.
 */

process.env.TZ = 'America/Los_Angeles';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { migrateBillCategoriesToUnifiedSet } from '../js/services/migration-manager.js';
import { normalizeCategoryKey, getAllExpenseCategories } from '../js/expense-categories.js';

const require = createRequire(import.meta.url);
const sharedAccess = require('../functions/shared/shared-access-model.cjs');

// Store-like shim so the category helpers see the blob's custom categories.
const storeLikeFor = (data) => ({
    getCustomExpenseCategories: () => data.customExpenseCategories || [],
});
const normalizerFor = (data) => (label) => {
    const storeLike = storeLikeFor(data);
    const key = normalizeCategoryKey(label, storeLike);
    return key && getAllExpenseCategories(storeLike)[key] ? key : null;
};

describe('migrateBillCategoriesToUnifiedSet', () => {
    test('labels matching built-in categories become their keys', () => {
        const data = { bills: [{ id: '1', category: 'Rent' }, { id: '2', category: 'Utilities' }] };
        assert.equal(migrateBillCategoriesToUnifiedSet(data, normalizerFor(data)), true);
        assert.equal(data.bills[0].category, 'rent');
        assert.equal(data.bills[1].category, 'utilities');
    });

    test('unknown labels become custom expense categories (the Insurance case)', () => {
        const data = { bills: [{ id: '1', category: 'Insurance' }] };
        migrateBillCategoriesToUnifiedSet(data, normalizerFor(data));
        assert.equal(data.bills[0].category, 'insurance');
        const created = data.customExpenseCategories.find(c => c.key === 'insurance');
        assert.ok(created, 'custom category created');
        assert.equal(created.name, 'Insurance');
    });

    test('legacy custom bill categories fold into the unified set', () => {
        const data = {
            customCategories: [{ id: 'x', name: 'Pool Service', color: 'blue' }],
            bills: [{ id: '1', category: 'Pool Service' }],
        };
        migrateBillCategoriesToUnifiedSet(data, normalizerFor(data));
        assert.equal(data.bills[0].category, 'pool-service');
        assert.ok(data.customExpenseCategories.some(c => c.key === 'pool-service'));
    });

    test('same unknown label across bills creates ONE custom category', () => {
        const data = { bills: [{ id: '1', category: 'Insurance' }, { id: '2', category: 'insurance' }] };
        migrateBillCategoriesToUnifiedSet(data, normalizerFor(data));
        assert.equal(data.customExpenseCategories.filter(c => c.key === 'insurance').length, 1);
        assert.equal(data.bills[0].category, 'insurance');
        assert.equal(data.bills[1].category, 'insurance');
    });

    test('idempotent: second run is a no-op', () => {
        const data = { bills: [{ id: '1', category: 'Insurance' }] };
        migrateBillCategoriesToUnifiedSet(data, normalizerFor(data));
        const snapshot = JSON.stringify(data);
        assert.equal(migrateBillCategoriesToUnifiedSet(data, normalizerFor(data)), false);
        assert.equal(JSON.stringify(data), snapshot);
    });

    test('blank/missing categories are left alone', () => {
        const data = { bills: [{ id: '1' }, { id: '2', category: '' }] };
        migrateBillCategoriesToUnifiedSet(data, normalizerFor(data));
        assert.equal(data.bills[0].category, undefined);
        assert.equal(data.bills[1].category, '');
    });
});

describe('bill → budget reconciliation: forecast until the payment lands', () => {
    const baseData = (bills, expenses = []) => ({
        bills,
        expenses,
        paySchedule: null,
        categoryBudgets: [{ id: 'b1', category: 'insurance', monthlyAmount: 5000, rollover: false, startMonth: '2026-01' }],
    });

    const insuranceStatus = (bills, expenses) => {
        const agg = sharedAccess.computeBudgetAggregates(baseData(bills, expenses), new Date(2026, 6, 15));
        return agg.statuses.find(s => s.category === 'insurance');
    };

    const bill = (extra = {}) => ({ id: 'sf', category: 'insurance', amount: 446, frequency: 'monthly', dueDay: 21, ...extra });
    const txn = (amount, date, extra = {}) => ({ id: 't-' + amount + date, category: 'insurance', amount, date, source: 'plaid', ...extra });

    test('unpaid bill counts as a forecast (no invisible upcoming bills)', () => {
        assert.equal(insuranceStatus([bill()], []).spent, 446);
    });

    test('once the payment lands, the actual counts and the forecast is suppressed', () => {
        const st = insuranceStatus([bill()], [txn(446, '2026-07-21')]);
        assert.equal(st.spent, 446); // transaction only — NOT 892
    });

    test('near-match amounts reconcile (the mortgage case: 3475.02 vs 3486.50)', () => {
        const st = insuranceStatus(
            [bill({ amount: 3486.50, dueDay: 1 })],
            [txn(3475.02, '2026-07-01')]
        );
        assert.equal(st.spent, 3475.02);
    });

    test('a payment outside the date window does not reconcile', () => {
        const st = insuranceStatus([bill({ dueDay: 21 })], [txn(446, '2026-07-01')]);
        assert.equal(st.spent, 446 + 446); // unrelated same-amount expense + forecast
    });

    test('two occurrences, one paid: actual + remaining forecast', () => {
        // Semi-monthly-ish: weekly bill on Tuesdays of July 2026 (7,14,21,28)
        const st = insuranceStatus(
            [bill({ frequency: 'weekly', dueDay: 2, amount: 100 })],
            [txn(100, '2026-07-07')]
        );
        // 4 Tuesdays; one matched → expense 100 + 3 forecasts of 100
        assert.equal(st.spent, 400);
    });

    test('each transaction is consumed at most once', () => {
        const st = insuranceStatus(
            [bill({ id: 'a' }), bill({ id: 'b' })],
            [txn(446, '2026-07-21')]
        );
        // one bill reconciled, one still forecast: 446 (txn) + 446 (forecast)
        assert.equal(st.spent, 892);
    });

    test("expenseCategory 'none' opts a bill out entirely", () => {
        assert.equal(insuranceStatus([bill({ expenseCategory: 'none' })], []).spent, 0);
    });

    test('explicit expenseCategory overrides the bill category', () => {
        const st = insuranceStatus([
            { id: '1', category: 'other', expenseCategory: 'insurance', amount: 100, frequency: 'monthly', dueDay: 1 },
            { id: '2', category: 'insurance', expenseCategory: 'utilities', amount: 999, frequency: 'monthly', dueDay: 1 },
        ], []);
        assert.equal(st.spent, 100);
    });

    test('frozen bills stay excluded', () => {
        assert.equal(insuranceStatus([bill({ frozen: true })], []).spent, 0);
    });
});
