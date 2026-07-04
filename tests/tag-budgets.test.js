/**
 * Tests for tag-targeted budgets: a budget can track a category OR a tag
 * (e.g. everything tagged "discretionary" across any category). Tag budgets
 * count qualifying expenses only — bills carry no tags.
 */

process.env.TZ = 'America/Los_Angeles';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeBudgetStatus, validateBudget } from '../js/services/budget-service.js';
import model from '../functions/shared/shared-access-model.cjs';

const EXPENSES = [
    { id: 'e1', category: 'dining', amount: 60, date: '2026-07-05', tags: ['discretionary'] },
    { id: 'e2', category: 'shopping', amount: 90, date: '2026-07-10', tags: ['Discretionary'] }, // case-insensitive
    { id: 'e3', category: 'groceries', amount: 400, date: '2026-07-12' },                        // untagged
    { id: 'e4', category: 'dining', amount: 25, date: '2026-06-20', tags: ['discretionary'] },   // prior month
    { id: 'e5', category: 'dining', amount: 30, date: '2026-07-15', tags: ['discretionary'], ignored: true },
    { id: 'e6', category: 'dining', amount: 50, date: '2026-07-16', tags: ['discretionary'], splitChildren: ['a'] },
];

describe('tag budgets', () => {
    const budget = { id: 'tb', tag: 'discretionary', monthlyAmount: 200, rollover: false, startMonth: '2026-07' };

    test('sums tagged expenses across categories, case-insensitively', () => {
        const s = computeBudgetStatus(budget, EXPENSES, '2026-07');
        assert.equal(s.spent, 150); // e1 + e2; ignores untagged, ignored, split parents, prior months
        assert.equal(s.remaining, 50);
        assert.equal(s.tag, 'discretionary');
    });

    test('bills never contribute to tag budgets even when a callback is supplied', () => {
        const s = computeBudgetStatus(budget, EXPENSES, '2026-07', () => 9999);
        assert.equal(s.billSpent, 0);
        assert.equal(s.spent, 150);
    });

    test('category budgets are unaffected by tags on their expenses', () => {
        const catBudget = { id: 'cb', category: 'dining', monthlyAmount: 300, rollover: false, startMonth: '2026-07' };
        const s = computeBudgetStatus(catBudget, EXPENSES, '2026-07');
        assert.equal(s.spent, 60); // e1 only (e5 ignored, e6 split parent)
        assert.equal(s.tag, null);
    });

    test('rollover works for tag budgets', () => {
        const roll = { ...budget, rollover: true, startMonth: '2026-06' };
        const s = computeBudgetStatus(roll, EXPENSES, '2026-07');
        assert.equal(s.rolledIn, 200 - 25); // June: 200 limit, 25 spent
        assert.equal(s.available, 200 + 175);
    });

    test('validateBudget requires category XOR tag', () => {
        assert.equal(validateBudget({ tag: 'x', monthlyAmount: 10, startMonth: '2026-07' }), null);
        assert.equal(validateBudget({ category: 'dining', monthlyAmount: 10, startMonth: '2026-07' }), null);
        assert.match(validateBudget({ monthlyAmount: 10, startMonth: '2026-07' }), /category or tag/i);
        assert.match(validateBudget({ category: 'dining', tag: 'x', monthlyAmount: 10, startMonth: '2026-07' }), /not both/i);
    });

    test('shared snapshot aggregates carry the tag and configs preserve it', () => {
        const data = {
            userName: 'James',
            accounts: [], bills: [], expenses: EXPENSES,
            budgets: [budget],
            sharedWith: [],
        };
        const snap = model.filterDataForRole(data, { role: 'companion', accountIds: [], canEditBudgets: true }, new Date(2026, 6, 15));
        const st = snap.budgets.statuses[0];
        assert.equal(st.tag, 'discretionary');
        assert.equal(st.spent, 150);
        assert.equal(snap.budgetConfigs[0].tag, 'discretionary');
        assert.ok(!('category' in snap.budgetConfigs[0]));
    });
});

// ─── Unlimited ($0) budgets ─────────────────────────────────────────

describe('unlimited ($0) budgets', () => {
    const zero = { id: 'z', category: 'dining', monthlyAmount: 0, rollover: false, startMonth: '2026-06' };

    test('validateBudget accepts 0 but rejects negatives', async () => {
        const { validateBudget } = await import('../js/services/budget-service.js');
        assert.equal(validateBudget({ ...zero }), null);
        assert.match(validateBudget({ ...zero, monthlyAmount: -5 }), /zero.*or a positive/i);
    });

    test('tracks spend with unlimited flag, zero remaining, zero pctUsed', async () => {
        const { computeBudgetStatus } = await import('../js/services/budget-service.js');
        const s = computeBudgetStatus(zero, EXPENSES, '2026-07');
        assert.equal(s.unlimited, true);
        assert.equal(s.spent, 60); // e1 (dining, July, not ignored/split)
        assert.equal(s.remaining, 0);
        assert.equal(s.pctUsed, 0, 'unlimited must never read as over budget');
    });

    test('rollover never applies to unlimited budgets', async () => {
        const { computeBudgetStatus } = await import('../js/services/budget-service.js');
        const s = computeBudgetStatus({ ...zero, rollover: true }, EXPENSES, '2026-07');
        assert.equal(s.rolledIn, 0, 'June spend must not carry a debit into July');
        assert.equal(s.rolledOut, 0);
    });

    test('totals exclude unlimited spend from remaining but report it', async () => {
        const { computeBudgetStatus, computeBudgetTotals } = await import('../js/services/budget-service.js');
        const limited = computeBudgetStatus({ id: 'l', category: 'shopping', monthlyAmount: 200, rollover: false, startMonth: '2026-07' }, EXPENSES, '2026-07');
        const unlim = computeBudgetStatus(zero, EXPENSES, '2026-07');
        const t = computeBudgetTotals([limited, unlim]);
        assert.equal(t.spent, limited.spent + unlim.spent);
        assert.equal(t.unlimitedSpent, unlim.spent);
        assert.equal(t.remaining, 200 - limited.spent, 'unlimited spend must not push totals over');
    });

    test('shared snapshot carries the unlimited flag', () => {
        const data = { userName: 'J', accounts: [], bills: [], expenses: EXPENSES, budgets: [zero], sharedWith: [] };
        const snap = model.filterDataForRole(data, { role: 'companion', accountIds: [] }, new Date(2026, 6, 15));
        assert.equal(snap.budgets.statuses[0].unlimited, true);
    });
});
