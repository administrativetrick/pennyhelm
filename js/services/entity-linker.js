/**
 * EntityLinker — manages bidirectional relationships between Accounts, Debts, and Bills.
 *
 * Extracted from Store to separate entity-relationship logic from data persistence.
 * All methods operate on the data object passed in; the linker holds no data state.
 */

let _syncing = false;

// ─── Lookup helpers ──────────────────────────────

export function findDebtByLinkedAccountId(accountId, debts) {
    return (debts || []).find(d => d.linkedAccountId === accountId);
}

export function findAccountByLinkedDebtId(debtId, accounts) {
    return (accounts || []).find(a => a.linkedDebtId === debtId);
}

export function findBillByLinkedDebtId(debtId, bills) {
    return (bills || []).find(b => b.linkedDebtId === debtId);
}

export function debtCategoryForBill(debtType) {
    const map = {
        'credit-card': 'Credit Card',
        'mortgage': 'Mortgage',
        'auto-loan': 'Car',
        'student-loan': 'Loan',
        'personal-loan': 'Loan',
        'equipment-loan': 'Loan',
        'medical': 'Medical',
        'other': 'Debt Payment'
    };
    return map[debtType] || 'Debt Payment';
}

// ─── Sync: Account → Debt + Bill ──────────────────

export function syncFromAccount(account, data, save) {
    if (_syncing) return;
    _syncing = true;
    try {
        if (!data.debts) data.debts = [];
        if (!data.bills) data.bills = [];

        const debtConfigs = {
            'credit':      { type: 'credit-card',    suffix: '' },
            'property':    { type: 'mortgage',        suffix: ' Mortgage' },
            'vehicle':     { type: 'auto-loan',       suffix: ' Auto Loan' },
            'equipment':   { type: 'equipment-loan',  suffix: ' Loan' },
            'other-asset': { type: 'other',           suffix: ' Loan' },
        };

        const config = debtConfigs[account.type];
        if (!config) return;

        // For non-credit types, only sync if amountOwed > 0
        if (account.type !== 'credit' && !(account.amountOwed > 0)) return;

        const balance = account.type === 'credit' ? account.balance : account.amountOwed;
        let debt = account.linkedDebtId ? data.debts.find(d => d.id === account.linkedDebtId) : null;

        if (!debt) {
            debt = {
                id: crypto.randomUUID(),
                name: account.name + config.suffix,
                type: config.type,
                currentBalance: balance,
                originalBalance: balance,
                interestRate: account._interestRate || 0,
                minimumPayment: account._minimumPayment || 0,
                linkedAccountId: account.id,
                createdDate: new Date().toISOString(),
                notes: ''
            };
            data.debts.push(debt);
            account.linkedDebtId = debt.id;
        } else {
            debt.currentBalance = balance;
            if (account.type === 'credit') {
                debt.name = account.name;
                if (account._interestRate !== undefined) debt.interestRate = account._interestRate;
                if (account._minimumPayment !== undefined) debt.minimumPayment = account._minimumPayment;
                if (debt.chargeCard) debt.minimumPayment = account.balance;
            }
        }

        // Clean transient fields (credit accounts only)
        delete account._interestRate;
        delete account._minimumPayment;

        syncDebtToBill(debt, data);
        save();
    } finally {
        _syncing = false;
    }
}

// ─── Sync: Debt → Account + Bill ──────────────────

