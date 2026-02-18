import { StorageAdapter } from './services/storage-adapter.js';
import { migrateKeyNames, migrateBalanceHistory } from './services/migration-manager.js';
import { migrateEntityLinks, syncFromAccount, syncFromDebt, syncFromBill, syncDeleteAccount, syncDeleteDebt, syncDeleteBill } from './services/entity-linker.js';
import { generatePayDates, createBalanceSnapshot } from './services/financial-service.js';

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
    accounts: [], // { id, name, type, balance, amountOwed?, lastUpdated } — type: checking|savings|credit|investment|retirement|property|vehicle|equipment|other-asset
    taxDocuments: [], // { id, taxYear, filename, mimeType, size, category, notes, uploadDate, owner: 'user'|'dependent' }
    taxYears: [], // explicitly created years (numbers)
    creditScores: {
        user: { score: null, lastUpdated: null },
        dependent: { score: null, lastUpdated: null }
    },
    debts: [], // { id, name, type, currentBalance, originalBalance, interestRate, minimumPayment, createdDate, notes }
    debtBudget: { totalMonthlyBudget: 0, strategy: 'avalanche' },
    expenses: [], // { id, name, amount, category, date, vendor, notes, createdDate, expenseType: 'personal'|'business', businessName?, plaidTransactionId?, source: 'manual'|'plaid' }
    taxDeductions: [], // { id, taxYear, category, description, amount, date, vendor, receiptDocId, notes }
    otherIncome: [], // { id, name, amount, frequency, category, notes } — category: rental|dividend|freelance|side-hustle|gift|other
    savingsGoals: [], // { id, name, targetAmount, currentAmount, targetDate, category, linkedAccountId, notes, createdDate }
    invites: [], // { id, email, type: 'partner'|'financial-planner'|'cpa', status: 'pending'|'accepted'|'declined', permissions: 'view'|'edit', invitedAt, acceptedAt?, inviteeUid? }
    sharedWith: [], // { uid, email, type, permissions, sharedAt } — people who have access to this account
    customCategories: [], // { id, name, color, createdAt } — user-defined bill categories
    vehicleMileage: [], // { id, vehicleAccountId, mileage, date, notes }
    vehicleTrips: [], // { id, vehicleAccountId, startMileage, endMileage, distance, date, purpose, notes }
    balanceHistory: [], // { date: "2026-01-15", checking, savings, investment, netWorth }
    notificationPreferences: {
        enabled: false,
        reminderDays: 1,
        preferredTime: '09:00',
        includeAutoPay: false
    },
    dashboardLayout: null, // { order: [...widgetIds], hidden: [...widgetIds] }
    usageType: null, // 'personal' | 'business' | 'both' — set during onboarding
    businessNames: [], // ['Acme Corp', 'Side Hustle LLC'] — user-defined business names
    lastTransactionSync: null, // ISO date string of last Plaid transaction import
    setupComplete: false // set to true after first-run welcome screen
};

class Store {
    constructor() {
        this._data = null;
        this._listeners = [];
        this._storage = new StorageAdapter();
    }

    // ─── Configuration (delegates to StorageAdapter) ──────────

    setMode(mode) { this._storage.setMode(mode); }
    initFirestore(uid) { this._storage.initFirestore(uid); }
    setAuthProvider(fn) { this._storage.setAuthProvider(fn); }
    startImpersonation(targetUid) { this._storage.startImpersonation(targetUid); }
    stopImpersonation() { this._storage.stopImpersonation(); }
    isImpersonating() { return this._storage.isImpersonating(); }
    getImpersonatedUid() { return this._storage.getImpersonatedUid(); }

    // ─── Initialization ──────────────────────────────────────

    async initFromServer() {
        this._data = await this._storage.load();

        if (!this._data) {
            this._data = JSON.parse(JSON.stringify(defaultData));
        }

        // Run migrations
        const keysMigrated = migrateKeyNames(this._data);
        if (keysMigrated) this._syncToServer();

        // If data was loaded/migrated and has bills, mark setup as complete
        if (this._data.bills && this._data.bills.length > 0 && !this._data.setupComplete) {
            this._data.setupComplete = true;
            this._syncToServer();
        }

        // Migrate entity links (accounts ↔ debts ↔ bills)
        const linksMigrated = migrateEntityLinks(this._data);
        if (linksMigrated) this._syncToServer();

        return this._data;
    }

