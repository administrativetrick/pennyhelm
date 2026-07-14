/**
 * Expense flow classification: transfers and credit-card payments are NOT
 * spending (the card's own purchases already count); interest charges ARE
 * spending, surfaced under the 'interest' category.
 *
 * Contract:
 *  - explicit `flow` on the expense always wins (user toggle / sync stamp)
 *  - a deliberately-assigned category (anything outside the catch-alls)
 *    means spending — rules and user edits keep winning
 *  - otherwise Plaid personal-finance-category (`plaidPfc`), then name
 *    patterns, decide
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const financial = require('../functions/shared/financial-service.cjs');
const sharedAccess = require('../functions/shared/shared-access-model.cjs');

const { classifyExpenseFlow, isTransferExpense, effectiveExpenseCategory, spendingExpenses } = financial;

const e = (name, extra = {}) => ({ id: name, name, amount: 100, date: '2026-07-05', category: 'other', ...extra });

describe('classifyExpenseFlow — name patterns (catch-all categories only)', () => {
    const transferNames = [
        'AMERICAN EXPRESS ACH PMT M0000 WEB ID: 200503',
        'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224',
        'CAPITAL ONE CRCARDPMT CA0000000000000 WEB ID',
        'DISCOVER E-PAYMENT 0000 WEB ID: 3510020270',
        'DISCOVER PAYMENTS 0000 TEL ID: 3510020270',
        'Online Transfer to CHK ...0000 transaction#: 1',
        'CU P2PEXT XFR JOHN DOE WEB ID: 94-0000000',
        'Robinhood',
        'Transfer to Savings',
    ];
    for (const name of transferNames) {
        test(`"${name}" → transfer`, () => {
            assert.equal(classifyExpenseFlow(e(name)), 'transfer');
            assert.equal(isTransferExpense(e(name)), true);
        });
    }

    test('interest charges → interest, not transfer', () => {
        assert.equal(classifyExpenseFlow(e('PURCHASE INTEREST CHARGE')), 'interest');
        assert.equal(classifyExpenseFlow(e('Interest Charge on Purchases')), 'interest');
    });

    const spendingNames = [
        'Zelle payment to JANE DOE 00000000000', // money to another person = real outflow
        'CASH APP*AUTO FINANCE',                  // loan payment = real debt service
        'COSTCO WHOLESALE',
        'Payment Processing LLC',                 // "payment" alone is not a transfer signal
    ];
    for (const name of spendingNames) {
        test(`"${name}" stays spending`, () => {
            assert.equal(classifyExpenseFlow(e(name)), 'spending');
        });
    }
});

describe('classifyExpenseFlow — precedence', () => {
    test('explicit flow wins over everything', () => {
        assert.equal(classifyExpenseFlow(e('AMEX ACH PMT', { flow: 'spending' })), 'spending');
        assert.equal(classifyExpenseFlow(e('Costco', { flow: 'transfer' })), 'transfer');
    });

    test('a real category beats name patterns (rules keep winning)', () => {
        // e.g. a rule filed "CHASE AUTOPAY" under car-payment
        assert.equal(classifyExpenseFlow(e('CHASE AUTOPAY', { category: 'car-payment' })), 'spending');
    });

    test('category interest classifies as interest', () => {
        assert.equal(classifyExpenseFlow(e('whatever', { category: 'interest' })), 'interest');
    });

    test('plaidPfc drives classification for catch-all categories', () => {
        assert.equal(classifyExpenseFlow(e('Some Bank', { plaidPfc: 'TRANSFER_OUT_ACCOUNT_TRANSFER' })), 'transfer');
        assert.equal(classifyExpenseFlow(e('Some Card', { plaidPfc: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' })), 'transfer');
        assert.equal(classifyExpenseFlow(e('Some Card', { plaidPfc: 'BANK_FEES_INTEREST_CHARGE' })), 'interest');
        // Mortgage/auto/student loan payments are real debt service
        assert.equal(classifyExpenseFlow(e('Mtg Servicer', { plaidPfc: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT' })), 'spending');
    });

    test('uncategorized/miscellaneous behave like other', () => {
        assert.equal(classifyExpenseFlow(e('AMEX ACH PMT', { category: 'uncategorized' })), 'transfer');
        assert.equal(classifyExpenseFlow(e('AMEX ACH PMT', { category: '' })), 'transfer');
    });
});

describe('effectiveExpenseCategory + spendingExpenses', () => {
    test('interest in a catch-all remaps to interest; real categories untouched', () => {
        assert.equal(effectiveExpenseCategory(e('PURCHASE INTEREST CHARGE')), 'interest');
        assert.equal(effectiveExpenseCategory(e('Costco', { category: 'groceries' })), 'groceries');
    });

    test('spendingExpenses drops transfers, ignored, split parents; remaps interest', () => {
        const list = [
            e('Costco', { category: 'groceries' }),
            e('AMEX ACH PMT'),
            e('PURCHASE INTEREST CHARGE'),
            e('Ignored thing', { ignored: true, category: 'groceries' }),
            e('Split parent', { category: 'groceries', splitChildren: ['a', 'b'] }),
        ];
        const spending = spendingExpenses(list);
        assert.deepEqual(spending.map(x => x.name), ['Costco', 'PURCHASE INTEREST CHARGE']);
        assert.equal(spending[1].category, 'interest');
    });

    test('spendingExpenses does not mutate the source rows', () => {
        const src = e('PURCHASE INTEREST CHARGE');
        spendingExpenses([src]);
        assert.equal(src.category, 'other');
    });
});

describe('budget aggregates exclude transfers end-to-end', () => {
    const data = (expenses) => ({
        bills: [],
        expenses,
        paySchedule: null,
        categoryBudgets: [
            { id: 'g', category: 'groceries', monthlyAmount: 1000, rollover: false, startMonth: '2026-01' },
            { id: 'i', category: 'interest', monthlyAmount: 100, rollover: false, startMonth: '2026-01' },
        ],
    });

    test('card payment does not hit any budget; interest hits its own', () => {
        const agg = sharedAccess.computeBudgetAggregates(data([
            e('Costco', { category: 'groceries', amount: 250 }),
            e('AMEX ACH PMT M0000', { amount: 2000 }),
            e('PURCHASE INTEREST CHARGE', { amount: 42.5 }),
        ]), new Date(2026, 6, 15));
        const g = agg.statuses.find(s => s.category === 'groceries');
        const i = agg.statuses.find(s => s.category === 'interest');
        assert.equal(g.spent, 250);
        assert.equal(i.spent, 42.5);
    });

    test('user re-included transfer counts again', () => {
        const agg = sharedAccess.computeBudgetAggregates(data([
            e('AMEX ACH PMT M0000', { amount: 2000, flow: 'spending', category: 'groceries' }),
        ]), new Date(2026, 6, 15));
        assert.equal(agg.statuses.find(s => s.category === 'groceries').spent, 2000);
    });
});