export function syncFromDebt(debt, data, save) {
    if (_syncing) return;
    _syncing = true;
    try {
        if (!data.accounts) data.accounts = [];
        if (!data.bills) data.bills = [];

        // Handle transient _linkedAccountId (manual linking from form)
        if (debt._linkedAccountId) {
            const targetAccount = data.accounts.find(a => a.id === debt._linkedAccountId);
            if (targetAccount) {
                if (debt.linkedAccountId && debt.linkedAccountId !== targetAccount.id) {
                    const oldAccount = data.accounts.find(a => a.id === debt.linkedAccountId);
                    if (oldAccount) oldAccount.linkedDebtId = null;
                }
                targetAccount.linkedDebtId = debt.id;
                debt.linkedAccountId = targetAccount.id;
                if (targetAccount.type === 'property' || targetAccount.type === 'vehicle' || targetAccount.type === 'equipment' || targetAccount.type === 'other-asset') {
                    targetAccount.amountOwed = debt.currentBalance;
                } else if (targetAccount.type === 'credit') {
                    targetAccount.balance = debt.currentBalance;
                }
                targetAccount.lastUpdated = new Date().toISOString();
            }
            delete debt._linkedAccountId;
        } else if (debt._unlinkAccount) {
            if (debt.linkedAccountId) {
                const oldAccount = data.accounts.find(a => a.id === debt.linkedAccountId);
                if (oldAccount) oldAccount.linkedDebtId = null;
                debt.linkedAccountId = null;
            }
            delete debt._unlinkAccount;
        } else if (debt.type === 'credit-card') {
            let account = debt.linkedAccountId ? data.accounts.find(a => a.id === debt.linkedAccountId) : null;
            if (!account) {
                account = {
                    id: crypto.randomUUID(),
                    name: debt.name,
                    type: 'credit',
                    balance: debt.currentBalance,
                    linkedDebtId: debt.id,
                    lastUpdated: new Date().toISOString()
                };
                data.accounts.push(account);
                debt.linkedAccountId = account.id;
            } else {
                account.balance = debt.currentBalance;
                account.name = debt.name;
                account.lastUpdated = new Date().toISOString();
            }
        } else if (debt.type === 'mortgage') {
            let account = debt.linkedAccountId ? data.accounts.find(a => a.id === debt.linkedAccountId) : null;
            if (account && account.type === 'property') {
                account.amountOwed = debt.currentBalance;
                account.lastUpdated = new Date().toISOString();
            }
        } else if (debt.type === 'auto-loan') {
            let account = debt.linkedAccountId ? data.accounts.find(a => a.id === debt.linkedAccountId) : null;
            if (account && account.type === 'vehicle') {
                account.amountOwed = debt.currentBalance;
                account.lastUpdated = new Date().toISOString();
            }
        } else if (debt.type === 'equipment-loan') {
            let account = debt.linkedAccountId ? data.accounts.find(a => a.id === debt.linkedAccountId) : null;
            if (account && account.type === 'equipment') {
                account.amountOwed = debt.currentBalance;
                account.lastUpdated = new Date().toISOString();
            }
        }

        if (debt.chargeCard) debt.minimumPayment = debt.currentBalance;

        syncDebtToBill(debt, data);
        save();
    } finally {
        _syncing = false;
    }
}

// ─── Sync: Debt minimum payment → linked Bill ─────

export function syncDebtToBill(debt, data) {
    if (!data.bills) data.bills = [];
    let bill = findBillByLinkedDebtId(debt.id, data.bills);

    if (debt._linkedBillId) {
        const targetBill = data.bills.find(b => b.id === debt._linkedBillId);
        if (targetBill) {
            if (bill && bill.id !== targetBill.id) {
                bill.linkedDebtId = null;
            }
            targetBill.linkedDebtId = debt.id;
            targetBill.amount = debt.minimumPayment || targetBill.amount;
            bill = targetBill;
        }
        delete debt._linkedBillId;
    } else if (debt._unlinkBill) {
        if (bill) bill.linkedDebtId = null;
        delete debt._unlinkBill;
        return;
    }

    if (debt.minimumPayment > 0) {
        if (!bill) {
            const checkingAcct = (data.accounts || []).find(a => a.type === 'checking');
            const paymentSource = checkingAcct ? checkingAcct.name : 'Checking Account';
            bill = {
                id: crypto.randomUUID(),
                name: debt.name + ' Payment',
                amount: debt.minimumPayment,
                category: debtCategoryForBill(debt.type),
                dueDay: 25,
                frequency: 'monthly',
                paymentSource: paymentSource,
                frozen: false,
                autoPay: false,
                linkedDebtId: debt.id,
                notes: 'Auto-synced from debt'
            };
            data.bills.push(bill);
        } else {
            bill.amount = debt.minimumPayment;
        }
    } else if (bill) {
        data.bills = data.bills.filter(b => b.id !== bill.id);
    }
}

// ─── Sync: Bill → Debt ───────────────────────────

export function syncFromBill(bill, data, save) {
    if (_syncing || !bill.linkedDebtId) return;
    _syncing = true;
    try {
        const debt = (data.debts || []).find(d => d.id === bill.linkedDebtId);
        if (debt) {
            debt.minimumPayment = bill.amount;
            save();
        }
    } finally {
        _syncing = false;
    }
}

// ─── Cascade Deletes ──────────────────────────────

export function syncDeleteAccount(accountId, data) {
    if (_syncing) return;
    _syncing = true;
    try {
        const account = (data.accounts || []).find(a => a.id === accountId);
        if (!account || !account.linkedDebtId) return;

        const debtId = account.linkedDebtId;
        const bill = findBillByLinkedDebtId(debtId, data.bills);
        if (bill) {
            data.bills = data.bills.filter(b => b.id !== bill.id);
        }
        data.debts = (data.debts || []).filter(d => d.id !== debtId);
    } finally {
        _syncing = false;
    }
}

