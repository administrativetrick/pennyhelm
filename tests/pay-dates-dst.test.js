/**
 * DST regression tests for pay-date generation and overdue carry-forwards.
 *
 * generatePayDates used to advance its cursor by n*86,400,000 ms. Crossing a
 * spring-forward DST transition left every subsequent date at 01:00 instead
 * of local midnight, so on a payday the bills page's "today >= payday"
 * midnight comparison failed, no pay period matched, and the paycheck view
 * silently fell back to showing every bill. These tests pin the fix
 * (calendar-day stepping): every generated date must sit at local midnight.
 *
 * TZ is forced to America/Los_Angeles so the March/November DST transitions
 * exist regardless of the machine running the suite. (Node reads TZ at first
 * Date use; setting it at module top precedes any test Date calls.)
 */

process.env.TZ = 'America/Los_Angeles';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatePayDates, addDays, getOverdueCarryForwards, computeAutoTickUpdates } from '../js/services/financial-service.js';

describe('generatePayDates across DST', () => {
    // Anchor Fri Jan 2, 2026 — before the Mar 8, 2026 spring-forward.
    const schedule = { startDate: '2026-01-02', frequency: 'biweekly' };

    test('every biweekly pay date is at local midnight (no DST drift)', () => {
        const dates = generatePayDates(schedule, '2026-01-01', '2026-12-31');
        assert.ok(dates.length > 20, 'expected a full year of biweekly dates');
        for (const d of dates) {
            assert.equal(
                d.getHours(), 0,
                `${d.toString()} is not at local midnight — ms-stepping DST drift is back`,
            );
        }
    });

    test('summer paydays land on the expected calendar days', () => {
        const dates = generatePayDates(schedule, '2026-07-01', '2026-07-31');
        const days = dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`);
        assert.deepEqual(days, ['7/3', '7/17', '7/31']);
    });

    test('a payday matches its own pay period (the July 3 bug)', () => {
        // Replicates the bills-page period loop for today = a payday after the
        // spring-forward. Pre-fix this found NO period.
        const sorted = generatePayDates(schedule).sort((a, b) => a - b);
        const today = new Date(2026, 6, 3); // Fri Jul 3, local midnight
        let matched = null;
        for (let i = 0; i < sorted.length; i++) {
            const pStart = sorted[i];
            const pEnd = sorted[i + 1] ? addDays(sorted[i + 1], -1) : addDays(pStart, 13);
            if (today >= pStart && today <= pEnd) { matched = { pStart, pEnd }; break; }
        }
        assert.ok(matched, 'payday must fall inside a pay period');
        assert.equal(matched.pStart.getDate(), 3, 'period should start on the payday itself');
        assert.equal(matched.pEnd.getDate(), 16, 'period should end the day before the next payday');
    });

    test('weekly frequency is also midnight-normalized', () => {
        const dates = generatePayDates({ startDate: '2026-01-02', frequency: 'weekly' }, '2026-03-01', '2026-04-01');
        assert.ok(dates.length >= 4);
        for (const d of dates) assert.equal(d.getHours(), 0, `${d} drifted off midnight`);
    });
});

describe('getOverdueCarryForwards', () => {
    const NOW = new Date(2026, 6, 3); // July 3, 2026 — previous month = June
    const unpaid = () => false;
    const paidSet = (...keys) => {
        const s = new Set(keys);
        return (id, y, m) => s.has(`${id}:${y}:${m}`);
    };

    test('a monthly bill unpaid in June carries forward with June paid-bucket', () => {
        const bills = [{ id: 'water', name: 'Water', amount: 90, dueDay: 27 }];
        const out = getOverdueCarryForwards(bills, unpaid, NOW);
        assert.equal(out.length, 1);
        assert.equal(out[0]._paidYear, 2026);
        assert.equal(out[0]._paidMonth, 5); // June
        assert.deepEqual(out[0]._overdueFrom, { year: 2026, month: 5, day: 27 });
    });

    test('paid-in-June bills do not carry forward', () => {
        const bills = [{ id: 'water', amount: 90, dueDay: 27 }];
        assert.equal(getOverdueCarryForwards(bills, paidSet('water:2026:5'), NOW).length, 0);
    });

    test('frozen, auto-pay, periodic, and pay-date-driven bills are skipped', () => {
        const bills = [
            { id: 'a', amount: 10, dueDay: 5, frozen: true },
            { id: 'c', amount: 10, dueDay: 5, frequency: 'yearly' },
            { id: 'd', amount: 10, dueDay: 5, autoPay: true },
            { id: 'e', amount: 10, dueDay: 5, frequency: 'per-paycheck' },
            { id: 'f', amount: 10, dueDay: 5, frequency: 'twice-monthly' },
        ];
        assert.equal(getOverdueCarryForwards(bills, unpaid, NOW).length, 0);
    });

    test('weekly bills carry forward per unpaid occurrence', () => {
        // June 2026 has four Fridays (5, 12, 19, 26); dueDay 5 = Friday.
        const bills = [{ id: 'lawn', amount: 40, dueDay: 5, frequency: 'weekly' }];
        const out = getOverdueCarryForwards(bills, unpaid, NOW);
        assert.equal(out.length, 4);
        assert.ok(out.every(o => o._paidMonth === 5 && o._occurrenceKey));
    });

    test('bills created this month are not flagged for last month', () => {
        const bills = [{ id: 'new', amount: 25, dueDay: 1, createdAt: '2026-07-02T10:00:00.000Z' }];
        assert.equal(getOverdueCarryForwards(bills, unpaid, NOW).length, 0);
    });

    test('bills without createdAt (legacy) are treated as old enough', () => {
        const bills = [{ id: 'legacy', amount: 25, dueDay: 1 }];
        assert.equal(getOverdueCarryForwards(bills, unpaid, NOW).length, 1);
    });

    test('dueDay 31 clamps to the last day of a 30-day previous month', () => {
        const bills = [{ id: 'x', amount: 10, dueDay: 31 }];
        const out = getOverdueCarryForwards(bills, unpaid, NOW); // prev month June = 30 days
        assert.equal(out[0]._overdueFrom.day, 30);
    });

    test('January looks back to December of the prior year', () => {
        const jan = new Date(2027, 0, 5);
        const out = getOverdueCarryForwards([{ id: 'y', amount: 10, dueDay: 15 }], unpaid, jan);
        assert.equal(out[0]._paidYear, 2026);
        assert.equal(out[0]._paidMonth, 11);
    });
});

describe('computeAutoTickUpdates (auto-tick auto-pay setting)', () => {
    const NOW = new Date(2026, 6, 10); // July 10, 2026
    const unpaid = () => false;

    test('past-due auto-pay bills get ticked for previous and current month', () => {
        const bills = [{ id: 'hbo', amount: 19, dueDay: 9, autoPay: true }];
        const out = computeAutoTickUpdates(bills, unpaid, NOW);
        assert.deepEqual(out, [
            { id: 'hbo', year: 2026, month: 5 }, // June 9 passed
            { id: 'hbo', year: 2026, month: 6 }, // July 9 passed
        ]);
    });

    test('not-yet-due bills are left alone (due today is not past due)', () => {
        const bills = [
            { id: 'later', amount: 10, dueDay: 25, autoPay: true },
            { id: 'today', amount: 10, dueDay: 10, autoPay: true },
        ];
        const out = computeAutoTickUpdates(bills, unpaid, NOW);
        // Both were due in June (passed); neither July date has passed yet.
        assert.deepEqual(out.map(u => `${u.id}:${u.month}`), ['later:5', 'today:5']);
    });

    test('non-auto-pay, frozen, and non-monthly bills are never ticked', () => {
        const bills = [
            { id: 'manual', amount: 10, dueDay: 1 },
            { id: 'frozen', amount: 10, dueDay: 1, autoPay: true, frozen: true },
            { id: 'weekly', amount: 10, dueDay: 1, autoPay: true, frequency: 'weekly' },
        ];
        assert.equal(computeAutoTickUpdates(bills, unpaid, NOW).length, 0);
    });

    test('already-paid months are not re-ticked', () => {
        const bills = [{ id: 'hbo', amount: 19, dueDay: 9, autoPay: true }];
        const paidJune = (id, y, m) => y === 2026 && m === 5;
        const out = computeAutoTickUpdates(bills, paidJune, NOW);
        assert.deepEqual(out, [{ id: 'hbo', year: 2026, month: 6 }]);
    });

    test('bills created after the due date are not back-ticked', () => {
        const bills = [{ id: 'new', amount: 10, dueDay: 1, autoPay: true, createdAt: '2026-07-05T00:00:00.000Z' }];
        const out = computeAutoTickUpdates(bills, unpaid, NOW);
        assert.equal(out.length, 0, 'a bill added July 5 was never due June 1 or July 1');
    });
});
