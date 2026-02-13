const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const Stripe = require("stripe");
const { TOTP, Secret } = require("otpauth");

admin.initializeApp();
const db = admin.firestore();

// Define secrets (set via: firebase functions:secrets:set PLAID_CLIENT_ID, etc.)
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const PLAID_ENV = defineSecret("PLAID_ENV");

// Email secrets (set via: firebase functions:secrets:set SMTP_HOST, etc.)
const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_PORT = defineSecret("SMTP_PORT");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const SMTP_FROM = defineSecret("SMTP_FROM");

// Stripe secrets (set via: firebase functions:secrets:set STRIPE_SECRET_KEY, etc.)
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// MFA secrets (set via: firebase functions:secrets:set MFA_ENCRYPTION_KEY)
// Must be a 64-character hex string (32 bytes)
const MFA_ENCRYPTION_KEY = defineSecret("MFA_ENCRYPTION_KEY");
// Price IDs set after creating products in Stripe Dashboard
const STRIPE_ANNUAL_PRICE_ID = defineSecret("STRIPE_ANNUAL_PRICE_ID");
const STRIPE_MONTHLY_PRICE_ID = defineSecret("STRIPE_MONTHLY_PRICE_ID");
const STRIPE_FIRST_YEAR_COUPON_ID = defineSecret("STRIPE_FIRST_YEAR_COUPON_ID");

function getPlaidClient(clientId, secret, env) {
    // Trim secrets to remove any trailing newlines/whitespace from secret manager
    const cleanId = clientId.trim();
    const cleanSecret = secret.trim();
    const cleanEnv = env.trim();
    const configuration = new Configuration({
        basePath: PlaidEnvironments[cleanEnv] || PlaidEnvironments.production,
        baseOptions: {
            headers: {
                "PLAID-CLIENT-ID": cleanId,
                "PLAID-SECRET": cleanSecret,
            },
        },
    });
    return new PlaidApi(configuration);
}

// Helper to create email transporter
function getEmailTransporter() {
    return nodemailer.createTransport({
        host: SMTP_HOST.value(),
        port: parseInt(SMTP_PORT.value()) || 587,
        secure: parseInt(SMTP_PORT.value()) === 465,
        auth: {
            user: SMTP_USER.value(),
            pass: SMTP_PASS.value(),
        },
    });
}

// Helper to generate a secure random password
function generateSecurePassword() {
    // Generate a random 12-character password with mixed case, numbers, and symbols
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    const randomBytes = crypto.randomBytes(12);
    for (let i = 0; i < 12; i++) {
        password += chars[randomBytes[i] % chars.length];
    }
    return password;
}

// Helper to hash password for storage (we only store hash, never plaintext)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// ─────────────────────────────────────────────
// MOBILE AUTH FUNCTIONS
// ─────────────────────────────────────────────

