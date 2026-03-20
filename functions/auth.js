const { onCall, HttpsError } = require("firebase-functions/v2/https");

module.exports = function({ admin, db, getPlaidClient, getEmailTransporter, generateSecurePassword, hashPassword, secrets }) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, STRIPE_SECRET_KEY } = secrets;

    const exports = {};

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

    // createTestUser
    //   Admin-only: creates a Firebase Auth user + Firestore docs for a test user
    exports.createTestUser = onCall(
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }
            if (request.auth.token.admin !== true) {
                throw new HttpsError("permission-denied", "Admin access required.");
            }

            const { displayName, email, subscriptionStatus } = request.data || {};
            if (!displayName) {
                throw new HttpsError("invalid-argument", "Display name is required.");
            }

            const crypto = require("crypto");
            const testUid = "test-" + crypto.randomBytes(4).toString("hex");
            const testEmail = email || testUid + "@pennyhelm.test";
            const tempPassword = generateSecurePassword();
            const passwordHash = hashPassword(tempPassword);

            try {
                // Create Firebase Auth user with custom UID
                await admin.auth().createUser({
                    uid: testUid,
                    email: testEmail,
                    password: tempPassword,
                    displayName: displayName,
                });
                console.log("Created Firebase Auth user:", testUid);

                // Create Firestore user profile
                await db.collection("users").doc(testUid).set({
                    email: testEmail,
                    displayName: displayName,
                    trialStartDate: admin.firestore.FieldValue.serverTimestamp(),
                    subscriptionStatus: subscriptionStatus || "trial",
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    isTestUser: true,
                    createdByAdmin: true,
                    mobilePasswordSet: true,
                    mobilePasswordHash: passwordHash,
                    requirePasswordChange: true,
                });

                // Create empty userData doc
                await db.collection("userData").doc(testUid).set({
                    data: JSON.stringify({
                        userName: displayName,
                        bills: [],
                        dependentBills: [],
                        accounts: [],
                        debts: [],
                        paymentSources: ["Checking Account", "Credit Card"],
                        setupComplete: false,
                    }),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                console.log("Test user created:", testUid, testEmail);
                return { success: true, uid: testUid, email: testEmail, tempPassword: tempPassword };
            } catch (err) {
                console.error("createTestUser error:", err);
                throw new HttpsError("internal", "Failed to create test user: " + err.message);
            }
        }
    );

    // deleteAccount
    //   Permanently deletes the authenticated user's account and all associated data
    exports.deleteAccount = onCall(
        { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, STRIPE_SECRET_KEY] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const uid = request.auth.uid;
            console.log("deleteAccount called for user:", uid);

            // 1. Read user doc for Stripe info
            const userDoc = await db.collection("users").doc(uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            // 2. Cancel Stripe subscription (best-effort)
            if (userData.stripeSubscriptionId) {
                try {
                    const stripe = require("stripe")(STRIPE_SECRET_KEY.value());
                    await stripe.subscriptions.cancel(userData.stripeSubscriptionId);
                    console.log("Stripe subscription cancelled:", userData.stripeSubscriptionId);
                } catch (err) {
                    console.warn("Stripe cancellation failed (non-fatal):", err.message);
                }
            }

            // 3. Revoke Plaid items (best-effort)
            try {
                const plaidSnap = await db.collection("plaidItems").where("uid", "==", uid).get();
                if (!plaidSnap.empty) {
                    const client = getPlaidClient(PLAID_CLIENT_ID.value(), PLAID_SECRET.value(), PLAID_ENV.value());
                    for (const doc of plaidSnap.docs) {
                        try {
                            await client.itemRemove({ access_token: doc.data().accessToken });
                            console.log("Plaid item revoked:", doc.id);
                        } catch (err) {
                            console.warn(`Plaid itemRemove failed for ${doc.id} (non-fatal):`, err.message);
                        }
                        await doc.ref.delete();
                    }
                }
            } catch (err) {
                console.warn("Plaid cleanup failed (non-fatal):", err.message);
            }

            // 4. Delete MFA subcollection
            try {
                const mfaSnap = await db.collection("users").doc(uid).collection("mfaSecrets").get();
                if (!mfaSnap.empty) {
                    const batch = db.batch();
                    mfaSnap.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    console.log("MFA secrets deleted");
                }
            } catch (err) {
                console.warn("MFA cleanup failed (non-fatal):", err.message);
            }

            // 5. Delete invites sent by this user
            try {
                const invSnap = await db.collection("invites").where("inviterUid", "==", uid).get();
                if (!invSnap.empty) {
                    const batch = db.batch();
                    invSnap.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    console.log("Invites deleted:", invSnap.size);
                }
            } catch (err) {
                console.warn("Invites cleanup failed (non-fatal):", err.message);
            }

            // 6. Delete registration codes owned by this user
            try {
                const regSnap = await db.collection("registrationCodes").where("ownerUid", "==", uid).get();
                if (!regSnap.empty) {
                    const batch = db.batch();
                    regSnap.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    console.log("Registration codes deleted:", regSnap.size);
                }
            } catch (err) {
                console.warn("Registration codes cleanup failed (non-fatal):", err.message);
            }

            // 7. Delete API keys
            try {
                const apiKeySnap = await db.collection("apiKeys").where("uid", "==", uid).get();
                if (!apiKeySnap.empty) {
                    const batch = db.batch();
                    apiKeySnap.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    console.log("API keys deleted:", apiKeySnap.size);
                }
            } catch (err) {
                console.warn("API keys cleanup failed (non-fatal):", err.message);
            }

            // 8. Delete userData document
            await db.collection("userData").doc(uid).delete();
            console.log("userData deleted");

            // 9. Delete users document
            await db.collection("users").doc(uid).delete();
            console.log("users doc deleted");

            // 10. Delete Firebase Auth account (must be last)
            await admin.auth().deleteUser(uid);
            console.log("Firebase Auth account deleted:", uid);

            return { success: true };
        }
    );

    // resetTestUserPassword
    //   Admin-only: generates a new temporary password for a test user
    exports.resetTestUserPassword = onCall(
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }
            if (request.auth.token.admin !== true) {
                throw new HttpsError("permission-denied", "Admin access required.");
            }

            const { uid } = request.data || {};
            if (!uid) {
                throw new HttpsError("invalid-argument", "User UID is required.");
            }

            // Verify this is actually a test user
            const userDoc = await db.collection("users").doc(uid).get();
            if (!userDoc.exists || !userDoc.data().isTestUser) {
                throw new HttpsError("not-found", "Test user not found.");
            }

            try {
                const tempPassword = generateSecurePassword();
                const passwordHash = hashPassword(tempPassword);

                // Update Firebase Auth password
                await admin.auth().updateUser(uid, { password: tempPassword });
                console.log("Password reset for test user:", uid);

                // Update Firestore flags
                await db.collection("users").doc(uid).set({
                    mobilePasswordSet: true,
                    mobilePasswordHash: passwordHash,
                    requirePasswordChange: true,
                    mobilePasswordResetAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });

                return { success: true, tempPassword: tempPassword };
            } catch (err) {
                console.error("resetTestUserPassword error:", err);
                throw new HttpsError("internal", "Failed to reset password: " + err.message);
            }
        }
    );

    return exports;
};
