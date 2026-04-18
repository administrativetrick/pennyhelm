/**
 * Unit tests for js/services/financial-service.js
 *
 * Covers the pure financial calculations — net worth, monthly income,
 * pay date generation, bill expansion, financial health score, and
 * balance snapshots. These are the functions that touch real money,
 * so a regression here means a lost user's trust.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    calculateNetWorth,
    getMonthlyMultiplier,
    calculateMonthlyIncome,
    generatePayDates,
    createBalanceSnapshot,
    expandBillOccurrences,
    calculateFinancialHealthScore,
    buildPayPeriods,
} from '../js/services/financial-service.js';

// ─── calculateNetWorth ────────────────────────────────────────────────

describe('calculateNetWorth', () => {
    test('returns zeros for empty inputs', () => {
        const result = calculateNetWorth([], []);
        assert.equal(result.cashTotal, 0);
        assert.equal(result.investmentTotal, 0);
        assert.equal(result.propertyEquity, 0);
        assert.equal(result.vehicleEquity, 0);
        assert.equal(result.creditOwed, 0);
        assert.equal(result.unlinkedDebtBalance, 0);
        assert.equal(result.netWorth, 0);
    });

    test('handles null/undefined inputs without throwing', () => {
        const result = calculateNetWorth(null, undefined);
        assert.equal(result.netWorth, 0);
    });

    test('sums checking and savings into cashTotal', () => {
        const accounts = [
            { type: 'checking', balance: 1500 },
            { type: 'savings', balance: 3500 },
        ];
        const result = calculateNetWorth(accounts, []);
        assert.equal(result.cashTotal, 5000);
        assert.equal(result.netWorth, 5000);
    });

    test('sums investment and retirement into investmentTotal', () => {
        const accounts = [
            { type: 'investment', balance: 12000 },
            { type: 'retirement', balance: 48000 },
        ];
        const result = calculateNetWorth(accounts, []);
        assert.equal(result.investmentTotal, 60000);
    });

    test('property equity = balance minus amountOwed', () => {
        const accounts = [{ type: 'property', balance: 300000, amountOwed: 180000 }];
        const result = calculateNetWorth(accounts, []);
        assert.equal(result.propertyEquity, 120000);
    });

    test('vehicle equity = balance minus amountOwed', () => {
        const accounts = [{ type: 'vehicle', balance: 25000, amountOwed: 18000 }];
        const result = calculateNetWorth(accounts, []);
        assert.equal(result.vehicleEquity, 7000);
    });

    test('credit card balances are subtracted', () => {
        const accounts = [
            { type: 'checking', balance: 5000 },
            { type: 'credit', balance: 1200 },
        ];
        const result = calculateNetWorth(accounts, []);
        assert.equal(result.creditOwed, 1200);
        assert.equal(result.netWorth, 3800);
    });

    test('unlinked debts are subtracted', () => {
        const accounts = [{ type: 'checking', balance: 10000 }];
        const debts = [{ currentBalance: 4000 }]; // no linkedAccountId
        const result = calculateNetWorth(accounts, debts);
        assert.equal(result.unlinkedDebtBalance, 4000);
        assert.equal(result.netWorth, 6000);
    });

    test('linked debts are NOT subtracted (avoids double-counting the linked account)', () => {
        // Critical: a car loan linked to the vehicle account should not be
        // subtracted again — the vehicle equity calculation already handles it.
        const accounts = [
            { type: 'vehicle', balance: 25000, amountOwed: 18000 }, // +7000 equity
        ];
        const debts = [{ currentBalance: 18000, linkedAccountId: 'veh-1' }];
        const result = calculateNetWorth(accounts, debts);
        assert.equal(result.unlinkedDebtBalance, 0);
        assert.equal(result.netWorth, 7000);
    });

    test('treats missing balance/amountOwed fields as zero', () => {
        const accounts = [
            { type: 'checking' }, // no balance
            { type: 'property', balance: 200000 }, // no amountOwed
        ];
        const result = calculateNetWorth(accounts, []);
        assert.equal(result.cashTotal, 0);
        assert.equal(result.propertyEquity, 200000);
    });

    test('produces negative net worth when debts exceed assets', () => {
        const accounts = [{ type: 'checking', balance: 500 }];
        const debts = [{ currentBalance: 15000 }];
        const result = calculateNetWorth(accounts, debts);
        assert.equal(result.netWorth, -14500);
    });
});

// ─── getMonthlyMultiplier ─────────────────────────────────────────────

describe('getMonthlyMultiplier', () => {
    test('weekly returns 52/12', () => {
        assert.equal(getMonthlyMultiplier('weekly'), 52 / 12);
    });
    test('biweekly returns 26/12', () => {
        assert.equal(getMonthlyMultiplier('biweekly'), 26 / 12);
    });
    test('semimonthly returns 2', () => {
        assert.equal(getMonthlyMultiplier('semimonthly'), 2);
    });
    test('monthly (default) returns 1', () => {
        assert.equal(getMonthlyMultiplier('monthly'), 1);
    });
    test('unknown frequency falls back to 1', () => {
        assert.equal(getMonthlyMultiplier('daily'), 1);
        assert.equal(getMonthlyMultiplier(undefined), 1);
    });
});

// ─── calculateMonthlyIncome ───────────────────────────────────────────

describe('calculateMonthlyIncome', () => {
    test('returns zeros when income is null', () => {
        const result = calculateMonthlyIncome(null, []);
        assert.equal(result.totalMonthly, 0);
        assert.equal(result.userPayMonthly, 0);
        assert.equal(result.depMonthlyPay, 0);
        assert.equal(result.otherIncomeMonthly, 0);
    });

    test('converts biweekly user pay correctly', () => {
        const income = {
            user: { payAmount: 2000, frequency: 'biweekly' },
        };
        const result = calculateMonthlyIncome(income, []);
        // 2000 × (26/12) = 4333.33...
        assert.ok(Math.abs(result.userPayMonthly - (2000 * 26 / 12)) < 0.001);
    });

    test('converts weekly user pay correctly', () => {
        const income = { user: { payAmount: 1000, frequency: 'weekly' } };
        const result = calculateMonthlyIncome(income, []);
        assert.ok(Math.abs(result.userPayMonthly - (1000 * 52 / 12)) < 0.001);
    });

    test('semimonthly user pay doubles', () => {
        const income = { user: { payAmount: 2500, frequency: 'semimonthly' } };
        const result = calculateMonthlyIncome(income, []);
        assert.equal(result.userPayMonthly, 5000);
    });

    test('defaults user frequency to biweekly when missing', () => {
        const income = { user: { payAmount: 2000 } };
        const result = calculateMonthlyIncome(income, []);
        assert.ok(Math.abs(result.userPayMonthly - (2000 * 26 / 12)) < 0.001);
    });

    test('includes dependent pay when employed is true', () => {
        const income = {
            user: { payAmount: 2000, frequency: 'biweekly' },
            dependent: { payAmount: 1500, frequency: 'monthly', employed: true },
        };
        const result = calculateMonthlyIncome(income, []);
        assert.equal(result.depMonthlyPay, 1500);
        assert.ok(result.totalMonthly > result.userPayMonthly);
    });

    test('excludes dependent pay when employed is false', () => {
        const income = {
            user: { payAmount: 2000, frequency: 'biweekly' },
            dependent: { payAmount: 1500, frequency: 'monthly', employed: false },
        };
        const result = calculateMonthlyIncome(income, []);
        assert.equal(result.depMonthlyPay, 0);
    });

    test('combineDependentIncome: false excludes dep from totalMonthly but not from depMonthlyPay', () => {
        const income = {
            user: { payAmount: 2000, frequency: 'biweekly' },
            dependent: { payAmount: 1500, frequency: 'monthly', employed: true },
            combineDependentIncome: false,
        };
        const result = calculateMonthlyIncome(income, []);
        assert.equal(result.depMonthlyPay, 1500); // still reported
        assert.ok(Math.abs(result.totalMonthly - result.userPayMonthly) < 0.001);
    });

    test('sums other income sources with mixed frequencies', () => {
        const income = { user: { payAmount: 0, frequency: 'monthly' } };
        const other = [
            { amount: 500, frequency: 'monthly' },
            { amount: 100, frequency: 'weekly' }, // × 52/12
        ];
        const result = calculateMonthlyIncome(income, other);
        const expected = 500 + 100 * 52 / 12;
        assert.ok(Math.abs(result.otherIncomeMonthly - expected) < 0.001);
    });
});

// ─── generatePayDates ─────────────────────────────────────────────────

describe('generatePayDates', () => {
    test('returns empty array when schedule is missing', () => {
        assert.deepEqual(generatePayDates(null, '2026-01-01', '2026-03-01'), []);
        assert.deepEqual(generatePayDates({}, '2026-01-01', '2026-03-01'), []);
    });

    test('biweekly generates dates every 14 days within range', () => {
        const schedule = { startDate: '2026-01-02', frequency: 'biweekly' };
        const dates = generatePayDates(schedule, '2026-01-01', '2026-02-28');
        // Expect: Jan 2, Jan 16, Jan 30, Feb 13, Feb 27
        assert.equal(dates.length, 5);
        assert.equal(dates[0].getDate(), 2);
        assert.equal(dates[1].getDate(), 16);
        // All consecutive pairs exactly 14 days apart
        for (let i = 1; i < dates.length; i++) {
            const diffDays = (dates[i] - dates[i - 1]) / 86400000;
            assert.equal(diffDays, 14);
        }
    });

    test('weekly generates dates every 7 days within range', () => {
        const schedule = { startDate: '2026-01-05', frequency: 'weekly' };
        const dates = generatePayDates(schedule, '2026-01-01', '2026-01-31');
        // Jan 5, 12, 19, 26
        assert.equal(dates.length, 4);
        for (let i = 1; i < dates.length; i++) {
            const diffDays = (dates[i] - dates[i - 1]) / 86400000;
            assert.equal(diffDays, 7);
        }
    });

    test('semimonthly produces two sorted dates per month', () => {
        const schedule = { startDate: '2026-01-01', frequency: 'semimonthly' };
        const dates = generatePayDates(schedule, '2026-01-01', '2026-02-28');
        // Two per month × 2 months = 4
        assert.equal(dates.length, 4);
        // Strictly ascending
        for (let i = 1; i < dates.length; i++) {
            assert.ok(dates[i] >= dates[i - 1]);
        }
    });

    test('monthly produces one date per month', () => {
        const schedule = { startDate: '2026-01-15', frequency: 'monthly' };
        const dates = generatePayDates(schedule, '2026-01-01', '2026-04-30');
        assert.equal(dates.length, 4);
        for (const d of dates) assert.equal(d.getDate(), 15);
    });

    test('monthly clamps day-of-month above 28 to 28 (prevents Feb rollover bugs)', () => {
        const schedule = { startDate: '2026-01-31', frequency: 'monthly' };
        const dates = generatePayDates(schedule, '2026-01-01', '2026-04-30');
        // Every date should be on the 28th (clamp prevents "March 3" accidents)
        for (const d of dates) assert.equal(d.getDate(), 28);
    });

    test('all returned dates fall within the requested range', () => {
        const schedule = { startDate: '2026-01-01', frequency: 'biweekly' };
        const start = new Date('2026-02-01T00:00:00');
        const end = new Date('2026-03-31T00:00:00');
        const dates = generatePayDates(schedule, '2026-02-01', '2026-03-31');
        for (const d of dates) {
            assert.ok(d >= start, `${d.toISOString()} before range start`);
            assert.ok(d <= end, `${d.toISOString()} after range end`);
        }
    });
});

// ─── createBalanceSnapshot ────────────────────────────────────────────

describe('createBalanceSnapshot', () => {
    test('returns dateKey in YYYY-MM-DD format', () => {
        const snap = createBalanceSnapshot([], []);
        assert.match(snap.date, /^\d{4}-\d{2}-\d{2}$/);
    });

    test('sums checking, savings, and investment separately', () => {
        const accounts = [
            { type: 'checking', balance: 1000 },
            { type: 'savings', balance: 2000 },
            { type: 'investment', balance: 5000 },
        ];
        const snap = createBalanceSnapshot(accounts, []);
        assert.equal(snap.checking, 1000);
        assert.equal(snap.savings, 2000);
        assert.equal(snap.investment, 5000);
    });

    test('retirement counts toward investment total', () => {
        const accounts = [
            { type: 'retirement', balance: 50000 },
        ];
        const snap = createBalanceSnapshot(accounts, []);
        assert.equal(snap.investment, 50000);
    });

    test('includes netWorth computed through calculateNetWorth', () => {
        const accounts = [{ type: 'checking', balance: 10000 }];
        const debts = [{ currentBalance: 3000 }];
        const snap = createBalanceSnapshot(accounts, debts);
        assert.equal(snap.netWorth, 7000);
    });
});

// ─── expandBillOccurrences ────────────────────────────────────────────

describe('expandBillOccurrences', () => {
    test('returns null for monthly / yearly / semi-annual (no expansion needed)', () => {
        const start = new Date('2026-01-01');
        const end = new Date('2026-03-31');
        assert.equal(expandBillOccurrences({ frequency: 'monthly' }, start, end), null);
        assert.equal(expandBillOccurrences({ frequency: 'yearly' }, start, end), null);
        assert.equal(expandBillOccurrences({ frequency: 'semi-annual' }, start, end), null);
    });

    test('weekly bill expands onto the target weekday', () => {
        // dueDay=1 → Monday (JS getDay: Sun=0, Mon=1)
        const bill = { id: 'b1', frequency: 'weekly', dueDay: 1, amount: 50 };
        const start = new Date('2026-01-01T00:00:00'); // Thursday
        const end = new Date('2026-01-31T00:00:00');
        const occs = expandBillOccurrences(bill, start, end);
        // Jan 2026: Mondays are 5, 12, 19, 26
        assert.equal(occs.length, 4);
        for (const o of occs) assert.equal(o._occurrenceDate.getDay(), 1);
    });

    test('biweekly spacing is 14 days', () => {
        const bill = { id: 'b1', frequency: 'biweekly', dueDay: 1, amount: 100 };
        const start = new Date('2026-01-01T00:00:00');
        const end = new Date('2026-02-28T00:00:00');
        const occs = expandBillOccurrences(bill, start, end);
        assert.ok(occs.length >= 2);
        for (let i = 1; i < occs.length; i++) {
            const diff = (occs[i]._occurrenceDate - occs[i - 1]._occurrenceDate) / 86400000;
            assert.equal(diff, 14);
        }
    });

    test('per-paycheck creates one occurrence per supplied pay date', () => {
        const bill = { id: 'b1', frequency: 'per-paycheck', amount: 25 };
        const start = new Date('2026-01-01T00:00:00');
        const end = new Date('2026-01-31T00:00:00');
        const payDates = [
            new Date('2026-01-05T00:00:00'),
            new Date('2026-01-19T00:00:00'),
        ];
        const occs = expandBillOccurrences(bill, start, end, payDates);
        assert.equal(occs.length, 2);
    });

    test('twice-monthly creates occurrences on the first and last pay dates of each month', () => {
        const bill = { id: 'b1', frequency: 'twice-monthly', amount: 25 };
        const start = new Date('2026-01-01T00:00:00');
        const end = new Date('2026-01-31T00:00:00');
        const payDates = [
            new Date('2026-01-05T00:00:00'),
            new Date('2026-01-19T00:00:00'),
        ];
        const occs = expandBillOccurrences(bill, start, end, payDates);
        // first + last of the same month = 2 occurrences
        assert.equal(occs.length, 2);
    });

    test('occurrence keys are unique', () => {
        const bill = { id: 'b1', frequency: 'weekly', dueDay: 1, amount: 10 };
        const start = new Date('2026-01-01T00:00:00');
        const end = new Date('2026-02-28T00:00:00');
        const occs = expandBillOccurrences(bill, start, end);
        const keys = new Set(occs.map(o => o._occurrenceKey));
        assert.equal(keys.size, occs.length);
    });
});

// ─── calculateFinancialHealthScore ────────────────────────────────────

describe('calculateFinancialHealthScore', () => {
    test('returns a score and grade shape', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            totalDebtBalance: 0,
            monthlyDebtPayments: 0,
            cashTotal: 15000,
            savingsBalance: 12000,
            billPaymentRate: 1.0,
            creditScore: 780,
        });
        assert.ok(typeof result.score === 'number');
        assert.ok(result.score >= 0 && result.score <= 100);
        assert.ok(result.grade && typeof result.grade.label === 'string');
        assert.equal(result.components.length, 5);
    });

    test('low DTI produces a high DTI subscore', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 10000,
            totalMonthlyBills: 1500,
            monthlyDebtPayments: 500,
            cashTotal: 5000,
            savingsBalance: 5000,
            billPaymentRate: 1,
            creditScore: 750,
        });
        const dti = result.components.find(c => c.name === 'Debt-to-Income');
        assert.equal(dti.score, 100);
    });

    test('high DTI (>50%) produces a low DTI subscore', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 3000,
            totalMonthlyBills: 1500,
            monthlyDebtPayments: 500, // DTI = 2000/3000 = 0.67
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: 1,
            creditScore: 700,
        });
        const dti = result.components.find(c => c.name === 'Debt-to-Income');
        assert.ok(dti.score < 40);
    });

    test('6+ months of savings cushion produces full savings score', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 10000, // 10 months of the $1000 expenses
            billPaymentRate: 1,
            creditScore: 750,
        });
        const savings = result.components.find(c => c.name === 'Savings Cushion');
        assert.equal(savings.score, 100);
    });

    test('perfect payment history gives 100 payment score', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 10000,
            savingsBalance: 5000,
            billPaymentRate: 1.0,
            creditScore: 750,
        });
        const pay = result.components.find(c => c.name === 'Payment History');
        assert.equal(pay.score, 100);
    });

    test('missing billPaymentRate defaults to 50', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 10000,
            savingsBalance: 5000,
            billPaymentRate: null,
            creditScore: 750,
        });
        const pay = result.components.find(c => c.name === 'Payment History');
        assert.equal(pay.score, 50);
    });

    test('credit score 300 → low subscore, 850 → 100', () => {
        const low = calculateFinancialHealthScore({
            monthlyIncome: 5000, totalMonthlyBills: 500, monthlyDebtPayments: 0,
            cashTotal: 5000, savingsBalance: 5000, billPaymentRate: 1, creditScore: 300,
        });
        const high = calculateFinancialHealthScore({
            monthlyIncome: 5000, totalMonthlyBills: 500, monthlyDebtPayments: 0,
            cashTotal: 5000, savingsBalance: 5000, billPaymentRate: 1, creditScore: 850,
        });
        const lowCS = low.components.find(c => c.name === 'Credit Score');
        const highCS = high.components.find(c => c.name === 'Credit Score');
        assert.equal(lowCS.score, 0);
        assert.equal(highCS.score, 100);
    });

    test('grade thresholds map to the right labels', () => {
        const excellent = calculateFinancialHealthScore({
            monthlyIncome: 10000, totalMonthlyBills: 500, monthlyDebtPayments: 0,
            cashTotal: 60000, savingsBalance: 60000, billPaymentRate: 1, creditScore: 820,
        });
        assert.ok(excellent.score >= 90);
        assert.equal(excellent.grade.label, 'Excellent');

        const critical = calculateFinancialHealthScore({
            monthlyIncome: 1000, totalMonthlyBills: 2000, monthlyDebtPayments: 500,
            cashTotal: 0, savingsBalance: 0, billPaymentRate: 0, creditScore: 400,
        });
        assert.ok(critical.score < 35);
        assert.equal(critical.grade.label, 'Critical');
    });

    test('final score never exceeds 100 or goes below 0', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 999999, totalMonthlyBills: 0, monthlyDebtPayments: 0,
            cashTotal: 9999999, savingsBalance: 9999999, billPaymentRate: 1, creditScore: 850,
        });
        assert.ok(result.score <= 100);
        assert.ok(result.score >= 0);
    });
});

// ─── buildPayPeriods ──────────────────────────────────────────────────

describe('buildPayPeriods', () => {
    test('returns empty array when no pay dates', () => {
        assert.deepEqual(buildPayPeriods([], [], {}, { user: { payAmount: 0 } }, 2026, 0), []);
    });

    test('creates one period per pay date', () => {
        const payDates = [
            new Date('2026-03-06T00:00:00'),
            new Date('2026-03-20T00:00:00'),
        ];
        const periods = buildPayPeriods(
            payDates, [], {},
            { user: { payAmount: 2000 } },
            2026, 2
        );
        assert.equal(periods.length, 2);
    });

    test('period available = payAmount - billsTotal when no other income', () => {
        const payDates = [new Date('2026-03-06T00:00:00')];
        const bills = [{ id: 'b1', name: 'Rent', amount: 1200, dueDay: 10, frequency: 'monthly' }];
        const periods = buildPayPeriods(
            payDates, bills, {},
            { user: { payAmount: 2000 } },
            2026, 2
        );
        assert.equal(periods.length, 1);
        assert.equal(periods[0].billsTotal, 1200);
        assert.equal(periods[0].available, 800);
    });

    test('frozen bills are excluded', () => {
        const payDates = [new Date('2026-03-06T00:00:00')];
        const bills = [
            { id: 'b1', name: 'Active', amount: 500, dueDay: 10, frequency: 'monthly' },
            { id: 'b2', name: 'Frozen', amount: 900, dueDay: 10, frequency: 'monthly', frozen: true },
        ];
        const periods = buildPayPeriods(payDates, bills, {}, { user: { payAmount: 2000 } }, 2026, 2);
        assert.equal(periods[0].billsTotal, 500);
    });

    test('bills with amount <= 0 are excluded', () => {
        const payDates = [new Date('2026-03-06T00:00:00')];
        const bills = [
            { id: 'b1', name: 'Real', amount: 500, dueDay: 10, frequency: 'monthly' },
            { id: 'b2', name: 'Zero', amount: 0, dueDay: 10, frequency: 'monthly' },
        ];
        const periods = buildPayPeriods(payDates, bills, {}, { user: { payAmount: 2000 } }, 2026, 2);
        assert.equal(periods[0].billsTotal, 500);
    });
});
