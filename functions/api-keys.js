const { onCall, HttpsError } = require("firebase-functions/v2/https");
const crypto = require("crypto");

/**
 * API Key Management — Cloud Functions
 *
 * API keys are stored in Firestore `apiKeys` collection. Only the SHA-256 hash
 * is persisted; the raw key is returned exactly once at creation time.
 *
 * Key format: ph_live_<32 random hex chars>
 */

const KEY_PREFIX = "ph_live_";
const MAX_KEYS_PER_USER = 5;

module.exports = function ({ admin, db, hashPassword }) {
    const exports = {};

    function generateApiKey() {
        return KEY_PREFIX + crypto.randomBytes(32).toString("hex");
    }

    // ─── createApiKey ────────────────────────────────────────────
    // Returns the raw key ONCE. After this, only the prefix is visible.
    exports.createApiKey = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const { name } = request.data || {};

        if (!name || typeof name !== "string" || name.trim().length === 0) {
            throw new HttpsError("invalid-argument", "API key name is required.");
        }
        if (name.trim().length > 64) {
            throw new HttpsError("invalid-argument", "Name must be 64 characters or fewer.");
        }

        // Enforce per-user limit
        const existing = await db.collection("apiKeys")
            .where("uid", "==", uid)
            .where("status", "==", "active")
            .get();

        if (existing.size >= MAX_KEYS_PER_USER) {
            throw new HttpsError(
                "resource-exhausted",
                `Maximum of ${MAX_KEYS_PER_USER} active API keys allowed. Revoke an existing key first.`
            );
        }

        const rawKey = generateApiKey();
        const keyHash = hashPassword(rawKey); // SHA-256
        const keyPrefix = rawKey.substring(0, 16); // "ph_live_" + first 8 hex chars

        const docRef = db.collection("apiKeys").doc();

        await docRef.set({
            uid,
            name: name.trim(),
            keyHash,
            keyPrefix,
            status: "active",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUsedAt: null,
        });

        console.log("API key created for user:", uid, "keyId:", docRef.id);

        return {
            success: true,
            apiKey: rawKey,
            keyId: docRef.id,
            name: name.trim(),
            keyPrefix,
            message: "Copy your API key now. It will not be shown again.",
        };
    });

    // ─── listApiKeys ─────────────────────────────────────────────
    // Returns metadata only (prefix, name, dates) — never the full key.
    exports.listApiKeys = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;

        const snapshot = await db.collection("apiKeys")
            .where("uid", "==", uid)
            .orderBy("createdAt", "desc")
            .get();

        const keys = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                keyId: doc.id,
                name: data.name,
                keyPrefix: data.keyPrefix,
                status: data.status,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                lastUsedAt: data.lastUsedAt?.toDate?.()?.toISOString() || null,
            };
        });

        return { success: true, keys };
    });

    // ─── revokeApiKey ────────────────────────────────────────────
    exports.revokeApiKey = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const { keyId } = request.data || {};

        if (!keyId) {
            throw new HttpsError("invalid-argument", "Key ID is required.");
        }

        const docRef = db.collection("apiKeys").doc(keyId);
        const doc = await docRef.get();

        if (!doc.exists || doc.data().uid !== uid) {
            throw new HttpsError("not-found", "API key not found.");
        }

        if (doc.data().status === "revoked") {
            throw new HttpsError("failed-precondition", "Key is already revoked.");
        }

        await docRef.update({
            status: "revoked",
            revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("API key revoked:", keyId, "user:", uid);

        return { success: true, message: "API key revoked." };
    });

    // ─── validateApiKey (internal helper, not exported as cloud fn) ──
    // Used by the API HTTP endpoints to authenticate requests.
    exports._validateApiKey = async function (rawKey) {
        if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
            return null;
        }

        const keyHash = hashPassword(rawKey);

        const snapshot = await db.collection("apiKeys")
            .where("keyHash", "==", keyHash)
            .where("status", "==", "active")
            .limit(1)
            .get();

        if (snapshot.empty) {
            return null;
        }

        const doc = snapshot.docs[0];
        const data = doc.data();

        // Update last used timestamp (fire-and-forget)
        doc.ref.update({
            lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        return { uid: data.uid, keyId: doc.id, name: data.name };
    };

    return exports;
};
