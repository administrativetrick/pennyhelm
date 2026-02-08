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
            await db.collection("users").doc(uid).set({
                mobilePasswordSet: true,
                mobilePasswordHash: passwordHash,
                requirePasswordChange: true,
                mobileCredentialsCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
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
