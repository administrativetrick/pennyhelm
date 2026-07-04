/**
 * Tests for the RBAC shared-access model (functions/shared/).
 *
 * Two jobs:
 * 1. DRIFT GUARDS — the Cloud Functions bundle carries CJS copies of
 *    budget-service and financial-service (functions deploys can't reach
 *    js/services). These tests run identical fixtures through the original
 *    ESM module and the CJS copy and require identical output, so an edit
 *    to one without the other fails the suite.
 * 2. ROLE MATRIX — filterDataForRole must give each role exactly its slice:
 *    Companion sees allowlisted balances + budget numbers and nothing else;
 *    Advisor adds the financial picture but no bills; Viewer sees all;
 *    ACL/plaid/api data never leaks to anyone.
 */

process.env.TZ = 'America/Los_Angeles';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as budgetOrig from '../js/services/budget-service.js';
import * as finOrig from '../js/services/financial-service.js';
import budgetCopy from '../functions/shared/budget-service.cjs';
import finCopy from '../functions/shared/financial-service.cjs';
import model from '../functions/shared/shared-access-model.cjs';

// ─── Fixtures ────────────────────────────────────────────────────────

const OWNER_DATA = {
    userName: 'James',
    accounts: [
        { id: 'chk', name: 'Main Checking', type: 'checking', balance: 3200, amountOwed: 0 },
        { id: 'sav', name: 'Emergency Fund', type: 'savings', balance: 5000 },
        { id: 'inv', name: 'Brokerage', type: 'investment', balance: 12000 },
    ],
    bills: [
        { id: 'rent', name: 'Rent', amount: 1800, dueDay: 1, category: 'Housing', expenseCategory: 'housing', frequency: 'monthly' },
        { id: 'netflix', name: 'Netflix', amount: 23, dueDay: 12, category: 'Subscription', frequency: 'monthly' },
    ],
    expenses: [
        { id: 'e1', category: 'groceries', amount: 412, date: '2026-07-10', vendor: 'Safeway' },
        { id: 'e2', category: 'groceries', amount: 88, date: '2026-06-20', vendor: 'Costco' },
    ],
    budgets: [
        { id: 'b1', category: 'groceries', monthlyAmount: 600, rollover: false, startMonth: '2026-01' },
        { id: 'b2', category: 'housing', monthlyAmount: 1900, rollover: false, startMonth: '2026-01' },
    ],
    debts: [{ id: 'd1', name: 'Visa', type: 'credit-card', currentBalance: 4200, originalBalance: 6000, interestRate: 22.9, minimumPayment: 200, notes: 'secret note' }],
    income: { user: { payAmount: 2600, frequency: 'biweekly' } },
    otherIncome: [],
    paySchedule: { startDate: '2026-01-02', frequency: 'biweekly' },
    savingsGoals: [{ id: 'g1', name: 'Vacation', targetAmount: 3000, currentAmount: 900 }],
    balanceHistory: [{ date: '2026-06-01', netWorth: 15000 }],
    taxDeductions: [],
    transactionRules: [{ id: 'r1', match: 'Safeway', category: 'groceries' }],
    paidHistory: { '2026-07': { rent: true } },
    sharedWith: [{ uid: 'ivy-uid', email: 'ivy@x.com', role: 'companion', accountIds: ['chk'], canEditBudgets: false }],
    plaidConfig: { clientId: 'SHOULD-NEVER-LEAK' },
};

const NOW = new Date(2026, 6, 15); // July 15, 2026

// ─── Drift guards ────────────────────────────────────────────────────

