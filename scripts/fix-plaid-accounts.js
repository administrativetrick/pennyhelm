#!/usr/bin/env node
/**
 * fix-plaid-accounts.js
 *
 * Remediation script: Finds Plaid items that exist in the plaidItems collection
 * but whose accounts are NOT present in the user's userData.accounts array.
 * For each orphaned item, calls Plaid to fetch current accounts and injects
 * them into the user's userData.
 *
 * Usage:
 *   node scripts/fix-plaid-accounts.js [--dry-run] [--uid <specific-uid>]
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key,
 *           and PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV env vars.
 */

const admin = require('firebase-admin');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const uidIndex = args.indexOf('--uid');
const targetUid = uidIndex !== -1 ? args[uidIndex + 1] : null;

if (dryRun) console.log('=== DRY RUN MODE — no writes will be made ===\n');

// Init Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// Init Plaid client
function getPlaidClient() {
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const env = process.env.PLAID_ENV || 'production';

    if (!clientId || !secret) {
        throw new Error('PLAID_CLIENT_ID and PLAID_SECRET env vars required');
    }

    const configuration = new Configuration({
        basePath: PlaidEnvironments[env] || PlaidEnvironments.production,
        baseOptions: {
            headers: {
                'PLAID-CLIENT-ID': clientId,
                'PLAID-SECRET': secret,
            },
        },
    });
    return new PlaidApi(configuration);
}

// Map Plaid account type → PennyHelm type (matches js/plaid.js logic)
function mapPlaidType(plaidType, plaidSubtype) {
    switch (plaidType) {
        case 'depository':
            if (plaidSubtype === 'checking') return { storeType: 'checking', entity: 'account' };
            return { storeType: 'savings', entity: 'account' };
        case 'credit':
            return { storeType: 'credit', entity: 'account' };
        case 'investment':
            return { storeType: 'investment', entity: 'account' };
        case 'loan':
            if (plaidSubtype === 'mortgage') return { storeType: 'property', entity: 'account' };
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

function generateId() {
    // Simple UUID v4-like generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

async function main() {
    const plaidClient = getPlaidClient();

    // Step 1: Get all Plaid items (or filter by UID)
    let itemsQuery = db.collection('plaidItems');
    if (targetUid) {
        itemsQuery = itemsQuery.where('uid', '==', targetUid);
    }
    const itemsSnapshot = await itemsQuery.get();

    if (itemsSnapshot.empty) {
        console.log('No Plaid items found.');
        return;
    }

    console.log(`Found ${itemsSnapshot.size} Plaid item(s) to check.\n`);

    // Group items by UID
    const itemsByUid = {};
    itemsSnapshot.forEach(doc => {
        const data = doc.data();
        if (!itemsByUid[data.uid]) itemsByUid[data.uid] = [];
        itemsByUid[data.uid].push({ docId: doc.id, ...data });
    });

    let totalFixed = 0;

    for (const [uid, items] of Object.entries(itemsByUid)) {
        console.log(`\n--- User: ${uid} ---`);

        // Get user's current userData
        const userDataDoc = await db.collection('userData').doc(uid).get();
        let userData;

        if (!userDataDoc.exists) {
            console.log('  WARNING: No userData document exists. Cannot fix.');
            continue;
        }

        const rawData = userDataDoc.data().data;
        userData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

        if (!userData.accounts) userData.accounts = [];
        if (!userData.debts) userData.debts = [];

        for (const item of items) {
            console.log(`  Plaid item: ${item.itemId} (${item.institutionName})`);

            // Check if any accounts in userData reference this item
            const linkedAccounts = userData.accounts.filter(a => a.plaidItemId === item.itemId);
            const linkedDebts = userData.debts.filter(d => d.plaidItemId === item.itemId);

            if (linkedAccounts.length > 0 || linkedDebts.length > 0) {
                console.log(`    Already linked: ${linkedAccounts.length} account(s), ${linkedDebts.length} debt(s) — skipping.`);
                continue;
            }

            console.log('    NOT linked to any accounts/debts — fetching from Plaid...');

            try {
                // Fetch current accounts from Plaid
                const accountsResponse = await plaidClient.accountsGet({
                    access_token: item.accessToken,
                });

                const plaidAccounts = accountsResponse.data.accounts;
                console.log(`    Found ${plaidAccounts.length} account(s) from Plaid.`);

                let accountsAdded = 0;
                let debtsAdded = 0;

                for (const acct of plaidAccounts) {
                    const { storeType, entity } = mapPlaidType(acct.type, acct.subtype);

                    // Check for duplicates by plaidAccountId
                    const existingAcct = userData.accounts.find(a => a.plaidAccountId === acct.account_id);
                    const existingDebt = userData.debts.find(d => d.plaidAccountId === acct.account_id);

                    if (existingAcct || existingDebt) {
                        console.log(`    Skipping ${acct.name} (already exists by plaidAccountId)`);
                        continue;
                    }

                    if (entity === 'account') {
                        const newAccount = {
                            id: generateId(),
                            name: acct.official_name || acct.name,
                            type: storeType,
                            balance: acct.balances.current || 0,
                            plaidAccountId: acct.account_id,
                            plaidItemId: item.itemId,
                            plaidInstitution: item.institutionName,
                            plaidMask: acct.mask,
                            lastUpdated: new Date().toISOString(),
                        };

                        if (storeType === 'property') {
                            newAccount.amountOwed = acct.balances.current || 0;
                        }

                        userData.accounts.push(newAccount);
                        accountsAdded++;
                        console.log(`    + Added account: ${newAccount.name} (${storeType}) — $${acct.balances.current || 0}`);
                    } else if (entity === 'debt') {
                        const newDebt = {
                            id: generateId(),
                            name: acct.official_name || acct.name,
                            type: storeType,
                            currentBalance: acct.balances.current || 0,
                            originalBalance: acct.balances.current || 0,
                            interestRate: 0,
                            minimumPayment: 0,
                            plaidAccountId: acct.account_id,
                            plaidItemId: item.itemId,
                            plaidInstitution: item.institutionName,
                            notes: `Imported from ${item.institutionName}`,
                        };

                        userData.debts.push(newDebt);
                        debtsAdded++;
                        console.log(`    + Added debt: ${newDebt.name} (${storeType}) — $${acct.balances.current || 0}`);
                    }
                }

                if (accountsAdded > 0 || debtsAdded > 0) {
                    totalFixed++;
                    console.log(`    Summary: ${accountsAdded} account(s) and ${debtsAdded} debt(s) added.`);
                } else {
                    console.log('    No new accounts/debts to add.');
                }

            } catch (err) {
                console.error(`    ERROR fetching from Plaid:`, err.response?.data || err.message);
            }
        }

        // Save updated userData back to Firestore
        if (!dryRun) {
            const existingDocData = userDataDoc.data();
            const saveData = {
                data: JSON.stringify(userData),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            // Preserve sharing arrays
            if (existingDocData.sharedWithUids) saveData.sharedWithUids = existingDocData.sharedWithUids;
            if (existingDocData.sharedWithEdit) saveData.sharedWithEdit = existingDocData.sharedWithEdit;

            await db.collection('userData').doc(uid).set(saveData);
            console.log(`  Saved updated userData for ${uid}.`);
        } else {
            console.log(`  [DRY RUN] Would save updated userData for ${uid}.`);
        }
    }

    console.log(`\n=== Done. ${totalFixed} Plaid item(s) fixed. ===`);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
