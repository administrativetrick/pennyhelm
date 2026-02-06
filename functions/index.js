const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

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

function getPlaidClient(clientId, secret, env) {
    const configuration = new Configuration({
        basePath: PlaidEnvironments[env] || PlaidEnvironments.development,
        baseOptions: {
            headers: {
                "PLAID-CLIENT-ID": clientId,
                "PLAID-SECRET": secret,
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
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const email = request.auth.token.email;

        if (!email) {
            throw new HttpsError("failed-precondition", "No email associated with account.");
        }

        // Check if already set up
        const userDoc = await db.collection("users").doc(uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        if (userData.mobilePasswordSet && !request.data?.resend) {
            return { success: true, alreadySet: true };
        }

        try {
            // Generate a secure temporary password
            const tempPassword = generateSecurePassword();

            // Link email/password credential to the user's account
            // Note: This is done client-side, we just generate the password here
            // and the client will call linkWithCredential

            // Hash the password for verification storage (NOT the actual password)
            const passwordHash = hashPassword(tempPassword);

            // Update Firestore - store hash and flag for password change requirement
            await db.collection("users").doc(uid).set({
                mobilePasswordSet: true,
                mobilePasswordHash: passwordHash,
                requirePasswordChange: true,
                mobileCredentialsCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            // Send email with temporary password
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

            // Update Firestore
            await db.collection("users").doc(uid).update({
                mobilePasswordHash: passwordHash,
                requirePasswordChange: true,
                mobilePasswordResetAt: admin.firestore.FieldValue.serverTimestamp(),
            });

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
            const response = await client.linkTokenCreate({
                user: { client_user_id: uid },
                client_name: "PennyHelm",
                products: ["transactions"],
                country_codes: ["US"],
                language: "en",
            });

            return { link_token: response.data.link_token };
        } catch (err) {
            console.error("createLinkToken error:", err.response?.data || err.message);
            throw new HttpsError("internal", "Failed to create link token.");
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

            const accounts = accountsResponse.data.accounts.map((acct) => ({
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
            }));

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

            const accounts = balanceResponse.data.accounts.map((acct) => ({
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
            }));

            return { itemId, accounts };
        } catch (err) {
            console.error("refreshBalances error:", err.response?.data || err.message);
            throw new HttpsError("internal", "Failed to refresh balances.");
        }
    }
);
