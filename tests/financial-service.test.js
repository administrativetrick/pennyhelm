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
    frequencyToMonthly,
    calculateBillMonthlyAmount,
    sumDebtMinimums,
    HOUSING_BILL_CATEGORIES,
    DEBT_BILL_CATEGORIES,
    calculateMonthlyIncome,
    generatePayDates,
    createBalanceSnapshot,
    expandBillOccurrences,
    calculateFinancialHealthScore,
    buildPayPeriods,
    matchBillToPlaidTransactions,
    resolveInvestmentHaircut,
    INVESTMENT_HAIRCUT_BY_RISK_TOLERANCE,
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

// ─── frequencyToMonthly ───────────────────────────────────────────────

describe('frequencyToMonthly', () => {
    test('weekly is amount * 52 / 12', () => {
        assert.equal(frequencyToMonthly(100, 'weekly'), 100 * 52 / 12);
    });
    test('biweekly is amount * 26 / 12', () => {
        assert.equal(frequencyToMonthly(100, 'biweekly'), 100 * 26 / 12);
    });
    test('semimonthly and twice-monthly both return amount * 2', () => {
        assert.equal(frequencyToMonthly(100, 'semimonthly'), 200);
        assert.equal(frequencyToMonthly(100, 'twice-monthly'), 200);
    });
    test('monthly returns amount', () => {
        assert.equal(frequencyToMonthly(100, 'monthly'), 100);
    });
    test('quarterly divides by 3', () => {
        assert.equal(frequencyToMonthly(300, 'quarterly'), 100);
    });
    test('semiannual and semi-annual both divide by 6', () => {
        assert.equal(frequencyToMonthly(600, 'semiannual'), 100);
        assert.equal(frequencyToMonthly(600, 'semi-annual'), 100);
    });
    test('yearly and annually both divide by 12', () => {
        assert.equal(frequencyToMonthly(1200, 'yearly'), 100);
        assert.equal(frequencyToMonthly(1200, 'annually'), 100);
    });
    test('one-time returns 0', () => {
        assert.equal(frequencyToMonthly(500, 'one-time'), 0);
    });
    test('null or undefined amount returns 0', () => {
        assert.equal(frequencyToMonthly(null, 'monthly'), 0);
        assert.equal(frequencyToMonthly(undefined, 'weekly'), 0);
    });
    test('unknown frequency falls through as monthly (no double-counting)', () => {
        assert.equal(frequencyToMonthly(100, 'zzz'), 100);
        assert.equal(frequencyToMonthly(100, undefined), 100);
    });
});

// ─── calculateBillMonthlyAmount ───────────────────────────────────────

describe('calculateBillMonthlyAmount', () => {
    test('returns 0 when bill is null/undefined', () => {
        assert.equal(calculateBillMonthlyAmount(null), 0);
        assert.equal(calculateBillMonthlyAmount(undefined), 0);
    });
    test('frozen bills return 0', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 500, frequency: 'monthly', frozen: true }), 0);
    });
    test('excludeFromTotal bills return 0', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 500, frequency: 'monthly', excludeFromTotal: true }), 0);
    });
    test('per-paycheck bills approximate as amount * 2', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 250, frequency: 'per-paycheck' }), 500);
    });
    test('twice-monthly bills return amount * 2', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 250, frequency: 'twice-monthly' }), 500);
    });
    test('weekly bills return amount * 52 / 12', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 100, frequency: 'weekly' }), 100 * 52 / 12);
    });
    test('biweekly bills return amount * 26 / 12', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 100, frequency: 'biweekly' }), 100 * 26 / 12);
    });
    test('yearly bills return amount / 12', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 1200, frequency: 'yearly' }), 100);
    });
    test('semi-annual bills return amount / 6', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 600, frequency: 'semi-annual' }), 100);
    });
    test('monthly (default) returns amount', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 100, frequency: 'monthly' }), 100);
    });
    test('no frequency specified falls through as monthly', () => {
        assert.equal(calculateBillMonthlyAmount({ amount: 100 }), 100);
    });
    test('missing amount treated as 0', () => {
        assert.equal(calculateBillMonthlyAmount({ frequency: 'monthly' }), 0);
    });
});

