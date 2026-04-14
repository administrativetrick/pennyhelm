/**
 * PennyHelm — Plaid Integration (Client-Side)
 *
 * Calls Firebase Cloud Functions to securely interact with Plaid API.
 * Access tokens never touch the browser.
 */

import { auth } from './auth.js';

// ─── Plaid Type → PennyHelm Type Mapping ───

function mapPlaidType(plaidType, plaidSubtype) {
    switch (plaidType) {
        case 'depository':
            if (plaidSubtype === 'checking') return { storeType: 'checking', entity: 'account' };
            return { storeType: 'savings', entity: 'account' }; // savings, hsa, cd, money market
        case 'credit':
            return { storeType: 'credit', entity: 'account' }; // sync engine auto-creates debt + bill
        case 'investment':
            return { storeType: 'investment', entity: 'account' };
        case 'loan':
            if (plaidSubtype === 'mortgage') return { storeType: 'property', entity: 'account' };
            // student, auto, personal → debt only
            return { storeType: mapLoanSubtype(plaidSubtype), entity: 'debt' };
        default:
            return { storeType: 'checking', entity: 'account' };
    }
}

function mapLoanSubtype(plaidSubtype) {
    switch (plaidSubtype) {
        case 'student': return 'student-loan';
        case 'auto': return 'auto-loan';
        default: return 'personal-loan';
    }
}

// ─── Cloud Functions Helpers ───

function getFunctions() {
    return firebase.app().functions();
}

async function callFunction(name, data) {
    const fn = getFunctions().httpsCallable(name);
    const result = await fn(data);
    return result.data;
}

// ─── Connect Bank ───

/**
 * Opens Plaid Link, authenticates with a bank, imports accounts.
 * @param {Store} store - PennyHelm store instance
 * @param {Function} onComplete - Callback after accounts are imported (for UI refresh)
 */
export async function connectBank(store, onComplete) {
    if (!auth.isCloud()) {
        alert('Bank connection is only available in Cloud mode.');
        return;
    }

    try {
        // Step 1: Get a link token from Cloud Function
        // Include redirect_uri for OAuth institutions (Chase, etc.) in production
        const oauthRedirectUri = window.location.origin + '/oauth';
        const { link_token } = await callFunction('createLinkToken', {
            redirect_uri: oauthRedirectUri,
        });

        // Step 2: Open Plaid Link
        const handler = Plaid.create({
            token: link_token,
            onSuccess: async (public_token, metadata) => {
                try {
                    // Step 3: Exchange public token via Cloud Function
                    // The cloud function also injects accounts server-side via
                    // a Firestore transaction as a safety net.
                    const result = await callFunction('exchangePublicToken', {
                        public_token,
                        institution_name: metadata.institution?.name || 'Unknown Bank',
                        institution_id: metadata.institution?.institution_id || null,
                    });

                    // Step 4: Reload store from Firestore to pick up server-side
                    // account injection (the Cloud Function writes accounts to
                    // userData via transaction). This ensures our in-memory data
                    // is current before we add anything on the client side.
                    await store.reloadFromServer();

                    // Step 5: Map Plaid accounts to PennyHelm format and add to store
                    // (deduplicates by plaidAccountId — safe if server already added them)
                    const imported = importPlaidAccounts(store, result.accounts, result.itemId);

                    // Step 6: Force immediate sync to Firestore (not debounced)
                    // This prevents a race condition where page refresh or
                    // setup flow could overwrite the data before debounced save fires.
                    await store.forceSyncNow();

                    // Step 7: Verify accounts actually persisted — if the store
                    // has no Plaid accounts for this item, the save may have been
                    // overwritten by a concurrent write. Reload and retry once.
                    const verifyAccounts = store.getAccounts().filter(a => a.plaidItemId === result.itemId);
                    const verifyDebts = store.getDebts().filter(d => d.plaidItemId === result.itemId);
                    if (verifyAccounts.length === 0 && verifyDebts.length === 0 && result.accounts.length > 0) {
                        console.warn('Plaid accounts missing after save — reloading and retrying...');
                        await store.reloadFromServer();
                        importPlaidAccounts(store, result.accounts, result.itemId);
                        await store.forceSyncNow();
                    }

                    const totalImported = store.getAccounts().filter(a => a.plaidItemId === result.itemId).length
                        + store.getDebts().filter(d => d.plaidItemId === result.itemId).length;

                    alert(`Successfully connected ${result.institutionName}!\n${totalImported} account(s) imported.`);

                    if (onComplete) onComplete();
                } catch (err) {
                    console.error('Plaid exchange error:', err);
                    // The cloud function may have succeeded (plaidItem created)
                    // even if the client-side save failed. Inform the user to
                    // try refreshing rather than re-linking.
                    alert('Bank connection was saved but accounts may not have loaded.\nPlease try refreshing connected balances, or contact support.');
                }
            },
            onEvent: (eventName, metadata) => {
                console.log('Plaid Link event:', eventName, metadata);
                if (eventName === 'ERROR') {
                    console.error('Plaid Link error details:', metadata);
                }
            },
            onExit: (err, metadata) => {
                if (err) {
                    console.warn('Plaid Link exited with error:', err);
                    console.warn('Plaid Link exit metadata:', metadata);
                }
            },
        });

        handler.open();
    } catch (err) {
        console.error('Plaid Link init error:', err);
        alert('Failed to start bank connection. Please try again.');
    }
}

