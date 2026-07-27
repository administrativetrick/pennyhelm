/**
 * Financial trend history: the monthly bill-commitment snapshot and the
 * backfilled spending series that power the Bills & Spending Trend widget.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fin = require('../functions/shared/financial-service.cjs');

describe('monthlyBillCommitment', () => {
    test('sums monthly-equivalents; skips frozen and excluded', () => {
        const bills = [
            { amount: 2000, frequency: 'monthly' },
            { amount: 100, frequency: 'weekly' },          // 100*52/12 = 433.33
            { amount: 1200, frequency: 'yearly' },          // 100/mo
            { amount: 999, frequency: 'monthly', frozen: true },
            { amount: 999, frequency: 'monthly', excludeFromTotal: true },
        ];
        const total = fin.monthlyBillCommitment(bills);
        assert.ok(Math.abs(total - (2000 + 100 * 52 / 12 + 100)) < 0.01, 'got ' + total);
    });
    test('empty / missing → 0', () => {
        assert.equal(fin.monthlyBillCommitment([]), 0);
        assert.equal(fin.monthlyBillCommitment(undefined), 0);
    });
});

describe('createFinancialSnapshot', () => {
    test('keys by current month and rounds bills + income', () => {
        const now = new Date(2026, 6, 15); // reference — snapshot uses real now, so just check shape
        const snap = fin.createFinancialSnapshot({
            bills: [{ amount: 1500.005, frequency: 'monthly' }],
            income: { user: { payAmount: 3000, frequency: 'monthly' }, dependent: { employed: false }, combineDependentIncome: false },
            otherIncome: [],
            paySchedule: { frequency: 'monthly' },
        });
        assert.match(snap.month, /^\d{4}-\d{2}$/);
        assert.equal(snap.bills, 1500.01);
        assert.equal(snap.income, 3000);
    });
});

describe('monthlySpendingSeries', () => {
    const at = (m, amount, extra = {}) => ({ id: m + amount, name: 'x', amount, date: m + '-10', category: 'groceries', ...extra });

    test('backfills a contiguous series ending this month, excluding transfers/ignored', () => {
        const now = new Date(2026, 6, 15); // July 2026
        const expenses = [
            at('2026-05', 200),
            at('2026-06', 150), at('2026-06', 50),
            at('2026-07', 300),
            at('2026-07', 999, { name: 'AMEX ACH PMT', category: 'other' }), // transfer — excluded
            at('2026-07', 40, { ignored: true }),                            // ignored — excluded
        ];
        const s = fin.monthlySpendingSeries(expenses, 3, now);
        assert.deepEqual(s.map(x => x.month), ['2026-05', '2026-06', '2026-07']);
        assert.equal(s[0].spent, 200);
        assert.equal(s[1].spent, 200);   // 150 + 50
        assert.equal(s[2].spent, 300);   // transfer + ignored excluded
    });

    test('months with no spend are zero-filled', () => {
        const now = new Date(2026, 6, 15);
        const s = fin.monthlySpendingSeries([at('2026-07', 100)], 3, now);
        assert.deepEqual(s.map(x => x.spent), [0, 0, 100]);
    });
});