// ─── sumDebtMinimums ──────────────────────────────────────────────────

describe('sumDebtMinimums', () => {
    const debts = [
        { type: 'mortgage', minimumPayment: 2500 },
        { type: 'mortgage', minimumPayment: 1500 },
        { type: 'credit_card', minimumPayment: 100 },
        { type: 'auto_loan', minimumPayment: 400 },
        { type: 'student_loan', minimumPayment: 300 },
        { type: 'personal_loan' }, // no minimum set — should be treated as 0
    ];

    test('returns 0 for null or missing debts', () => {
        assert.equal(sumDebtMinimums(null), 0);
        assert.equal(sumDebtMinimums(undefined), 0);
        assert.equal(sumDebtMinimums([]), 0);
    });

    test('sums all minimums with no filter', () => {
        assert.equal(sumDebtMinimums(debts), 2500 + 1500 + 100 + 400 + 300);
    });

    test('filters by type when type option provided', () => {
        assert.equal(sumDebtMinimums(debts, { type: 'mortgage' }), 4000);
        assert.equal(sumDebtMinimums(debts, { type: 'credit_card' }), 100);
    });

    test('filters out a type when excludeType provided', () => {
        assert.equal(sumDebtMinimums(debts, { excludeType: 'mortgage' }), 100 + 400 + 300);
    });

    test('missing minimumPayment treated as 0', () => {
        const noMins = [{ type: 'credit_card' }, { type: 'credit_card' }];
        assert.equal(sumDebtMinimums(noMins), 0);
    });
});

// ─── HOUSING_BILL_CATEGORIES / DEBT_BILL_CATEGORIES ───────────────────

