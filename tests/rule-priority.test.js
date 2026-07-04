/**
 * Tests for first-match-wins rule evaluation and budget startMonth defense.
 *
 * Rules run in priority order (lowest number first) and the FIRST enabled
 * match applies — evaluation stops for that expense. Reordering on the
 * Rules page rewrites priorities to list positions.
 */

process.env.TZ = 'America/Los_Angeles';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyRulesToExpense, applyRulesToExpenses } from '../js/services/transaction-rules.js';
import { computeBudgetStatus } from '../js/services/budget-service.js';

const EXPENSE = { id: 'e1', name: 'COSTCO WHOLESALE #123', vendor: 'COSTCO', amount: 214.55, category: 'other' };

describe('first-match-wins rule evaluation', () => {
    test('the highest-priority matching rule applies and the rest are skipped', () => {
        const rules = [
            { id: 'r2', enabled: true, priority: 1, match: { field: 'vendor', op: 'contains', value: 'costco' }, actions: { category: 'groceries', addTags: ['bulk'] } },
            { id: 'r1', enabled: true, priority: 0, match: { field: 'name', op: 'contains', value: 'wholesale' }, actions: { category: 'shopping' } },
        ];
        const out = applyRulesToExpense(rules, EXPENSE);
        assert.equal(out.category, 'shopping', 'priority 0 rule must win');
        assert.ok(!out.tags, 'later matching rule must NOT also apply');
    });

    test('disabled and non-matching rules are passed over until a match', () => {
        const rules = [
            { id: 'a', enabled: false, priority: 0, match: { field: 'vendor', op: 'contains', value: 'costco' }, actions: { category: 'x' } },
            { id: 'b', enabled: true, priority: 1, match: { field: 'vendor', op: 'contains', value: 'starbucks' }, actions: { category: 'coffee' } },
            { id: 'c', enabled: true, priority: 2, match: { field: 'amount', op: 'gt', value: 100 }, actions: { category: 'big-purchases' } },
        ];
        assert.equal(applyRulesToExpense(rules, EXPENSE).category, 'big-purchases');
    });

    test('no match leaves the expense untouched', () => {
        const rules = [{ id: 'a', enabled: true, priority: 0, match: { field: 'vendor', op: 'contains', value: 'zzz' }, actions: { category: 'x' } }];
        assert.equal(applyRulesToExpense(rules, EXPENSE), EXPENSE);
    });

    test('per-expense stop does not stop the batch', () => {
        const rules = [
            { id: 'a', enabled: true, priority: 0, match: { field: 'vendor', op: 'contains', value: 'costco' }, actions: { category: 'groceries' } },
            { id: 'b', enabled: true, priority: 1, match: { field: 'vendor', op: 'contains', value: 'shell' }, actions: { category: 'gas' } },
        ];
        const out = applyRulesToExpenses(rules, [EXPENSE, { id: 'e2', vendor: 'SHELL', name: 'SHELL', amount: 40, category: 'other' }]);
        assert.equal(out[0].category, 'groceries');
        assert.equal(out[1].category, 'gas');
    });

    test('reordered priorities flip the winner', () => {
        const general = { id: 'g', enabled: true, priority: 0, match: { field: 'vendor', op: 'contains', value: 'costco' }, actions: { category: 'groceries' } };
        const specific = { id: 's', enabled: true, priority: 1, match: { field: 'name', op: 'contains', value: 'wholesale' }, actions: { category: 'shopping' } };
        assert.equal(applyRulesToExpense([general, specific], EXPENSE).category, 'groceries');
        // Drag "specific" above "general" → priorities renumbered
        assert.equal(applyRulesToExpense([{ ...general, priority: 1 }, { ...specific, priority: 0 }], EXPENSE).category, 'shopping');
    });
});

describe('budget startMonth defense', () => {
    test('a full-date startMonth does not strand the budget in notStarted', () => {
        const budget = { id: 'b', category: 'dining', monthlyAmount: 500, rollover: false, startMonth: '2026-07-03' };
        const s = computeBudgetStatus(budget, [{ id: 'e', category: 'dining', amount: 60, date: '2026-07-05' }], '2026-07');
        assert.ok(!s.notStarted, 'same-month full-date startMonth must count as started');
        assert.equal(s.spent, 60);
    });
});
