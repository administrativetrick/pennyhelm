/**
 * entity-linker: bidirectional Account ↔ Debt ↔ Bill sync + cascade deletes
 * + the one-time link migration. Pure data mutation on a passed-in blob, so
 * it tests cleanly in node with no DOM.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
    findDebtByLinkedAccountId,
    findAccountByLinkedDebtId,
    findBillByLinkedDebtId,
    debtCategoryForBill,
    syncFromAccount,
    syncFromDebt,
    syncDebtToBill,
    syncFromBill,
    syncDeleteAccount,
    syncDeleteDebt,
    syncDeleteBill,
    migrateEntityLinks,
} from '../js/services/entity-linker.js';

const blank = () => ({ accounts: [], debts: [], bills: [] });
const noop = () => {};
// save-spy that records how many times sync persisted
const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };

describe('lookup helpers', () => {
    test('find by linked ids, and null-safe on missing arrays', () => {
        const debts = [{ id: 'd1', linkedAccountId: 'a1' }];
        const accounts = [{ id: 'a1', linkedDebtId: 'd1' }];
        const bills = [{ id: 'b1', linkedDebtId: 'd1' }];
        assert.equal(findDebtByLinkedAccountId('a1', debts).id, 'd1');
        assert.equal(findAccountByLinkedDebtId('d1', accounts).id, 'a1');
        assert.equal(findBillByLinkedDebtId('d1', bills).id, 'b1');
        assert.equal(findDebtByLinkedAccountId('nope', debts), undefined);
        assert.equal(findBillByLinkedDebtId('d1', undefined), undefined);
    });

    test('debtCategoryForBill maps known types, defaults otherwise', () => {
        assert.equal(debtCategoryForBill('credit-card'), 'Credit Card');
        assert.equal(debtCategoryForBill('mortgage'), 'Mortgage');
        assert.equal(debtCategoryForBill('auto-loan'), 'Car');
        assert.equal(debtCategoryForBill('student-loan'), 'Loan');
        assert.equal(debtCategoryForBill('medical'), 'Medical');
        assert.equal(debtCategoryForBill('weird-type'), 'Debt Payment');
    });
});

describe('syncFromAccount', () => {
    test('credit account creates a linked debt and a payment bill', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'Chase Visa', type: 'credit', balance: 1500, _interestRate: 22.9, _minimumPayment: 45 };
        data.accounts.push(acct);
        const save = spy();

        syncFromAccount(acct, data, save);

        assert.equal(data.debts.length, 1);
        const debt = data.debts[0];
        assert.equal(debt.type, 'credit-card');
        assert.equal(debt.currentBalance, 1500);
        assert.equal(debt.interestRate, 22.9);
        assert.equal(debt.minimumPayment, 45);
        assert.equal(acct.linkedDebtId, debt.id);
        assert.equal(debt.linkedAccountId, 'a1');
        // transient fields cleaned off the account
        assert.equal(acct._interestRate, undefined);
        assert.equal(acct._minimumPayment, undefined);
        // bill created from the debt minimum
        assert.equal(data.bills.length, 1);
        assert.equal(data.bills[0].amount, 45);
        assert.equal(data.bills[0].linkedDebtId, debt.id);
        assert.ok(save.calls >= 1);
    });

    test('property account with amountOwed creates a mortgage debt; zero owed does nothing', () => {
        const data = blank();
        const owed = { id: 'p1', name: 'Main St', type: 'property', balance: 500000, amountOwed: 300000 };
        const paid = { id: 'p2', name: 'Cabin', type: 'property', balance: 200000, amountOwed: 0 };
        data.accounts.push(owed, paid);

        syncFromAccount(owed, data, noop);
        syncFromAccount(paid, data, noop);

        assert.equal(data.debts.length, 1);
        assert.equal(data.debts[0].type, 'mortgage');
        assert.equal(data.debts[0].currentBalance, 300000);
        assert.equal(paid.linkedDebtId, undefined); // no debt made for a paid-off property
    });

    test('updating a linked credit account syncs balance + name to the debt', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'Old Name', type: 'credit', balance: 100 };
        data.accounts.push(acct);
        syncFromAccount(acct, data, noop);
        const debt = data.debts[0];

        acct.balance = 250;
        acct.name = 'New Name';
        syncFromAccount(acct, data, noop);

        assert.equal(data.debts.length, 1); // no duplicate
        assert.equal(debt.currentBalance, 250);
        assert.equal(debt.name, 'New Name');
    });

    test('chargeCard debt pins minimum payment to the full balance', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'Amex', type: 'credit', balance: 4000 };
        data.accounts.push(acct);
        syncFromAccount(acct, data, noop);
        data.debts[0].chargeCard = true;
        acct.balance = 5000;
        syncFromAccount(acct, data, noop);
        assert.equal(data.debts[0].minimumPayment, 5000);
    });

    test('unsupported account type (checking) is a no-op', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'Bills', type: 'checking', balance: 2000 };
        data.accounts.push(acct);
        syncFromAccount(acct, data, noop);
        assert.equal(data.debts.length, 0);
    });
});

describe('syncFromDebt', () => {
    test('credit-card debt creates a linked credit account + bill', () => {
        const data = blank();
        const debt = { id: 'd1', name: 'Discover', type: 'credit-card', currentBalance: 900, minimumPayment: 30 };
        data.debts.push(debt);
        syncFromDebt(debt, data, noop);

        assert.equal(data.accounts.length, 1);
        assert.equal(data.accounts[0].type, 'credit');
        assert.equal(data.accounts[0].balance, 900);
        assert.equal(debt.linkedAccountId, data.accounts[0].id);
        assert.equal(data.bills.length, 1);
        assert.equal(data.bills[0].amount, 30);
    });

    test('manual _linkedAccountId links to an existing account and reflects the balance', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'Rental', type: 'property', balance: 400000, amountOwed: 0 };
        data.accounts.push(acct);
        const debt = { id: 'd1', name: 'Rental Mortgage', type: 'mortgage', currentBalance: 250000, minimumPayment: 0, _linkedAccountId: 'a1' };
        data.debts.push(debt);

        syncFromDebt(debt, data, noop);

        assert.equal(acct.linkedDebtId, 'd1');
        assert.equal(debt.linkedAccountId, 'a1');
        assert.equal(acct.amountOwed, 250000); // property owed reflects the debt
        assert.equal(debt._linkedAccountId, undefined); // transient consumed
    });

    test('_unlinkAccount severs the link both ways', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'X', type: 'credit', balance: 100, linkedDebtId: 'd1' };
        const debt = { id: 'd1', name: 'X', type: 'credit-card', currentBalance: 100, minimumPayment: 0, linkedAccountId: 'a1', _unlinkAccount: true };
        data.accounts.push(acct); data.debts.push(debt);

        syncFromDebt(debt, data, noop);

        assert.equal(debt.linkedAccountId, null);
        assert.equal(acct.linkedDebtId, null);
        assert.equal(debt._unlinkAccount, undefined);
    });

    test('mortgage debt updates its linked property amountOwed', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'Home', type: 'property', balance: 500000, amountOwed: 300000, linkedDebtId: 'd1' };
        const debt = { id: 'd1', name: 'Home Mortgage', type: 'mortgage', currentBalance: 280000, minimumPayment: 0, linkedAccountId: 'a1' };
        data.accounts.push(acct); data.debts.push(debt);

        syncFromDebt(debt, data, noop);
        assert.equal(acct.amountOwed, 280000);
    });
});

describe('syncDebtToBill', () => {
    test('removes the linked bill when the minimum payment drops to 0', () => {
        const data = blank();
        const debt = { id: 'd1', name: 'Card', type: 'credit-card', currentBalance: 500, minimumPayment: 25 };
        data.debts.push(debt);
        syncDebtToBill(debt, data);
        assert.equal(data.bills.length, 1);

        debt.minimumPayment = 0;
        syncDebtToBill(debt, data);
        assert.equal(data.bills.length, 0);
    });

    test('_unlinkBill detaches without deleting the bill', () => {
        const data = blank();
        const bill = { id: 'b1', name: 'Card Payment', amount: 25, linkedDebtId: 'd1' };
        data.bills.push(bill);
        const debt = { id: 'd1', name: 'Card', type: 'credit-card', minimumPayment: 25, _unlinkBill: true };
        data.debts.push(debt);

        syncDebtToBill(debt, data);
        assert.equal(data.bills.length, 1);
        assert.equal(bill.linkedDebtId, null);
        assert.equal(debt._unlinkBill, undefined);
    });
});

describe('syncFromBill', () => {
    test('editing a linked bill amount updates the debt minimum payment', () => {
        const data = blank();
        const debt = { id: 'd1', name: 'Loan', type: 'personal-loan', minimumPayment: 100 };
        const bill = { id: 'b1', name: 'Loan Payment', amount: 150, linkedDebtId: 'd1' };
        data.debts.push(debt); data.bills.push(bill);
        const save = spy();

        syncFromBill(bill, data, save);
        assert.equal(debt.minimumPayment, 150);
        assert.equal(save.calls, 1);
    });

    test('a bill with no linked debt is a no-op', () => {
        const data = blank();
        const save = spy();
        syncFromBill({ id: 'b1', name: 'Rent', amount: 2000 }, data, save);
        assert.equal(save.calls, 0);
    });
});

describe('cascade deletes', () => {
    test('deleting a credit account removes its linked debt and bill', () => {
        const data = blank();
        const acct = { id: 'a1', name: 'Visa', type: 'credit', balance: 1000 };
        data.accounts.push(acct);
        syncFromAccount(acct, data, noop);
        assert.equal(data.debts.length, 1);
        assert.equal(data.bills.length, 0); // no min payment yet
        // give it a bill
        data.debts[0].minimumPayment = 40;
        syncDebtToBill(data.debts[0], data);
        assert.equal(data.bills.length, 1);

        syncDeleteAccount('a1', data);
        assert.equal(data.debts.length, 0);
        assert.equal(data.bills.length, 0);
    });

    test('deleting a debt removes its linked bill and account', () => {
        const data = blank();
        const debt = { id: 'd1', name: 'Card', type: 'credit-card', currentBalance: 800, minimumPayment: 30 };
        data.debts.push(debt);
        syncFromDebt(debt, data, noop);
        assert.equal(data.accounts.length, 1);
        assert.equal(data.bills.length, 1);

        syncDeleteDebt('d1', data);
        assert.equal(data.bills.length, 0);
        assert.equal(data.accounts.length, 0);
    });

    test('deleting a bill just nulls the debt link (keeps the debt)', () => {
        const data = blank();
        const debt = { id: 'd1', name: 'Loan', type: 'personal-loan', minimumPayment: 100 };
        const bill = { id: 'b1', name: 'Loan Payment', amount: 100, linkedDebtId: 'd1' };
        data.debts.push(debt); data.bills.push(bill);

        syncDeleteBill('b1', data);
        assert.equal(data.debts.length, 1);
        assert.equal(bill.linkedDebtId, null);
    });
});

describe('migrateEntityLinks', () => {
    test('links credit debt↔account by name, creates missing bill, returns changed', () => {
        const data = {
            accounts: [{ id: 'a1', name: 'Chase Freedom', type: 'credit', balance: 0 }],
            debts: [{ id: 'd1', name: 'Chase Freedom', type: 'credit-card', currentBalance: 1200, minimumPayment: 50 }],
            bills: [],
        };
        const changed = migrateEntityLinks(data);
        assert.equal(changed, true);
        assert.equal(data.debts[0].linkedAccountId, 'a1');
        assert.equal(data.accounts[0].linkedDebtId, 'd1');
        assert.equal(data.accounts[0].balance, 1200); // account balance reflects the debt
        assert.equal(data.bills.length, 1); // missing payment bill created
        assert.equal(data.bills[0].amount, 50);
    });

    test('links mortgage debt to a property by name substring, sets amountOwed', () => {
        const data = {
            accounts: [{ id: 'a1', name: 'Walter Alley', type: 'property', balance: 600000 }],
            debts: [{ id: 'd1', name: 'Walter Alley Mortgage', type: 'mortgage', currentBalance: 450000, minimumPayment: 0 }],
            bills: [],
        };
        const changed = migrateEntityLinks(data);
        assert.equal(changed, true);
        assert.equal(data.debts[0].linkedAccountId, 'a1');
        assert.equal(data.accounts[0].amountOwed, 450000);
    });

    test('creates a credit account for an unlinked credit-card debt', () => {
        const data = {
            accounts: [],
            debts: [{ id: 'd1', name: 'Capital One', type: 'credit-card', currentBalance: 700, minimumPayment: 0 }],
            bills: [],
        };
        const changed = migrateEntityLinks(data);
        assert.equal(changed, true);
        assert.equal(data.accounts.length, 1);
        assert.equal(data.accounts[0].name, 'Capital One');
        assert.equal(data.debts[0].linkedAccountId, data.accounts[0].id);
    });

    test('already-linked, fully-billed data is unchanged (idempotent)', () => {
        const data = {
            accounts: [{ id: 'a1', name: 'Visa', type: 'credit', balance: 500, linkedDebtId: 'd1' }],
            debts: [{ id: 'd1', name: 'Visa', type: 'credit-card', currentBalance: 500, minimumPayment: 20, linkedAccountId: 'a1' }],
            bills: [{ id: 'b1', name: 'Visa Payment', amount: 20, linkedDebtId: 'd1' }],
        };
        const changed = migrateEntityLinks(data);
        assert.equal(changed, false);
    });
});
