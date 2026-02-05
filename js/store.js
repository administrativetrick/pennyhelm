const STORAGE_KEY = 'personal_finances_data';

const defaultData = {
    userName: 'User',
    dependentName: 'Dependent',
    dependentEnabled: false,
    income: {
        user: {
            payAmount: 0,
            frequency: 'biweekly',
            nextPayDates: []
        },
        dependent: {
            payAmount: 0,
            frequency: 'monthly',
            employed: false
        },
        combineDependentIncome: true
    },
    bills: [],
    dependentBills: [],
    paymentSources: [
        'Checking Account',
        'Credit Card'
    ],
    paySchedule: {
        startDate: new Date().toISOString().slice(0, 10), // Today as default anchor
        frequency: 'biweekly'    // biweekly, weekly, semimonthly, monthly
    },
    paidHistory: {}, // { "2026-01": { "bill-id": true } }
    accounts: [], // { id, name, type, balance, amountOwed?, lastUpdated } — type: checking|savings|credit|investment|retirement|property
    taxDocuments: [], // { id, taxYear, filename, mimeType, size, category, notes, uploadDate, owner: 'user'|'dependent' }
    taxYears: [], // explicitly created years (numbers)
    creditScores: {
        user: { score: null, lastUpdated: null },
        dependent: { score: null, lastUpdated: null }
    },
    debts: [], // { id, name, type, currentBalance, originalBalance, interestRate, minimumPayment, createdDate, notes }
    debtBudget: { totalMonthlyBudget: 0, strategy: 'avalanche' },
    taxDeductions: [], // { id, taxYear, category, description, amount, date, vendor, receiptDocId, notes }
    otherIncome: [], // { id, name, amount, frequency, category, notes } — category: rental|dividend|freelance|side-hustle|gift|other
    setupComplete: false // set to true after first-run welcome screen
};

class Store {
    constructor() {
        this._data = null;
        this._listeners = [];
        this._syncTimer = null;
        this._serverAvailable = false;
        this._syncing = false; // Guard flag to prevent infinite sync loops
        this._authProvider = null; // Function that returns auth headers
        this._mode = 'selfhost'; // 'selfhost' or 'cloud'
        this._db = null; // Firestore instance (cloud mode)
        this._dataDocRef = null; // Firestore doc ref for userData/{uid}
    }

    // Set mode (called by app.js after auth.init())
    setMode(mode) {
        this._mode = mode;
    }

    // Initialize Firestore references (cloud mode only)
    initFirestore(uid) {
        this._db = firebase.firestore();
        this._dataDocRef = this._db.collection('userData').doc(uid);
    }

    // Set auth provider (called by app.js for selfhost mode)
    setAuthProvider(fn) {
        this._authProvider = fn;
    }

    _getAuthHeaders() {
        if (this._authProvider) {
            return this._authProvider();
        }
        return {};
    }

    // Called once at startup before app renders
    async initFromServer() {
        if (this._mode === 'cloud') {
            await this._initFromFirestore();
        } else {
            await this._initFromExpressServer();
        }

        if (!this._data) {
            this._data = JSON.parse(JSON.stringify(defaultData));
        }

        // Migrate old key names (legacy → user/dependent)
        this._migrateKeyNames();

        // If data was loaded/migrated and has bills, mark setup as complete
        // (handles existing users whose data predates the setupComplete flag)
        if (this._data.bills && this._data.bills.length > 0 && !this._data.setupComplete) {
            this._data.setupComplete = true;
            this._syncToServer();
        }

        // Migrate: link accounts ↔ debts ↔ bills
        this._migrateEntityLinks();
        return this._data;
    }

