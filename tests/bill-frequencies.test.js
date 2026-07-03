/**
 * Tests for the every-4-weeks and every-2-months bill frequencies.
 *
 * every-4-weeks: a 28-day cycle anchored on a known due date
 * (bill.anchorDate) — a weekday alone can't pin which of the four weeks the
 * bill lands on. Built for cadences like daycare billed on a 4-week custody
 * rotation.
 *
 * every-2-months: due on dueDay in alternating months, phase-anchored by
 * dueMonth parity — common for water/sewer/trash utilities.
 */

process.env.TZ = 'America/Los_Angeles';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    frequencyToMonthly,
    expandBillOccurrences,
    getOverdueCarryForwards,
    computeAutoTickUpdates,
} from '../js/services/financial-service.js';

describe('frequencyToMonthly for new frequencies', () => {
    test('every-4-weeks averages 13 payments per year', () => {
        assert.equal(frequencyToMonthly(120, 'every-4-weeks'), 120 * 13 / 12);
    });
    test('every-2-months averages 6 payments per year', () => {
        assert.equal(frequencyToMonthly(120, 'every-2-months'), 60);
    });
});

describe('expandBillOccurrences: every-4-weeks', () => {
    const bill = { id: 'daycare', amount: 485, frequency: 'every-4-weeks', anchorDate: '2026-06-05' };

    test('anchored 28-day cycle lands on the right July dates', () => {
        // Jun 5 + 28 = Jul 3; + 28 = Jul 31
        const occ = expandBillOccurrences(bill, new Date(2026, 6, 1), new Date(2026, 6, 31), []);
        assert.deepEqual(occ.map(o => o._occurrenceDate.getDate()), [3, 31]);
        assert.ok(occ.every(o => o._occurrenceDate.getMonth() === 6));
        assert.ok(occ.every(o => o._occurrenceKey.includes('_4w_')));
    });

    test('anchor works when it is after the range (walks backward)', () => {
        const future = { ...bill, anchorDate: '2026-08-28' }; // -28 → Jul 31, -28 → Jul 3
        const occ = expandBillOccurrences(future, new Date(2026, 6, 1), new Date(2026, 6, 31), []);
        assert.deepEqual(occ.map(o => o._occurrenceDate.getDate()), [3, 31]);
    });

    test('occurrences stay at local midnight across DST', () => {
        const occ = expandBillOccurrences(bill, new Date(2026, 0, 1), new Date(2026, 11, 31), []);
        assert.equal(occ.length, 13, 'a full year has 13 four-week cycles');
        for (const o of occ) assert.equal(o._occurrenceDate.getHours(), 0);
    });

    test('a month with a single occurrence yields one row', () => {
        // August 2026: Jul 31 + 28 = Aug 28 only
        const occ = expandBillOccurrences(bill, new Date(2026, 7, 1), new Date(2026, 7, 31), []);
        assert.deepEqual(occ.map(o => `${o._occurrenceDate.getMonth()}/${o._occurrenceDate.getDate()}`), ['7/28']);
    });
});

describe('expandBillOccurrences: every-2-months', () => {
    const bill = { id: 'water', amount: 90, frequency: 'every-2-months', dueDay: 15, dueMonth: 0 };

    test('due in anchor-parity months only', () => {
        const occ = expandBillOccurrences(bill, new Date(2026, 0, 1), new Date(2026, 3, 30), []);
        assert.deepEqual(
            occ.map(o => `${o._occurrenceDate.getMonth()}/${o._occurrenceDate.getDate()}`),
            ['0/15', '2/15'], // Jan 15, Mar 15
        );
    });

    test('odd-anchored bills land on odd months', () => {
        const feb = { ...bill, dueMonth: 1 }; // Feb/Apr/Jun...
        const occ = expandBillOccurrences(feb, new Date(2026, 0, 1), new Date(2026, 5, 30), []);
        assert.deepEqual(occ.map(o => o._occurrenceDate.getMonth()), [1, 3, 5]);
    });

    test('dueDay 31 clamps to short months', () => {
        const eom = { id: 'x', amount: 10, frequency: 'every-2-months', dueDay: 31, dueMonth: 0 };
        const occ = expandBillOccurrences(eom, new Date(2026, 2, 1), new Date(2026, 2, 31), []);
        assert.deepEqual(occ.map(o => o._occurrenceDate.getDate()), [31]); // March has 31
        const nov = expandBillOccurrences(eom, new Date(2026, 10, 1), new Date(2026, 10, 30), []);
        assert.deepEqual(nov.map(o => o._occurrenceDate.getDate()), [30]); // November clamps
    });
});

describe('overdue carry-forward for new frequencies', () => {
    const NOW = new Date(2026, 6, 3); // July 2026; previous month = June
    const unpaid = () => false;

    test('unpaid every-4-weeks June occurrences carry forward per occurrence', () => {
        const bill = { id: 'daycare', amount: 485, frequency: 'every-4-weeks', anchorDate: '2026-06-05' };
        const out = getOverdueCarryForwards([bill], unpaid, NOW);
        assert.equal(out.length, 1); // Jun 5 (next is Jul 3 — current month)
        assert.equal(out[0]._paidMonth, 5);
        assert.equal(out[0]._overdueFrom.day, 5);
        assert.ok(out[0]._occurrenceKey.includes('_4w_'));
    });

    test('paid occurrences do not carry forward', () => {
        const bill = { id: 'daycare', amount: 485, frequency: 'every-4-weeks', anchorDate: '2026-06-05' };
        const paid = (id, y, m, key) => key != null && key.includes('2026-5-5');
        assert.equal(getOverdueCarryForwards([bill], paid, NOW).length, 0);
    });

    test('every-2-months carries forward only when June matches its parity', () => {
        const dueJune = { id: 'w1', amount: 90, frequency: 'every-2-months', dueDay: 15, dueMonth: 1 }; // Feb/Apr/Jun
        const dueJuly = { id: 'w2', amount: 90, frequency: 'every-2-months', dueDay: 15, dueMonth: 0 }; // Jan/Mar/May/Jul
        const out = getOverdueCarryForwards([dueJune, dueJuly], unpaid, NOW);
        assert.deepEqual(out.map(b => b.id), ['w1']);
    });
});

describe('auto-tick for every-2-months', () => {
    test('past-due parity month gets ticked, non-parity skipped', () => {
        const NOW = new Date(2026, 6, 20); // July 20
        const bill = { id: 'w', amount: 90, frequency: 'every-2-months', dueDay: 15, dueMonth: 0, autoPay: true }; // Jan/Mar/May/Jul
        const out = computeAutoTickUpdates([bill], () => false, NOW);
        // June (month 5) is non-parity — skipped; July 15 passed — ticked.
        assert.deepEqual(out, [{ id: 'w', year: 2026, month: 6 }]);
    });
});
