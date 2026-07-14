/**
 * Stale-tab guard — mergeServerPlaidExpenses.
 *
 * A browser tab that loaded before a server-side Plaid sync must not
 * clobber the newer synced transactions when it saves the whole blob
 * (this destroyed a week of transactions in production — the "gas budget
 * shows $0" incident).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeServerPlaidExpenses } from '../js/services/storage-adapter.js';

const plaid = (id, extra = {}) => ({ id: 'local-' + id, plaidTransactionId: id, name: id, amount: 10, source: 'plaid', ...extra });
const manual = (id, extra = {}) => ({ id, name: id, amount: 5, ...extra });

describe('mergeServerPlaidExpenses', () => {
    test('rescues server Plaid transactions the client never saw', () => {
        const outgoing = { expenses: [plaid('a'), manual('m1')] };
        const server = { expenses: [plaid('a'), plaid('b'), plaid('c')] };
        const rescued = mergeServerPlaidExpenses(outgoing, server);
        assert.equal(rescued, 2);
        const ids = outgoing.expenses.map(e => e.plaidTransactionId).filter(Boolean);
        assert.deepEqual(ids.sort(), ['a', 'b', 'c']);
    });

    test('never duplicates transactions the client already has', () => {
        const outgoing = { expenses: [plaid('a'), plaid('b')] };
        const server = { expenses: [plaid('a'), plaid('b')] };
        assert.equal(mergeServerPlaidExpenses(outgoing, server), 0);
        assert.equal(outgoing.expenses.length, 2);
    });

    test('does not resurrect transactions deleted this session', () => {
        const outgoing = { expenses: [] };
        const server = { expenses: [plaid('a'), plaid('b')] };
        const rescued = mergeServerPlaidExpenses(outgoing, server, new Set(['a']));
        assert.equal(rescued, 1);
        assert.equal(outgoing.expenses[0].plaidTransactionId, 'b');
    });

    test('manual server expenses are NOT merged (client owns those)', () => {
        // The client may have legitimately deleted a manual expense — only
        // Plaid rows (server-side sync writes) are rescued.
        const outgoing = { expenses: [] };
        const server = { expenses: [manual('hand-entered'), plaid('p1')] };
        const rescued = mergeServerPlaidExpenses(outgoing, server);
        assert.equal(rescued, 1);
        assert.equal(outgoing.expenses.length, 1);
        assert.equal(outgoing.expenses[0].plaidTransactionId, 'p1');
    });

    test('client edits to an existing Plaid expense win (same id, changed category)', () => {
        const edited = plaid('a');
        edited.category = 'gas';
        edited.manualOverride = true;
        const outgoing = { expenses: [edited] };
        const server = { expenses: [plaid('a', { category: 'other' })] };
        mergeServerPlaidExpenses(outgoing, server);
        assert.equal(outgoing.expenses.length, 1);
        assert.equal(outgoing.expenses[0].category, 'gas');
    });

    test('sync watermark never regresses, but does advance', () => {
        const outgoing = { expenses: [], lastTransactionSync: '2026-07-07T00:00:00Z' };
        const server = { expenses: [], lastTransactionSync: '2026-07-13T00:00:00Z' };
        mergeServerPlaidExpenses(outgoing, server);
        assert.equal(outgoing.lastTransactionSync, '2026-07-13T00:00:00Z');

        const outgoing2 = { expenses: [], lastTransactionSync: '2026-07-13T00:00:00Z' };
        mergeServerPlaidExpenses(outgoing2, { expenses: [], lastTransactionSync: '2026-07-01T00:00:00Z' });
        assert.equal(outgoing2.lastTransactionSync, '2026-07-13T00:00:00Z');
    });

    test('reproduces the production incident: stale save preserves the fuel week', () => {
        // Server: 125 July expenses incl. fuel synced Jul 10-11. Stale tab:
        // only knows through Jul 6. Its save must keep the fuel rows.
        const fuel = [plaid('arco', { amount: 23.68, category: 'gas' }), plaid('shell1', { amount: 40.47, category: 'gas' }), plaid('shell2', { amount: 150.56, category: 'gas' })];
        const staleTab = { expenses: [plaid('old1'), manual('rent-note')] };
        const server = { expenses: [plaid('old1'), ...fuel] };
        const rescued = mergeServerPlaidExpenses(staleTab, server);
        assert.equal(rescued, 3);
        const gasTotal = staleTab.expenses.filter(e => e.category === 'gas').reduce((s, e) => s + e.amount, 0);
        assert.ok(Math.abs(gasTotal - 214.71) < 0.001);
    });

    test('handles missing/empty structures without throwing', () => {
        assert.equal(mergeServerPlaidExpenses({}, {}), 0);
        assert.equal(mergeServerPlaidExpenses({ expenses: null }, { expenses: [plaid('x')] }), 1);
        assert.equal(mergeServerPlaidExpenses({}, null), 0);
    });
});
