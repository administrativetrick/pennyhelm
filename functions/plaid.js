const { onCall, HttpsError } = require("firebase-functions/v2/https");
const crypto = require("crypto");

module.exports = function({ admin, db, getPlaidClient, secrets }) {
    const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV } = secrets;
    const exports = {};

    // ─────────────────────────────────────────────
    // PLAID INTEGRATION FUNCTIONS
    // ─────────────────────────────────────────────

    // 1a. createLinkToken
    //     Creates a Plaid Link token so the client can open Plaid Link UI.
    exports.createLinkToken = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] },
        async (request) => {
            // Auth check
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const uid = request.auth.uid;
            const client = getPlaidClient(
                PLAID_CLIENT_ID.value(),
                PLAID_SECRET.value(),
                PLAID_ENV.value()
            );

            try {
                const linkConfig = {
                    user: { client_user_id: uid },
                    client_name: "PennyHelm",
                    products: ["transactions"],
                    additional_consented_products: ["liabilities", "investments"],
                    country_codes: ["US"],
                    language: "en",
                };

                // OAuth redirect URI — required for institutions like Chase in production
                const redirectUri = request.data?.redirect_uri;
                if (redirectUri) {
                    linkConfig.redirect_uri = redirectUri;
                }

                const response = await client.linkTokenCreate(linkConfig);

                return { link_token: response.data.link_token };
            } catch (err) {
                console.error("createLinkToken error:", err.response?.data || err.message);
                throw new HttpsError("internal", "Failed to create link token.");
            }
        }
    );

    // 1b. createUpdateLinkToken
    //     Creates a Link token in "update mode" for an existing Plaid item.
    //     Used to collect additional consent (e.g. investments, liabilities)
    //     without requiring the user to fully disconnect/reconnect.
    exports.createUpdateLinkToken = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const uid = request.auth.uid;
            const itemId = request.data?.item_id;

            if (!itemId) {
                throw new HttpsError("invalid-argument", "Missing item_id.");
            }

            // Verify ownership
            const itemDoc = await db.collection("plaidItems").doc(itemId).get();
            if (!itemDoc.exists) {
                throw new HttpsError("not-found", "Plaid item not found.");
            }

            const itemData = itemDoc.data();
            const isAdmin = request.auth.token?.admin === true;
            if (itemData.uid !== uid && !isAdmin) {
                throw new HttpsError("permission-denied", "Not your Plaid item.");
            }

            const client = getPlaidClient(
                PLAID_CLIENT_ID.value(),
                PLAID_SECRET.value(),
                PLAID_ENV.value()
            );

            try {
                const linkConfig = {
                    user: { client_user_id: uid },
                    client_name: "PennyHelm",
                    access_token: itemData.accessToken,
                    additional_consented_products: ["liabilities", "investments"],
                    country_codes: ["US"],
                    language: "en",
                };

                const redirectUri = request.data?.redirect_uri;
                if (redirectUri) {
                    linkConfig.redirect_uri = redirectUri;
                }

                const response = await client.linkTokenCreate(linkConfig);

                return { link_token: response.data.link_token };
            } catch (err) {
                console.error("createUpdateLinkToken error:", err.response?.data || err.message);
                throw new HttpsError("internal", "Failed to create update link token.");
            }
        }
    );

    // 2. exchangePublicToken
    //    Client sends public_token after Plaid Link success.
    //    We exchange it for an access_token, store it securely,
    //    fetch accounts, and return account data (never the access_token).
    exports.exchangePublicToken = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const uid = request.auth.uid;
            const publicToken = request.data?.public_token;
            const institutionName = request.data?.institution_name || "Unknown Bank";
            const institutionId = request.data?.institution_id || null;

            if (!publicToken) {
                throw new HttpsError("invalid-argument", "Missing public_token.");
            }

            const client = getPlaidClient(
                PLAID_CLIENT_ID.value(),
                PLAID_SECRET.value(),
                PLAID_ENV.value()
            );

            try {
                // Exchange public token for access token
                const exchangeResponse = await client.itemPublicTokenExchange({
                    public_token: publicToken,
                });

                const accessToken = exchangeResponse.data.access_token;
                const itemId = exchangeResponse.data.item_id;

                // Store access_token securely in Firestore (client cannot read this)
                await db.collection("plaidItems").doc(itemId).set({
                    accessToken: accessToken,
                    itemId: itemId,
                    uid: uid,
                    institutionName: institutionName,
                    institutionId: institutionId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                // Fetch accounts
                const accountsResponse = await client.accountsGet({
                    access_token: accessToken,
                });

                // Try to fetch liabilities for credit/loan details (min payment, APR, etc.)
                let liabilities = null;
                try {
                    const liabResponse = await client.liabilitiesGet({
                        access_token: accessToken,
                    });
                    liabilities = liabResponse.data.liabilities;
                } catch (liabErr) {
                    // Liabilities may not be available for all institutions — that's OK
                    console.log("Liabilities not available:", liabErr.response?.data?.error_code || liabErr.message);
                }

                // Try to fetch investment holdings
                let investmentHoldings = null;
                let investmentSecurities = null;
                try {
                    const invResponse = await client.investmentsHoldingsGet({
                        access_token: accessToken,
                    });
                    investmentHoldings = invResponse.data.holdings;
                    investmentSecurities = invResponse.data.securities;
                } catch (invErr) {
                    // Investments may not be available for all institutions — that's OK
                    console.log("Investments not available:", invErr.response?.data?.error_code || invErr.message);
                }

                // Build a securities lookup map (security_id → security details)
                const securitiesMap = {};
                if (investmentSecurities) {
                    for (const sec of investmentSecurities) {
                        securitiesMap[sec.security_id] = sec;
                    }
                }

                // Build a map of account_id → holdings array
                const holdingsMap = {};
                if (investmentHoldings) {
                    for (const h of investmentHoldings) {
                        if (!holdingsMap[h.account_id]) holdingsMap[h.account_id] = [];
                        const sec = securitiesMap[h.security_id] || {};
                        holdingsMap[h.account_id].push({
                            securityId: h.security_id,
                            name: sec.name || "Unknown",
                            ticker: sec.ticker_symbol || null,
                            type: sec.type || null, // equity, etf, mutual fund, cash, etc.
                            quantity: h.quantity,
                            price: sec.close_price || null,
                            priceDate: sec.close_price_as_of || null,
                            value: h.institution_value,
                            costBasis: h.cost_basis,
                            // Vested fields: for RSU/grant holdings, institutions sometimes report
                            // the full grant as `quantity` but only the currently-held portion as
                            // `vested_quantity`. When present, the investments page will prefer these.
                            vestedQuantity: h.vested_quantity != null ? h.vested_quantity : null,
                            vestedValue: h.vested_value != null ? h.vested_value : null,
                            isoCurrencyCode: h.iso_currency_code || "USD",
                        });
                    }
                }

                // Build a map of account_id → liability data for easy lookup
                const creditMap = {};
                const mortgageMap = {};
                const studentMap = {};
                if (liabilities) {
                    if (liabilities.credit) {
                        for (const cc of liabilities.credit) {
                            creditMap[cc.account_id] = cc;
                        }
                    }
                    if (liabilities.mortgage) {
                        for (const m of liabilities.mortgage) {
                            mortgageMap[m.account_id] = m;
                        }
                    }
                    if (liabilities.student) {
                        for (const s of liabilities.student) {
                            studentMap[s.account_id] = s;
                        }
                    }
                }

                const accounts = accountsResponse.data.accounts.map((acct) => {
                    const base = {
                        plaidAccountId: acct.account_id,
                        plaidItemId: itemId,
                        name: acct.official_name || acct.name,
                        mask: acct.mask,
                        type: acct.type,
                        subtype: acct.subtype,
                        balanceCurrent: acct.balances.current,
                        balanceAvailable: acct.balances.available,
                        balanceLimit: acct.balances.limit,
                        institutionName: institutionName,
                    };

                    // Enrich with credit card liability data
                    const cc = creditMap[acct.account_id];
                    if (cc) {
                        base.minimumPayment = cc.minimum_payment_amount;
                        base.lastPaymentAmount = cc.last_payment_amount;
                        base.lastPaymentDate = cc.last_payment_date;
                        base.nextPaymentDueDate = cc.next_payment_due_date;
                        base.lastStatementBalance = cc.last_statement_balance;
                        base.isOverdue = cc.is_overdue;
                        // Get the purchase APR (most relevant)
                        const purchaseApr = cc.aprs?.find(a => a.apr_type === "purchase_apr");
                        base.interestRate = purchaseApr ? purchaseApr.apr_percentage : null;
                    }

                    // Enrich with mortgage liability data
                    const mort = mortgageMap[acct.account_id];
                    if (mort) {
                        base.interestRate = mort.interest_rate?.percentage;
                        base.interestRateType = mort.interest_rate?.type; // fixed or variable
                        base.originationDate = mort.origination_date;
                        base.originationPrincipal = mort.origination_principal_amount;
                        base.nextPaymentDueDate = mort.next_payment_due_date;
                        base.nextPaymentAmount = mort.next_monthly_payment;
                        base.lastPaymentDate = mort.last_payment_date;
                        base.lastPaymentAmount = mort.last_payment_amount;
                        base.loanTerm = mort.loan_term;
                        base.maturityDate = mort.maturity_date;
                    }

                    // Enrich with student loan liability data
                    const student = studentMap[acct.account_id];
                    if (student) {
                        base.interestRate = student.interest_rate_percentage;
                        base.minimumPayment = student.minimum_payment_amount;
                        base.nextPaymentDueDate = student.next_payment_due_date;
                        base.lastPaymentDate = student.last_payment_date;
                        base.lastPaymentAmount = student.last_payment_amount;
                        base.originationDate = student.origination_date;
                        base.originationPrincipal = student.origination_principal_amount;
                        base.loanStatus = student.loan_status?.type;
                        base.servicerName = student.servicer_address?.organization;
                    }

                    // Enrich with investment holdings
                    const holdings = holdingsMap[acct.account_id];
                    if (holdings) {
                        base.holdings = holdings;
                    }

                    return base;
                });

                // Server-side fallback: inject accounts into the user's userData
                // using a transaction to prevent race conditions where a concurrent
                // client-side write could overwrite the injected accounts.
                try {
                    const userDataRef = db.collection("userData").doc(uid);
                    await db.runTransaction(async (tx) => {
                        const userDataDoc = await tx.get(userDataRef);
                        if (!userDataDoc.exists) {
                            console.log(`No userData doc for ${uid} yet — client will create it.`);
                            return;
                        }

                        const rawData = userDataDoc.data().data;
                        const userData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

                        if (!userData || typeof userData !== 'object') return;
                        if (!userData.accounts) userData.accounts = [];
                        if (!userData.debts) userData.debts = [];

                        let modified = false;

                        for (const acct of accounts) {
                            let storeType, entity;
                            switch (acct.type) {
                                case 'depository':
                                    storeType = acct.subtype === 'checking' ? 'checking' : 'savings';
                                    entity = 'account';
                                    break;
                                case 'credit':
                                    storeType = 'credit';
                                    entity = 'account';
                                    break;
                                case 'investment':
                                    storeType = 'investment';
                                    entity = 'account';
                                    break;
                                case 'loan':
                                    if (acct.subtype === 'mortgage') {
                                        storeType = 'property';
                                        entity = 'account';
                                    } else {
                                        storeType = acct.subtype === 'student' ? 'student-loan' :
                                                    acct.subtype === 'auto' ? 'auto-loan' : 'personal-loan';
                                        entity = 'debt';
                                    }
                                    break;
                                default:
                                    storeType = 'checking';
                                    entity = 'account';
                            }

                            const existsInAccounts = userData.accounts.some(a => a.plaidAccountId === acct.plaidAccountId);
                            const existsInDebts = userData.debts.some(d => d.plaidAccountId === acct.plaidAccountId);
                            if (existsInAccounts || existsInDebts) continue;

                            if (entity === 'account') {
                                const newAcct = {
                                    id: crypto.randomUUID(),
                                    name: acct.name,
                                    type: storeType,
                                    balance: acct.balanceCurrent || 0,
                                    plaidAccountId: acct.plaidAccountId,
                                    plaidItemId: itemId,
                                    plaidInstitution: institutionName,
                                    plaidMask: acct.mask,
                                    lastUpdated: new Date().toISOString(),
                                };
                                if (storeType === 'property') newAcct.amountOwed = acct.balanceCurrent || 0;
                                if (storeType === 'credit') {
                                    newAcct._interestRate = acct.interestRate || 0;
                                    newAcct._minimumPayment = acct.minimumPayment || 0;
                                }
                                userData.accounts.push(newAcct);
                                modified = true;
                            } else {
                                const newDebt = {
                                    id: crypto.randomUUID(),
                                    name: acct.name,
                                    type: storeType,
                                    currentBalance: acct.balanceCurrent || 0,
                                    originalBalance: acct.originationPrincipal || acct.balanceCurrent || 0,
                                    interestRate: acct.interestRate || 0,
                                    minimumPayment: acct.minimumPayment || 0,
                                    plaidAccountId: acct.plaidAccountId,
                                    plaidItemId: itemId,
                                    plaidInstitution: institutionName,
                                    notes: `Imported from ${institutionName}`,
                                };
                                userData.debts.push(newDebt);
                                modified = true;
                            }
                        }

                        if (modified) {
                            const existingDocData = userDataDoc.data();
                            const saveData = {
                                data: JSON.stringify(userData),
                                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            };
                            if (existingDocData.sharedWithUids) saveData.sharedWithUids = existingDocData.sharedWithUids;
                            if (existingDocData.sharedWithEdit) saveData.sharedWithEdit = existingDocData.sharedWithEdit;
                            tx.set(userDataRef, saveData);
                            console.log(`Server-side: injected Plaid accounts into userData for ${uid}`);
                        }
                    });
                } catch (ssErr) {
                    // Non-fatal: client-side will also try to save
                    console.warn("Server-side account injection failed (non-fatal):", ssErr.message);
                }

                return { itemId, institutionName, accounts };
            } catch (err) {
                console.error("exchangePublicToken error:", err.response?.data || err.message);
                throw new HttpsError("internal", "Failed to exchange token.");
            }
        }
    );

    // 3. refreshBalances
    //    Reads stored access_token, calls Plaid /accounts/balance/get,
    //    returns updated account data.
    exports.refreshBalances = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const uid = request.auth.uid;
            const itemId = request.data?.item_id;

            if (!itemId) {
                throw new HttpsError("invalid-argument", "Missing item_id.");
            }

            // Verify ownership
            const itemDoc = await db.collection("plaidItems").doc(itemId).get();
            if (!itemDoc.exists) {
                throw new HttpsError("not-found", "Plaid item not found.");
            }

            const itemData = itemDoc.data();

            // Allow owner or admin
            const isAdmin = request.auth.token?.admin === true;
            if (itemData.uid !== uid && !isAdmin) {
                throw new HttpsError("permission-denied", "Not your Plaid item.");
            }

            const client = getPlaidClient(
                PLAID_CLIENT_ID.value(),
                PLAID_SECRET.value(),
                PLAID_ENV.value()
            );

            try {
                const balanceResponse = await client.accountsBalanceGet({
                    access_token: itemData.accessToken,
                });

                // Try to fetch liabilities for credit/loan details
                let liabilities = null;
                try {
                    const liabResponse = await client.liabilitiesGet({
                        access_token: itemData.accessToken,
                    });
                    liabilities = liabResponse.data.liabilities;
                } catch (liabErr) {
                    console.log("Liabilities not available on refresh:", liabErr.response?.data?.error_code || liabErr.message);
                }

                // Try to fetch investment holdings
                let investmentHoldings = null;
                let investmentSecurities = null;
                try {
                    const invResponse = await client.investmentsHoldingsGet({
                        access_token: itemData.accessToken,
                    });
                    investmentHoldings = invResponse.data.holdings;
                    investmentSecurities = invResponse.data.securities;
                } catch (invErr) {
                    console.log("Investments not available on refresh:", invErr.response?.data?.error_code || invErr.message);
                }

                // Build securities lookup map
                const securitiesMap = {};
                if (investmentSecurities) {
                    for (const sec of investmentSecurities) {
                        securitiesMap[sec.security_id] = sec;
                    }
                }

                // Build holdings map (account_id → holdings array)
                const holdingsMap = {};
                if (investmentHoldings) {
                    for (const h of investmentHoldings) {
                        if (!holdingsMap[h.account_id]) holdingsMap[h.account_id] = [];
                        const sec = securitiesMap[h.security_id] || {};
                        holdingsMap[h.account_id].push({
                            securityId: h.security_id,
                            name: sec.name || "Unknown",
                            ticker: sec.ticker_symbol || null,
                            type: sec.type || null,
                            quantity: h.quantity,
                            price: sec.close_price || null,
                            priceDate: sec.close_price_as_of || null,
                            value: h.institution_value,
                            costBasis: h.cost_basis,
                            // See exchangePublicToken for rationale — prefer vested_quantity
                            // over quantity when reporting actual held shares (RSU/grant handling).
                            vestedQuantity: h.vested_quantity != null ? h.vested_quantity : null,
                            vestedValue: h.vested_value != null ? h.vested_value : null,
                            isoCurrencyCode: h.iso_currency_code || "USD",
                        });
                    }
                }

                // Build liability lookup maps
                const creditMap = {};
                const mortgageMap = {};
                const studentMap = {};
                if (liabilities) {
                    if (liabilities.credit) {
                        for (const cc of liabilities.credit) {
                            creditMap[cc.account_id] = cc;
                        }
                    }
                    if (liabilities.mortgage) {
                        for (const m of liabilities.mortgage) {
                            mortgageMap[m.account_id] = m;
                        }
                    }
                    if (liabilities.student) {
                        for (const s of liabilities.student) {
                            studentMap[s.account_id] = s;
                        }
                    }
                }

                const accounts = balanceResponse.data.accounts.map((acct) => {
                    const base = {
                        plaidAccountId: acct.account_id,
                        plaidItemId: itemId,
                        name: acct.official_name || acct.name,
                        mask: acct.mask,
                        type: acct.type,
                        subtype: acct.subtype,
                        balanceCurrent: acct.balances.current,
                        balanceAvailable: acct.balances.available,
                        balanceLimit: acct.balances.limit,
                        institutionName: itemData.institutionName,
                    };

                    // Enrich with credit card data
                    const cc = creditMap[acct.account_id];
                    if (cc) {
                        base.minimumPayment = cc.minimum_payment_amount;
                        base.lastPaymentAmount = cc.last_payment_amount;
                        base.lastPaymentDate = cc.last_payment_date;
                        base.nextPaymentDueDate = cc.next_payment_due_date;
                        base.lastStatementBalance = cc.last_statement_balance;
                        base.isOverdue = cc.is_overdue;
                        const purchaseApr = cc.aprs?.find(a => a.apr_type === "purchase_apr");
                        base.interestRate = purchaseApr ? purchaseApr.apr_percentage : null;
                    }

                    // Enrich with mortgage data
                    const mort = mortgageMap[acct.account_id];
                    if (mort) {
                        base.interestRate = mort.interest_rate?.percentage;
                        base.interestRateType = mort.interest_rate?.type;
                        base.nextPaymentDueDate = mort.next_payment_due_date;
                        base.nextPaymentAmount = mort.next_monthly_payment;
                        base.lastPaymentDate = mort.last_payment_date;
                        base.lastPaymentAmount = mort.last_payment_amount;
                    }

                    // Enrich with student loan data
                    const student = studentMap[acct.account_id];
                    if (student) {
                        base.interestRate = student.interest_rate_percentage;
                        base.minimumPayment = student.minimum_payment_amount;
                        base.nextPaymentDueDate = student.next_payment_due_date;
                        base.lastPaymentDate = student.last_payment_date;
                        base.lastPaymentAmount = student.last_payment_amount;
                    }

                    // Enrich with investment holdings
                    const holdings = holdingsMap[acct.account_id];
                    if (holdings) {
                        base.holdings = holdings;
                    }

                    return base;
                });

                return { itemId, accounts };
            } catch (err) {
                console.error("refreshBalances error:", err.response?.data || err.message);
                throw new HttpsError("internal", "Failed to refresh balances.");
            }
        }
    );

    // 3a. getRecurringTransactions
    //     Calls Plaid's /transactions/recurring/get for one item and returns the
    //     detected outflow + inflow streams so the UI can offer one-click import
    //     into the Bills / Income pages. Requires the Recurring Transactions
    //     add-on to be enabled on the Plaid dashboard (it is).
    //
    //     We keep this as its own call (not folded into refreshBalances) because:
    //       - It's on-demand only — users click "Detect bills from bank", not
    //         every refresh — so it doesn't burn API quota on silent syncs.
    //       - It can be called independently of Balance, which is important now
    //         that Balance is capped on Limited Production.
    exports.getRecurringTransactions = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const uid = request.auth.uid;
            const itemId = request.data?.item_id;
            if (!itemId) {
                throw new HttpsError("invalid-argument", "Missing item_id.");
            }

            // Verify ownership (same pattern as refreshBalances)
            const itemDoc = await db.collection("plaidItems").doc(itemId).get();
            if (!itemDoc.exists) {
                throw new HttpsError("not-found", "Plaid item not found.");
            }
            const itemData = itemDoc.data();
            const isAdmin = request.auth.token?.admin === true;
            if (itemData.uid !== uid && !isAdmin) {
                throw new HttpsError("permission-denied", "Not your Plaid item.");
            }

            const client = getPlaidClient(
                PLAID_CLIENT_ID.value(),
                PLAID_SECRET.value(),
                PLAID_ENV.value()
            );

            try {
                const response = await client.transactionsRecurringGet({
                    access_token: itemData.accessToken,
                });

                // Flatten and normalize. Plaid uses negative amounts for outflows
                // and positive for inflows — we keep the sign semantics via the
                // `direction` field and always return a positive `amount` so the
                // UI doesn't have to deal with signs.
                const normalize = (stream, direction) => ({
                    streamId: stream.stream_id,
                    direction, // 'outflow' (bills) | 'inflow' (income)
                    merchantName: stream.merchant_name || stream.description || "Unknown",
                    description: stream.description || null,
                    category: Array.isArray(stream.category) ? stream.category : [],
                    personalFinanceCategory: stream.personal_finance_category?.primary || null,
                    personalFinanceCategoryDetailed: stream.personal_finance_category?.detailed || null,
                    frequency: stream.frequency || "UNKNOWN",
                    firstDate: stream.first_date || null,
                    lastDate: stream.last_date || null,
                    predictedNextDate: stream.predicted_next_date || null,
                    averageAmount: Math.abs(Number(stream.average_amount?.amount) || 0),
                    lastAmount: Math.abs(Number(stream.last_amount?.amount) || 0),
                    isoCurrencyCode: stream.average_amount?.iso_currency_code || "USD",
                    accountId: stream.account_id || null,
                    isActive: !!stream.is_active,
                    status: stream.status || "UNKNOWN",
                    transactionIds: Array.isArray(stream.transaction_ids) ? stream.transaction_ids : [],
                });

                const outflows = (response.data.outflow_streams || []).map(s => normalize(s, "outflow"));
                const inflows = (response.data.inflow_streams || []).map(s => normalize(s, "inflow"));

                return {
                    itemId,
                    outflows,
                    inflows,
                    updatedAt: response.data.updated_datetime || new Date().toISOString(),
                };
            } catch (err) {
                const errCode = err.response?.data?.error_code;
                console.error("getRecurringTransactions error:", err.response?.data || err.message);
                // Surface CREDITS_EXHAUSTED / rate-limit errors verbatim so the
                // client can show a useful message instead of a generic failure.
                if (errCode === "CREDITS_EXHAUSTED" || errCode === "RATE_LIMIT_EXCEEDED") {
                    throw new HttpsError("resource-exhausted", "Plaid quota exhausted — request full Production access.");
                }
                if (errCode === "ITEM_LOGIN_REQUIRED") {
                    throw new HttpsError("failed-precondition", "Bank needs re-authentication.");
                }
                if (errCode === "PRODUCT_NOT_READY") {
                    // Recurring Transactions takes 1-2 minutes to become available
                    // after initial link while Plaid builds the stream history.
                    throw new HttpsError("unavailable", "Recurring detection still warming up — try again in a minute.");
                }
                throw new HttpsError("internal", "Failed to fetch recurring transactions.");
            }
        }
    );

    // 4. repairPlaidAccounts
    //    Admin-only function that finds orphaned Plaid items (items in plaidItems
    //    collection that have no corresponding accounts in the user's userData)
    //    and injects them. Fixes the case where the client-side save failed after
    //    a successful Plaid Link connection.
    exports.repairPlaidAccounts = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const isAdmin = request.auth.token?.admin === true;
            if (!isAdmin) {
                throw new HttpsError("permission-denied", "Admin only.");
            }

            const targetUid = request.data?.uid || null;
            const client = getPlaidClient(
                PLAID_CLIENT_ID.value(),
                PLAID_SECRET.value(),
                PLAID_ENV.value()
            );

            // Get Plaid items (optionally filtered by UID)
            let itemsQuery = db.collection("plaidItems");
            if (targetUid) {
                itemsQuery = itemsQuery.where("uid", "==", targetUid);
            }
            const itemsSnapshot = await itemsQuery.get();

            if (itemsSnapshot.empty) {
                return { repaired: 0, message: "No Plaid items found." };
            }

            // Group by UID
            const itemsByUid = {};
            itemsSnapshot.forEach(doc => {
                const data = doc.data();
                if (!itemsByUid[data.uid]) itemsByUid[data.uid] = [];
                itemsByUid[data.uid].push({ docId: doc.id, ...data });
            });

            let totalRepaired = 0;
            const details = [];

            for (const [uid, items] of Object.entries(itemsByUid)) {
                const userDataRef = db.collection("userData").doc(uid);
                const userDataDoc = await userDataRef.get();

                if (!userDataDoc.exists) {
                    details.push({ uid, status: "no_userData_doc" });
                    continue;
                }

                const rawData = userDataDoc.data().data;
                const userData = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
                if (!userData.accounts) userData.accounts = [];
                if (!userData.debts) userData.debts = [];

                let modified = false;

                for (const item of items) {
                    // Check if any accounts/debts reference this Plaid item
                    const hasAccounts = userData.accounts.some(a => a.plaidItemId === item.itemId);
                    const hasDebts = userData.debts.some(d => d.plaidItemId === item.itemId);

                    if (hasAccounts || hasDebts) continue; // already linked

                    // Fetch current accounts from Plaid
                    try {
                        const accountsResponse = await client.accountsGet({
                            access_token: item.accessToken,
                        });

                        for (const acct of accountsResponse.data.accounts) {
                            // Determine PennyHelm entity type
                            let storeType, entity;
                            switch (acct.type) {
                                case "depository":
                                    storeType = acct.subtype === "checking" ? "checking" : "savings";
                                    entity = "account";
                                    break;
                                case "credit":
                                    storeType = "credit";
                                    entity = "account";
                                    break;
                                case "investment":
                                    storeType = "investment";
                                    entity = "account";
                                    break;
                                case "loan":
                                    if (acct.subtype === "mortgage") {
                                        storeType = "property";
                                        entity = "account";
                                    } else {
                                        storeType = acct.subtype === "student" ? "student-loan" :
                                                    acct.subtype === "auto" ? "auto-loan" : "personal-loan";
                                        entity = "debt";
                                    }
                                    break;
                                default:
                                    storeType = "checking";
                                    entity = "account";
                            }

                            // Skip if already exists by plaidAccountId
                            if (userData.accounts.some(a => a.plaidAccountId === acct.account_id)) continue;
                            if (userData.debts.some(d => d.plaidAccountId === acct.account_id)) continue;

                            if (entity === "account") {
                                userData.accounts.push({
                                    id: crypto.randomUUID(),
                                    name: acct.official_name || acct.name,
                                    type: storeType,
                                    balance: acct.balances.current || 0,
                                    plaidAccountId: acct.account_id,
                                    plaidItemId: item.itemId,
                                    plaidInstitution: item.institutionName,
                                    plaidMask: acct.mask,
                                    lastUpdated: new Date().toISOString(),
                                });
                                modified = true;
                            } else {
                                userData.debts.push({
                                    id: crypto.randomUUID(),
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
                                });
                                modified = true;
                            }
                        }

                        if (modified) {
                            totalRepaired++;
                            details.push({ uid, itemId: item.itemId, institution: item.institutionName, status: "repaired" });
                        }
                    } catch (plaidErr) {
                        details.push({ uid, itemId: item.itemId, status: "plaid_error", error: plaidErr.message });
                    }
                }

                if (modified) {
                    // Use a transaction to avoid overwriting concurrent changes
                    await db.runTransaction(async (tx) => {
                        const freshDoc = await tx.get(userDataRef);
                        const freshRaw = freshDoc.data()?.data;
                        const freshData = typeof freshRaw === "string" ? JSON.parse(freshRaw) : freshRaw;
                        if (!freshData.accounts) freshData.accounts = [];
                        if (!freshData.debts) freshData.debts = [];

                        // Merge: only add accounts/debts that don't already exist
                        for (const acct of userData.accounts) {
                            if (acct.plaidAccountId && !freshData.accounts.some(a => a.plaidAccountId === acct.plaidAccountId)) {
                                freshData.accounts.push(acct);
                            }
                        }
                        for (const debt of userData.debts) {
                            if (debt.plaidAccountId && !freshData.debts.some(d => d.plaidAccountId === debt.plaidAccountId)) {
                                freshData.debts.push(debt);
                            }
                        }

                        const saveData = {
                            data: JSON.stringify(freshData),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        };
                        const existingDocData = freshDoc.data();
                        if (existingDocData.sharedWithUids) saveData.sharedWithUids = existingDocData.sharedWithUids;
                        if (existingDocData.sharedWithEdit) saveData.sharedWithEdit = existingDocData.sharedWithEdit;
                        tx.set(userDataRef, saveData);
                    });
                }
            }

            return { repaired: totalRepaired, details };
        }
    );

    return exports;
};