export function syncDeleteDebt(debtId, data) {
    if (_syncing) return;
    _syncing = true;
    try {
        const debt = (data.debts || []).find(d => d.id === debtId);

        const bill = findBillByLinkedDebtId(debtId, data.bills);
        if (bill) {
            data.bills = data.bills.filter(b => b.id !== bill.id);
        }

        if (debt && debt.linkedAccountId) {
            data.accounts = (data.accounts || []).filter(a => a.id !== debt.linkedAccountId);
        }
    } finally {
        _syncing = false;
    }
}

export function syncDeleteBill(billId, data) {
    if (_syncing) return;
    const bill = (data.bills || []).find(b => b.id === billId);
    if (bill && bill.linkedDebtId) {
        bill.linkedDebtId = null;
    }
}

// ─── Migration ────────────────────────────────────

export function migrateEntityLinks(data) {
    if (!data.accounts) data.accounts = [];
    if (!data.debts) data.debts = [];
    if (!data.bills) data.bills = [];
    let changed = false;

    const normalize = (name) => (name || '').toLowerCase().trim()
        .replace(/\s+payment$/i, '')
        .replace(/\s+card$/i, '')
        .replace(/\s+account$/i, '');

    // 1. Link credit-card debts ↔ credit accounts by name
    data.debts.filter(d => d.type === 'credit-card' && !d.linkedAccountId).forEach(debt => {
        const match = data.accounts.find(a =>
            a.type === 'credit' && !a.linkedDebtId &&
            normalize(a.name) === normalize(debt.name)
        );
        if (match) {
            debt.linkedAccountId = match.id;
            match.linkedDebtId = debt.id;
            match.balance = debt.currentBalance;
            match.lastUpdated = new Date().toISOString();
            changed = true;
        }
    });

    // 2. Link mortgage debts ↔ property accounts by name
    data.debts.filter(d => d.type === 'mortgage' && !d.linkedAccountId).forEach(debt => {
        const match = data.accounts.find(a =>
            a.type === 'property' && !a.linkedDebtId &&
            (normalize(a.name) === normalize(debt.name) ||
             normalize(debt.name).includes(normalize(a.name)))
        );
        if (match) {
            debt.linkedAccountId = match.id;
            match.linkedDebtId = debt.id;
            match.amountOwed = debt.currentBalance;
            changed = true;
        }
    });

    // 2b. Link auto-loan debts ↔ vehicle accounts by name
    data.debts.filter(d => d.type === 'auto-loan' && !d.linkedAccountId).forEach(debt => {
        const match = data.accounts.find(a =>
            a.type === 'vehicle' && !a.linkedDebtId &&
            (normalize(a.name) === normalize(debt.name) ||
             normalize(debt.name).includes(normalize(a.name)))
        );
        if (match) {
            debt.linkedAccountId = match.id;
            match.linkedDebtId = debt.id;
            match.amountOwed = debt.currentBalance;
            changed = true;
        }
    });

    // 3. Link credit card bills ↔ debts by name
    data.bills.filter(b => b.category === 'Credit Card' && !b.linkedDebtId).forEach(bill => {
        const match = data.debts.find(d =>
            d.type === 'credit-card' && !findBillByLinkedDebtId(d.id, data.bills) &&
            (normalize(bill.name) === normalize(d.name) ||
             normalize(bill.name).replace(/\s+payment$/i, '') === normalize(d.name))
        );
        if (match) {
            bill.linkedDebtId = match.id;
            bill.amount = match.minimumPayment || bill.amount;
            changed = true;
        }
    });

    // 4. Create missing credit accounts for unlinked credit-card debts
    data.debts.filter(d => d.type === 'credit-card' && !d.linkedAccountId).forEach(debt => {
        const account = {
            id: crypto.randomUUID(),
            name: debt.name,
            type: 'credit',
            balance: debt.currentBalance,
            linkedDebtId: debt.id,
            lastUpdated: new Date().toISOString()
        };
        data.accounts.push(account);
        debt.linkedAccountId = account.id;
        changed = true;
    });

    // 5. Create missing bills for debts with minimum payments
    data.debts.filter(d => d.minimumPayment > 0 && !findBillByLinkedDebtId(d.id, data.bills)).forEach(debt => {
        const checkingAcct = data.accounts.find(a => a.type === 'checking');
        const bill = {
            id: crypto.randomUUID(),
            name: debt.name + ' Payment',
            amount: debt.minimumPayment,
            category: debtCategoryForBill(debt.type),
            dueDay: 25,
            frequency: 'monthly',
            paymentSource: checkingAcct ? checkingAcct.name : 'Checking Account',
            frozen: false,
            autoPay: false,
            linkedDebtId: debt.id,
            notes: 'Auto-synced from debt'
        };
        data.bills.push(bill);
        changed = true;
    });

    return changed;
}