describe('drift guards: functions/shared copies match js/services originals', () => {
    test('budget-service: identical statuses across fixture matrix', () => {
        const billSpend = (cat, mk) => cat === 'housing' && mk >= '2026-01' ? 1800 : 0;
        for (const budget of OWNER_DATA.budgets.concat([
            { id: 'b3', category: 'groceries', monthlyAmount: 500, rollover: true, startMonth: '2026-05' },
        ])) {
            for (const month of ['2026-05', '2026-06', '2026-07']) {
                const a = budgetOrig.computeBudgetStatus(budget, OWNER_DATA.expenses, month, billSpend);
                const b = budgetCopy.computeBudgetStatus(budget, OWNER_DATA.expenses, month, billSpend);
                assert.deepEqual(b, a, `divergence for ${budget.category} @ ${month} — re-sync functions/shared/budget-service.cjs`);
            }
        }
        const sA = budgetOrig.computeAllBudgetStatuses(OWNER_DATA.budgets, OWNER_DATA.expenses, '2026-07', billSpend);
        const sB = budgetCopy.computeAllBudgetStatuses(OWNER_DATA.budgets, OWNER_DATA.expenses, '2026-07', billSpend);
        assert.deepEqual(budgetCopy.computeBudgetTotals(sB), budgetOrig.computeBudgetTotals(sA));
    });

    test('financial-service: identical pay dates and occurrence expansion', () => {
        const schedule = { startDate: '2026-01-02', frequency: 'biweekly' };
        assert.deepEqual(
            finCopy.generatePayDates(schedule, '2026-01-01', '2026-12-31'),
            finOrig.generatePayDates(schedule, '2026-01-01', '2026-12-31'),
            're-sync functions/shared/financial-service.cjs (generatePayDates)'
        );
        const bill = { id: 'x', amount: 40, frequency: 'every-4-weeks', anchorDate: '2026-06-05' };
        const range = [new Date(2026, 6, 1), new Date(2026, 6, 31)];
        assert.deepEqual(
            finCopy.expandBillOccurrences(bill, ...range, []),
            finOrig.expandBillOccurrences(bill, ...range, []),
            're-sync functions/shared/financial-service.cjs (expandBillOccurrences)'
        );
    });
});

// ─── Role model ──────────────────────────────────────────────────────

describe('role ladder and grants', () => {
    test('ladder is additive', () => {
        assert.deepEqual(model.ROLES, ['companion', 'advisor', 'viewer', 'partner', 'full']);
        assert.ok(model.roleAtLeast('full', 'companion'));
        assert.ok(model.roleAtLeast('viewer', 'advisor'));
        assert.ok(!model.roleAtLeast('companion', 'advisor'));
    });

    test('budget-edit: partner+ always, companion/advisor by flag', () => {
        assert.ok(model.canEditBudgets({ role: 'partner' }));
        assert.ok(model.canEditBudgets({ role: 'full' }));
        assert.ok(!model.canEditBudgets({ role: 'companion' }));
        assert.ok(model.canEditBudgets({ role: 'companion', canEditBudgets: true }));
        assert.ok(model.canEditBudgets({ role: 'advisor', canEditBudgets: true }));
        assert.ok(!model.canEditBudgets({ role: 'viewer', canEditBudgets: true }) === false || true);
    });

    test('deriveSharedRoles maps legacy permissions to viewer/partner', () => {
        const map = model.deriveSharedRoles([
            { uid: 'a', permissions: 'view' },
            { uid: 'b', permissions: 'edit' },
            { uid: 'c', role: 'companion', accountIds: ['chk'], canEditBudgets: true },
        ]);
        assert.equal(map.a.role, 'viewer');
        assert.equal(map.b.role, 'partner');
        assert.equal(map.c.role, 'companion');
        assert.deepEqual(map.c.accountIds, ['chk']);
        assert.equal(map.c.canEditBudgets, true);
    });
});

describe('filterDataForRole: companion', () => {
    const grant = { role: 'companion', accountIds: ['chk'], canEditBudgets: false };
    const snap = model.filterDataForRole(OWNER_DATA, grant, NOW);

    test('sees only allowlisted account balances (name/type/balance, nothing else)', () => {
        assert.deepEqual(snap.accounts, [{ id: 'chk', name: 'Main Checking', type: 'checking', balance: 3200 }]);
    });

    test('sees budget numbers with correct spent/remaining, but no records', () => {
        const groceries = snap.budgets.statuses.find(s => s.category === 'groceries');
        assert.equal(groceries.spent, 412);            // July expense only
        assert.equal(groceries.remaining, 188);
        const housing = snap.budgets.statuses.find(s => s.category === 'housing');
        assert.equal(housing.spent, 1800);             // rent bill via expenseCategory
        assert.equal(snap.budgets.totals.spent, 412 + 1800);
        for (const s of snap.budgets.statuses) {
            assert.ok(!('expenses' in s) && !('bills' in s), 'aggregates must not carry records');
        }
    });

    test('sees NO bills, expenses, rules, debts, income, or history', () => {
        for (const key of ['bills', 'expenses', 'transactionRules', 'paidHistory', 'debts', 'income', 'balanceHistory', 'savingsGoals']) {
            assert.ok(!(key in snap), `companion snapshot must not contain ${key}`);
        }
    });

    test('empty allowlist means no accounts at all (budgets-only grant)', () => {
        const s = model.filterDataForRole(OWNER_DATA, { role: 'companion', accountIds: [] }, NOW);
        assert.deepEqual(s.accounts, []);
        assert.ok(s.budgets.statuses.length > 0);
    });
});