    // Load data from Firestore (cloud mode)
    async _initFromFirestore() {
        try {
            const docSnap = await this._dataDocRef.get();
            if (docSnap.exists) {
                const raw = docSnap.data().data;
                const serverData = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (serverData && typeof serverData === 'object' && 'bills' in serverData) {
                    this._data = serverData;
                    this._serverAvailable = true;
                } else {
                    this._serverAvailable = true;
                }
            } else {
                this._serverAvailable = true;
                // Check localStorage for migration
                try {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (raw) {
                        console.log('Migrating data from localStorage to Firestore...');
                        this._data = JSON.parse(raw);
                        await this._syncToServerImmediate();
                        localStorage.removeItem(STORAGE_KEY);
                        console.log('Migration complete. localStorage cleared.');
                    }
                } catch (e) {
                    console.warn('No localStorage data to migrate:', e);
                }
            }
        } catch (e) {
            console.warn('Firestore not available, falling back to localStorage:', e);
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    this._data = JSON.parse(raw);
                }
            } catch (e2) {
                console.error('Failed to load from localStorage:', e2);
            }
        }
    }

    // Load data from Express server (selfhost mode)
    async _initFromExpressServer() {
        try {
            const res = await fetch('/api/data', {
                headers: this._getAuthHeaders()
            });
            if (res.status === 401) {
                window.location.href = '/login';
                return;
            }
            const serverData = await res.json();

            if (serverData && typeof serverData === 'object' && 'bills' in serverData) {
                this._data = serverData;
                this._serverAvailable = true;
            } else {
                this._serverAvailable = true;
                try {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (raw) {
                        console.log('Migrating data from localStorage to server...');
                        this._data = JSON.parse(raw);
                        await this._syncToServerImmediate();
                        localStorage.removeItem(STORAGE_KEY);
                        console.log('Migration complete. localStorage cleared.');
                    }
                } catch (e) {
                    console.warn('No localStorage data to migrate:', e);
                }
            }
        } catch (e) {
            console.warn('Server not available, falling back to localStorage:', e);
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    this._data = raw ? JSON.parse(raw) : null;
                }
            } catch (e2) {
                console.error('Failed to load from localStorage:', e2);
            }
        }
    }

    _load() {
        if (this._data) return this._data;
        // Fallback if initFromServer hasn't been called yet
        this._data = JSON.parse(JSON.stringify(defaultData));
        return this._data;
    }

    _migrateKeyNames() {
        let changed = false;
        const d = this._data;

        // Migrate legacy income keys to generic user/dependent
        const legacyUserKeys = ['curtis'];
        const legacyDepKeys = ['ivy'];

        legacyUserKeys.forEach(key => {
            if (d.income && d.income[key] && !d.income.user) {
                d.income.user = d.income[key];
                delete d.income[key];
                changed = true;
            }
            if (d.creditScores && d.creditScores[key] && !d.creditScores.user) {
                d.creditScores.user = d.creditScores[key];
                delete d.creditScores[key];
                changed = true;
            }
        });

        legacyDepKeys.forEach(key => {
            if (d.income && d.income[key] && !d.income.dependent) {
                d.income.dependent = d.income[key];
                delete d.income[key];
                changed = true;
            }
            if (d.creditScores && d.creditScores[key] && !d.creditScores.dependent) {
                d.creditScores.dependent = d.creditScores[key];
                delete d.creditScores[key];
                changed = true;
            }
        });

        // Migrate legacy dependent bills array name
        const legacyBillArrays = ['ivyBills'];
        legacyBillArrays.forEach(key => {
            if (d[key] && !d.dependentBills) {
                d.dependentBills = d[key];
                delete d[key];
                changed = true;
            }
        });

        // Migrate legacy covering field on dependent bills
        const depBills = d.dependentBills || [];
        const legacyCoveringKeys = ['curtisCovering'];
        depBills.forEach(bill => {
            legacyCoveringKeys.forEach(key => {
                if (key in bill) {
                    bill.userCovering = bill[key];
                    delete bill[key];
                    changed = true;
                }
            });
        });

        if (changed) {
            this._syncToServer();
        }
    }

    // ===== Entity Sync Engine =====

    // Helpers to find linked entities
    _findDebtByLinkedAccountId(accountId) {
        const debts = this._data.debts || [];
        return debts.find(d => d.linkedAccountId === accountId);
    }

    _findAccountByLinkedDebtId(debtId) {
        const accounts = this._data.accounts || [];
        return accounts.find(a => a.linkedDebtId === debtId);
    }

    _findBillByLinkedDebtId(debtId) {
        const bills = this._data.bills || [];
        return bills.find(b => b.linkedDebtId === debtId);
    }

    _debtCategoryForBill(debtType) {
        const map = {
            'credit-card': 'Credit Card',
            'mortgage': 'Mortgage',
            'auto-loan': 'Car',
            'student-loan': 'Loan',
            'personal-loan': 'Loan',
            'medical': 'Medical',
            'other': 'Debt Payment'
        };
        return map[debtType] || 'Debt Payment';
    }

    // Sync: Account was created or updated → update/create linked debt + bill
    _syncFromAccount(account) {
        if (this._syncing) return;
        this._syncing = true;
        try {
            const data = this._data;
            if (!data.debts) data.debts = [];
            if (!data.bills) data.bills = [];

            if (account.type === 'credit') {
                let debt = account.linkedDebtId ? data.debts.find(d => d.id === account.linkedDebtId) : null;
                if (!debt) {
                    // Create linked debt
                    debt = {
                        id: crypto.randomUUID(),
                        name: account.name,
                        type: 'credit-card',
                        currentBalance: account.balance,
                        originalBalance: account.balance,
                        interestRate: account._interestRate || 0,
                        minimumPayment: account._minimumPayment || 0,
                        linkedAccountId: account.id,
                        createdDate: new Date().toISOString(),
                        notes: ''
                    };
                    data.debts.push(debt);
                    // Link back
                    account.linkedDebtId = debt.id;
                } else {
                    // Update linked debt
                    debt.currentBalance = account.balance;
                    debt.name = account.name;
                    if (account._interestRate !== undefined) debt.interestRate = account._interestRate;
                    if (account._minimumPayment !== undefined) debt.minimumPayment = account._minimumPayment;
                    // Charge card: min payment always equals balance
                    if (debt.chargeCard) debt.minimumPayment = account.balance;
                }
                // Clean up transient fields
                delete account._interestRate;
                delete account._minimumPayment;

                // Now sync debt → bill
                this._syncDebtToBill(debt);
                this._save();

            } else if (account.type === 'property' && account.amountOwed > 0) {
                let debt = account.linkedDebtId ? data.debts.find(d => d.id === account.linkedDebtId) : null;
                if (!debt) {
                    debt = {
                        id: crypto.randomUUID(),
                        name: account.name + ' Mortgage',
                        type: 'mortgage',
                        currentBalance: account.amountOwed,
                        originalBalance: account.amountOwed,
                        interestRate: 0,
                        minimumPayment: 0,
                        linkedAccountId: account.id,
                        createdDate: new Date().toISOString(),
                        notes: ''
                    };
                    data.debts.push(debt);
                    account.linkedDebtId = debt.id;
                } else {
                    debt.currentBalance = account.amountOwed;
                }
                this._syncDebtToBill(debt);
                this._save();
            }
        } finally {
            this._syncing = false;
        }
    }

    // Sync: Debt was created or updated → update/create linked account + bill
    _syncFromDebt(debt) {
        if (this._syncing) return;
        this._syncing = true;
        try {
            const data = this._data;
            if (!data.accounts) data.accounts = [];
            if (!data.bills) data.bills = [];

            // Handle transient _linkedAccountId (manual linking from form)
            if (debt._linkedAccountId) {
                const targetAccount = data.accounts.find(a => a.id === debt._linkedAccountId);
                if (targetAccount) {
                    // Unlink old account if there was a different one
                    if (debt.linkedAccountId && debt.linkedAccountId !== targetAccount.id) {
                        const oldAccount = data.accounts.find(a => a.id === debt.linkedAccountId);
                        if (oldAccount) oldAccount.linkedDebtId = null;
                    }
                    // Create bidirectional link
                    targetAccount.linkedDebtId = debt.id;
                    debt.linkedAccountId = targetAccount.id;
                    // Sync balances based on type
                    if (targetAccount.type === 'property') {
                        targetAccount.amountOwed = debt.currentBalance;
                    } else if (targetAccount.type === 'credit') {
                        targetAccount.balance = debt.currentBalance;
                    }
                    targetAccount.lastUpdated = new Date().toISOString();
                }
                delete debt._linkedAccountId;
            } else if (debt._unlinkAccount) {
                // Explicit unlink request
                if (debt.linkedAccountId) {
                    const oldAccount = data.accounts.find(a => a.id === debt.linkedAccountId);
                    if (oldAccount) oldAccount.linkedDebtId = null;
                    debt.linkedAccountId = null;
                }
                delete debt._unlinkAccount;
            } else if (debt.type === 'credit-card') {
                let account = debt.linkedAccountId ? data.accounts.find(a => a.id === debt.linkedAccountId) : null;
                if (!account) {
                    // Create linked account
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
            }

            // Charge card: min payment always equals balance
            if (debt.chargeCard) debt.minimumPayment = debt.currentBalance;

            // All debt types: sync minimum payment → bill
            this._syncDebtToBill(debt);
            this._save();
        } finally {
            this._syncing = false;
        }
    }

    // Sync: debt's minimum payment → linked bill
    _syncDebtToBill(debt) {
        const data = this._data;
        if (!data.bills) data.bills = [];
        let bill = this._findBillByLinkedDebtId(debt.id);

        // If the debt has a transient _linkedBillId, link to that existing bill
        if (debt._linkedBillId) {
            const targetBill = data.bills.find(b => b.id === debt._linkedBillId);
            if (targetBill) {
                // Unlink old bill if there was one (and it's different)
                if (bill && bill.id !== targetBill.id) {
                    bill.linkedDebtId = null;
                }
                // Link the target bill
                targetBill.linkedDebtId = debt.id;
                targetBill.amount = debt.minimumPayment || targetBill.amount;
                bill = targetBill;
            }
            delete debt._linkedBillId;
        } else if (debt._unlinkBill) {
            // Explicit unlink request
            if (bill) {
                bill.linkedDebtId = null;
            }
            delete debt._unlinkBill;
            return;
        }

        if (debt.minimumPayment > 0) {
            if (!bill) {
                // Find a sensible payment source
                const checkingAcct = (data.accounts || []).find(a => a.type === 'checking');
                const paymentSource = checkingAcct ? checkingAcct.name : 'Checking Account';
                bill = {
                    id: crypto.randomUUID(),
                    name: debt.name + ' Payment',
                    amount: debt.minimumPayment,
                    category: this._debtCategoryForBill(debt.type),
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
            // Minimum payment is 0 — remove the linked bill
            data.bills = data.bills.filter(b => b.id !== bill.id);
        }
    }

    // Sync: Bill was updated → push amount back to debt's minimumPayment
    _syncFromBill(bill) {
        if (this._syncing || !bill.linkedDebtId) return;
        this._syncing = true;
        try {
            const data = this._data;
            const debt = (data.debts || []).find(d => d.id === bill.linkedDebtId);
            if (debt) {
                debt.minimumPayment = bill.amount;
                this._save();
            }
        } finally {
            this._syncing = false;
        }
    }

    // Cascade delete: account deleted → remove linked debt + bill
    _syncDeleteAccount(accountId) {
        if (this._syncing) return;
        this._syncing = true;
        try {
            const data = this._data;
            const account = (data.accounts || []).find(a => a.id === accountId);
            if (!account || !account.linkedDebtId) return;

            const debtId = account.linkedDebtId;
            // Delete linked bill first
            const bill = this._findBillByLinkedDebtId(debtId);
            if (bill) {
                data.bills = data.bills.filter(b => b.id !== bill.id);
            }
            // Delete linked debt
            data.debts = (data.debts || []).filter(d => d.id !== debtId);
        } finally {
            this._syncing = false;
        }
    }

    // Cascade delete: debt deleted → remove linked account + bill
    _syncDeleteDebt(debtId) {
        if (this._syncing) return;
        this._syncing = true;
        try {
            const data = this._data;
            const debt = (data.debts || []).find(d => d.id === debtId);

            // Delete linked bill
            const bill = this._findBillByLinkedDebtId(debtId);
            if (bill) {
                data.bills = data.bills.filter(b => b.id !== bill.id);
            }

            // Delete linked account
            if (debt && debt.linkedAccountId) {
                data.accounts = (data.accounts || []).filter(a => a.id !== debt.linkedAccountId);
            }
        } finally {
            this._syncing = false;
        }
    }

    // Delete bill: unlink from debt but don't delete debt
    _syncDeleteBill(billId) {
        if (this._syncing) return;
        const data = this._data;
        const bill = (data.bills || []).find(b => b.id === billId);
        if (bill && bill.linkedDebtId) {
            // Just clear the link — debt keeps its minimumPayment value
            bill.linkedDebtId = null;
        }
    }

    // Migration: link existing unlinked entities by name matching
    _migrateEntityLinks() {
        const data = this._data;
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
                // Debt balance is source of truth
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

        // 3. Link credit card bills ↔ debts by name
        data.bills.filter(b => b.category === 'Credit Card' && !b.linkedDebtId).forEach(bill => {
            const match = data.debts.find(d =>
                d.type === 'credit-card' && !this._findBillByLinkedDebtId(d.id) &&
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
        data.debts.filter(d => d.minimumPayment > 0 && !this._findBillByLinkedDebtId(d.id)).forEach(debt => {
            const checkingAcct = data.accounts.find(a => a.type === 'checking');
            const bill = {
                id: crypto.randomUUID(),
                name: debt.name + ' Payment',
                amount: debt.minimumPayment,
                category: this._debtCategoryForBill(debt.type),
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

        if (changed) {
            this._syncToServer();
        }
    }

    _save() {
        this._notify();
        this._syncToServer();
    }

    // Debounced fire-and-forget sync to server
    _syncToServer() {
        if (!this._serverAvailable) return;
        clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => {
            this._syncToServerImmediate();
        }, 100);
    }

    // Immediate sync (used for migration and import)
    async _syncToServerImmediate() {
        if (this._mode === 'cloud') {
            return this._syncToFirestore();
        }
        return this._syncToExpressServer();
    }

    // Write data to Firestore (cloud mode)
    async _syncToFirestore() {
        try {
            await this._dataDocRef.set({
                data: JSON.stringify(this._data),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error('Failed to sync to Firestore:', e);
        }
    }

    // Write data to Express server (selfhost mode)
    async _syncToExpressServer() {
        try {
            const authHeaders = this._getAuthHeaders();
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify(this._data)
            });
            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }
        } catch (e) {
            console.error('Failed to sync to server:', e);
        }
    }

    _notify() {
        this._listeners.forEach(fn => fn(this._data));
    }

    onChange(fn) {
        this._listeners.push(fn);
        return () => {
            this._listeners = this._listeners.filter(f => f !== fn);
        };
    }

    getData() {
        return this._load();
    }

    getUserName() {
        const data = this._load();
        return data.userName || 'User';
    }

    setUserName(name) {
        const data = this._load();
        data.userName = name;
        this._save();
    }

    getDependentName() {
        const data = this._load();
        return data.dependentName || 'Dependent';
    }

    setDependentName(name) {
        const data = this._load();
        data.dependentName = name;
        this._save();
    }

    isDependentEnabled() {
        const data = this._load();
        return data.dependentEnabled !== false; // default true for backward compat
    }

    setDependentEnabled(enabled) {
        const data = this._load();
        data.dependentEnabled = enabled;
        this._save();
    }

    isSeeded() {
        const data = this._load();
        return data.bills.length > 0;
    }

    isSetupComplete() {
        const data = this._load();
        return data.setupComplete === true;
    }

    completeSetup() {
        const data = this._load();
        data.setupComplete = true;
        this._save();
    }

    // Bills CRUD
    getBills() {
        return this._load().bills;
    }

    addBill(bill) {
        const data = this._load();
        bill.id = crypto.randomUUID();
        data.bills.push(bill);
        this._save();
        return bill;
    }

    updateBill(id, updates) {
        const data = this._load();
        const idx = data.bills.findIndex(b => b.id === id);
        if (idx !== -1) {
            data.bills[idx] = { ...data.bills[idx], ...updates };
            this._save();
            // Sync: if this bill is linked to a debt, push amount changes back
            this._syncFromBill(data.bills[idx]);
        }
    }

    deleteBill(id) {
        this._syncDeleteBill(id);
        const data = this._load();
        data.bills = data.bills.filter(b => b.id !== id);
        this._save();
    }

    // Paid status by month
    getPaidKey(year, month) {
        return `${year}-${String(month + 1).padStart(2, '0')}`;
    }

    isBillPaid(billId, year, month) {
        const data = this._load();
        const key = this.getPaidKey(year, month);
        return !!(data.paidHistory[key] && data.paidHistory[key][billId]);
    }

    toggleBillPaid(billId, year, month) {
        const data = this._load();
        const key = this.getPaidKey(year, month);
        if (!data.paidHistory[key]) data.paidHistory[key] = {};
        data.paidHistory[key][billId] = !data.paidHistory[key][billId];
        this._save();
        return data.paidHistory[key][billId];
    }

    // Dependent Bills CRUD
    getDependentBills() {
        const data = this._load();
        return data.dependentBills || [];
    }

    addDependentBill(bill) {
        const data = this._load();
        if (!data.dependentBills) data.dependentBills = [];
        bill.id = crypto.randomUUID();
        data.dependentBills.push(bill);
        this._save();
        return bill;
    }

    updateDependentBill(id, updates) {
        const data = this._load();
        if (!data.dependentBills) return;
        const idx = data.dependentBills.findIndex(b => b.id === id);
        if (idx !== -1) {
            data.dependentBills[idx] = { ...data.dependentBills[idx], ...updates };
            this._save();
        }
    }

    deleteDependentBill(id) {
        const data = this._load();
        if (!data.dependentBills) return;
        data.dependentBills = data.dependentBills.filter(b => b.id !== id);
        this._save();
    }

    toggleDependentCovering(id) {
        const data = this._load();
        if (!data.dependentBills) return false;
        const bill = data.dependentBills.find(b => b.id === id);
        if (bill) {
            bill.userCovering = !bill.userCovering;
            this._save();
            return bill.userCovering;
        }
        return false;
    }

    // Income
    getIncome() {
        return this._load().income;
    }

    updateIncome(who, updates) {
        const data = this._load();
        if (who) {
            data.income[who] = { ...data.income[who], ...updates };
        } else {
            // Top-level income properties (e.g., combineDependentIncome)
            Object.assign(data.income, updates);
        }
        this._save();
    }

    // Payment Sources
    getPaymentSources() {
        return this._load().paymentSources;
    }

    addPaymentSource(name) {
        const data = this._load();
        if (!data.paymentSources.includes(name)) {
            data.paymentSources.push(name);
            this._save();
        }
    }

    renamePaymentSource(oldName, newName) {
        const data = this._load();
        const idx = data.paymentSources.indexOf(oldName);
        if (idx === -1 || !newName) return;
        data.paymentSources[idx] = newName;
        // Update all bills referencing this source
        (data.bills || []).forEach(b => {
            if (b.paymentSource === oldName) b.paymentSource = newName;
        });
        (data.dependentBills || []).forEach(b => {
            if (b.paymentSource === oldName) b.paymentSource = newName;
        });
        this._save();
    }

    removePaymentSource(name) {
        const data = this._load();
        data.paymentSources = data.paymentSources.filter(s => s !== name);
        this._save();
    }

    // Pay Schedule
    getPaySchedule() {
        const data = this._load();
        if (!data.paySchedule) {
            data.paySchedule = { startDate: '2026-01-02', frequency: 'biweekly' };
        }
        return data.paySchedule;
    }

    updatePaySchedule(updates) {
        const data = this._load();
        if (!data.paySchedule) {
            data.paySchedule = { startDate: '2026-01-02', frequency: 'biweekly' };
        }
        data.paySchedule = { ...data.paySchedule, ...updates };
        this._save();
    }

    // Generate pay dates for a given date range based on schedule
    getPayDates(rangeStartStr, rangeEndStr) {
        const schedule = this.getPaySchedule();
        if (!schedule.startDate) return [];

        const anchor = new Date(schedule.startDate + 'T00:00:00');
        const now = new Date();
        // Default range: 2 months back to 4 months ahead
        const rangeStart = rangeStartStr
            ? new Date(rangeStartStr + 'T00:00:00')
            : new Date(now.getFullYear(), now.getMonth() - 2, 1);
        const rangeEnd = rangeEndStr
            ? new Date(rangeEndStr + 'T00:00:00')
            : new Date(now.getFullYear(), now.getMonth() + 4, 0);

        const dates = [];
        const freq = schedule.frequency;

        if (freq === 'biweekly') {
            // Walk from anchor in 14-day steps to cover the range
            let cursor = new Date(anchor);
            // Rewind to before rangeStart
            while (cursor > rangeStart) {
                cursor = new Date(cursor.getTime() - 14 * 86400000);
            }
            // Walk forward
            while (cursor <= rangeEnd) {
                if (cursor >= rangeStart) {
                    dates.push(new Date(cursor));
                }
                cursor = new Date(cursor.getTime() + 14 * 86400000);
            }
        } else if (freq === 'weekly') {
            let cursor = new Date(anchor);
            while (cursor > rangeStart) {
                cursor = new Date(cursor.getTime() - 7 * 86400000);
            }
            while (cursor <= rangeEnd) {
                if (cursor >= rangeStart) {
                    dates.push(new Date(cursor));
                }
                cursor = new Date(cursor.getTime() + 7 * 86400000);
            }
        } else if (freq === 'semimonthly') {
            // 1st and 15th of each month (or use anchor day and anchor day + 15)
            const day1 = anchor.getDate();
            const day2 = day1 <= 15 ? day1 + 15 : day1 - 15;
            let curYear = rangeStart.getFullYear();
            let curMonth = rangeStart.getMonth();
            while (true) {
                const d1 = new Date(curYear, curMonth, Math.min(day1, 28));
                const d2 = new Date(curYear, curMonth, Math.min(day2, 28));
                if (d1 > rangeEnd && d2 > rangeEnd) break;
                if (d1 >= rangeStart && d1 <= rangeEnd) dates.push(d1);
                if (d2 >= rangeStart && d2 <= rangeEnd) dates.push(d2);
                curMonth++;
                if (curMonth > 11) { curMonth = 0; curYear++; }
            }
            dates.sort((a, b) => a - b);
        } else if (freq === 'monthly') {
            const day = anchor.getDate();
            let curYear = rangeStart.getFullYear();
            let curMonth = rangeStart.getMonth();
            while (true) {
                const d = new Date(curYear, curMonth, Math.min(day, 28));
                if (d > rangeEnd) break;
                if (d >= rangeStart) dates.push(d);
                curMonth++;
                if (curMonth > 11) { curMonth = 0; curYear++; }
            }
        }

        return dates;
    }

    // Get pay dates as ISO strings (for backward compat)
    getPayDateStrings(rangeStart, rangeEnd) {
        return this.getPayDates(rangeStart, rangeEnd).map(d => d.toISOString().slice(0, 10));
    }

    // Credit Scores
    getCreditScores() {
        const data = this._load();
        if (!data.creditScores) {
            data.creditScores = {};
        }
        if (!data.creditScores.user) {
            data.creditScores.user = { score: null, lastUpdated: null };
        }
        if (!data.creditScores.dependent) {
            data.creditScores.dependent = { score: null, lastUpdated: null };
        }
        return data.creditScores;
    }

    updateCreditScore(who, score) {
        const data = this._load();
        if (!data.creditScores) data.creditScores = {};
        if (!data.creditScores.user) data.creditScores.user = { score: null, lastUpdated: null };
        if (!data.creditScores.dependent) data.creditScores.dependent = { score: null, lastUpdated: null };
        data.creditScores[who] = { score, lastUpdated: new Date().toISOString() };
        this._save();
    }

    // Accounts
    getAccounts() {
        const data = this._load();
        if (!data.accounts) data.accounts = [];
        return data.accounts;
    }

    addAccount(account) {
        const data = this._load();
        if (!data.accounts) data.accounts = [];
        account.id = crypto.randomUUID();
        account.lastUpdated = new Date().toISOString();
        data.accounts.push(account);
        this._save();
        this._syncFromAccount(account);
        return account;
    }

    updateAccount(id, updates) {
        const data = this._load();
        if (!data.accounts) return;
        const idx = data.accounts.findIndex(a => a.id === id);
        if (idx !== -1) {
            data.accounts[idx] = { ...data.accounts[idx], ...updates, lastUpdated: new Date().toISOString() };
            this._save();
            this._syncFromAccount(data.accounts[idx]);
        }
    }

    deleteAccount(id) {
        this._syncDeleteAccount(id);
        const data = this._load();
        if (!data.accounts) return;
        data.accounts = data.accounts.filter(a => a.id !== id);
        this._save();
    }

    // Tax Documents (metadata — blobs stored in IndexedDB)
    getTaxYears() {
        const data = this._load();
        if (!data.taxDocuments) data.taxDocuments = [];
        if (!data.taxYears) data.taxYears = [];
        const docYears = data.taxDocuments.map(d => d.taxYear);
        return [...new Set([...data.taxYears, ...docYears])].sort((a, b) => b - a);
    }

    addTaxYear(year) {
        const data = this._load();
        if (!data.taxYears) data.taxYears = [];
        if (!data.taxYears.includes(year)) {
            data.taxYears.push(year);
            data.taxYears.sort((a, b) => b - a);
            this._save();
        }
    }

    deleteTaxYear(year) {
        const data = this._load();
        if (!data.taxYears) return;
        data.taxYears = data.taxYears.filter(y => y !== year);
        this._save();
    }

    getTaxDocuments(taxYear) {
        const data = this._load();
        if (!data.taxDocuments) data.taxDocuments = [];
        if (taxYear !== undefined) return data.taxDocuments.filter(d => d.taxYear === taxYear);
        return data.taxDocuments;
    }

    addTaxDocument(doc) {
        const data = this._load();
        if (!data.taxDocuments) data.taxDocuments = [];
        doc.id = crypto.randomUUID();
        doc.uploadDate = new Date().toISOString();
        doc.owner = doc.owner || 'user'; // default to user
        data.taxDocuments.push(doc);
        this._save();
        return doc;
    }

    updateTaxDocument(id, updates) {
        const data = this._load();
        if (!data.taxDocuments) return;
        const idx = data.taxDocuments.findIndex(d => d.id === id);
        if (idx !== -1) {
            data.taxDocuments[idx] = { ...data.taxDocuments[idx], ...updates };
            this._save();
        }
    }

    deleteTaxDocument(id) {
        const data = this._load();
        if (!data.taxDocuments) return;
        data.taxDocuments = data.taxDocuments.filter(d => d.id !== id);
        this._save();
    }

    // Debts
    getDebts() {
        const data = this._load();
        if (!data.debts) data.debts = [];
        return data.debts;
    }

    addDebt(debt) {
        const data = this._load();
        if (!data.debts) data.debts = [];
        debt.id = crypto.randomUUID();
        debt.createdDate = new Date().toISOString();
        data.debts.push(debt);
        this._save();
        this._syncFromDebt(debt);
        return debt;
    }

    updateDebt(id, updates) {
        const data = this._load();
        if (!data.debts) return;
        const idx = data.debts.findIndex(d => d.id === id);
        if (idx !== -1) {
            data.debts[idx] = { ...data.debts[idx], ...updates };
            this._save();
            this._syncFromDebt(data.debts[idx]);
        }
    }

    deleteDebt(id) {
        this._syncDeleteDebt(id);
        const data = this._load();
        if (!data.debts) return;
        data.debts = data.debts.filter(d => d.id !== id);
        this._save();
    }

    getDebtBudget() {
        const data = this._load();
        if (!data.debtBudget) {
            data.debtBudget = { totalMonthlyBudget: 0, strategy: 'avalanche' };
        }
        return data.debtBudget;
    }

    updateDebtBudget(updates) {
        const data = this._load();
        if (!data.debtBudget) {
            data.debtBudget = { totalMonthlyBudget: 0, strategy: 'avalanche' };
        }
        data.debtBudget = { ...data.debtBudget, ...updates };
        this._save();
    }

    // Tax Deductions
    getTaxDeductions(taxYear) {
        const data = this._load();
        if (!data.taxDeductions) data.taxDeductions = [];
        if (taxYear !== undefined) return data.taxDeductions.filter(d => d.taxYear === taxYear);
        return data.taxDeductions;
    }

    addTaxDeduction(deduction) {
        const data = this._load();
        if (!data.taxDeductions) data.taxDeductions = [];
        deduction.id = crypto.randomUUID();
        deduction.createdDate = new Date().toISOString();
        data.taxDeductions.push(deduction);
        this._save();
        return deduction;
    }

    updateTaxDeduction(id, updates) {
        const data = this._load();
        if (!data.taxDeductions) return;
        const idx = data.taxDeductions.findIndex(d => d.id === id);
        if (idx !== -1) {
            data.taxDeductions[idx] = { ...data.taxDeductions[idx], ...updates };
            this._save();
        }
    }

    deleteTaxDeduction(id) {
        const data = this._load();
        if (!data.taxDeductions) return;
        data.taxDeductions = data.taxDeductions.filter(d => d.id !== id);
        this._save();
    }

    // Other Income Sources
    getOtherIncome() {
        const data = this._load();
        if (!data.otherIncome) data.otherIncome = [];
        return data.otherIncome;
    }

    addOtherIncome(source) {
        const data = this._load();
        if (!data.otherIncome) data.otherIncome = [];
        source.id = crypto.randomUUID();
        data.otherIncome.push(source);
        this._save();
        return source;
    }

    updateOtherIncome(id, updates) {
        const data = this._load();
        if (!data.otherIncome) return;
        const idx = data.otherIncome.findIndex(s => s.id === id);
        if (idx !== -1) {
            data.otherIncome[idx] = { ...data.otherIncome[idx], ...updates };
            this._save();
        }
    }

    deleteOtherIncome(id) {
        const data = this._load();
        if (!data.otherIncome) return;
        data.otherIncome = data.otherIncome.filter(s => s.id !== id);
        this._save();
    }

    // Reset
    resetData() {
        this._data = JSON.parse(JSON.stringify(defaultData));
        this._notify();
        this._syncToServerImmediate(); // Immediate sync for reset
    }

    // Clear sample/all data while keeping settings
    clearSampleData() {
        const data = this._load();
        // Clear all data arrays but keep user preferences/settings
        data.bills = [];
        data.dependentBills = [];
        data.accounts = [];
        data.debts = [];
        data.taxDocuments = [];
        data.taxYears = [];
        data.taxDeductions = [];
        data.otherIncome = [];
        data.paidHistory = {};
        data.debtBudget = { totalMonthlyBudget: 0, strategy: 'avalanche' };
        // Keep: userName, dependentName, dependentEnabled, income, paymentSources, paySchedule, creditScores
        this._save();
    }

    // Export
    exportJSON() {
        return JSON.stringify(this._load(), null, 2);
    }

    // Import
    importJSON(jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr);
            this._data = parsed;
            this._migrateEntityLinks(); // Link entities after import
            this._notify();
            this._syncToServerImmediate(); // Immediate sync for imports
            return true;
        } catch (e) {
            console.error('Invalid JSON:', e);
            return false;
        }
    }
}

export const store = new Store();