/**
 * Opens Plaid Link in "update mode" to request additional product consent
 * (investments, liabilities) for an existing Plaid item.
 * @param {Store} store - PennyHelm store instance
 * @param {string} itemId - Plaid item ID to update
 * @param {Function} onComplete - Callback after update completes
 */
export async function updateBankConsent(store, itemId, onComplete) {
    if (!auth.isCloud()) {
        alert('Bank connection is only available in Cloud mode.');
        return;
    }

    try {
        const oauthRedirectUri = window.location.origin + '/oauth';
        const { link_token } = await callFunction('createUpdateLinkToken', {
            item_id: itemId,
            redirect_uri: oauthRedirectUri,
        });

        const handler = Plaid.create({
            token: link_token,
            onSuccess: async (public_token, metadata) => {
                // In update mode, no new public_token exchange is needed.
                // The existing access_token is updated with new consent.
                // Trigger a refresh to pull the newly consented data.
                try {
                    const result = await refreshPlaidBalances(store);
                    alert(`Consent updated! Refreshed ${result.updated} account(s).`);
                    if (onComplete) onComplete();
                } catch (err) {
                    console.error('Post-consent refresh error:', err);
                    alert('Consent updated, but refresh failed. Try clicking Refresh Connected Balances.');
                    if (onComplete) onComplete();
                }
            },
            onEvent: (eventName, metadata) => {
                console.log('Plaid Update event:', eventName, metadata);
            },
            onExit: (err, metadata) => {
                if (err) {
                    console.warn('Plaid Update exited with error:', err);
                }
            },
        });

        handler.open();
    } catch (err) {
        console.error('Plaid Update init error:', err);
        alert('Failed to start consent update. Please try again.');
    }
}

// ─── Import Plaid Accounts ───

