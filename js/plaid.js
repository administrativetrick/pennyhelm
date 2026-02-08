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
        const { link_token } = await callFunction('createLinkToken', {});

        // Step 2: Open Plaid Link
        const handler = Plaid.create({
            token: link_token,
            onSuccess: async (public_token, metadata) => {
                try {
                    // Step 3: Exchange public token via Cloud Function
                    const result = await callFunction('exchangePublicToken', {
                        public_token,
                        institution_name: metadata.institution?.name || 'Unknown Bank',
                        institution_id: metadata.institution?.institution_id || null,
                    });

                    // Step 4: Map Plaid accounts to PennyHelm format and add to store
                    const imported = importPlaidAccounts(store, result.accounts, result.itemId);

                    alert(`Successfully connected ${result.institutionName}!\n${imported.accounts} account(s) and ${imported.debts} debt(s) imported.`);

                    if (onComplete) onComplete();
                } catch (err) {
                    console.error('Plaid exchange error:', err);
                    alert('Failed to connect bank account. Please try again.');
                }
            },
            onExit: (err) => {
                if (err) {
                    console.warn('Plaid Link exited with error:', err);
                }
            },
        });

        handler.open();
    } catch (err) {
        console.error('Plaid Link init error:', err);
        alert('Failed to start bank connection. Please try again.');
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

                // For credit cards, pass limit as interest-rate placeholder
                // The sync engine will auto-create the linked debt
                if (storeType === 'credit') {
                    accountData._interestRate = 0; // User can set later
                    accountData._minimumPayment = 0;
                }

                store.addAccount(accountData);
                accountsAdded++;
            }
        } else if (entity === 'debt') {
            if (existingDebt) {
                // Update existing debt balance
                store.updateDebt(existingDebt.id, {
                    currentBalance: pa.balanceCurrent || 0,
                    name: pa.name,
                });
            } else {
                // Add as debt (non-mortgage loans)
                store.addDebt({
                    name: pa.name,
                    type: storeType,
                    currentBalance: pa.balanceCurrent || 0,
                    originalBalance: pa.balanceCurrent || 0,
                    interestRate: 0, // User can set later
                    minimumPayment: 0,
                    plaidAccountId: pa.plaidAccountId,
                    plaidItemId: itemId,
                    plaidInstitution: pa.institutionName,
                    notes: `Imported from ${pa.institutionName}`,
                });
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
                // Check accounts
                const acct = existingAccounts.find(a => a.plaidAccountId === pa.plaidAccountId);
                if (acct) {
                    const updates = { balance: pa.balanceCurrent || 0 };
                    if (acct.type === 'property') {
                        updates.amountOwed = pa.balanceCurrent || 0;
                    }
                    store.updateAccount(acct.id, updates);
                    totalUpdated++;
                    continue;
                }

                // Check debts
                const debt = existingDebts.find(d => d.plaidAccountId === pa.plaidAccountId);
                if (debt) {
                    store.updateDebt(debt.id, {
                        currentBalance: pa.balanceCurrent || 0,
                    });
                    totalUpdated++;
                }
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
