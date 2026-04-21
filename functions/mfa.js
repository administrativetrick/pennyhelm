const { onCall, HttpsError } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { TOTP, Secret } = require("otpauth");

module.exports = function({ admin, db, secrets, enforceRateLimit }) {
    const { MFA_ENCRYPTION_KEY } = secrets;
    const exports = {};

    // ─────────────────────────────────────────────────────────────────────────
    // Encryption helpers
    // ─────────────────────────────────────────────────────────────────────────

    // AES-256-GCM encryption for TOTP secrets
    function encryptMFA(text) {
        const key = Buffer.from(MFA_ENCRYPTION_KEY.value(), 'hex');
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return { iv: iv.toString('hex'), encrypted, authTag };
    }

    // AES-256-GCM decryption for TOTP secrets
    function decryptMFA(encData) {
        const key = Buffer.from(MFA_ENCRYPTION_KEY.value(), 'hex');
        const iv = Buffer.from(encData.iv, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(Buffer.from(encData.authTag, 'hex'));
        let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // Generate 10 recovery codes (8-char alphanumeric each, no I/O/0/1 for clarity)
    function generateRecoveryCodes() {
        const codes = [];
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

    // Hash a recovery code for storage (SHA-256)
    function hashRecoveryCode(code) {
        return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cloud Functions
    // ─────────────────────────────────────────────────────────────────────────

    // setupMFA
    //     Generates TOTP secret + recovery codes, stores in pending subcollection
    exports.setupMFA = onCall(
        { secrets: [MFA_ENCRYPTION_KEY] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            // Guard against repeated setup spam (each call writes a pending doc).
            await enforceRateLimit({
                db, request, name: 'setupMFA', limit: 5, windowSec: 300,
            });

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

    // verifyMFASetup
    //     Verifies the TOTP code to confirm setup, then activates MFA
    exports.verifyMFASetup = onCall(
        { secrets: [MFA_ENCRYPTION_KEY] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            // Same brute-force profile as login.
            await enforceRateLimit({
                db, request, name: 'verifyMFASetup', limit: 10, windowSec: 60,
                message: 'Too many MFA attempts. Try again in a minute.',
            });

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

                // Move pending -> active config
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

    // verifyMFALogin
    //     Verifies a TOTP code or recovery code during login
    exports.verifyMFALogin = onCall(
        { secrets: [MFA_ENCRYPTION_KEY] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            // Brute-force guard: 10 attempts/min is generous for a legit typo-prone
            // user, miles below what's needed to enumerate a 6-digit TOTP.
            await enforceRateLimit({
                db, request, name: 'verifyMFALogin', limit: 10, windowSec: 60,
                message: 'Too many MFA attempts. Try again in a minute.',
            });

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

    // disableMFA
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

    // cancelMFASetup
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

    return exports;
};