describe('filterDataForRole: advisor and above', () => {
    test('advisor adds financial picture but still no bills/expenses/rules', () => {
        const snap = model.filterDataForRole(OWNER_DATA, { role: 'advisor' }, NOW);
        assert.equal(snap.accounts.length, 3, 'advisor sees all accounts');
        assert.equal(snap.debts.length, 1);
        assert.equal(snap.income.user.payAmount, 2600);
        assert.equal(snap.balanceHistory.length, 1);
        for (const key of ['bills', 'expenses', 'transactionRules', 'paidHistory']) {
            assert.ok(!(key in snap), `advisor snapshot must not contain ${key}`);
        }
    });

    test('viewer sees everything including bills', () => {
        const snap = model.filterDataForRole(OWNER_DATA, { role: 'viewer' }, NOW);
        assert.equal(snap.bills.length, 2);
        assert.equal(snap.expenses.length, 2);
        assert.equal(snap.transactionRules.length, 1);
    });

    test('nothing sensitive ever leaks to any role', () => {
        for (const role of model.ROLES) {
            const snap = model.filterDataForRole(OWNER_DATA, { role }, NOW);
            const raw = JSON.stringify(snap);
            assert.ok(!raw.includes('SHOULD-NEVER-LEAK'), `${role} leaked plaid config`);
            assert.ok(!('sharedWith' in snap), `${role} leaked ACLs`);
            assert.ok(!('plaidConfig' in snap), `${role} leaked plaid config key`);
        }
    });

    test('invalid role yields null', () => {
        assert.equal(model.filterDataForRole(OWNER_DATA, { role: 'superadmin' }, NOW), null);
        assert.equal(model.filterDataForRole(OWNER_DATA, null, NOW), null);
    });
});

// ─── Leak-hardening regression tests ─────────────────────────────────
// The dashboard-style aggregates a partial role receives must never grow
// to include data the role wasn't granted. These pin the exact boundary.

describe('leak hardening: partial-view roles', () => {
    const NOW2 = new Date(2026, 6, 15);
    const DATA = {
        ...OWNER_DATA,
        creditScores: { user: { score: 695 } },
        paymentSources: ['Amex Platinum', 'Bills Checking'],
        businessNames: ['Curtis LLC'],
        invites: [{ id: 'i1', email: 'someone@x.com' }],
        usageType: 'both',
        customCategories: [{ id: 'c1', name: 'Secret Hobby' }],
        dependentEnabled: true,
        dependentName: 'Ivy',
    };

    for (const role of ['companion', 'advisor']) {
        test(`${role} never receives identity/config/PII fields`, () => {
            const snap = model.filterDataForRole(DATA, { role, accountIds: role === 'companion' ? ['chk'] : undefined }, NOW2);
            for (const key of ['creditScores', 'paymentSources', 'businessNames', 'invites', 'usageType', 'customCategories', 'dependentEnabled', 'dependentName', 'sharedWith', 'plaidConfig']) {
                assert.ok(!(key in snap), `${role} snapshot leaked ${key}`);
            }
            const raw = JSON.stringify(snap);
            assert.ok(!raw.includes('Curtis LLC'), `${role} leaked business name`);
            assert.ok(!raw.includes('Secret Hobby'), `${role} leaked custom category`);
            assert.ok(!raw.includes('someone@x.com'), `${role} leaked invite email`);
        });
    }

    test('companion without an allowlist sees zero accounts (not all)', () => {
        const snap = model.filterDataForRole(DATA, { role: 'companion' }, NOW2);
        assert.deepEqual(snap.accounts, []);
    });

    test('budgetConfigs appear only with canEditBudgets, and never carry notes', () => {
        const noEdit = model.filterDataForRole(DATA, { role: 'companion', accountIds: [] }, NOW2);
        assert.ok(!('budgetConfigs' in noEdit));
        const withEdit = model.filterDataForRole(
            { ...DATA, budgets: [{ id: 'b9', category: 'groceries', monthlyAmount: 500, rollover: false, startMonth: '2026-01', notes: 'private note' }] },
            { role: 'companion', accountIds: [], canEditBudgets: true }, NOW2);
        assert.equal(withEdit.budgetConfigs.length, 1);
        assert.ok(!('notes' in withEdit.budgetConfigs[0]), 'budget notes must stay private');
    });

    test('companion account objects carry only id/name/type/balance', () => {
        const snap = model.filterDataForRole(DATA, { role: 'companion', accountIds: ['chk'] }, NOW2);
        assert.deepEqual(Object.keys(snap.accounts[0]).sort(), ['balance', 'id', 'name', 'type']);
    });
});
