/**
 * Tests for the bills-page "Remaining Bills This Period" summary math.
 *
 * The summary card totals only bills that are still unpaid, using the same
 * due-month bucketing as the bills table (getBillPaidBucket), so a pay period
 * that straddles a month boundary reads paid status from the month the bill is
 * actually due — not the month being viewed. These tests pin that behavior:
 * the card must drop when a bill is marked paid, ignore frozen/excluded bills,
 * and honor occurrence-level paid keys for expanded recurring bills.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getBillPaidBucket, sumRemainingBills } from '../js/services/financial-service.js';

// Minimal stand-in for store.isBillPaid backed by a Set of "id:year:month[:key]".
function paidSet(...entries) {
    const s = new Set(entries);
    return (id, year, month, key) =>
        s.has(key != null ? `${id}:${year}:${month}:${key}` : `${id}:${year}:${month}`);
}

describe('getBillPaidBucket', () => {
    test('falls back to the viewed month for plain bills', () => {
        assert.deepEqual(getBillPaidBucket({ id: 1 }, 2026, 6), [2026, 6]);
    });

    test('uses _occurrenceDate for expanded recurring occurrences', () => {
        const bill = { id: 1, _occurrenceDate: new Date(2026, 7, 3) };
        assert.deepEqual(getBillPaidBucket(bill, 2026, 6), [2026, 7]);
    });

    test('uses _paidYear/_paidMonth for month-straddling monthly bills', () => {
        const bill = { id: 1, _paidYear: 2026, _paidMonth: 7 };
        assert.deepEqual(getBillPaidBucket(bill, 2026, 6), [2026, 7]);
    });

    test('_paidMonth of 0 (January) is not treated as missing', () => {
        const bill = { id: 1, _paidYear: 2027, _paidMonth: 0 };
        assert.deepEqual(getBillPaidBucket(bill, 2026, 11), [2027, 0]);
    });
});

describe('sumRemainingBills', () => {
    const YEAR = 2026, MONTH = 6; // July 2026

    test('sums all unpaid bills', () => {
        const bills = [
            { id: 'rent', amount: 2000 },
            { id: 'power', amount: 150 },
        ];
        assert.equal(sumRemainingBills(bills, paidSet(), YEAR, MONTH), 2150);
    });

    test('marking a bill paid removes it from the total', () => {
        const bills = [
            { id: 'rent', amount: 2000 },
            { id: 'power', amount: 150 },
        ];
        const isPaid = paidSet(`rent:${YEAR}:${MONTH}`);
        assert.equal(sumRemainingBills(bills, isPaid, YEAR, MONTH), 150);
    });

    test('frozen and excludeFromTotal bills never count', () => {
        const bills = [
            { id: 'rent', amount: 2000, frozen: true },
            { id: 'gym', amount: 50, excludeFromTotal: true },
            { id: 'power', amount: 150 },
        ];
        assert.equal(sumRemainingBills(bills, paidSet(), YEAR, MONTH), 150);
    });

    test('all bills paid totals zero', () => {
        const bills = [{ id: 'rent', amount: 2000 }];
        const isPaid = paidSet(`rent:${YEAR}:${MONTH}`);
        assert.equal(sumRemainingBills(bills, isPaid, YEAR, MONTH), 0);
    });

    test('month-straddling bill reads paid status from its own due month', () => {
        // Due Aug 1 but shown in the July pay period: paid flag lives under
        // August. Marking it paid under August removes it; a July flag doesn't.
        const bill = { id: 'rent', amount: 2000, _paidYear: 2026, _paidMonth: 7 };
        const paidUnderJuly = paidSet(`rent:2026:6`);
        const paidUnderAugust = paidSet(`rent:2026:7`);
        assert.equal(sumRemainingBills([bill], paidUnderJuly, YEAR, MONTH), 2000,
            'a paid flag under the viewed month must not hide a bill due next month');
        assert.equal(sumRemainingBills([bill], paidUnderAugust, YEAR, MONTH), 0);
    });

    test('recurring occurrences are tracked per-occurrence via _occurrenceKey', () => {
        // Two weekly occurrences of the same bill in one period: paying the
        // first must not remove the second.
        const occ1 = { id: 'lawn', amount: 40, _occurrenceDate: new Date(2026, 6, 3), _occurrenceKey: '2026-07-03' };
        const occ2 = { id: 'lawn', amount: 40, _occurrenceDate: new Date(2026, 6, 10), _occurrenceKey: '2026-07-10' };
        const isPaid = paidSet(`lawn:2026:6:2026-07-03`);
        assert.equal(sumRemainingBills([occ1, occ2], isPaid, YEAR, MONTH), 40);
    });

    test('empty bill list totals zero', () => {
        assert.equal(sumRemainingBills([], paidSet(), YEAR, MONTH), 0);
    });
});