describe('Bill category constants', () => {
    test('HOUSING_BILL_CATEGORIES contains Mortgage and Rent', () => {
        assert.ok(HOUSING_BILL_CATEGORIES.has('Mortgage'));
        assert.ok(HOUSING_BILL_CATEGORIES.has('Rent'));
        assert.ok(!HOUSING_BILL_CATEGORIES.has('Auto Loan'));
    });
    test('DEBT_BILL_CATEGORIES contains auto/student/personal/card/loan/debt', () => {
        ['Auto Loan', 'Student Loan', 'Personal Loan', 'Credit Card', 'Loan', 'Debt Payment']
            .forEach(c => assert.ok(DEBT_BILL_CATEGORIES.has(c), `${c} missing`));
        assert.ok(!DEBT_BILL_CATEGORIES.has('Mortgage'));
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

    test('paySchedule.frequency overrides income.user.frequency (real store shape)', () => {
        // Real store keeps pay frequency on paySchedule, not on income.user.
        const income = { user: { payAmount: 2000 } }; // no frequency on income.user
        const paySchedule = { frequency: 'weekly' };
        const result = calculateMonthlyIncome(income, [], paySchedule);
        assert.ok(Math.abs(result.userPayMonthly - (2000 * 52 / 12)) < 0.001);
    });

    test('paySchedule.frequency wins even when income.user.frequency is set', () => {
        const income = { user: { payAmount: 2000, frequency: 'monthly' } };
        const paySchedule = { frequency: 'biweekly' };
        const result = calculateMonthlyIncome(income, [], paySchedule);
        assert.ok(Math.abs(result.userPayMonthly - (2000 * 26 / 12)) < 0.001);
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

    test('mortgage-aware DTI: big mortgage alone does not crush the score', () => {
        // $17k/mo income, $4k mortgage (24% housing), $200 in other debt
        // Front-end: 4000/17000 = 23.5% (good)
        // Back-end: 4200/17000 = 24.7% (good)
        // Both well below 28%/36% thresholds → full score.
        const result = calculateFinancialHealthScore({
            monthlyIncome: 17000,
            totalMonthlyBills: 4200,     // legacy input kept for back-compat
            monthlyDebtPayments: 4200,   // legacy input
            monthlyHousingPayment: 4000,
            monthlyNonHousingDebt: 200,
            cashTotal: 0, savingsBalance: 0,
            billPaymentRate: 1, creditScore: 750,
        });
        const dti = result.components.find(c => c.name === 'Debt-to-Income');
        assert.equal(dti.score, 100);
        assert.match(dti.tip, /Housing 24% \/ total 25%/);
    });

    test('mortgage-aware DTI: stretched housing drops the score even with 0 other debt', () => {
        // $5k/mo income, $2k mortgage (40% housing — way over 28%)
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            monthlyHousingPayment: 2000,
            monthlyNonHousingDebt: 0,
            cashTotal: 0, savingsBalance: 0,
            billPaymentRate: 1, creditScore: 700,
        });
        const dti = result.components.find(c => c.name === 'Debt-to-Income');
        assert.ok(dti.score < 60, `expected <60, got ${dti.score}`);
        assert.match(dti.tip, /Housing 40%/);
    });

    test('mortgage-aware DTI: worst-of-two — good housing cannot hide bad consumer debt', () => {
        // $10k/mo income, $0 housing, $4500 non-housing (45% back-end)
        // Front-end: 0/10000 = 0% (perfect)
        // Back-end: 4500/10000 = 45% (bad — above 43% FHA max)
        const result = calculateFinancialHealthScore({
            monthlyIncome: 10000,
            monthlyHousingPayment: 0,
            monthlyNonHousingDebt: 4500,
            cashTotal: 0, savingsBalance: 0,
            billPaymentRate: 1, creditScore: 700,
        });
        const dti = result.components.find(c => c.name === 'Debt-to-Income');
        assert.ok(dti.score < 60, `expected <60, got ${dti.score}`);
    });

    test('debts without minimum payments → DTI treated as missing, not zero', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 17000,
            totalMonthlyBills: 0,
            monthlyDebtPayments: 0,
            hasDebtsWithoutMinimumPayment: true,
            cashTotal: 10000, savingsBalance: 10000,
            billPaymentRate: 1, creditScore: 780,
        });
        const dti = result.components.find(c => c.name === 'Debt-to-Income');
        assert.equal(dti, undefined, 'DTI should not be scored when minimums are missing');
        const missing = result.missingComponents.find(c => c.name === 'Debt-to-Income');
        assert.ok(missing, 'DTI should appear in missingComponents');
        assert.match(missing.tip, /minimum monthly payment/);
    });

    test('legacy callers (no housing split) still get a DTI score', () => {
        // Backwards-compat check: existing tests/callers don't pass
        // monthlyHousingPayment or monthlyNonHousingDebt and should still
        // score via the blended ratio.
        const result = calculateFinancialHealthScore({
            monthlyIncome: 10000,
            totalMonthlyBills: 1500,
            monthlyDebtPayments: 500,
            cashTotal: 5000, savingsBalance: 5000,
            billPaymentRate: 1, creditScore: 750,
        });
        const dti = result.components.find(c => c.name === 'Debt-to-Income');
        assert.ok(dti);
        assert.equal(dti.score, 100);
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

    test('Savings Cushion counts taxable investments at 75% haircut', () => {
        // $1000/mo expenses, $0 savings, $27,492 brokerage
        // Credit = 27492 × 0.75 = $20,619 → 20.6 months covered → full 100
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: 1,
            creditScore: 750,
            taxableInvestmentBalance: 27492,
        });
        const savings = result.components.find(c => c.name === 'Savings Cushion');
        assert.equal(savings.score, 100);
    });

    test('Savings Cushion: $0 savings + $0 investments still scores 0', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: 1,
            creditScore: 750,
            taxableInvestmentBalance: 0,
        });
        const savings = result.components.find(c => c.name === 'Savings Cushion');
        assert.equal(savings.score, 0);
    });

    test('Savings Cushion: partial investment credit scales linearly', () => {
        // $1000/mo expenses, $0 savings, $4,000 brokerage
        // Credit = 4000 × 0.75 = $3,000 → 3.0 months → 50% score
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: 1,
            creditScore: 750,
            taxableInvestmentBalance: 4000,
        });
        const savings = result.components.find(c => c.name === 'Savings Cushion');
        // 3 months / 6 months × 100 = 50
        assert.equal(savings.score, 50);
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

    test('missing billPaymentRate excludes Payment History entirely (no fake default)', () => {
        // Previously this defaulted to 50 — which polluted new users' scores
        // with 12.5 "free" synthetic points. New behavior: skip it, renormalize
        // the remaining components, and surface it in `missingComponents`.
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
        assert.equal(pay, undefined);
        assert.ok(result.missingComponents.some(m => m.name === 'Payment History'));
    });

    test('missing creditScore excludes Credit Score (no fake 50)', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 10000,
            savingsBalance: 5000,
            billPaymentRate: 1.0,
            creditScore: null,
        });
        assert.equal(result.components.find(c => c.name === 'Credit Score'), undefined);
        assert.ok(result.missingComponents.some(m => m.name === 'Credit Score'));
    });

    test('renormalizes weights when components are missing', () => {
        // With Credit Score (0.15) and Payment History (0.25) missing,
        // remaining weights (0.25 + 0.25 + 0.10 = 0.60) should expand to
        // cover the full score. A perfect DTI+Savings+Cash should reach ~100.
        const result = calculateFinancialHealthScore({
            monthlyIncome: 10000,
            totalMonthlyBills: 500,      // very low DTI → 100
            monthlyDebtPayments: 0,
            cashTotal: 60000,            // 6 months income → 100
            savingsBalance: 60000,       // 120x expenses → capped at 100
            billPaymentRate: null,
            creditScore: null,
        });
        // Only 3 components scored — the remaining weights should renormalize
        // to sum to 1.0, and a perfect user across those 3 should score ~100.
        assert.equal(result.components.length, 3);
        assert.ok(result.score >= 99, `expected renormalized perfect ≥ 99, got ${result.score}`);
    });

    test('completeness is "full" when all 5 components scored', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 200,
            cashTotal: 10000,
            savingsBalance: 5000,
            billPaymentRate: 0.9,
            creditScore: 740,
        });
        assert.equal(result.completeness, 'full');
        assert.equal(result.components.length, 5);
        assert.equal(result.missingComponents.length, 0);
    });

    test('completeness is "partial" when 3-4 components scored', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 10000,
            savingsBalance: 5000,
            billPaymentRate: null,
            creditScore: null,
        });
        assert.equal(result.completeness, 'partial');
        assert.equal(result.components.length, 3);
        assert.equal(result.missingComponents.length, 2);
    });

    test('completeness is "insufficient" when <3 components scored', () => {
        // Brand-new user with only a cash balance set.
        const result = calculateFinancialHealthScore({
            monthlyIncome: 0,
            totalMonthlyBills: 0,
            monthlyDebtPayments: 0,
            cashTotal: 500,
            savingsBalance: 0,
            billPaymentRate: null,
            creditScore: null,
        });
        assert.equal(result.completeness, 'insufficient');
        assert.ok(result.components.length < 3);
    });

    test('empty user (no data at all) produces zero components, not a fake score', () => {
        const result = calculateFinancialHealthScore({
            monthlyIncome: 0,
            totalMonthlyBills: 0,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: null,
            creditScore: null,
        });
        assert.equal(result.components.length, 0);
        assert.equal(result.completeness, 'insufficient');
        assert.equal(result.score, 0);
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

    test('Liquid Reserves counts taxable investments at 75% haircut', () => {
        // $30k taxable investments × 0.75 = $22,500 of credit
        // At $5k/mo income → 4.5 months → full 100 on the liquidity component.
        const withInvestments = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 5000,
            billPaymentRate: 1,
            creditScore: 740,
            taxableInvestmentBalance: 30000,
        });
        const withoutInvestments = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 5000,
            billPaymentRate: 1,
            creditScore: 740,
        });
        const withLR = withInvestments.components.find(c => c.name === 'Liquid Reserves');
        const withoutLR = withoutInvestments.components.find(c => c.name === 'Liquid Reserves');
        assert.equal(withLR.score, 100);
        assert.equal(withoutLR.score, 0);
    });

    test('Liquid Reserves does NOT receive credit for retirement balances', () => {
        // Caller is responsible for passing taxable-only. If they
        // include retirement in taxableInvestmentBalance it would count —
        // but dashboard.js filters to type === 'investment' only.
        // This test just verifies the component is called "Liquid Reserves"
        // (renamed from "Cash Reserves") and exists on a well-defined user.
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 5000,
            savingsBalance: 5000,
            billPaymentRate: 1,
            creditScore: 740,
            taxableInvestmentBalance: 0,
        });
        const liquid = result.components.find(c => c.name === 'Liquid Reserves');
        assert.ok(liquid, 'Liquid Reserves component should exist');
        // No Cash Reserves anywhere — the component was renamed.
        assert.equal(result.components.find(c => c.name === 'Cash Reserves'), undefined);
    });

    test('Liquid Reserves: cash + taxable investments combine correctly', () => {
        // $3k cash + $10k taxable × 0.75 = $3k + $7.5k = $10.5k liquid reserve
        // At $5k/mo income → 2.1 months → 70% score
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 3000,
            savingsBalance: 5000,
            billPaymentRate: 1,
            creditScore: 740,
            taxableInvestmentBalance: 10000,
        });
        const liquid = result.components.find(c => c.name === 'Liquid Reserves');
        // 10.5k / 5k = 2.1 months → 2.1/3 × 100 = 70
        assert.equal(liquid.score, 70);
    });

    test('taxableInvestmentBalance defaults to 0 when not supplied', () => {
        // Back-compat: callers that don't pass the field shouldn't crash
        // or accidentally inherit garbage.
        const result = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 15000,  // 3 months → full score on its own
            savingsBalance: 5000,
            billPaymentRate: 1,
            creditScore: 740,
            // taxableInvestmentBalance omitted
        });
        const liquid = result.components.find(c => c.name === 'Liquid Reserves');
        assert.equal(liquid.score, 100);
    });

    test('Conservative haircut (0.50) gives smaller credit than Balanced (0.75)', () => {
        // $1000/mo expenses, $0 savings, $10k brokerage
        // Conservative: 5000 / 1000 = 5 months → 83%
        // Balanced:     7500 / 1000 = 7.5 months → 100% (capped at 6mo)
        // Aggressive:  10000 / 1000 = 10 months → 100%
        const makeResult = (haircut) => calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: 1,
            creditScore: 750,
            taxableInvestmentBalance: 10000,
            investmentHaircut: haircut,
        });
        const conservative = makeResult(0.50).components.find(c => c.name === 'Savings Cushion');
        const balanced = makeResult(0.75).components.find(c => c.name === 'Savings Cushion');
        const aggressive = makeResult(1.00).components.find(c => c.name === 'Savings Cushion');
        assert.ok(conservative.score < balanced.score);
        assert.equal(balanced.score, 100);
        assert.equal(aggressive.score, 100);
        // 5 / 6 × 100 = 83.3 → rounds to 83
        assert.equal(conservative.score, 83);
    });

    test('investmentHaircut defaults to 0.75 (balanced) when not supplied', () => {
        const withDefault = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: 1,
            creditScore: 750,
            taxableInvestmentBalance: 10000,
            // investmentHaircut omitted
        });
        const withExplicit = calculateFinancialHealthScore({
            monthlyIncome: 5000,
            totalMonthlyBills: 1000,
            monthlyDebtPayments: 0,
            cashTotal: 0,
            savingsBalance: 0,
            billPaymentRate: 1,
            creditScore: 750,
            taxableInvestmentBalance: 10000,
            investmentHaircut: 0.75,
        });
        const defaultSav = withDefault.components.find(c => c.name === 'Savings Cushion');
        const explicitSav = withExplicit.components.find(c => c.name === 'Savings Cushion');
        assert.equal(defaultSav.score, explicitSav.score);
    });

    test('invalid / out-of-range haircut is clamped safely', () => {
        // Negative → treated as 0 (no credit at all). Super-large → clamped to 1.
        const negative = calculateFinancialHealthScore({
            monthlyIncome: 5000, totalMonthlyBills: 1000, monthlyDebtPayments: 0,
            cashTotal: 0, savingsBalance: 0, billPaymentRate: 1, creditScore: 750,
            taxableInvestmentBalance: 10000, investmentHaircut: -5,
        });
        const huge = calculateFinancialHealthScore({
            monthlyIncome: 5000, totalMonthlyBills: 1000, monthlyDebtPayments: 0,
            cashTotal: 0, savingsBalance: 0, billPaymentRate: 1, creditScore: 750,
            taxableInvestmentBalance: 10000, investmentHaircut: 99,
        });
        const negSav = negative.components.find(c => c.name === 'Savings Cushion');
        const hugeSav = huge.components.find(c => c.name === 'Savings Cushion');
        assert.equal(negSav.score, 0);        // no credit → 0
        assert.equal(hugeSav.score, 100);     // capped at 1.00 → 10k, 10 months
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

// ─── resolveInvestmentHaircut ─────────────────────────────────────────

describe('resolveInvestmentHaircut', () => {
    test('maps conservative → 0.50', () => {
        assert.equal(resolveInvestmentHaircut('conservative'), 0.50);
    });

    test('maps balanced → 0.75', () => {
        assert.equal(resolveInvestmentHaircut('balanced'), 0.75);
    });

    test('maps aggressive → 1.00', () => {
        assert.equal(resolveInvestmentHaircut('aggressive'), 1.00);
    });

    test('unknown / missing preset falls back to balanced (0.75)', () => {
        assert.equal(resolveInvestmentHaircut('foo'), 0.75);
        assert.equal(resolveInvestmentHaircut(undefined), 0.75);
        assert.equal(resolveInvestmentHaircut(null), 0.75);
        assert.equal(resolveInvestmentHaircut(''), 0.75);
    });

    test('exported preset table is the public source of truth', () => {
        assert.equal(INVESTMENT_HAIRCUT_BY_RISK_TOLERANCE.conservative, 0.50);
        assert.equal(INVESTMENT_HAIRCUT_BY_RISK_TOLERANCE.balanced, 0.75);
        assert.equal(INVESTMENT_HAIRCUT_BY_RISK_TOLERANCE.aggressive, 1.00);
    });
});

// ─── matchBillToPlaidTransactions ─────────────────────────────────────

describe('matchBillToPlaidTransactions', () => {
    const bill = { id: 'b1', name: 'Electric', amount: 120 };
    const dueDate = new Date('2026-04-10T12:00:00');

    test('exact amount + exact date → matched:true', () => {
        const expenses = [
            { source: 'plaid', amount: 120, date: '2026-04-10T12:00:00' },
        ];
        const result = matchBillToPlaidTransactions(bill, dueDate, expenses);
        assert.equal(result.matched, true);
        assert.equal(result.expense.amount, 120);
    });

    test('amount within ±5% tolerance → matched:true', () => {
        // $120 × 0.05 = $6 allowed. $125 is within, $127 is not.
        const within = [{ source: 'plaid', amount: 125, date: '2026-04-10T12:00:00' }];
        const beyond = [{ source: 'plaid', amount: 127, date: '2026-04-10T12:00:00' }];
        assert.equal(matchBillToPlaidTransactions(bill, dueDate, within).matched, true);
        assert.equal(matchBillToPlaidTransactions(bill, dueDate, beyond).matched, false);
    });

    test('small bills use $1 absolute floor instead of 5%', () => {
        // $10 × 5% = $0.50 — too tight. Floor bumps tolerance to $1.
        const smallBill = { id: 'b2', amount: 10 };
        const expenses = [{ source: 'plaid', amount: 10.75, date: '2026-04-10T12:00:00' }];
        const result = matchBillToPlaidTransactions(smallBill, dueDate, expenses);
        assert.equal(result.matched, true);
    });

    test('date within ±3 days → matched, outside → unmatched', () => {
        const within = [{ source: 'plaid', amount: 120, date: '2026-04-13T12:00:00' }]; // +3 days
        const outside = [{ source: 'plaid', amount: 120, date: '2026-04-14T12:00:00' }]; // +4 days
        assert.equal(matchBillToPlaidTransactions(bill, dueDate, within).matched, true);
        assert.equal(matchBillToPlaidTransactions(bill, dueDate, outside).matched, false);
    });

    test('handles negative plaid amounts (debits stored as negatives)', () => {
        const expenses = [{ source: 'plaid', amount: -120, date: '2026-04-10T12:00:00' }];
        const result = matchBillToPlaidTransactions(bill, dueDate, expenses);
        assert.equal(result.matched, true);
    });

    test('source !== "plaid" is ignored (manual expenses do not match)', () => {
        const expenses = [{ source: 'manual', amount: 120, date: '2026-04-10T12:00:00' }];
        const result = matchBillToPlaidTransactions(bill, dueDate, expenses);
        assert.equal(result.matched, false);
    });

    test('ignored expenses are skipped even when source is plaid', () => {
        const expenses = [
            { source: 'plaid', amount: 120, date: '2026-04-10T12:00:00', ignored: true },
        ];
        const result = matchBillToPlaidTransactions(bill, dueDate, expenses);
        assert.equal(result.matched, false);
    });

    test('empty / missing expenses → matched:false (no throw)', () => {
        assert.equal(matchBillToPlaidTransactions(bill, dueDate, []).matched, false);
        assert.equal(matchBillToPlaidTransactions(bill, dueDate, null).matched, false);
        assert.equal(matchBillToPlaidTransactions(bill, dueDate, undefined).matched, false);
    });

    test('missing bill or amount → matched:false (no throw)', () => {
        const expenses = [{ source: 'plaid', amount: 120, date: '2026-04-10T12:00:00' }];
        assert.equal(matchBillToPlaidTransactions(null, dueDate, expenses).matched, false);
        assert.equal(matchBillToPlaidTransactions({ id: 'x' }, dueDate, expenses).matched, false);
        assert.equal(matchBillToPlaidTransactions({ id: 'x', amount: 0 }, dueDate, expenses).matched, false);
    });

    test('missing dueDate → matched:false', () => {
        const expenses = [{ source: 'plaid', amount: 120, date: '2026-04-10T12:00:00' }];
        assert.equal(matchBillToPlaidTransactions(bill, null, expenses).matched, false);
    });

    test('picks the first matching expense and stops', () => {
        const expenses = [
            { source: 'plaid', amount: 120, date: '2026-04-10T12:00:00', id: 'exp-1' },
            { source: 'plaid', amount: 120, date: '2026-04-11T12:00:00', id: 'exp-2' },
        ];
        const result = matchBillToPlaidTransactions(bill, dueDate, expenses);
        assert.equal(result.matched, true);
        assert.equal(result.expense.id, 'exp-1');
    });

    test('honors custom amountTolerance option', () => {
        // Allow 20% slop — normally 5%.
        const expenses = [{ source: 'plaid', amount: 140, date: '2026-04-10T12:00:00' }];
        const strict = matchBillToPlaidTransactions(bill, dueDate, expenses);
        const lenient = matchBillToPlaidTransactions(bill, dueDate, expenses, { amountTolerance: 0.20 });
        assert.equal(strict.matched, false);
        assert.equal(lenient.matched, true);
    });

    test('honors custom dateToleranceDays option', () => {
        const expenses = [{ source: 'plaid', amount: 120, date: '2026-04-17T12:00:00' }]; // +7 days
        const strict = matchBillToPlaidTransactions(bill, dueDate, expenses);
        const lenient = matchBillToPlaidTransactions(bill, dueDate, expenses, { dateToleranceDays: 7 });
        assert.equal(strict.matched, false);
        assert.equal(lenient.matched, true);
    });

    test('invalid date strings are skipped, not thrown', () => {
        const expenses = [
            { source: 'plaid', amount: 120, date: 'not-a-date' },
            { source: 'plaid', amount: 120, date: '2026-04-10T12:00:00' },
        ];
        const result = matchBillToPlaidTransactions(bill, dueDate, expenses);
        assert.equal(result.matched, true);
    });
});
