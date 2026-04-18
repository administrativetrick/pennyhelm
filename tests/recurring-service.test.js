/**
 * Unit tests for js/services/recurring-service.js
 *
 * Covers merchant normalization, recurring-transaction detection, and bill
 * suggestion building. The detection algorithm has real edge cases around
 * date-interval clustering and amount variance — this suite exists mostly
 * to make sure a tweak to the scoring weights doesn't silently break
 * obvious cases (monthly Netflix, biweekly gym, random one-offs).
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeMerchant,
    detectRecurringTransactions,
    buildBillSuggestion,
} from '../js/services/recurring-service.js';

// ─── normalizeMerchant ────────────────────────────────────────────────

describe('normalizeMerchant', () => {
    test('lowercases and trims', () => {
        assert.equal(normalizeMerchant('  NETFLIX  '), 'netflix');
    });

    test('strips *1234 style identifiers', () => {
        assert.equal(normalizeMerchant('Netflix *1234'), 'netflix');
    });

    test('strips #5678 style identifiers', () => {
        assert.equal(normalizeMerchant('Spotify #5678'), 'spotify');
    });

    test('strips common corporate suffixes', () => {
        assert.equal(normalizeMerchant('Acme Inc'), 'acme');
        assert.equal(normalizeMerchant('Acme Inc.'), 'acme');
        assert.equal(normalizeMerchant('Foo LLC'), 'foo');
        assert.equal(normalizeMerchant('Bar Corp'), 'bar');
        assert.equal(normalizeMerchant('Baz Ltd'), 'baz');
    });

    test('strips trailing long digit runs', () => {
        assert.equal(normalizeMerchant('Gas Station 12345'), 'gas station');
    });

    test('collapses internal whitespace', () => {
        assert.equal(normalizeMerchant('Multi   Space    Co'), 'multi space');
    });

    test('strips non-word characters', () => {
        assert.equal(normalizeMerchant('AT&T'), 'att');
    });

    test('empty / null input returns "unknown"', () => {
        assert.equal(normalizeMerchant(''), 'unknown');
        assert.equal(normalizeMerchant(null), 'unknown');
        assert.equal(normalizeMerchant(undefined), 'unknown');
    });

    test('groups the real-world variants that matter for detection', () => {
        // The scenarios we actually care about: Plaid returning the same
        // merchant with different trailing transaction IDs, varying case,
        // or corporate suffixes. All of these should share a key.
        const key = normalizeMerchant('Netflix');
        assert.equal(normalizeMerchant('NETFLIX'), key);
        assert.equal(normalizeMerchant('netflix'), key);
        assert.equal(normalizeMerchant('Netflix *1234'), key);
        assert.equal(normalizeMerchant('Netflix #98765'), key);
        assert.equal(normalizeMerchant('Netflix Inc'), key);
        // Note: punctuation (".") is stripped, so "Netflix.com" collapses to
        // "netflixcom" — a different key from "Netflix". That's current
        // behavior; if it matters we can file a follow-up.
    });
});

// ─── detectRecurringTransactions ──────────────────────────────────────

function makeExpense({ vendor, name, amount, date, category = 'subscriptions' }) {
    // Use midday timestamps to avoid UTC-midnight → previous-day drift
    // when `new Date(string).getDate()` is read back in a non-UTC timezone.
    const fullDate = /T\d/.test(date) ? date : `${date}T12:00:00`;
    return {
        source: 'plaid',
        vendor: vendor || name,
        name: name || vendor,
        amount,
        date: fullDate,
        category,
    };
}

describe('detectRecurringTransactions', () => {
    test('returns empty result for empty input', () => {
        const result = detectRecurringTransactions([], [], []);
        assert.deepEqual(result.recurring, []);
        assert.deepEqual(result.irregular, []);
    });

    test('ignores manual (non-Plaid) expenses', () => {
        const expenses = [
            { source: 'manual', name: 'Netflix', amount: 15.99, date: '2026-01-05' },
            { source: 'manual', name: 'Netflix', amount: 15.99, date: '2026-02-05' },
            { source: 'manual', name: 'Netflix', amount: 15.99, date: '2026-03-05' },
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        assert.equal(result.recurring.length, 0);
    });

    test('needs at least 2 occurrences', () => {
        const expenses = [
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-01-05' }),
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        assert.equal(result.recurring.length, 0);
    });

    test('detects monthly Netflix as recurring', () => {
        const expenses = [
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-01-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-02-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-03-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-04-05' }),
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        assert.equal(result.recurring.length, 1);
        const r = result.recurring[0];
        assert.equal(r.frequency, 'monthly');
        assert.equal(r.occurrences, 4);
        assert.equal(r.averageAmount, 15.99);
        // Fixed amount → variance should be zero (or extremely close)
        assert.ok(r.amountVariance < 0.01);
        // High confidence on a clean monthly pattern
        assert.ok(r.confidence >= 0.7, `confidence was ${r.confidence}`);
    });

    test('detects biweekly pattern with the right frequency label', () => {
        const expenses = [
            makeExpense({ name: 'Gym', amount: 39.99, date: '2026-01-02' }),
            makeExpense({ name: 'Gym', amount: 39.99, date: '2026-01-16' }),
            makeExpense({ name: 'Gym', amount: 39.99, date: '2026-01-30' }),
            makeExpense({ name: 'Gym', amount: 39.99, date: '2026-02-13' }),
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        assert.equal(result.recurring.length, 1);
        assert.equal(result.recurring[0].frequency, 'biweekly');
    });

    test('ignores random one-offs that do not cluster around any frequency', () => {
        const expenses = [
            makeExpense({ name: 'RandomShop', amount: 25, date: '2026-01-03' }),
            makeExpense({ name: 'RandomShop', amount: 10, date: '2026-01-11' }),
            makeExpense({ name: 'RandomShop', amount: 80, date: '2026-02-20' }),
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        // Should not be flagged recurring — intervals (8 days, 40 days) don't cluster
        assert.equal(result.recurring.length, 0);
    });

    test('excludes merchants that already exist as bills', () => {
        const expenses = [
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-01-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-02-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-03-05' }),
        ];
        const bills = [{ name: 'Netflix' }];
        const result = detectRecurringTransactions(expenses, bills, []);
        assert.equal(result.recurring.length, 0);
    });

    test('excludes dismissed merchant keys', () => {
        const expenses = [
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-01-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-02-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-03-05' }),
        ];
        const result = detectRecurringTransactions(expenses, [], ['netflix']);
        assert.equal(result.recurring.length, 0);
    });

    test('sorts results by confidence descending', () => {
        const expenses = [
            // Noisy quarterly — lower confidence
            makeExpense({ name: 'Insurance', amount: 450, date: '2026-01-10' }),
            makeExpense({ name: 'Insurance', amount: 470, date: '2026-04-15' }),
            makeExpense({ name: 'Insurance', amount: 430, date: '2026-07-20' }),
            // Clean monthly — high confidence
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-01-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-02-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-03-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-04-05' }),
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        if (result.recurring.length >= 2) {
            assert.ok(result.recurring[0].confidence >= result.recurring[1].confidence);
        }
    });

    test('estimatedDueDay reflects the recent transaction dates', () => {
        const expenses = [
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-01-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-02-05' }),
            makeExpense({ name: 'Netflix', amount: 15.99, date: '2026-03-05' }),
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        assert.equal(result.recurring[0].estimatedDueDay, 5);
    });

    test('groups merchant name variants (Netflix vs NETFLIX *1234)', () => {
        const expenses = [
            makeExpense({ name: 'Netflix',        amount: 15.99, date: '2026-01-05' }),
            makeExpense({ name: 'NETFLIX *1234',  amount: 15.99, date: '2026-02-05' }),
            makeExpense({ name: 'netflix',        amount: 15.99, date: '2026-03-05' }),
            makeExpense({ name: 'Netflix',        amount: 15.99, date: '2026-04-05' }),
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        assert.equal(result.recurring.length, 1);
        assert.equal(result.recurring[0].occurrences, 4);
    });

    test('detects irregular amount when one charge is >2σ from the norm', () => {
        // Need enough "normal" history for the outlier to be >2 sd out.
        // With 6 @ $40 and 1 @ $250, deviation is ~2.4σ.
        const expenses = [
            makeExpense({ name: 'Gym', amount: 40, date: '2025-10-05' }),
            makeExpense({ name: 'Gym', amount: 40, date: '2025-11-05' }),
            makeExpense({ name: 'Gym', amount: 40, date: '2025-12-05' }),
            makeExpense({ name: 'Gym', amount: 40, date: '2026-01-05' }),
            makeExpense({ name: 'Gym', amount: 40, date: '2026-02-05' }),
            makeExpense({ name: 'Gym', amount: 40, date: '2026-03-05' }),
            makeExpense({ name: 'Gym', amount: 250, date: '2026-04-05' }), // annual fee
        ];
        const result = detectRecurringTransactions(expenses, [], []);
        assert.ok(result.irregular.length >= 1,
            `expected irregular flag, got ${result.irregular.length}`);
        const flagged = result.irregular[0];
        assert.equal(flagged.direction, 'higher');
        assert.equal(flagged.amount, 250);
    });
});

// ─── buildBillSuggestion ──────────────────────────────────────────────

describe('buildBillSuggestion', () => {
    test('fixed-amount recurring uses lastAmount', () => {
        const recurring = {
            merchantName: 'Netflix',
            averageAmount: 15.99,
            lastAmount: 15.99,
            frequency: 'monthly',
            estimatedDueDay: 5,
            category: 'subscriptions',
            amountVariance: 0,
            occurrences: 4,
        };
        const suggestion = buildBillSuggestion(recurring);
        assert.equal(suggestion.name, 'Netflix');
        assert.equal(suggestion.amount, 15.99);
        assert.equal(suggestion.frequency, 'monthly');
        assert.equal(suggestion.dueDay, 5);
        assert.equal(suggestion.autoPay, false);
        assert.equal(suggestion.frozen, false);
    });

    test('variable-amount recurring uses averageAmount', () => {
        const recurring = {
            merchantName: 'Electric',
            averageAmount: 120.50,
            lastAmount: 165.00,
            frequency: 'monthly',
            estimatedDueDay: 15,
            category: 'utilities',
            amountVariance: 0.20, // 20% variance — above 5% threshold
            occurrences: 6,
        };
        const suggestion = buildBillSuggestion(recurring);
        assert.equal(suggestion.amount, 120.50);
    });

    test('maps expense category to bill category', () => {
        const base = {
            merchantName: 'Foo', averageAmount: 50, lastAmount: 50,
            frequency: 'monthly', estimatedDueDay: 1, amountVariance: 0, occurrences: 3,
        };
        assert.equal(buildBillSuggestion({ ...base, category: 'utilities' }).category, 'Utilities');
        assert.equal(buildBillSuggestion({ ...base, category: 'subscriptions' }).category, 'Subscriptions');
        assert.equal(buildBillSuggestion({ ...base, category: 'groceries' }).category, 'Groceries');
    });

    test('unknown expense category falls back to "Other"', () => {
        const recurring = {
            merchantName: 'Mystery', averageAmount: 10, lastAmount: 10,
            frequency: 'monthly', estimatedDueDay: 1,
            category: 'made-up-category', amountVariance: 0, occurrences: 3,
        };
        assert.equal(buildBillSuggestion(recurring).category, 'Other');
    });

    test('notes field documents how many occurrences were detected', () => {
        const recurring = {
            merchantName: 'Foo', averageAmount: 10, lastAmount: 10,
            frequency: 'monthly', estimatedDueDay: 1,
            category: 'other', amountVariance: 0, occurrences: 7,
        };
        const suggestion = buildBillSuggestion(recurring);
        assert.match(suggestion.notes, /7 occurrences/);
    });
});
