/**
 * One category set for bills / budgets / rules.
 *
 * Covers the one-shot migration (bill taxonomy labels → canonical
 * expense-category keys, unknown labels becoming custom categories) and the
 * new bill→budget blending default (a bill counts toward the budget
 * matching its own category; expenseCategory overrides; 'none' opts out).
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

describe('bill → budget blending follows the unified category', () => {
    const baseData = (bills) => ({
        bills,
        expenses: [],
        paySchedule: null,
        categoryBudgets: [{ id: 'b1', category: 'insurance', monthlyAmount: 500, rollover: false, startMonth: '2026-01' }],
    });

    const insuranceSpend = (bills) => {
        const agg = sharedAccess.computeBudgetAggregates(baseData(bills), new Date(2026, 6, 15));
        return agg.statuses.find(s => s.category === 'insurance').spent;
    };

    test("a bill's own category feeds the matching budget (no expenseCategory needed)", () => {
        assert.equal(insuranceSpend([{ id: '1', category: 'insurance', amount: 446, frequency: 'monthly', dueDay: 21 }]), 446);
    });

    test('expenseCategory still overrides the category', () => {
        assert.equal(insuranceSpend([
            { id: '1', category: 'other', expenseCategory: 'insurance', amount: 100, frequency: 'monthly', dueDay: 1 },
            { id: '2', category: 'insurance', expenseCategory: 'utilities', amount: 999, frequency: 'monthly', dueDay: 1 },
        ]), 100);
    });

    test("expenseCategory 'none' opts a bill out entirely", () => {
        assert.equal(insuranceSpend([
            { id: '1', category: 'insurance', expenseCategory: 'none', amount: 999, frequency: 'monthly', dueDay: 1 },
        ]), 0);
    });

    test('frozen bills stay excluded', () => {
        assert.equal(insuranceSpend([
            { id: '1', category: 'insurance', amount: 999, frequency: 'monthly', dueDay: 1, frozen: true },
        ]), 0);
    });
});