    async reloadFromServer() {
        if (this._storage.isCloud()) {
            this._data = await this._storage.load({ forceServer: true });
        } else {
            this._data = await this._storage.load();
        }
        if (!this._data) {
            this._data = JSON.parse(JSON.stringify(defaultData));
        }
    }

    _load() {
        if (this._data) return this._data;
        this._data = JSON.parse(JSON.stringify(defaultData));
        return this._data;
    }

    // ─── Persistence ─────────────────────────────────────────

    _save() {
        this._notify();
        this._syncToServer();
    }

    _syncToServer() {
        this._storage.scheduleSave(this._data);
    }

    async forceSyncNow() {
        return this._storage.forceSave(this._data);
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

    // ─── Generic Accessors ───────────────────────────────────

    getData() { return this._load(); }

    getUserName() {
        return this._load().userName || 'User';
    }

    setUserName(name) {
        this._load().userName = name;
        this._save();
    }

    getDependentName() {
        return this._load().dependentName || 'Dependent';
    }

    setDependentName(name) {
        this._load().dependentName = name;
        this._save();
    }

    isDependentEnabled() {
        return this._load().dependentEnabled !== false;
    }

    setDependentEnabled(enabled) {
        this._load().dependentEnabled = enabled;
        this._save();
    }

    isSeeded() {
        return this._load().bills.length > 0;
    }

    isSetupComplete() {
        return this._load().setupComplete === true;
    }

    completeSetup() {
        this._load().setupComplete = true;
        this._save();
    }

    // ─── Custom Categories CRUD ──────────────────────────────

    getCustomCategories() {
        const data = this._load();
        if (!data.customCategories) data.customCategories = [];
        return data.customCategories;
    }

    addCustomCategory(category) {
        const data = this._load();
        if (!data.customCategories) data.customCategories = [];
        const exists = data.customCategories.find(c =>
            c.name.toLowerCase() === category.name.toLowerCase()
        );
        if (exists) throw new Error('A category with this name already exists');
        category.id = crypto.randomUUID();
        category.createdAt = new Date().toISOString();
        data.customCategories.push(category);
        this._save();
        return category;
    }

    updateCustomCategory(id, updates) {
        const data = this._load();
        if (!data.customCategories) return;
        const idx = data.customCategories.findIndex(c => c.id === id);
        if (idx !== -1) {
            if (updates.name && updates.name.toLowerCase() !== data.customCategories[idx].name.toLowerCase()) {
                const exists = data.customCategories.find(c =>
                    c.id !== id && c.name.toLowerCase() === updates.name.toLowerCase()
                );
                if (exists) throw new Error('A category with this name already exists');
            }
            data.customCategories[idx] = { ...data.customCategories[idx], ...updates };
            this._save();
        }
    }

    deleteCustomCategory(id) {
        const data = this._load();
        if (!data.customCategories) return;
        data.customCategories = data.customCategories.filter(c => c.id !== id);
        this._save();
    }

    // ─── Bills CRUD ──────────────────────────────────────────

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
            syncFromBill(data.bills[idx], data, () => this._save());
        }
    }

    deleteBill(id) {
        syncDeleteBill(id, this._data);
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

    // ─── Dependent Bills CRUD ────────────────────────────────

    getDependentBills() {
        return this._load().dependentBills || [];
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

    // ─── Income ──────────────────────────────────────────────

    getIncome() {
        return this._load().income;
    }

    updateIncome(who, updates) {
        const data = this._load();
        if (who) {
            data.income[who] = { ...data.income[who], ...updates };
        } else {
            Object.assign(data.income, updates);
        }
        this._save();
    }

    // ─── Payment Sources ─────────────────────────────────────

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

    // ─── Pay Schedule ────────────────────────────────────────

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

    getPayDates(rangeStartStr, rangeEndStr) {
        return generatePayDates(this.getPaySchedule(), rangeStartStr, rangeEndStr);
    }

    getPayDateStrings(rangeStart, rangeEnd) {
        return this.getPayDates(rangeStart, rangeEnd).map(d => d.toISOString().slice(0, 10));
    }

    // ─── Credit Scores ───────────────────────────────────────

    getCreditScores() {
        const data = this._load();
        if (!data.creditScores) data.creditScores = {};
        if (!data.creditScores.user) data.creditScores.user = { score: null, lastUpdated: null };
        if (!data.creditScores.dependent) data.creditScores.dependent = { score: null, lastUpdated: null };
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

    // ─── Accounts ────────────────────────────────────────────

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
        syncFromAccount(account, data, () => this._save());
        return account;
    }

    updateAccount(id, updates) {
        const data = this._load();
        if (!data.accounts) return;
        const idx = data.accounts.findIndex(a => a.id === id);
        if (idx !== -1) {
            data.accounts[idx] = { ...data.accounts[idx], ...updates, lastUpdated: new Date().toISOString() };
            this._save();
            syncFromAccount(data.accounts[idx], data, () => this._save());
        }
    }

    deleteAccount(id) {
        syncDeleteAccount(id, this._data);
        const data = this._load();
        if (!data.accounts) return;
        data.accounts = data.accounts.filter(a => a.id !== id);
        this._save();
    }

    // ─── Vehicle Mileage ─────────────────────────────────────

    getVehicleMileage(vehicleAccountId) {
        const data = this._load();
        if (!data.vehicleMileage) data.vehicleMileage = [];
        return data.vehicleMileage
            .filter(m => m.vehicleAccountId === vehicleAccountId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    addVehicleMileage(entry) {
        const data = this._load();
        if (!data.vehicleMileage) data.vehicleMileage = [];
        entry.id = crypto.randomUUID();
        data.vehicleMileage.push(entry);
        this._save();
        return entry;
    }

    updateVehicleMileage(id, updates) {
        const data = this._load();
        if (!data.vehicleMileage) return;
        const idx = data.vehicleMileage.findIndex(m => m.id === id);
        if (idx !== -1) {
            data.vehicleMileage[idx] = { ...data.vehicleMileage[idx], ...updates };
            this._save();
        }
    }

    deleteVehicleMileage(id) {
        const data = this._load();
        if (!data.vehicleMileage) return;
        data.vehicleMileage = data.vehicleMileage.filter(m => m.id !== id);
        this._save();
    }

    // ─── Vehicle Trips ───────────────────────────────────────

    getVehicleTrips(vehicleAccountId) {
        const data = this._load();
        if (!data.vehicleTrips) data.vehicleTrips = [];
        return data.vehicleTrips
            .filter(t => t.vehicleAccountId === vehicleAccountId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    addVehicleTrip(trip) {
        const data = this._load();
        if (!data.vehicleTrips) data.vehicleTrips = [];
        trip.id = crypto.randomUUID();
        trip.distance = (trip.endMileage || 0) - (trip.startMileage || 0);
        data.vehicleTrips.push(trip);
        this._save();
        return trip;
    }

    updateVehicleTrip(id, updates) {
        const data = this._load();
        if (!data.vehicleTrips) return;
        const idx = data.vehicleTrips.findIndex(t => t.id === id);
        if (idx !== -1) {
            data.vehicleTrips[idx] = { ...data.vehicleTrips[idx], ...updates };
            if (data.vehicleTrips[idx].endMileage && data.vehicleTrips[idx].startMileage) {
                data.vehicleTrips[idx].distance = data.vehicleTrips[idx].endMileage - data.vehicleTrips[idx].startMileage;
            }
            this._save();
        }
    }

    deleteVehicleTrip(id) {
        const data = this._load();
        if (!data.vehicleTrips) return;
        data.vehicleTrips = data.vehicleTrips.filter(t => t.id !== id);
        this._save();
    }

    // ─── Balance History ─────────────────────────────────────

    getBalanceHistory() {
        const data = this._load();
        if (!data.balanceHistory) data.balanceHistory = [];
        migrateBalanceHistory(data.balanceHistory);
        return data.balanceHistory.sort((a, b) => a.date.localeCompare(b.date));
    }

    snapshotBalances() {
        const data = this._load();
        if (!data.balanceHistory) data.balanceHistory = [];
        if (!data.accounts) data.accounts = [];

        migrateBalanceHistory(data.balanceHistory);

        const snapshot = createBalanceSnapshot(data.accounts, data.debts);

        const existingIdx = data.balanceHistory.findIndex(h => h.date === snapshot.date);
        if (existingIdx !== -1) {
            data.balanceHistory[existingIdx] = snapshot;
        } else {
            data.balanceHistory.push(snapshot);
        }

        // Keep only last 365 days
        data.balanceHistory.sort((a, b) => a.date.localeCompare(b.date));
        if (data.balanceHistory.length > 365) {
            data.balanceHistory = data.balanceHistory.slice(-365);
        }

        this._save();
        return snapshot;
    }

    // ─── Tax Documents ───────────────────────────────────────

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
        doc.owner = doc.owner || 'user';
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

    // ─── Debts ───────────────────────────────────────────────

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
        syncFromDebt(debt, data, () => this._save());
        return debt;
    }

    updateDebt(id, updates) {
        const data = this._load();
        if (!data.debts) return;
        const idx = data.debts.findIndex(d => d.id === id);
        if (idx !== -1) {
            data.debts[idx] = { ...data.debts[idx], ...updates };
            this._save();
            syncFromDebt(data.debts[idx], data, () => this._save());
        }
    }

    deleteDebt(id) {
        syncDeleteDebt(id, this._data);
        const data = this._load();
        if (!data.debts) return;
        data.debts = data.debts.filter(d => d.id !== id);
        this._save();
    }

    getDebtBudget() {
        const data = this._load();
        if (!data.debtBudget) data.debtBudget = { totalMonthlyBudget: 0, strategy: 'avalanche' };
        return data.debtBudget;
    }

    updateDebtBudget(updates) {
        const data = this._load();
        if (!data.debtBudget) data.debtBudget = { totalMonthlyBudget: 0, strategy: 'avalanche' };
        data.debtBudget = { ...data.debtBudget, ...updates };
        this._save();
    }

    // ─── Tax Deductions ──────────────────────────────────────

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

    // ─── Other Income Sources ────────────────────────────────

    getOtherIncome() {
        const data = this._load();
        if (!data.otherIncome) data.otherIncome = [];
        let needsSave = false;
        data.otherIncome.forEach(item => {
            if (!item.id) {
                item.id = crypto.randomUUID();
                needsSave = true;
            }
        });
        if (needsSave) this._save();
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

    // ─── Expenses ────────────────────────────────────────────

    getExpenses() {
        const data = this._load();
        if (!data.expenses) data.expenses = [];
        let needsSave = false;
        data.expenses.forEach(item => {
            if (!item.id) {
                item.id = crypto.randomUUID();
                needsSave = true;
            }
        });
        if (needsSave) this._save();
        return data.expenses;
    }

    addExpense(expense) {
        const data = this._load();
        if (!data.expenses) data.expenses = [];
        expense.id = crypto.randomUUID();
        expense.createdDate = new Date().toISOString();
        data.expenses.push(expense);
        this._save();
        return expense;
    }

    updateExpense(id, updates) {
        const data = this._load();
        if (!data.expenses) return;
        const idx = data.expenses.findIndex(e => e.id === id);
        if (idx !== -1) {
            data.expenses[idx] = { ...data.expenses[idx], ...updates };
            this._save();
        }
    }

    deleteExpense(id) {
        const data = this._load();
        if (!data.expenses) return;
        data.expenses = data.expenses.filter(e => e.id !== id);
        this._save();
    }

    // ─── Business Names ──────────────────────────────────────

    getBusinessNames() {
        const data = this._load();
        if (!data.businessNames) data.businessNames = [];
        return data.businessNames;
    }

    addBusinessName(name) {
        const data = this._load();
        if (!data.businessNames) data.businessNames = [];
        if (!data.businessNames.includes(name)) {
            data.businessNames.push(name);
            this._save();
        }
        return data.businessNames;
    }

    removeBusinessName(name) {
        const data = this._load();
        if (!data.businessNames) return;
        data.businessNames = data.businessNames.filter(n => n !== name);
        this._save();
    }

    renameBusinessName(oldName, newName) {
        const data = this._load();
        if (!data.businessNames) return;
        const idx = data.businessNames.indexOf(oldName);
        if (idx !== -1) {
            data.businessNames[idx] = newName;
            if (data.expenses) {
                data.expenses.forEach(e => {
                    if (e.businessName === oldName) e.businessName = newName;
                });
            }
            this._save();
        }
    }

    // ─── Usage Type ──────────────────────────────────────────

    getUsageType() {
        return this._load().usageType || null;
    }

    setUsageType(type) {
        this._load().usageType = type;
        this._save();
    }

    // ─── Transaction Sync ────────────────────────────────────

    getLastTransactionSync() {
        return this._load().lastTransactionSync || null;
    }

    setLastTransactionSync(dateStr) {
        this._load().lastTransactionSync = dateStr;
        this._save();
    }

    importPlaidTransactions(transactions) {
        const data = this._load();
        if (!data.expenses) data.expenses = [];
        let imported = 0;
        for (const txn of transactions) {
            if (data.expenses.some(e => e.plaidTransactionId === txn.plaidTransactionId)) continue;
            const expense = {
                id: crypto.randomUUID(),
                name: txn.name,
                amount: txn.amount,
                category: txn.category || 'other',
                date: txn.date,
                vendor: txn.merchantName || '',
                notes: '',
                createdDate: new Date().toISOString(),
                expenseType: 'personal',
                businessName: null,
                plaidTransactionId: txn.plaidTransactionId,
                plaidAccountId: txn.plaidAccountId,
                source: 'plaid'
            };
            data.expenses.push(expense);
            imported++;
        }
        if (imported > 0) this._save();
        return imported;
    }

    // ─── Savings Goals ───────────────────────────────────────

    getSavingsGoals() {
        const data = this._load();
        if (!data.savingsGoals) data.savingsGoals = [];
        return data.savingsGoals;
    }

    addSavingsGoal(goal) {
        const data = this._load();
        if (!data.savingsGoals) data.savingsGoals = [];
        goal.id = crypto.randomUUID();
        goal.createdDate = new Date().toISOString();
        data.savingsGoals.push(goal);
        this._save();
        return goal;
    }

    updateSavingsGoal(id, updates) {
        const data = this._load();
        if (!data.savingsGoals) return;
        const idx = data.savingsGoals.findIndex(g => g.id === id);
        if (idx !== -1) {
            data.savingsGoals[idx] = { ...data.savingsGoals[idx], ...updates };
            this._save();
        }
    }

    deleteSavingsGoal(id) {
        const data = this._load();
        if (!data.savingsGoals) return;
        data.savingsGoals = data.savingsGoals.filter(g => g.id !== id);
        this._save();
    }

    // ─── Dashboard Layout ────────────────────────────────────

    getDashboardLayout() {
        const data = this._load();
        const defaultOrder = ['stats-grid', 'pay-periods', 'monthly-progress', 'upcoming-bills', 'spending-category', 'payment-sources', 'savings-goals'];
        if (!data.dashboardLayout) {
            return { order: [...defaultOrder], hidden: [] };
        }
        const layout = data.dashboardLayout;
        if (!layout.order) layout.order = [...defaultOrder];
        if (!layout.hidden) layout.hidden = [];
        for (const id of defaultOrder) {
            if (!layout.order.includes(id) && !layout.hidden.includes(id)) {
                layout.order.push(id);
            }
        }
        return layout;
    }

    updateDashboardLayout(layout) {
        this._load().dashboardLayout = layout;
        this._save();
    }

    resetDashboardLayout() {
        this._load().dashboardLayout = null;
        this._save();
    }

    // ─── Invites & Sharing ───────────────────────────────────

    getInvites() {
        const data = this._load();
        if (!data.invites) data.invites = [];
        return data.invites;
    }

    getSharedWith() {
        const data = this._load();
        if (!data.sharedWith) data.sharedWith = [];
        return data.sharedWith;
    }

    addInvite(invite) {
        const data = this._load();
        if (!data.invites) data.invites = [];
        if (!invite.id) invite.id = crypto.randomUUID();
        invite.status = invite.status || 'pending';
        invite.invitedAt = invite.invitedAt || new Date().toISOString();
        data.invites.push(invite);
        this._save();
        return invite;
    }

    updateInvite(id, updates) {
        const data = this._load();
        if (!data.invites) return;
        const idx = data.invites.findIndex(i => i.id === id);
        if (idx !== -1) {
            data.invites[idx] = { ...data.invites[idx], ...updates };
            this._save();
        }
    }

    deleteInvite(id) {
        const data = this._load();
        if (!data.invites) return;
        data.invites = data.invites.filter(i => i.id !== id);
        this._save();
    }

    acceptInvite(inviteId, inviteeUid, inviteeEmail) {
        const data = this._load();
        if (!data.invites) return null;
        const invite = data.invites.find(i => i.id === inviteId);
        if (!invite) return null;
        invite.status = 'accepted';
        invite.acceptedAt = new Date().toISOString();
        invite.inviteeUid = inviteeUid;
        if (!data.sharedWith) data.sharedWith = [];
        const existing = data.sharedWith.find(s => s.uid === inviteeUid);
        if (!existing) {
            data.sharedWith.push({
                uid: inviteeUid,
                email: inviteeEmail || invite.email,
                type: invite.type,
                permissions: invite.permissions,
                sharedAt: new Date().toISOString()
            });
        }
        this._save();
        return invite;
    }

    revokeAccess(uid) {
        const data = this._load();
        if (!data.sharedWith) return;
        data.sharedWith = data.sharedWith.filter(s => s.uid !== uid);
        if (data.invites) {
            data.invites.forEach(i => {
                if (i.inviteeUid === uid) i.status = 'revoked';
            });
        }
        this._save();
    }

    // ─── Plaid Helpers ───────────────────────────────────────

    getPlaidItemIds() {
        const accounts = this.getAccounts();
        const ids = new Set();
        accounts.forEach(a => { if (a.plaidItemId) ids.add(a.plaidItemId); });
        const debts = this.getDebts();
        debts.forEach(d => { if (d.plaidItemId) ids.add(d.plaidItemId); });
        return [...ids];
    }

    getAccountsByPlaidItem(itemId) {
        return this.getAccounts().filter(a => a.plaidItemId === itemId);
    }

    // ─── Reset & Import/Export ────────────────────────────────

    resetData() {
        this._data = JSON.parse(JSON.stringify(defaultData));
        this._notify();
        this._storage.forceSave(this._data);
    }

    clearSampleData() {
        const data = this._load();
        data.bills = [];
        data.dependentBills = [];
        data.accounts = [];
        data.debts = [];
        data.taxDocuments = [];
        data.taxYears = [];
        data.taxDeductions = [];
        data.otherIncome = [];
        data.expenses = [];
        data.paidHistory = {};
        data.debtBudget = { totalMonthlyBudget: 0, strategy: 'avalanche' };
        this._save();
    }

    exportJSON() {
        return JSON.stringify(this._load(), null, 2);
    }

    importJSON(jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr);
            this._data = parsed;
            const linksMigrated = migrateEntityLinks(this._data);
            this._notify();
            this._storage.forceSave(this._data);
            return true;
        } catch (e) {
            console.error('Invalid JSON:', e);
            return false;
        }
    }

    // ─── Notification Preferences ────────────────────────────

    getNotificationPreferences() {
        const data = this._load();
        return data.notificationPreferences || {
            enabled: false,
            reminderDays: 1,
            preferredTime: '09:00',
            includeAutoPay: false
        };
    }

    updateNotificationPreferences(updates) {
        const data = this._load();
        data.notificationPreferences = { ...data.notificationPreferences, ...updates };
        this._save();
    }
}

export const store = new Store();