function importPlaidAccounts(store, plaidAccounts, itemId) {
    const existingAccounts = store.getAccounts();
    const existingDebts = store.getDebts();
    let accountsAdded = 0;
    let debtsAdded = 0;

    for (const pa of plaidAccounts) {
        const { storeType, entity } = mapPlaidType(pa.type, pa.subtype);

        // Deduplicate by plaidAccountId
        const existingAccount = existingAccounts.find(a => a.plaidAccountId === pa.plaidAccountId);
        const existingDebt = existingDebts.find(d => d.plaidAccountId === pa.plaidAccountId);

        if (entity === 'account') {
            if (existingAccount) {
                // Update existing account
                const updates = {
                    balance: pa.balanceCurrent || 0,
                    name: pa.name,
                };
                if (storeType === 'property') {
                    updates.amountOwed = pa.balanceCurrent || 0;
                    updates.balance = pa.balanceCurrent || 0; // For mortgages, current = owed
                }
                if (storeType === 'investment' && pa.holdings) {
                    updates.holdings = pa.holdings;
                }
                store.updateAccount(existingAccount.id, updates);
            } else {
                // Add new account
                const accountData = {
                    name: pa.name,
                    type: storeType,
                    balance: pa.balanceCurrent || 0,
                    plaidAccountId: pa.plaidAccountId,
                    plaidItemId: itemId,
                    plaidInstitution: pa.institutionName,
                    plaidMask: pa.mask,
                };

                if (storeType === 'property') {
                    accountData.amountOwed = pa.balanceCurrent || 0;
                }

                // For investment accounts, include holdings
                if (storeType === 'investment' && pa.holdings) {
                    accountData.holdings = pa.holdings;
                }

                // For credit cards, use liability data if available
                if (storeType === 'credit') {
                    accountData._interestRate = pa.interestRate || 0;
                    accountData._minimumPayment = pa.minimumPayment || 0;
                    accountData._nextPaymentDueDate = pa.nextPaymentDueDate || null;
                    accountData._lastStatementBalance = pa.lastStatementBalance || null;
                }

                store.addAccount(accountData);
                accountsAdded++;
            }
        } else if (entity === 'debt') {
            if (existingDebt) {
                // Update existing debt with balance and liability data
                const debtUpdates = {
                    currentBalance: pa.balanceCurrent || 0,
                    name: pa.name,
                };
                if (pa.interestRate != null) debtUpdates.interestRate = pa.interestRate;
                if (pa.minimumPayment != null) debtUpdates.minimumPayment = pa.minimumPayment;
                if (pa.nextPaymentDueDate) debtUpdates.nextPaymentDueDate = pa.nextPaymentDueDate;
                if (pa.lastPaymentDate) debtUpdates.lastPaymentDate = pa.lastPaymentDate;
                if (pa.lastPaymentAmount != null) debtUpdates.lastPaymentAmount = pa.lastPaymentAmount;
                if (pa.isOverdue != null) debtUpdates.isOverdue = pa.isOverdue;
                if (pa.lastStatementBalance != null) debtUpdates.lastStatementBalance = pa.lastStatementBalance;
                store.updateDebt(existingDebt.id, debtUpdates);
            } else {
                // Add as debt with liability data if available
                const debtData = {
                    name: pa.name,
                    type: storeType,
                    currentBalance: pa.balanceCurrent || 0,
                    originalBalance: pa.originationPrincipal || pa.balanceCurrent || 0,
                    interestRate: pa.interestRate || 0,
                    minimumPayment: pa.minimumPayment || 0,
                    plaidAccountId: pa.plaidAccountId,
                    plaidItemId: itemId,
                    plaidInstitution: pa.institutionName,
                    notes: `Imported from ${pa.institutionName}`,
                };
                // Extra liability fields
                if (pa.nextPaymentDueDate) debtData.nextPaymentDueDate = pa.nextPaymentDueDate;
                if (pa.lastPaymentDate) debtData.lastPaymentDate = pa.lastPaymentDate;
                if (pa.lastPaymentAmount != null) debtData.lastPaymentAmount = pa.lastPaymentAmount;
                if (pa.isOverdue != null) debtData.isOverdue = pa.isOverdue;
                if (pa.lastStatementBalance != null) debtData.lastStatementBalance = pa.lastStatementBalance;
                if (pa.loanTerm) debtData.loanTerm = pa.loanTerm;
                if (pa.maturityDate) debtData.maturityDate = pa.maturityDate;
                if (pa.interestRateType) debtData.interestRateType = pa.interestRateType;
                if (pa.originationDate) debtData.originationDate = pa.originationDate;
                if (pa.loanStatus) debtData.loanStatus = pa.loanStatus;
                if (pa.servicerName) debtData.servicerName = pa.servicerName;
                store.addDebt(debtData);
                debtsAdded++;
            }
        }
    }

    return { accounts: accountsAdded, debts: debtsAdded };
}

// ─── Refresh Plaid Balances ───

/**
 * Refresh balances for all Plaid-connected items.
 * @param {Store} store - PennyHelm store instance
 * @returns {Object} Summary of updates
 */
