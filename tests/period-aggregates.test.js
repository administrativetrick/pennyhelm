/**
 * Multi-month aggregates — billTotalForMonth + computePeriodSummary.
 * These power the dashboard's This Month / Quarter / Year toggle, so the
 * per-frequency month math is pinned here across month boundaries.
 */

process.env.TZ = 'America/Los_Angeles';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    billTotalForMonth,
    computePeriodSummary,
    generatePayDates,
} from '../js/services/financial-service.js';

// July 2026: 31 days, starts Wednesday. Fridays: 3, 10, 17, 24, 31 (five).
const Y = 2026;
const JUL = 6;

describe('billTotalForMonth', () => {
    test('monthly bills count once regardless of dueDay', () => {
        assert.equal(billTotalForMonth([{ amount: 100, frequency: 'monthly', dueDay: 15 }], Y, JUL), 100);
        assert.equal(billTotalForMonth([{ amount: 100, dueDay: 31 }], Y, JUL), 100); // default freq
    });

    test('frozen and excluded bills are skipped', () => {
        assert.equal(billTotalForMonth([
            { amount: 100, frozen: true },
            { amount: 100, excludeFromTotal: true },
        ], Y, JUL), 0);
    });

    test('yearly and semi-annual land only in their months', () => {
        const yearly = [{ amount: 600, frequency: 'yearly', dueMonth: 6, dueDay: 1 }];
        assert.equal(billTotalForMonth(yearly, Y, 6), 600);
        assert.equal(billTotalForMonth(yearly, Y, 7), 0);
        const semi = [{ amount: 300, frequency: 'semi-annual', dueMonth: 0, dueDay: 1 }];
        assert.equal(billTotalForMonth(semi, Y, 0), 300);
        assert.equal(billTotalForMonth(semi, Y, 6), 300);
        assert.equal(billTotalForMonth(semi, Y, 3), 0);
    });

    test('weekly bills count actual weekday occurrences (5 Fridays in Jul 2026)', () => {
        assert.equal(billTotalForMonth([{ id: 'w', amount: 10, frequency: 'weekly', dueDay: 5 }], Y, JUL), 50);
    });

    test('every-2-months follows dueMonth parity', () => {
        const b = [{ id: 'e2', amount: 80, frequency: 'every-2-months', dueMonth: 0, dueDay: 15 }];
        assert.equal(billTotalForMonth(b, Y, 6), 80);  // Jul: even offset from Jan
        assert.equal(billTotalForMonth(b, Y, 7), 0);   // Aug: odd
    });

    test('every-4-weeks uses the anchor to place occurrences', () => {
        // Anchored 2026-07-03 → Jul 3 and Jul 31 both land in July (2 occurrences)
        const b = [{ id: 'e4', amount: 25, frequency: 'every-4-weeks', anchorDate: '2026-07-03', dueDay: 5 }];
        assert.equal(billTotalForMonth(b, Y, JUL), 50);
        // August: Aug 28 only (1 occurrence)
        assert.equal(billTotalForMonth(b, Y, 7), 25);
    });

    test('per-paycheck multiplies by pay dates; falls back to 2 without any', () => {
        const b = [{ id: 'pp', amount: 40, frequency: 'per-paycheck' }];
        const payDates = [new Date(2026, 6, 3), new Date(2026, 6, 17), new Date(2026, 6, 31)];
        assert.equal(billTotalForMonth(b, Y, JUL, payDates), 120);
        assert.equal(billTotalForMonth(b, Y, JUL, []), 80); // fallback 2 checks
    });

    test('twice-monthly caps at 2 even in three-paycheck months', () => {
        const b = [{ id: 'tm', amount: 40, frequency: 'twice-monthly' }];
        const payDates = [new Date(2026, 6, 3), new Date(2026, 6, 17), new Date(2026, 6, 31)];
        assert.equal(billTotalForMonth(b, Y, JUL, payDates), 80);
    });
});

describe('computePeriodSummary', () => {
    const base = {
        bills: [
            { id: 'rent', amount: 1000, frequency: 'monthly', dueDay: 1 },
            { id: 'ins', amount: 600, frequency: 'yearly', dueMonth: 8, dueDay: 1 },     // September
            { id: 'water', amount: 90, frequency: 'every-2-months', dueMonth: 0, dueDay: 15 }, // odd months incl. Jul/Sep… wait: Jan-anchored = Jan/Mar/May/Jul/Sep/Nov
        ],
        monthlyIncome: 2000,
    };

    test('single month matches billTotalForMonth', () => {
        const s = computePeriodSummary(base, 2026, 6, 1); // July
        assert.equal(s.income, 2000);
        assert.equal(s.billsTotal, 1000 + 90); // rent + water (Jul is on-parity), no insurance
        assert.equal(s.remaining, 2000 - 1090);
        assert.equal(s.months.length, 1);
    });

    test('quarter places each bill in the right months', () => {
        const s = computePeriodSummary(base, 2026, 6, 3); // Jul–Sep
        // rent ×3, insurance once (Sep), water in Jul + Sep (parity months)
        assert.equal(s.billsTotal, 3000 + 600 + 180);
        assert.equal(s.income, 6000);
        assert.equal(s.remaining, 6000 - 3780);
        assert.equal(s.months.length, 3);
        assert.equal(s.months[0].bills, 1090);  // Jul: rent + water
        assert.equal(s.months[1].bills, 1000);  // Aug: rent only
        assert.equal(s.months[2].bills, 1690);  // Sep: rent + insurance + water
    });

    test('year counts yearly once and every-2-months six times', () => {
        const s = computePeriodSummary(base, 2026, 0, 12);
        assert.equal(s.billsTotal, 12000 + 600 + 90 * 6);
        assert.equal(s.income, 24000);
    });

    test('coverage is aggregated separately and included in outflow', () => {
        const s = computePeriodSummary({
            ...base,
            coveredDependentBills: [{ id: 'cov', amount: 200, frequency: 'monthly', dueDay: 5 }],
        }, 2026, 6, 3);
        assert.equal(s.coverageTotal, 600);
        assert.equal(s.outflow, s.billsTotal + 600);
        assert.equal(s.remaining, s.income - s.outflow);
    });

    test('per-paycheck bills track real pay-date counts across months', () => {
        // Biweekly anchored Fri 2026-07-03: Jul has 3 checks (3, 17, 31), Aug 2 (14, 28)
        const s = computePeriodSummary({
            bills: [{ id: 'pp', amount: 50, frequency: 'per-paycheck' }],
            paySchedule: { startDate: '2026-07-03', frequency: 'biweekly' },
            monthlyIncome: 0,
        }, 2026, 6, 2);
        assert.equal(s.months[0].bills, 150);
        assert.equal(s.months[1].bills, 100);
    });

    test('year period crosses into the correct calendar months (no drift)', () => {
        const s = computePeriodSummary(base, 2026, 0, 12);
        assert.deepEqual(s.months.map(m => m.month), [0,1,2,3,4,5,6,7,8,9,10,11]);
        assert.ok(s.months.every(m => m.year === 2026));
    });
});
