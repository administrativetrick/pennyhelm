/**
 * Shared-access gateway (RBAC) — the ONLY data path for partial-view roles.
 *
 * Companion and Advisor never get direct Firestore reads on the owner's
 * userData document (rules block them). Instead they call:
 *
 *   getSharedSnapshot({ ownerUid })  → role-filtered slice of the owner's
 *       data, with budget spent/remaining computed server-side so raw
 *       bills/expenses never leave the server.
 *   listMyShares()                   → who has shared with me (reverse
 *       index, revalidated against the owner's live grants).
 *   sharedUpdateBudget({ ownerUid, budgets }) → replace the owner's budget
 *       configs; requires canEditBudgets (companion/advisor toggle) or
 *       partner/full role.
 *
 * The grant source of truth is the owner's JSON blob (sharedWith entries);
 * the root-level sharedRoles map mirrors it for Firestore rules.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const sharedAccess = require("./shared/shared-access-model.cjs");

module.exports = function({ admin, db, enforceRateLimit }) {
    const exports = {};

    async function loadOwnerData(ownerUid) {
        const doc = await db.collection("userData").doc(ownerUid).get();
        if (!doc.exists) throw new HttpsError("not-found", "No shared data found.");
        const raw = doc.data().data;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }

    function grantFor(userData, uid) {
        const entry = (userData.sharedWith || []).find(s => s && s.uid === uid);
        if (!entry) return null;
        return sharedAccess.deriveSharedRoles([entry])[uid] || null;
    }

    // getSharedSnapshot — role-filtered view of an owner's data.
    exports.getSharedSnapshot = onCall(async (request) => {
        if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
        const { ownerUid } = request.data || {};
        if (!ownerUid || typeof ownerUid !== 'string') {
            throw new HttpsError("invalid-argument", "Missing ownerUid.");
        }
        await enforceRateLimit({
            db, request, name: 'getSharedSnapshot', limit: 120, windowSec: 3600,
            message: 'Too many refreshes — try again shortly.',
        });

        const userData = await loadOwnerData(ownerUid);
        const grant = grantFor(userData, request.auth.uid);
        if (!grant) throw new HttpsError("permission-denied", "You don't have access to these finances.");

        const snapshot = sharedAccess.filterDataForRole(userData, grant);
        if (!snapshot) throw new HttpsError("permission-denied", "Invalid access grant.");
        return { success: true, snapshot };
    });

    // listMyShares — reverse-index lookup, revalidated against live grants
    // so a revoked share disappears immediately even if the index is stale.
    exports.listMyShares = onCall(async (request) => {
        if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
        const uid = request.auth.uid;

        const idx = await db.collection("shares").where("shareeUid", "==", uid).get();
        const shares = [];
        for (const doc of idx.docs) {
            const { ownerUid, ownerName } = doc.data();
            try {
                const userData = await loadOwnerData(ownerUid);
                const grant = grantFor(userData, uid);
                if (grant) {
                    shares.push({
                        ownerUid,
                        ownerName: userData.userName || ownerName || 'Someone',
                        role: grant.role,
                        canEditBudgets: sharedAccess.canEditBudgets(grant),
                    });
                } else {
                    // Stale index entry (revoked) — clean it up.
                    await doc.ref.delete();
                }
            } catch (e) {
                // Owner doc missing — skip quietly.
            }
        }
        return { success: true, shares };
    });

    // sharedUpdateBudget — the one write partial-view roles may perform.
    exports.sharedUpdateBudget = onCall(async (request) => {
        if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
        const { ownerUid, budgets } = request.data || {};
        if (!ownerUid || typeof ownerUid !== 'string' || !Array.isArray(budgets) || budgets.length > 100) {
            throw new HttpsError("invalid-argument", "Expected ownerUid and a budgets array.");
        }
        await enforceRateLimit({
            db, request, name: 'sharedUpdateBudget', limit: 60, windowSec: 3600,
            message: 'Too many budget updates — try again shortly.',
        });

        const ownerRef = db.collection("userData").doc(ownerUid);
        await db.runTransaction(async (tx) => {
            const doc = await tx.get(ownerRef);
            if (!doc.exists) throw new HttpsError("not-found", "No shared data found.");
            const raw = doc.data().data;
            const userData = typeof raw === 'string' ? JSON.parse(raw) : raw;

            const grant = grantFor(userData, request.auth.uid);
            if (!grant || !sharedAccess.canEditBudgets(grant)) {
                throw new HttpsError("permission-denied", "You don't have permission to change budgets.");
            }

            // Validate every budget shape server-side (mirrors validateBudget).
            const budgetService = require("./shared/budget-service.cjs");
            for (const b of budgets) {
                const err = budgetService.validateBudget(b);
                if (err) throw new HttpsError("invalid-argument", `Invalid budget: ${err}`);
            }

            userData.budgets = budgets.map(b => ({
                id: String(b.id || ''),
                ...(b.tag ? { tag: String(b.tag) } : { category: String(b.category) }),
                monthlyAmount: Number(b.monthlyAmount),
                rollover: b.rollover === true,
                startMonth: String(b.startMonth),
                notes: typeof b.notes === 'string' ? b.notes.slice(0, 500) : undefined,
            }));

            tx.set(ownerRef, {
                data: JSON.stringify(userData),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { mergeFields: ['data', 'updatedAt'] });
        });

        return { success: true };
    });

    return exports;
};
