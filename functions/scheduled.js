const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const crypto = require("crypto");

// Map Plaid personal_finance_category to PennyHelm expense category
function mapPlaidCategory(plaidCategory) {
    if (!plaidCategory) return "other";
    const primary = (plaidCategory.primary || "").toUpperCase();
    const detailed = (plaidCategory.detailed || "").toUpperCase();
    switch (primary) {
        case "FOOD_AND_DRINK":
            if (detailed.includes("GROCERIES")) return "groceries";
            return "dining";
        case "TRANSPORTATION":
            if (detailed.includes("GAS")) return "gas";
            return "transportation";
        case "TRAVEL": return "travel";
        case "ENTERTAINMENT": return "entertainment";
        case "GENERAL_MERCHANDISE":
        case "GENERAL_SERVICES":
            return "shopping";
        case "MEDICAL": return "healthcare";
        case "PERSONAL_CARE": return "personal-care";
        case "HOME_IMPROVEMENT":
        case "RENT_AND_UTILITIES":
            if (detailed.includes("UTILITIES")) return "utilities";
            return "home";
        case "EDUCATION": return "education";
        case "GOVERNMENT_AND_NON_PROFIT":
        case "TRANSFER_IN":
        case "TRANSFER_OUT":
        case "LOAN_PAYMENTS":
        case "BANK_FEES":
            return "other";
        default:
            return "other";
    }
}

