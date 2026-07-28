/**
 * Debt Repayment Strategy math. Uses SYNTHETIC, hand-verifiable debts only —
 * no real user balances or account names in the repo (see the changelog-PII
 * scrub rule). Every expected number below is computed by hand from these
 * fictional inputs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    simulate, balanceSeries, allocateLumps, afterLumpsSummary, annualInterest,
    applyLumpTo, avalancheOrder, prepareStrategyDebts,
} from '../js/services/debt-strategy-service.js';

// Fictional cards: A highest APR, then B, then C.
const CARDS = [
    { name: 'Card A', bal: 5000, apr: 24 },
    { name: 'Card B', bal: 3000, apr: 18 },
    { name: 'Card C', bal: 2000, apr: 12 },
];
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

describe('avalanche ordering + refundable floor', () => {
    test('orders by APR desc, ties by smaller balance', () => {
        const bals = [{ bal: 100, apr: 20 }, { bal: 100, apr: 30 }, { bal: 50, apr: 30 }];
        assert.deepEqual(avalancheOrder(bals), [2, 1, 0]);
    });
    test('a lump never pays a debt below its refundable floor', () => {
        const bals = [{ bal: 5000, apr: 25, floor: 2000 }];
        const leftover = applyLumpTo(bals, 4000);
        assert.equal(bals[0].bal, 2000);  // stopped at the floor
        assert.equal(leftover, 1000);     // $1000 had nowhere to go
    });
});

describe('afterLumpsSummary + annualInterest', () => {
    test('pours lumps down the avalanche and reports interest killed', () => {
        // Total lumps 8000: clears A (5000, kills 5000*24% = 1200) then B (3000, kills 3000*18% = 540).
        const s = afterLumpsSummary(CARDS, [{ m: 0, amt: 5000 }, { m: 3, amt: 3000 }]);
        assert.equal(s.afterLumps, 2000);       // only Card C left
        near(s.interestKilled, 1740, 0.01);     // 1200 + 540
    });
    test('annualInterest sums bal*apr', () => {
        near(annualInterest(CARDS), 5000 * 0.24 + 3000 * 0.18 + 2000 * 0.12, 0.01);
    });
});

describe('allocateLumps', () => {
    test('each wave clears the highest-APR debt first; tail is the cheapest', () => {
        const a = allocateLumps(CARDS, [{ m: 0, amt: 5000, label: 'W1' }, { m: 3, amt: 3000, label: 'W2' }]);
        assert.equal(a.waves[0].rows[0].name, 'Card A');
        assert.equal(a.waves[0].rows[0].paidOff, true);
        assert.equal(a.waves[1].rows[0].name, 'Card B');
        assert.equal(a.waves[1].rows[0].paidOff, true);
        assert.deepEqual(a.remaining.map((r) => r.name), ['Card C']);
        assert.equal(a.remainingTotal, 2000);
    });
});

describe('simulate (deterministic 0% cases)', () => {
    test('one 0% debt, $100/mo, no lumps → 12 months, no interest', () => {
        const r = simulate([{ name: 'X', bal: 1200, apr: 0 }], [], 100, 'current');
        assert.equal(r.months, 12);
        near(r.interest, 0, 0.001);
        near(r.outOfPocket, 1200, 0.01);
        assert.equal(r.converged, true);
    });
    test('a $400 lump at month 0 shortens payoff to 8 months', () => {
        const r = simulate([{ name: 'X', bal: 1200, apr: 0 }], [{ m: 0, amt: 400 }], 100, 'current');
        assert.equal(r.months, 8);
        near(r.outOfPocket, 1200, 0.01);
    });
    test('a payment that cannot outrun interest never converges', () => {
        const r = simulate([{ name: 'X', bal: 10000, apr: 24 }], [], 10, 'current');
        assert.equal(r.converged, false);
    });
    test('a lower uniform rate scenario costs less interest', () => {
        const cur = simulate(CARDS, [{ m: 0, amt: 2000 }], 300, 'current');
        const zero = simulate(CARDS, [{ m: 0, amt: 2000 }], 300, '0');
        assert.ok(zero.interest < cur.interest);
        near(zero.interest, 0, 0.001);
    });
});

describe('balanceSeries', () => {
    test('one mark per lump, top = starting total, payoff > 0', () => {
        const g = balanceSeries(CARDS, [{ m: 0, amt: 5000 }, { m: 3, amt: 3000 }], 300, 'current');
        assert.equal(g.marks.length, 2);
        assert.equal(g.maxV, 10000);
        assert.ok(g.payoffMonth > 0 && g.payoffMonth < 900);
    });
});

describe('prepareStrategyDebts', () => {
    const stored = [
        { id: 'a', name: 'Visa', type: 'credit-card', currentBalance: 1000, interestRate: 25, minimumPayment: 25 },
        { id: 'b', name: 'Car', type: 'auto-loan', currentBalance: 15000, interestRate: 5, minimumPayment: 300 },
        { id: 'c', name: 'Paid', type: 'credit-card', currentBalance: 0, interestRate: 22, minimumPayment: 0 },
    ];
    test('defaults to including credit cards with a balance only', () => {
        assert.deepEqual(prepareStrategyDebts(stored, {}).map((d) => d.id), ['a']);
    });
    test('explicit include flag overrides the card default', () => {
        const out = prepareStrategyDebts(stored, { b: { included: true }, a: { included: false } });
        assert.deepEqual(out.map((d) => d.id).sort(), ['b']);
    });
    test('includeTypes selects debts by type', () => {
        assert.deepEqual(prepareStrategyDebts(stored, {}, ['auto-loan']).map((d) => d.id), ['b']);
        assert.deepEqual(prepareStrategyDebts(stored, {}, ['credit-card', 'auto-loan']).map((d) => d.id).sort(), ['a', 'b']);
        assert.deepEqual(prepareStrategyDebts(stored, {}, []).map((d) => d.id), []); // empty = none by type
    });
    test('per-debt include flag still overrides a type selection', () => {
        const out = prepareStrategyDebts(stored, { a: { included: true }, b: { included: false } }, ['auto-loan']);
        assert.deepEqual(out.map((d) => d.id).sort(), ['a']);
    });
    test('carries joint + refundable flags through', () => {
        const out = prepareStrategyDebts(stored, { a: { joint: true, refundableAmount: 200 } });
        assert.equal(out[0].joint, true);
        assert.equal(out[0].floor, 200);
    });
});