// 4. setupMobileCredentials
//    Called after Google sign-in to create email/password credentials
//    and send the temporary password via email
exports.setupMobileCredentials = onCall(
    { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
    async (request) => {
        console.log("setupMobileCredentials called");

        if (!request.auth) {
            console.error("No auth context");
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const email = request.auth.token.email;
        console.log("User:", uid, "Email:", email);

        if (!email) {
            console.error("No email associated with account");
            throw new HttpsError("failed-precondition", "No email associated with account.");
        }

        // Check if already set up
        const userDoc = await db.collection("users").doc(uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        console.log("User data exists:", userDoc.exists, "mobilePasswordSet:", userData.mobilePasswordSet);

        if (userData.mobilePasswordSet && !request.data?.resend) {
            console.log("Already set up, returning");
            return { success: true, alreadySet: true };
        }

        try {
            // Generate a secure temporary password
            const tempPassword = generateSecurePassword();
            console.log("Generated temp password");

            // Set the password in Firebase Auth using Admin SDK
            // This creates the email/password provider for the user
            await admin.auth().updateUser(uid, {
                password: tempPassword,
            });
            console.log("Firebase Auth password set for user:", uid);

            // Hash the password for verification storage (NOT the actual password)
            const passwordHash = hashPassword(tempPassword);

            // Update Firestore - store hash and flag for password change requirement
            const updateData = {
                email: email,
                mobilePasswordSet: true,
                mobilePasswordHash: passwordHash,
                requirePasswordChange: true,
                mobileCredentialsCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            // Add subscription fields if they don't exist (fixes mobile-first signups)
            if (!userData.subscriptionStatus) {
                updateData.subscriptionStatus = 'trial';
            }
            if (!userData.trialStartDate) {
                updateData.trialStartDate = admin.firestore.FieldValue.serverTimestamp();
            }
            if (!userData.createdAt) {
                updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            }

            await db.collection("users").doc(uid).set(updateData, { merge: true });
            console.log("Firestore updated");

            // Send email with temporary password
            console.log("Creating email transporter with host:", SMTP_HOST.value(), "port:", SMTP_PORT.value());
            const transporter = getEmailTransporter();

            await transporter.sendMail({
                from: SMTP_FROM.value(),
                to: email,
                subject: "Your PennyHelm Mobile App Credentials",
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <h1 style="color: #4f8cff; margin: 0;">PennyHelm</h1>
                            <p style="color: #666; margin: 5px 0 0 0;">Navigate Your Finances</p>
                        </div>

                        <h2 style="color: #333;">Your Mobile App Login Credentials</h2>

                        <p>Use these credentials to sign in to the PennyHelm mobile app:</p>

                        <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
                            <p style="margin: 0 0 10px 0;"><strong>Email:</strong> ${email}</p>
                            <p style="margin: 0;"><strong>Temporary Password:</strong> <code style="background: #e0e0e0; padding: 2px 6px; border-radius: 4px;">${tempPassword}</code></p>
                        </div>

                        <p style="color: #d32f2f; font-weight: 600;">
                            Important: You will be required to change this password on your first mobile login.
                        </p>

                        <p style="color: #666; font-size: 14px;">
                            This is a temporary password generated for your account. For security reasons,
                            please change it immediately when you first sign in to the mobile app.
                        </p>

                        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                        <p style="color: #999; font-size: 12px; text-align: center;">
                            If you did not request this, please ignore this email or contact support.
                        </p>
                    </div>
                `,
                text: `
PennyHelm Mobile App Login Credentials

Use these credentials to sign in to the PennyHelm mobile app:

Email: ${email}
Temporary Password: ${tempPassword}

IMPORTANT: You will be required to change this password on your first mobile login.

This is a temporary password generated for your account. For security reasons,
please change it immediately when you first sign in to the mobile app.

If you did not request this, please ignore this email or contact support.
                `,
            });
            console.log("Email sent successfully to:", email);

            // Return the temp password to the client so it can link the credential
            // This is the ONLY time the password is transmitted
            return {
                success: true,
                tempPassword: tempPassword,
                message: "Credentials sent to your email"
            };

        } catch (err) {
            console.error("setupMobileCredentials error:", err);
            throw new HttpsError("internal", "Failed to set up mobile credentials.");
        }
    }
);

// 5. resendMobilePassword
//    Resend a new temporary password for users who lost theirs
exports.resendMobilePassword = onCall(
    { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const email = request.auth.token.email;

        if (!email) {
            throw new HttpsError("failed-precondition", "No email associated with account.");
        }

        try {
            // Generate a new temporary password
            const tempPassword = generateSecurePassword();
            const passwordHash = hashPassword(tempPassword);

            // Update the user's password in Firebase Auth
            // This allows them to sign in with email/password
            await admin.auth().updateUser(uid, {
                password: tempPassword,
            });
            console.log("Firebase Auth password updated for user:", uid);

            // Update Firestore
            await db.collection("users").doc(uid).set({
                mobilePasswordSet: true,
                mobilePasswordHash: passwordHash,
                requirePasswordChange: true,
                mobilePasswordResetAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            // Send email
            const transporter = getEmailTransporter();

            await transporter.sendMail({
                from: SMTP_FROM.value(),
                to: email,
                subject: "Your New PennyHelm Mobile App Password",
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <h1 style="color: #4f8cff; margin: 0;">PennyHelm</h1>
                            <p style="color: #666; margin: 5px 0 0 0;">Navigate Your Finances</p>
                        </div>

                        <h2 style="color: #333;">Your New Mobile App Password</h2>

                        <p>A new temporary password has been generated for your mobile app:</p>

                        <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
                            <p style="margin: 0 0 10px 0;"><strong>Email:</strong> ${email}</p>
                            <p style="margin: 0;"><strong>New Temporary Password:</strong> <code style="background: #e0e0e0; padding: 2px 6px; border-radius: 4px;">${tempPassword}</code></p>
                        </div>

                        <p style="color: #d32f2f; font-weight: 600;">
                            You will be required to change this password on your next mobile login.
                        </p>

                        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                        <p style="color: #999; font-size: 12px; text-align: center;">
                            If you did not request this, please secure your account immediately.
                        </p>
                    </div>
                `,
            });

            // Return the temp password so the client can update the credential
            return {
                success: true,
                tempPassword: tempPassword,
                message: "New password sent to your email"
            };

        } catch (err) {
            console.error("resendMobilePassword error:", err);
            throw new HttpsError("internal", "Failed to reset mobile password.");
        }
    }
);

// DEBUG: Check user's password change status
exports.debugCheckPasswordStatus = onCall(
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const email = request.auth.token.email;
        const setFlag = request.data?.setFlag;

        try {
            const userDoc = await db.collection("users").doc(uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            // If setFlag is true, set requirePasswordChange to true
            if (setFlag === true) {
                await db.collection("users").doc(uid).set({
                    requirePasswordChange: true,
                }, { merge: true });
                return {
                    uid,
                    email,
                    message: "Flag set to true",
                    requirePasswordChange: true,
                    mobilePasswordSet: userData.mobilePasswordSet,
                };
            }

            return {
                uid,
                email,
                requirePasswordChange: userData.requirePasswordChange,
                mobilePasswordSet: userData.mobilePasswordSet,
                mobilePasswordResetAt: userData.mobilePasswordResetAt,
                mobileCredentialsCreatedAt: userData.mobileCredentialsCreatedAt,
            };
        } catch (err) {
            console.error("debugCheckPasswordStatus error:", err);
            throw new HttpsError("internal", "Failed to check status.");
        }
    }
);

// 6. confirmPasswordChanged
//    Called after user changes their mobile password
exports.confirmPasswordChanged = onCall(
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;

        try {
            // Clear the requirePasswordChange flag
            await db.collection("users").doc(uid).update({
                requirePasswordChange: false,
                passwordChangedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            return { success: true };
        } catch (err) {
            console.error("confirmPasswordChanged error:", err);
            throw new HttpsError("internal", "Failed to confirm password change.");
        }
    }
);

// ─────────────────────────────────────────────
// PLAID FUNCTIONS
// ─────────────────────────────────────────────

// 1. createLinkToken
//    Called by client to get a link_token for Plaid Link
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

// ─────────────────────────────────────────────
// INVITE & SHARING FUNCTIONS
// ─────────────────────────────────────────────

// Helper to get invite type display name
function getInviteTypeLabel(type) {
    const labels = {
        'partner': 'Partner/Spouse',
        'financial-planner': 'Financial Planner',
        'cpa': 'CPA/Accountant'
    };
    return labels[type] || type;
}

// 7. sendInvite
//    Creates an invite record in Firestore and sends an email to the invitee
exports.sendInvite = onCall(
    { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const inviterEmail = request.auth.token.email;
        const { email, type, permissions } = request.data || {};

        if (!email || !type || !permissions) {
            throw new HttpsError("invalid-argument", "Missing email, type, or permissions.");
        }

        // Validate type
        const validTypes = ['partner', 'financial-planner', 'cpa'];
        if (!validTypes.includes(type)) {
            throw new HttpsError("invalid-argument", "Invalid invite type.");
        }

        // Validate permissions
        const validPermissions = ['view', 'edit'];
        if (!validPermissions.includes(permissions)) {
            throw new HttpsError("invalid-argument", "Invalid permissions.");
        }

        // Get inviter's name from their user profile
        const userDoc = await db.collection("users").doc(uid).get();
        const inviterName = userDoc.exists && userDoc.data().displayName
            ? userDoc.data().displayName
            : inviterEmail;

        try {
            // Create invite document in Firestore
            const inviteId = crypto.randomUUID();
            const inviteData = {
                id: inviteId,
                inviterUid: uid,
                inviterEmail: inviterEmail,
                inviterName: inviterName,
                inviteeEmail: email.toLowerCase(),
                type: type,
                permissions: permissions,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };

            await db.collection("invites").doc(inviteId).set(inviteData);

            // Add to invitesByEmail for easy lookup when invitee logs in
            await db.collection("invitesByEmail").doc(email.toLowerCase()).set({
                invites: admin.firestore.FieldValue.arrayUnion(inviteId)
            }, { merge: true });

            // Build the invite link
            const inviteLink = `https://pennyhelm.com/accept-invite?id=${inviteId}`;

            // Send email
            const transporter = getEmailTransporter();
            const permissionText = permissions === 'edit' ? 'view and edit' : 'view';
            const typeLabel = getInviteTypeLabel(type);

            await transporter.sendMail({
                from: SMTP_FROM.value(),
                to: email,
                subject: `${inviterName} invited you to share their PennyHelm finances`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <h1 style="color: #4f8cff; margin: 0;">PennyHelm</h1>
                            <p style="color: #666; margin: 5px 0 0 0;">Navigate Your Finances</p>
                        </div>

                        <h2 style="color: #333;">You've Been Invited!</h2>

                        <p><strong>${inviterName}</strong> has invited you to ${permissionText} their financial information on PennyHelm as their <strong>${typeLabel}</strong>.</p>

                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${inviteLink}" style="display: inline-block; background: #4f8cff; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
                                Accept Invitation
                            </a>
                        </div>

                        <p style="color: #666; font-size: 14px;">
                            By accepting this invitation, you'll be able to ${permissionText} ${inviterName}'s financial data including bills, accounts, and budgets.
                        </p>

                        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                        <p style="color: #999; font-size: 12px; text-align: center;">
                            If you don't recognize ${inviterName} or didn't expect this invitation, you can safely ignore this email.
                        </p>
                    </div>
                `,
                text: `
${inviterName} invited you to share their PennyHelm finances

You've been invited to ${permissionText} their financial information as their ${typeLabel}.

Accept the invitation by visiting:
${inviteLink}

If you don't recognize ${inviterName} or didn't expect this invitation, you can safely ignore this email.
                `
            });

            return {
                success: true,
                inviteId: inviteId,
                message: `Invitation sent to ${email}`
            };

        } catch (err) {
            console.error("sendInvite error:", err);
            throw new HttpsError("internal", "Failed to send invitation.");
        }
    }
);

// 8. acceptInvite
//    Called when an invitee accepts an invitation
//    Updates the invite status and adds the invitee to the inviter's sharedWith array
exports.acceptInvite = onCall(
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const inviteeUid = request.auth.uid;
        const inviteeEmail = request.auth.token.email;
        const { inviteId } = request.data || {};

        if (!inviteId) {
            throw new HttpsError("invalid-argument", "Missing inviteId.");
        }

        try {
            // Get the invite
            const inviteDoc = await db.collection("invites").doc(inviteId).get();
            if (!inviteDoc.exists) {
                throw new HttpsError("not-found", "Invitation not found.");
            }

            const invite = inviteDoc.data();

            // Verify the invite is for this user
            if (invite.inviteeEmail.toLowerCase() !== inviteeEmail.toLowerCase()) {
                throw new HttpsError("permission-denied", "This invitation is not for you.");
            }

            // Check invite status
            if (invite.status !== 'pending') {
                throw new HttpsError("failed-precondition", `Invitation has already been ${invite.status}.`);
            }

            // Update invite status
            await db.collection("invites").doc(inviteId).update({
                status: 'accepted',
                acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
                inviteeUid: inviteeUid
            });

            // Get inviter's userData document and add invitee to sharedWith
            const inviterDataDoc = await db.collection("userData").doc(invite.inviterUid).get();

            if (inviterDataDoc.exists) {
                // Parse the stored JSON data
                const rawData = inviterDataDoc.data().data;
                const userData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

                // Initialize sharedWith if needed
                if (!userData.sharedWith) userData.sharedWith = [];

                // Add the invitee if not already present
                const alreadyShared = userData.sharedWith.find(s => s.uid === inviteeUid);
                if (!alreadyShared) {
                    userData.sharedWith.push({
                        uid: inviteeUid,
                        email: inviteeEmail,
                        type: invite.type,
                        permissions: invite.permissions,
                        sharedAt: new Date().toISOString()
                    });

                    // Update inviter's invite in their local data too
                    if (userData.invites) {
                        const localInvite = userData.invites.find(i => i.id === inviteId);
                        if (localInvite) {
                            localInvite.status = 'accepted';
                            localInvite.acceptedAt = new Date().toISOString();
                            localInvite.inviteeUid = inviteeUid;
                        }
                    }

                    // Build sharedWithUids and sharedWithEdit arrays for Firestore security rules
                    // (Rules can't parse JSON, so we maintain these at document root level)
                    const sharedWithUids = userData.sharedWith.map(s => s.uid);
                    const sharedWithEdit = userData.sharedWith
                        .filter(s => s.permissions === 'edit')
                        .map(s => s.uid);

                    // Save back to Firestore with both JSON data and rule-accessible arrays
                    await db.collection("userData").doc(invite.inviterUid).set({
                        data: JSON.stringify(userData),
                        sharedWithUids: sharedWithUids,
                        sharedWithEdit: sharedWithEdit,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }

            return {
                success: true,
                inviterUid: invite.inviterUid,
                inviterName: invite.inviterName,
                type: invite.type,
                permissions: invite.permissions,
                message: `You now have ${invite.permissions} access to ${invite.inviterName}'s finances.`
            };

        } catch (err) {
            console.error("acceptInvite error:", err);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "Failed to accept invitation.");
        }
    }
);

// 9. getMyInvites
//    Returns all pending invites for the current user (by email)
exports.getMyInvites = onCall(
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const email = request.auth.token.email;
        if (!email) {
            throw new HttpsError("failed-precondition", "No email associated with account.");
        }

        try {
            // Query invites by email
            const invitesSnapshot = await db.collection("invites")
                .where("inviteeEmail", "==", email.toLowerCase())
                .where("status", "==", "pending")
                .get();

            const invites = [];
            invitesSnapshot.forEach(doc => {
                const data = doc.data();
                invites.push({
                    id: doc.id,
                    inviterName: data.inviterName,
                    inviterEmail: data.inviterEmail,
                    type: data.type,
                    permissions: data.permissions,
                    createdAt: data.createdAt
                });
            });

            return { invites };

        } catch (err) {
            console.error("getMyInvites error:", err);
            throw new HttpsError("internal", "Failed to get invitations.");
        }
    }
);

// 10. declineInvite
//     Allows an invitee to decline an invitation
exports.declineInvite = onCall(
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const inviteeEmail = request.auth.token.email;
        const { inviteId } = request.data || {};

        if (!inviteId) {
            throw new HttpsError("invalid-argument", "Missing inviteId.");
        }

        try {
            const inviteDoc = await db.collection("invites").doc(inviteId).get();
            if (!inviteDoc.exists) {
                throw new HttpsError("not-found", "Invitation not found.");
            }

            const invite = inviteDoc.data();

            // Verify the invite is for this user
            if (invite.inviteeEmail.toLowerCase() !== inviteeEmail.toLowerCase()) {
                throw new HttpsError("permission-denied", "This invitation is not for you.");
            }

            // Update invite status
            await db.collection("invites").doc(inviteId).update({
                status: 'declined',
                declinedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: true, message: "Invitation declined." };

        } catch (err) {
            console.error("declineInvite error:", err);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "Failed to decline invitation.");
        }
    }
);

// 11. cleanupTelemetry
//     Scheduled function to delete telemetry logs older than 30 days
//     Runs daily at 3:00 AM UTC
exports.cleanupTelemetry = onSchedule(
    {
        schedule: "0 3 * * *", // Daily at 3:00 AM UTC (cron format)
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

// 12. scheduledBalanceRefresh
//     Runs daily at 6:00 AM PT (14:00 UTC) to refresh Plaid balances
//     for all connected items and update user account data in Firestore
exports.scheduledBalanceRefresh = onSchedule(
    {
        schedule: "0 14 * * *", // Daily at 6:00 AM PT (14:00 UTC)
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

// 13. fixUserDocument (Admin only)
//     One-time utility to fix incomplete user documents
//     Adds missing subscription fields while preserving existing data
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

// 13. fixAllIncompleteUsers (Admin only)
//     Scans all users documents and adds missing subscription fields
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
// STRIPE SUBSCRIPTION FUNCTIONS
// ─────────────────────────────────────────────

// Helper to get or create a Stripe customer for a Firebase user
async function getOrCreateStripeCustomer(stripe, uid, email, displayName) {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (userData.stripeCustomerId) {
        return userData.stripeCustomerId;
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({
        email: email,
        name: displayName || undefined,
        metadata: { firebaseUid: uid },
    });

    // Store customer ID in Firestore
    await db.collection("users").doc(uid).set(
        { stripeCustomerId: customer.id },
        { merge: true }
    );

    return customer.id;
}

// 14. createCheckoutSession
//     Creates a Stripe Checkout session for subscription
exports.createCheckoutSession = onCall(
    {
        secrets: [STRIPE_SECRET_KEY, STRIPE_ANNUAL_PRICE_ID, STRIPE_MONTHLY_PRICE_ID, STRIPE_FIRST_YEAR_COUPON_ID],
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const email = request.auth.token.email;
        const plan = request.data?.plan; // 'annual' or 'monthly'

        if (!plan || !['annual', 'monthly'].includes(plan)) {
            throw new HttpsError("invalid-argument", "Plan must be 'annual' or 'monthly'.");
        }

        try {
            const stripe = new Stripe(STRIPE_SECRET_KEY.value());
            const customerId = await getOrCreateStripeCustomer(stripe, uid, email, request.auth.token.name);

            const priceId = plan === 'annual'
                ? STRIPE_ANNUAL_PRICE_ID.value()
                : STRIPE_MONTHLY_PRICE_ID.value();

            const sessionParams = {
                customer: customerId,
                payment_method_types: ["card"],
                mode: "subscription",
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: "https://pennyhelm.com/app#subscription-success",
                cancel_url: "https://pennyhelm.com/app#subscription-cancelled",
                subscription_data: {
                    metadata: { firebaseUid: uid },
                },
                allow_promotion_codes: true,
                metadata: { firebaseUid: uid },
            };

            // Apply first-year coupon for annual plans
            if (plan === 'annual') {
                const couponId = STRIPE_FIRST_YEAR_COUPON_ID.value();
                if (couponId) {
                    sessionParams.discounts = [{ coupon: couponId }];
                    // Can't use both discounts and allow_promotion_codes
                    delete sessionParams.allow_promotion_codes;
                }
            }

            const session = await stripe.checkout.sessions.create(sessionParams);

            return { sessionId: session.id, url: session.url };

        } catch (err) {
            console.error("createCheckoutSession error:", err);
            throw new HttpsError("internal", "Failed to create checkout session.");
        }
    }
);

// 15. createPortalSession
//     Creates a Stripe Customer Portal session for managing subscription
exports.createPortalSession = onCall(
    { secrets: [STRIPE_SECRET_KEY] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const userDoc = await db.collection("users").doc(uid).get();

        if (!userDoc.exists || !userDoc.data().stripeCustomerId) {
            throw new HttpsError("failed-precondition", "No Stripe customer found. Please subscribe first.");
        }

        try {
            const stripe = new Stripe(STRIPE_SECRET_KEY.value());

            const session = await stripe.billingPortal.sessions.create({
                customer: userDoc.data().stripeCustomerId,
                return_url: "https://pennyhelm.com/app#settings",
            });

            return { url: session.url };

        } catch (err) {
            console.error("createPortalSession error:", err);
            throw new HttpsError("internal", "Failed to create portal session.");
        }
    }
);

// 16. stripeWebhook
//     Handles Stripe webhook events (subscription lifecycle)
//     Must be an HTTP endpoint (not callable) for Stripe to POST to
exports.stripeWebhook = onRequest(
    {
        secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
        // Raw body needed for signature verification
        invoker: "public",
    },
    async (req, res) => {
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }

        const stripe = new Stripe(STRIPE_SECRET_KEY.value());
        const sig = req.headers["stripe-signature"];

        let event;
        try {
            event = stripe.webhooks.constructEvent(
                req.rawBody,
                sig,
                STRIPE_WEBHOOK_SECRET.value()
            );
        } catch (err) {
            console.error("Webhook signature verification failed:", err.message);
            res.status(400).send(`Webhook Error: ${err.message}`);
            return;
        }

        console.log(`Stripe webhook received: ${event.type}`);

        try {
            switch (event.type) {
                case "checkout.session.completed": {
                    const session = event.data.object;
                    const uid = session.metadata?.firebaseUid;
                    if (uid && session.subscription) {
                        await db.collection("users").doc(uid).set({
                            subscriptionStatus: "active",
                            stripeSubscriptionId: session.subscription,
                            stripeCustomerId: session.customer,
                            subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }, { merge: true });
                        console.log(`User ${uid} subscription activated.`);
                    }
                    break;
                }

                case "customer.subscription.updated": {
                    const subscription = event.data.object;
                    const uid = subscription.metadata?.firebaseUid;
                    if (uid) {
                        const status = subscription.status === "active" || subscription.status === "trialing"
                            ? "active"
                            : subscription.status === "past_due"
                                ? "past_due"
                                : "expired";
                        await db.collection("users").doc(uid).set({
                            subscriptionStatus: status,
                            subscriptionPeriodEnd: subscription.current_period_end
                                ? new Date(subscription.current_period_end * 1000)
                                : null,
                        }, { merge: true });
                        console.log(`User ${uid} subscription updated to ${status}.`);
                    }
                    break;
                }

                case "customer.subscription.deleted": {
                    const subscription = event.data.object;
                    const uid = subscription.metadata?.firebaseUid;
                    if (uid) {
                        await db.collection("users").doc(uid).set({
                            subscriptionStatus: "expired",
                        }, { merge: true });
                        console.log(`User ${uid} subscription cancelled/expired.`);
                    } else {
                        // Fallback: look up user by stripeCustomerId
                        const customerId = subscription.customer;
                        const userSnapshot = await db.collection("users")
                            .where("stripeCustomerId", "==", customerId)
                            .limit(1).get();
                        if (!userSnapshot.empty) {
                            await userSnapshot.docs[0].ref.set({
                                subscriptionStatus: "expired",
                            }, { merge: true });
                            console.log(`User (by customer) subscription expired.`);
                        }
                    }
                    break;
                }

                case "invoice.payment_failed": {
                    const invoice = event.data.object;
                    const customerId = invoice.customer;
                    const userSnapshot = await db.collection("users")
                        .where("stripeCustomerId", "==", customerId)
                        .limit(1).get();
                    if (!userSnapshot.empty) {
                        await userSnapshot.docs[0].ref.set({
                            subscriptionStatus: "past_due",
                        }, { merge: true });
                        console.log(`Payment failed for customer ${customerId}.`);
                    }
                    break;
                }

                default:
                    console.log(`Unhandled event type: ${event.type}`);
            }

            res.status(200).json({ received: true });

        } catch (err) {
            console.error("Webhook handler error:", err);
            res.status(500).send("Internal error processing webhook.");
        }
    }
);

// ─────────────────────────────────────────────
// MFA (TOTP Two-Factor Authentication) FUNCTIONS
// ─────────────────────────────────────────────

// AES-256-GCM encryption helpers for TOTP secrets
function encryptMFA(text) {
    const key = Buffer.from(MFA_ENCRYPTION_KEY.value(), 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { iv: iv.toString('hex'), encrypted, authTag };
}

function decryptMFA(encData) {
    const key = Buffer.from(MFA_ENCRYPTION_KEY.value(), 'hex');
    const iv = Buffer.from(encData.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encData.authTag, 'hex'));
    let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Generate 10 recovery codes (8-char alphanumeric each)
function generateRecoveryCodes() {
    const codes = [];
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
    for (let i = 0; i < 10; i++) {
        let code = '';
        const bytes = crypto.randomBytes(8);
        for (let j = 0; j < 8; j++) {
            code += chars[bytes[j] % chars.length];
        }
        codes.push(code);
    }
    return codes;
}

// Hash a recovery code for storage
function hashRecoveryCode(code) {
    return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
}

// 17. setupMFA
//     Generates TOTP secret + recovery codes, stores in pending subcollection
exports.setupMFA = onCall(
    { secrets: [MFA_ENCRYPTION_KEY] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const email = request.auth.token.email || 'user';

        try {
            // Generate a random TOTP secret
            const secret = new Secret({ size: 20 });

            // Create TOTP instance for URI generation
            const totp = new TOTP({
                issuer: 'PennyHelm',
                label: email,
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                secret: secret,
            });

            const otpauthUri = totp.toString();
            const secretBase32 = secret.base32;

            // Generate recovery codes
            const recoveryCodes = generateRecoveryCodes();
            const hashedRecoveryCodes = recoveryCodes.map(code => ({
                hash: hashRecoveryCode(code),
                used: false,
            }));

            // Encrypt the secret for storage
            const encryptedSecret = encryptMFA(secretBase32);

            // Store in pending subcollection (not active yet until verified)
            await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("pending").set({
                    encryptedSecret: encryptedSecret,
                    recoveryCodes: hashedRecoveryCodes,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

            return {
                secret: secretBase32,
                otpauthUri: otpauthUri,
                recoveryCodes: recoveryCodes,
            };

        } catch (err) {
            console.error("setupMFA error:", err);
            throw new HttpsError("internal", "Failed to set up MFA.");
        }
    }
);

// 18. verifyMFASetup
//     Verifies the TOTP code to confirm setup, then activates MFA
exports.verifyMFASetup = onCall(
    { secrets: [MFA_ENCRYPTION_KEY] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const code = request.data?.code;

        if (!code || typeof code !== 'string' || code.length !== 6) {
            throw new HttpsError("invalid-argument", "Must provide a 6-digit code.");
        }

        try {
            // Read the pending secret
            const pendingDoc = await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("pending").get();

            if (!pendingDoc.exists) {
                throw new HttpsError("not-found", "No pending MFA setup found. Start setup first.");
            }

            const pendingData = pendingDoc.data();
            const secretBase32 = decryptMFA(pendingData.encryptedSecret);

            // Verify the TOTP code
            const totp = new TOTP({
                issuer: 'PennyHelm',
                label: request.auth.token.email || 'user',
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                secret: Secret.fromBase32(secretBase32),
            });

            const delta = totp.validate({ token: code, window: 1 });

            if (delta === null) {
                throw new HttpsError("invalid-argument", "Invalid code. Please try again.");
            }

            // Move pending → active config
            await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("config").set({
                    encryptedSecret: pendingData.encryptedSecret,
                    recoveryCodes: pendingData.recoveryCodes,
                    enabledAt: admin.firestore.FieldValue.serverTimestamp(),
                });

            // Delete pending
            await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("pending").delete();

            // Set mfaEnabled flag on user doc
            await db.collection("users").doc(uid).set({
                mfaEnabled: true,
            }, { merge: true });

            return { success: true };

        } catch (err) {
            console.error("verifyMFASetup error:", err);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "Failed to verify MFA setup.");
        }
    }
);

// 19. verifyMFALogin
//     Verifies a TOTP code or recovery code during login
exports.verifyMFALogin = onCall(
    { secrets: [MFA_ENCRYPTION_KEY] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const code = request.data?.code;
        const isRecoveryCode = request.data?.isRecoveryCode === true;

        if (!code || typeof code !== 'string') {
            throw new HttpsError("invalid-argument", "Must provide a code.");
        }

        try {
            // Read the active config
            const configDoc = await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("config").get();

            if (!configDoc.exists) {
                throw new HttpsError("not-found", "MFA is not configured.");
            }

            const configData = configDoc.data();

            if (isRecoveryCode) {
                // Verify recovery code
                const codeHash = hashRecoveryCode(code);
                const recoveryEntry = configData.recoveryCodes.find(
                    rc => rc.hash === codeHash && !rc.used
                );

                if (!recoveryEntry) {
                    throw new HttpsError("invalid-argument", "Invalid or already used recovery code.");
                }

                // Mark the recovery code as used
                const updatedCodes = configData.recoveryCodes.map(rc => {
                    if (rc.hash === codeHash && !rc.used) {
                        return { ...rc, used: true };
                    }
                    return rc;
                });

                await db.collection("users").doc(uid)
                    .collection("mfaSecrets").doc("config").update({
                        recoveryCodes: updatedCodes,
                    });

            } else {
                // Verify TOTP code
                if (code.length !== 6) {
                    throw new HttpsError("invalid-argument", "Must provide a 6-digit TOTP code.");
                }

                const secretBase32 = decryptMFA(configData.encryptedSecret);
                const totp = new TOTP({
                    issuer: 'PennyHelm',
                    label: request.auth.token.email || 'user',
                    algorithm: 'SHA1',
                    digits: 6,
                    period: 30,
                    secret: Secret.fromBase32(secretBase32),
                });

                const delta = totp.validate({ token: code, window: 1 });

                if (delta === null) {
                    throw new HttpsError("invalid-argument", "Invalid code. Please try again.");
                }
            }

            // Set lastMFAVerification timestamp
            await db.collection("users").doc(uid).set({
                lastMFAVerification: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            return { success: true };

        } catch (err) {
            console.error("verifyMFALogin error:", err);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "Failed to verify MFA code.");
        }
    }
);

// 20. disableMFA
//     Requires a valid TOTP code to disable MFA (security measure)
exports.disableMFA = onCall(
    { secrets: [MFA_ENCRYPTION_KEY] },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const code = request.data?.code;

        if (!code || typeof code !== 'string' || code.length !== 6) {
            throw new HttpsError("invalid-argument", "Must provide a 6-digit TOTP code to disable MFA.");
        }

        try {
            // Read the active config
            const configDoc = await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("config").get();

            if (!configDoc.exists) {
                throw new HttpsError("not-found", "MFA is not configured.");
            }

            const configData = configDoc.data();
            const secretBase32 = decryptMFA(configData.encryptedSecret);

            // Verify the TOTP code first
            const totp = new TOTP({
                issuer: 'PennyHelm',
                label: request.auth.token.email || 'user',
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                secret: Secret.fromBase32(secretBase32),
            });

            const delta = totp.validate({ token: code, window: 1 });

            if (delta === null) {
                throw new HttpsError("invalid-argument", "Invalid code. MFA was not disabled.");
            }

            // Delete the config document
            await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("config").delete();

            // Also delete any pending setup
            const pendingDoc = await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("pending").get();
            if (pendingDoc.exists) {
                await pendingDoc.ref.delete();
            }

            // Clear the mfaEnabled flag
            await db.collection("users").doc(uid).set({
                mfaEnabled: false,
                lastMFAVerification: admin.firestore.FieldValue.delete(),
            }, { merge: true });

            return { success: true };

        } catch (err) {
            console.error("disableMFA error:", err);
            if (err instanceof HttpsError) throw err;
            throw new HttpsError("internal", "Failed to disable MFA.");
        }
    }
);

// 21. cancelMFASetup
//     Deletes the pending MFA setup (user abandoned enrollment)
exports.cancelMFASetup = onCall(
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;

        try {
            const pendingDoc = await db.collection("users").doc(uid)
                .collection("mfaSecrets").doc("pending").get();

            if (pendingDoc.exists) {
                await pendingDoc.ref.delete();
            }

            return { success: true };

        } catch (err) {
            console.error("cancelMFASetup error:", err);
            throw new HttpsError("internal", "Failed to cancel MFA setup.");
        }
    }
);