module.exports = function({ admin, db, getPlaidClient, secrets }) {
    const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV } = secrets;
    const exports = {};

    // ─────────────────────────────────────────────
    // SCHEDULED / CRON FUNCTIONS
    // ─────────────────────────────────────────────

    // cleanupTelemetry
    //   Scheduled function to delete telemetry logs older than 30 days
    //   Runs daily at 3:00 AM UTC
    exports.cleanupTelemetry = onSchedule(
        {
            schedule: "0 3 * * *",
            timeZone: "UTC",
        },
        async (event) => {
            console.log("Starting telemetry cleanup...");

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30);

            let totalDeleted = 0;
            let batchCount = 0;

            try {
                // Process in batches to avoid timeout
                while (true) {
                    const snapshot = await db.collection("telemetry")
                        .where("timestamp", "<", cutoffDate)
                        .limit(500)
                        .get();

                    if (snapshot.empty) {
                        break;
                    }

                    const batch = db.batch();
                    snapshot.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();

                    totalDeleted += snapshot.size;
                    batchCount++;
                    console.log(`Batch ${batchCount}: Deleted ${snapshot.size} logs`);

                    // Safety limit - don't run forever
                    if (batchCount >= 20) {
                        console.log("Reached batch limit, will continue next run");
                        break;
                    }
                }

                console.log(`Telemetry cleanup complete. Total deleted: ${totalDeleted}`);
                return null;

            } catch (err) {
                console.error("Telemetry cleanup error:", err);
                throw err;
            }
        }
    );

    // scheduledBalanceRefresh
    //   Runs daily at 6:00 AM PT (14:00 UTC) to refresh Plaid balances
    //   for all connected items and update user account data in Firestore
    exports.scheduledBalanceRefresh = onSchedule(
        {
            schedule: "0 14 * * *",
            timeZone: "UTC",
            secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV],
        },
        async (event) => {
            console.log("Starting scheduled balance refresh...");

            try {
                // Get all Plaid items
                const itemsSnapshot = await db.collection("plaidItems").get();

                if (itemsSnapshot.empty) {
                    console.log("No Plaid items found, nothing to refresh.");
                    return null;
                }

                console.log(`Found ${itemsSnapshot.size} Plaid item(s) to refresh.`);

                const client = getPlaidClient(
                    PLAID_CLIENT_ID.value(),
                    PLAID_SECRET.value(),
                    PLAID_ENV.value()
                );

                let successCount = 0;
                let errorCount = 0;

                for (const itemDoc of itemsSnapshot.docs) {
                    const itemData = itemDoc.data();
                    const itemId = itemDoc.id;
                    const uid = itemData.uid;

                    try {
                        // Fetch fresh balances from Plaid
                        const balanceResponse = await client.accountsBalanceGet({
                            access_token: itemData.accessToken,
                        });

                        const plaidAccounts = balanceResponse.data.accounts;
                        console.log(`Item ${itemId}: Got ${plaidAccounts.length} account(s) from Plaid.`);

                        // Get user's PennyHelm data from Firestore
                        const userDataDoc = await db.collection("userData").doc(uid).get();
                        if (!userDataDoc.exists) {
                            console.warn(`Item ${itemId}: No userData doc for user ${uid}, skipping.`);
                            continue;
                        }

                        const rawData = userDataDoc.data().data;
                        const userData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

                        let updated = false;

                        for (const pa of plaidAccounts) {
                            // Update matching accounts
                            if (userData.accounts) {
                                const acct = userData.accounts.find(a => a.plaidAccountId === pa.account_id);
                                if (acct) {
                                    acct.balance = pa.balances.current || 0;
                                    if (acct.type === 'property' || acct.type === 'vehicle') {
                                        acct.amountOwed = pa.balances.current || 0;
                                    }
                                    acct.name = pa.official_name || pa.name || acct.name;
                                    updated = true;
                                    continue;
                                }
                            }

                            // Update matching debts
                            if (userData.debts) {
                                const debt = userData.debts.find(d => d.plaidAccountId === pa.account_id);
                                if (debt) {
                                    debt.currentBalance = pa.balances.current || 0;
                                    debt.name = pa.official_name || pa.name || debt.name;
                                    updated = true;
                                }
                            }
                        }

                        // Save updated data back to Firestore
                        if (updated) {
                            // Preserve sharedWithUids/sharedWithEdit arrays
                            const existingDoc = userDataDoc.data();
                            const saveData = {
                                data: JSON.stringify(userData),
                                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            };
                            if (existingDoc.sharedWithUids) saveData.sharedWithUids = existingDoc.sharedWithUids;
                            if (existingDoc.sharedWithEdit) saveData.sharedWithEdit = existingDoc.sharedWithEdit;

                            await db.collection("userData").doc(uid).set(saveData);
                            console.log(`Item ${itemId}: Updated balances for user ${uid}.`);
                        }

                        successCount++;

                    } catch (itemErr) {
                        console.error(`Item ${itemId}: Failed to refresh -`, itemErr.response?.data || itemErr.message);
                        errorCount++;
                    }
                }

                console.log(`Scheduled balance refresh complete. Success: ${successCount}, Errors: ${errorCount}`);
                return null;

            } catch (err) {
                console.error("Scheduled balance refresh error:", err);
                throw err;
            }
        }
    );

    // dailyBalanceSnapshot
    //   Runs every day at 6:00 AM America/New_York
    //   Snapshots each user's balances by type and net worth
    exports.dailyBalanceSnapshot = onSchedule(
        { schedule: "0 6 * * *", timeZone: "America/New_York" },
        async () => {
            const today = new Date();
            const dateKey = today.toISOString().slice(0, 10);

            console.log(`[dailyBalanceSnapshot] Running for ${dateKey}`);

            // Get all user data documents
            const snapshot = await db.collection("userData").get();
            let processed = 0;
            let skipped = 0;

            for (const doc of snapshot.docs) {
                try {
                    const data = doc.data();
                    const accounts = data.accounts || [];

                    // Skip users with no accounts
                    if (accounts.length === 0) {
                        skipped++;
                        continue;
                    }

                    const history = data.balanceHistory || [];

                    // Migrate any old monthly entries
                    for (const h of history) {
                        if (h.month && !h.date) {
                            h.date = h.month + "-01";
                            delete h.month;
                            delete h.snapshotDate;
                        }
                    }

                    // Check if today already has a snapshot
                    if (history.some(h => h.date === dateKey)) {
                        skipped++;
                        continue;
                    }

                    // Sum balances by asset account type
                    let checking = 0, savings = 0, investment = 0;
                    for (const a of accounts) {
                        switch (a.type) {
                            case "checking": checking += (a.balance || 0); break;
                            case "savings": savings += (a.balance || 0); break;
                            case "investment":
                            case "retirement": investment += (a.balance || 0); break;
                        }
                    }

                    // Net worth (matches dashboard calculation)
                    const cashTotal = checking + savings;
                    const propertyEquity = accounts.filter(a => a.type === "property").reduce((s, a) => s + ((a.balance || 0) - (a.amountOwed || 0)), 0);
                    const vehicleEquity = accounts.filter(a => a.type === "vehicle").reduce((s, a) => s + ((a.balance || 0) - (a.amountOwed || 0)), 0);
                    const creditOwed = accounts.filter(a => a.type === "credit").reduce((s, a) => s + (a.balance || 0), 0);
                    const debts = data.debts || [];
                    const unlinkedDebtBalance = debts.filter(d => !d.linkedAccountId).reduce((s, d) => s + (d.currentBalance || 0), 0);
                    const netWorth = cashTotal + investment + propertyEquity + vehicleEquity - creditOwed - unlinkedDebtBalance;

                    const newSnapshot = {
                        date: dateKey,
                        checking,
                        savings,
                        investment,
                        netWorth
                    };

                    history.push(newSnapshot);

                    // Sort and keep last 365 days
                    history.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
                    const trimmed = history.length > 365 ? history.slice(-365) : history;

                    await doc.ref.update({ balanceHistory: trimmed });
                    processed++;
                } catch (err) {
                    console.error(`[dailyBalanceSnapshot] Error for user ${doc.id}:`, err);
                }
            }

            console.log(`[dailyBalanceSnapshot] Done. Processed: ${processed}, Skipped: ${skipped}`);
        }
    );

    // dailyTransactionSync
    //   Runs daily at 7:00 AM PT (15:00 UTC) to sync transactions for all users
    exports.dailyTransactionSync = onSchedule(
        {
            schedule: "0 15 * * *",
            timeZone: "UTC",
            secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV],
        },
        async (event) => {
            console.log("[dailyTransactionSync] Starting...");

            try {
                const itemsSnapshot = await db.collection("plaidItems").get();
                if (itemsSnapshot.empty) {
                    console.log("[dailyTransactionSync] No Plaid items found.");
                    return null;
                }

                const client = getPlaidClient(
                    PLAID_CLIENT_ID.value(),
                    PLAID_SECRET.value(),
                    PLAID_ENV.value()
                );

                const now = new Date();
                const endDate = now.toISOString().slice(0, 10);
                // Fetch last 3 days to catch any missed transactions
                const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

                // Group items by user
                const userItems = {};
                for (const itemDoc of itemsSnapshot.docs) {
                    const data = itemDoc.data();
                    if (!userItems[data.uid]) userItems[data.uid] = [];
                    userItems[data.uid].push({ id: itemDoc.id, ...data });
                }

                let usersProcessed = 0;
                let totalImported = 0;

                for (const [uid, items] of Object.entries(userItems)) {
                    try {
                        // Get user's existing expenses
                        const userDataDoc = await db.collection("userData").doc(uid).get();
                        if (!userDataDoc.exists) continue;

                        const rawData = userDataDoc.data().data;
                        const userData = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
                        if (!userData.expenses) userData.expenses = [];

                        // Build set of existing Plaid transaction IDs for dedup
                        const existingTxnIds = new Set();
                        userData.expenses.forEach(e => {
                            if (e.plaidTransactionId) existingTxnIds.add(e.plaidTransactionId);
                        });

                        let userImported = 0;

                        for (const item of items) {
                            try {
                                const response = await client.transactionsGet({
                                    access_token: item.accessToken,
                                    start_date: startDate,
                                    end_date: endDate,
                                    options: { count: 500, offset: 0 },
                                });

                                const transactions = response.data.transactions || [];

                                for (const txn of transactions) {
                                    if (txn.amount <= 0) continue;
                                    if (txn.pending) continue;
                                    if (existingTxnIds.has(txn.transaction_id)) continue;

                                    const expense = {
                                        id: crypto.randomUUID(),
                                        name: txn.merchant_name || txn.name || "Unknown",
                                        amount: Math.abs(txn.amount),
                                        category: mapPlaidCategory(txn.personal_finance_category),
                                        date: txn.date,
                                        vendor: txn.merchant_name || "",
                                        notes: "",
                                        createdDate: new Date().toISOString(),
                                        expenseType: "personal",
                                        businessName: null,
                                        plaidTransactionId: txn.transaction_id,
                                        plaidAccountId: txn.account_id,
                                        source: "plaid",
                                    };

                                    userData.expenses.push(expense);
                                    existingTxnIds.add(txn.transaction_id);
                                    userImported++;
                                }
                            } catch (itemErr) {
                                console.error(`[dailyTransactionSync] Item ${item.id} error:`, itemErr.response?.data || itemErr.message);
                            }
                        }

                        if (userImported > 0) {
                            userData.lastTransactionSync = new Date().toISOString();
                            const existingDoc = userDataDoc.data();
                            const saveData = {
                                data: JSON.stringify(userData),
                                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            };
                            if (existingDoc.sharedWithUids) saveData.sharedWithUids = existingDoc.sharedWithUids;
                            if (existingDoc.sharedWithEdit) saveData.sharedWithEdit = existingDoc.sharedWithEdit;
                            await db.collection("userData").doc(uid).set(saveData);
                            totalImported += userImported;
                        }

                        usersProcessed++;
                    } catch (userErr) {
                        console.error(`[dailyTransactionSync] User ${uid} error:`, userErr);
                    }
                }

                console.log(`[dailyTransactionSync] Done. Users: ${usersProcessed}, Imported: ${totalImported}`);
                return null;
            } catch (err) {
                console.error("[dailyTransactionSync] Fatal error:", err);
                throw err;
            }
        }
    );

    // ─────────────────────────────────────────────
    // ADMIN UTILITY FUNCTIONS
    // ─────────────────────────────────────────────

    // fixUserDocument (Admin only)
    //   One-time utility to fix incomplete user documents
    //   Adds missing subscription fields while preserving existing data
    exports.fixUserDocument = onCall(
        async (request) => {
            // Only allow admin users
            if (!request.auth || request.auth.token.admin !== true) {
                throw new HttpsError("permission-denied", "Admin access required.");
            }

            const { uid, email, subscriptionStatus, trialStartDate, createdAt } = request.data || {};

            if (!uid || !email) {
                throw new HttpsError("invalid-argument", "Missing uid or email.");
            }

            try {
                const userRef = db.collection("users").doc(uid);
                const docSnap = await userRef.get();

                if (!docSnap.exists) {
                    throw new HttpsError("not-found", `User document ${uid} does not exist.`);
                }

                const existingData = docSnap.data();
                console.log(`Fixing user ${uid}, existing fields:`, Object.keys(existingData));

                // Merge new fields with existing data
                const updateData = {
                    email: email,
                    subscriptionStatus: subscriptionStatus || 'trial',
                    trialStartDate: trialStartDate ? new Date(trialStartDate) : new Date(),
                    createdAt: createdAt ? new Date(createdAt) : new Date()
                };

                await userRef.set(updateData, { merge: true });

                // Verify the update
                const updatedDoc = await userRef.get();
                console.log(`User ${uid} updated, new fields:`, Object.keys(updatedDoc.data()));

                return {
                    success: true,
                    message: `User ${uid} updated successfully`,
                    fields: Object.keys(updatedDoc.data())
                };

            } catch (err) {
                console.error("fixUserDocument error:", err);
                if (err instanceof HttpsError) throw err;
                throw new HttpsError("internal", "Failed to fix user document.");
            }
        }
    );

    // fixAllIncompleteUsers (Admin only)
    //   Scans all users documents and adds missing subscription fields
    exports.fixAllIncompleteUsers = onCall(
        async (request) => {
            // Only allow admin users
            if (!request.auth || request.auth.token.admin !== true) {
                throw new HttpsError("permission-denied", "Admin access required.");
            }

            try {
                const usersSnapshot = await db.collection("users").get();
                const fixedUsers = [];
                const alreadyCompleteUsers = [];

                for (const userDoc of usersSnapshot.docs) {
                    const uid = userDoc.id;
                    const data = userDoc.data();

                    // Check if missing required subscription fields
                    if (!data.subscriptionStatus || !data.trialStartDate || !data.createdAt) {
                        console.log(`Fixing incomplete user: ${uid}`);

                        const updateData = {};
                        if (!data.email && data.mobilePasswordSet) {
                            // Try to get email from Firebase Auth
                            try {
                                const authUser = await admin.auth().getUser(uid);
                                updateData.email = authUser.email || '';
                            } catch (e) {
                                updateData.email = '';
                            }
                        }
                        if (!data.subscriptionStatus) {
                            updateData.subscriptionStatus = 'trial';
                        }
                        if (!data.trialStartDate) {
                            // Use createdAt if available, otherwise mobileCredentialsCreatedAt, otherwise now
                            updateData.trialStartDate = data.createdAt || data.mobileCredentialsCreatedAt || admin.firestore.FieldValue.serverTimestamp();
                        }
                        if (!data.createdAt) {
                            updateData.createdAt = data.mobileCredentialsCreatedAt || admin.firestore.FieldValue.serverTimestamp();
                        }

                        await db.collection("users").doc(uid).set(updateData, { merge: true });
                        fixedUsers.push(uid);
                    } else {
                        alreadyCompleteUsers.push(uid);
                    }
                }

                return {
                    success: true,
                    message: `Fixed ${fixedUsers.length} users, ${alreadyCompleteUsers.length} were already complete`,
                    fixedUsers,
                    alreadyCompleteUsers
                };

            } catch (err) {
                console.error("fixAllIncompleteUsers error:", err);
                throw new HttpsError("internal", "Failed to fix users.");
            }
        }
    );

    // ─────────────────────────────────────────────
    // CALLABLE TRANSACTION FUNCTIONS
    // ─────────────────────────────────────────────

    // syncTransactions
    //   Fetches recent transactions from Plaid for all connected items
    //   and returns them for client-side import as expenses.
    exports.syncTransactions = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const uid = request.auth.uid;
            const startDate = request.data?.start_date || null;
            const endDate = request.data?.end_date || null;

            // Get all Plaid items for this user
            const itemsSnapshot = await db.collection("plaidItems")
                .where("uid", "==", uid)
                .get();

            if (itemsSnapshot.empty) {
                return { transactions: [], message: "No connected accounts." };
            }

            const client = getPlaidClient(
                PLAID_CLIENT_ID.value(),
                PLAID_SECRET.value(),
                PLAID_ENV.value()
            );

            // Default: last 30 days
            const now = new Date();
            const end = endDate || now.toISOString().slice(0, 10);
            const start = startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

            const allTransactions = [];
            let errors = 0;

            for (const itemDoc of itemsSnapshot.docs) {
                const itemData = itemDoc.data();
                try {
                    let pageTransactions = [];

                    const response = await client.transactionsGet({
                        access_token: itemData.accessToken,
                        start_date: start,
                        end_date: end,
                        options: { count: 500, offset: 0 },
                    });

                    pageTransactions = response.data.transactions || [];
                    const total = response.data.total_transactions;

                    // Paginate if needed
                    while (pageTransactions.length < total) {
                        const nextResponse = await client.transactionsGet({
                            access_token: itemData.accessToken,
                            start_date: start,
                            end_date: end,
                            options: { count: 500, offset: pageTransactions.length },
                        });
                        pageTransactions = pageTransactions.concat(nextResponse.data.transactions || []);
                    }

                    // Map to PennyHelm format -- only include spending (positive amounts)
                    // Plaid: positive = money spent (debit), negative = money received (credit/refund)
                    for (const txn of pageTransactions) {
                        if (txn.amount <= 0) continue; // Skip income/refunds
                        if (txn.pending) continue; // Skip pending transactions

                        allTransactions.push({
                            plaidTransactionId: txn.transaction_id,
                            plaidAccountId: txn.account_id,
                            name: txn.merchant_name || txn.name || "Unknown",
                            merchantName: txn.merchant_name || "",
                            amount: Math.abs(txn.amount),
                            date: txn.date,
                            category: mapPlaidCategory(txn.personal_finance_category),
                            institutionName: itemData.institutionName,
                        });
                    }
                } catch (err) {
                    console.error(`syncTransactions: Error for item ${itemDoc.id}:`, err.response?.data || err.message);
                    errors++;
                }
            }

            return {
                transactions: allTransactions,
                count: allTransactions.length,
                errors,
                startDate: start,
                endDate: end,
            };
        }
    );

    return exports;
};