export async function refreshPlaidBalances(store) {
    const itemIds = store.getPlaidItemIds();
    if (itemIds.length === 0) {
        return { updated: 0, errors: 0 };
    }

    let totalUpdated = 0;
    let totalErrors = 0;

    for (const itemId of itemIds) {
        try {
            const result = await callFunction('refreshBalances', { item_id: itemId });

            // Update accounts
            const existingAccounts = store.getAccounts();
            const existingDebts = store.getDebts();

            for (const pa of result.accounts) {
                let updated = false;

                // Check accounts
                const acct = existingAccounts.find(a => a.plaidAccountId === pa.plaidAccountId);
                if (acct) {
                    const updates = { balance: pa.balanceCurrent || 0 };
                    if (acct.type === 'property') {
                        updates.amountOwed = pa.balanceCurrent || 0;
                    }
                    if ((acct.type === 'investment' || acct.type === 'retirement') && pa.holdings) {
                        updates.holdings = pa.holdings;
                    }
                    store.updateAccount(acct.id, updates);
                    updated = true;
                }

                // Check debts — find by plaidAccountId OR via the account's linkedDebtId
                // (sync engine auto-creates debts for credit cards without plaidAccountId)
                const debt = existingDebts.find(d => d.plaidAccountId === pa.plaidAccountId)
                    || (acct?.linkedDebtId ? existingDebts.find(d => d.id === acct.linkedDebtId) : null);
                if (debt) {
                    const debtUpdates = { currentBalance: pa.balanceCurrent || 0 };
                    // Only update fields that the user hasn't manually overridden
                    if (pa.interestRate != null && !debt.manualOverrides?.interestRate) debtUpdates.interestRate = pa.interestRate;
                    if (pa.minimumPayment != null && !debt.manualOverrides?.minimumPayment) debtUpdates.minimumPayment = pa.minimumPayment;
                    if (pa.nextPaymentDueDate && !debt.manualOverrides?.nextPaymentDueDate) debtUpdates.nextPaymentDueDate = pa.nextPaymentDueDate;
                    if (pa.lastPaymentDate) debtUpdates.lastPaymentDate = pa.lastPaymentDate;
                    if (pa.lastPaymentAmount != null) debtUpdates.lastPaymentAmount = pa.lastPaymentAmount;
                    if (pa.isOverdue != null) debtUpdates.isOverdue = pa.isOverdue;
                    if (pa.lastStatementBalance != null) debtUpdates.lastStatementBalance = pa.lastStatementBalance;
                    // Ensure debt has plaidAccountId for future refreshes
                    if (!debt.plaidAccountId && pa.plaidAccountId) debtUpdates.plaidAccountId = pa.plaidAccountId;
                    store.updateDebt(debt.id, debtUpdates);
                    updated = true;
                }

                if (updated) totalUpdated++;
            }
        } catch (err) {
            console.error(`Failed to refresh item ${itemId}:`, err);
            totalErrors++;
        }
    }

    return { updated: totalUpdated, errors: totalErrors };
}

/**
 * Check if any Plaid items are connected
 * @param {Store} store
 * @returns {boolean}
 */
export function hasPlaidConnections(store) {
    return store.getPlaidItemIds().length > 0;
}

// ─── Transaction Sync ───

/**
 * Sync transactions from Plaid-connected accounts as expenses.
 * Only fetches transactions since last sync (or last 30 days if first sync).
 * Deduplicates by plaidTransactionId.
 * @param {Store} store - PennyHelm store instance
 * @returns {Object} { imported, total }
 */
export async function syncPlaidTransactions(store) {
    if (!auth.isCloud()) return { imported: 0, total: 0 };
    if (!hasPlaidConnections(store)) return { imported: 0, total: 0 };

    const lastSync = store.getLastTransactionSync();
    const now = new Date();

    // Calculate start date: last sync or 30 days ago
    let startDate;
    if (lastSync) {
        // Go back 1 extra day from last sync to catch any late-posting transactions
        const lastSyncDate = new Date(lastSync);
        lastSyncDate.setDate(lastSyncDate.getDate() - 1);
        startDate = lastSyncDate.toISOString().slice(0, 10);
    } else {
        // First sync — last 90 days (historical backfill to feed CashFlow charts)
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    const endDate = now.toISOString().slice(0, 10);

    try {
        const result = await callFunction('syncTransactions', {
            start_date: startDate,
            end_date: endDate,
        });

        const imported = store.importPlaidTransactions(result.transactions || []);
        store.setLastTransactionSync(now.toISOString());

        return { imported, total: (result.transactions || []).length };
    } catch (err) {
        console.error('Transaction sync error:', err);
        return { imported: 0, total: 0, error: err.message };
    }
}

/**
 * Check if a transaction sync should run (once per day max).
 * @param {Store} store
 * @returns {boolean}
 */
export function shouldSyncTransactions(store) {
    if (!hasPlaidConnections(store)) return false;
    const lastSync = store.getLastTransactionSync();
    if (!lastSync) return true;
    const lastSyncDate = new Date(lastSync);
    const now = new Date();
    // Sync if last sync was more than 20 hours ago
    return (now.getTime() - lastSyncDate.getTime()) > 20 * 60 * 60 * 1000;
}
