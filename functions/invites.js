const { onCall, HttpsError } = require("firebase-functions/v2/https");
const crypto = require("crypto");

module.exports = function({ admin, db, getEmailTransporter, secrets, enforceRateLimit }) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = secrets;
    const exports = {};

    // ─────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────

    function getInviteTypeLabel(type) {
        const labels = {
            'partner': 'Partner/Spouse',
            'financial-planner': 'Financial Planner',
            'cpa': 'CPA/Accountant'
        };
        return labels[type] || type;
    }

    // Generate a random code: prefix + 7 random chars (no I/O/0/1 to avoid confusion)
    function generateCode() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = crypto.randomBytes(7);
        let code = "";
        for (let i = 0; i < 7; i++) {
            code += chars[bytes[i] % chars.length];
        }
        return code;
    }

    // ─────────────────────────────────────────────
    // INVITE / SHARING FUNCTIONS
    // ─────────────────────────────────────────────

    // sendInvite
    //   Creates an invite record in Firestore and sends an email to the invitee
    exports.sendInvite = onCall(
        { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            // Sends an email — the attractive vector for abuse is using your
            // verified SMTP sender to phish via forwarded invite copy.
            await enforceRateLimit({
                db, request, name: 'sendInvite', limit: 10, windowSec: 3600,
                message: 'You can send up to 10 invites per hour.',
            });

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

    // acceptInvite
    //   Called when an invitee accepts an invitation
    //   Updates the invite status and adds the invitee to the inviter's sharedWith array
    exports.acceptInvite = onCall(
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            // Guessing a valid inviteId is infeasible, but rate-limit anyway.
            await enforceRateLimit({
                db, request, name: 'acceptInvite', limit: 20, windowSec: 3600,
            });

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

    // getMyInvites
    //   Returns all pending invites for the current user (by email)
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

    // declineInvite
    //   Allows an invitee to decline an invitation
    exports.declineInvite = onCall(
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            await enforceRateLimit({
                db, request, name: 'declineInvite', limit: 20, windowSec: 3600,
            });

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

    // ─────────────────────────────────────────────
    // REFERRAL TRACKING
    // ─────────────────────────────────────────────

    // Tiered reward structure. Each threshold is how many *paid* referrals the
    // user needs; totalMonths is the cumulative free subscription they've
    // earned across all tiers up to and including this one. The per-tier
    // reward is totalMonths minus whatever prior tiers have already granted.
    //
    //   1 paid  → 1 month total           (tier 1 grants 1 month)
    //   3 paid  → 3 months total          (tier 3 grants +2 months)
    //   5 paid  → 6 months total          (tier 5 grants +3 months)
    //  10 paid  → 12 months total         (tier 10 grants +6 months)
    const REFERRAL_TIERS = [
        { threshold: 1,  totalMonths: 1  },
        { threshold: 3,  totalMonths: 3  },
        { threshold: 5,  totalMonths: 6  },
        { threshold: 10, totalMonths: 12 },
    ];

    /**
     * Credit the referrer's Stripe customer balance by (months × monthly price).
     * Stripe automatically applies customer balance to subsequent invoices, so
     * this cleanly stacks across tiers without the single-coupon-per-subscription
     * limitation. Returns the credit amount in cents that was applied, or null
     * if the referrer has no active subscription to credit against.
     */
    async function creditReferrerMonths(stripe, referrerData, months, tier) {
        const stripeCustomerId = referrerData.stripeCustomerId;
        const stripeSubId = referrerData.stripeSubscriptionId;
        if (!stripeCustomerId || !stripeSubId) return null;

        // Retrieve the subscription's current price so the credit matches
        // whatever plan they're on (monthly vs yearly, different tiers, etc.).
        const sub = await stripe.subscriptions.retrieve(stripeSubId, {
            expand: ['items.data.price'],
        });
        const price = sub.items && sub.items.data && sub.items.data[0]
            ? sub.items.data[0].price
            : null;
        if (!price || !price.unit_amount) {
            throw new Error('Could not determine subscription price for referral credit');
        }

        // If the subscription is billed yearly, unit_amount is the yearly
        // price — prorate per month so "1 free month" means 1/12th of the
        // yearly cost, not a full yearly refund.
        const interval = price.recurring && price.recurring.interval;
        const intervalCount = (price.recurring && price.recurring.interval_count) || 1;
        let perMonthCents = price.unit_amount;
        if (interval === 'year') perMonthCents = Math.round(price.unit_amount / (12 * intervalCount));
        else if (interval === 'week') perMonthCents = Math.round(price.unit_amount * 4 / intervalCount);
        else if (interval === 'day') perMonthCents = Math.round(price.unit_amount * 30 / intervalCount);
        else perMonthCents = Math.round(price.unit_amount / intervalCount); // month

        const creditCents = perMonthCents * months;
        if (creditCents <= 0) return null;

        await stripe.customers.createBalanceTransaction(stripeCustomerId, {
            amount: -creditCents, // negative = credit toward future invoices
            currency: price.currency || 'usd',
            description: `PennyHelm referral tier ${tier.threshold}: ${months} free month${months === 1 ? '' : 's'}`,
        });

        return creditCents;
    }

    /**
     * Called internally (not exported as a Cloud Function) from the Stripe
     * webhook when a subscription becomes active. Looks up the subscriber's
     * referredBy code, finds the referrer, increments their paidReferralCount,
     * and applies any newly-unlocked tier rewards (1/3/5/10).
     */
    async function trackPaidReferral(subscriberUid, stripe) {
        const subscriberDoc = await db.collection("users").doc(subscriberUid).get();
        if (!subscriberDoc.exists) return;
        const referredBy = subscriberDoc.data().referredBy;
        if (!referredBy) return;

        // Find the referrer by their referral code
        const referrerSnap = await db.collection("users")
            .where("referralCode", "==", referredBy)
            .limit(1)
            .get();
        if (referrerSnap.empty) {
            console.warn(`Referral code ${referredBy} not found for subscriber ${subscriberUid}`);
            return;
        }

        const referrerDoc = referrerSnap.docs[0];
        const referrerData = referrerDoc.data();

        // Prevent double-counting: check if this subscriber was already tracked
        if (referrerData._trackedReferrals && referrerData._trackedReferrals.includes(subscriberUid)) {
            return;
        }

        const newCount = (referrerData.paidReferralCount || 0) + 1;
        const tiersApplied = referrerData.referralTiersApplied || [];
        const legacyAllTiersApplied = !!referrerData.referralRewardApplied && tiersApplied.length === 0;

        const updates = {
            paidReferralCount: admin.firestore.FieldValue.increment(1),
            _trackedReferrals: admin.firestore.FieldValue.arrayUnion(subscriberUid),
        };

        // For each tier the referrer has now crossed but not yet been rewarded
        // for, credit the incremental months. Ordered low→high so tier 1 is
        // credited before tier 3, etc.
        let newlyRewardedTiers = [];
        for (const tier of REFERRAL_TIERS) {
            if (newCount < tier.threshold) continue;
            if (tiersApplied.includes(tier.threshold)) continue;

            // How many months the user should have accumulated from tiers
            // strictly lower than this one. Covers the legacy case where
            // referralRewardApplied=true existed without referralTiersApplied.
            const priorAwarded = REFERRAL_TIERS
                .filter(t => t.threshold < tier.threshold)
                .filter(t => tiersApplied.includes(t.threshold) || legacyAllTiersApplied)
                .reduce((max, t) => Math.max(max, t.totalMonths), 0);

            const incrementalMonths = tier.totalMonths - priorAwarded;
            if (incrementalMonths <= 0) {
                // Legacy user already has >=totalMonths credited — just record
                // the tier as applied so we don't revisit it.
                newlyRewardedTiers.push({ threshold: tier.threshold, months: 0, creditCents: null });
                continue;
            }

            try {
                const creditCents = await creditReferrerMonths(stripe, referrerData, incrementalMonths, tier);
                if (creditCents === null) {
                    console.warn(`Referrer ${referrerDoc.id} has no Stripe subscription — tier ${tier.threshold} deferred`);
                    // Don't mark as applied — we'll retry next time they
                    // convert a referral. If they never subscribe, they lose
                    // nothing (they had no subscription to credit).
                    continue;
                }
                newlyRewardedTiers.push({ threshold: tier.threshold, months: incrementalMonths, creditCents });
                console.log(`Tier ${tier.threshold} reward applied to ${referrerDoc.id}: ${incrementalMonths} months (${creditCents} cents)`);
            } catch (err) {
                console.error(`Failed to apply tier ${tier.threshold} reward to ${referrerDoc.id}:`, err);
                // Leave tier unmarked so a future successful call can retry.
            }
        }

        if (newlyRewardedTiers.length > 0) {
            updates.referralTiersApplied = admin.firestore.FieldValue.arrayUnion(
                ...newlyRewardedTiers.map(t => t.threshold)
            );
            updates.referralLastRewardAt = admin.firestore.FieldValue.serverTimestamp();
            // Keep legacy flag in sync for old UI code that only knows about
            // the "did they earn the full free year" concept.
            if (newlyRewardedTiers.some(t => t.threshold === 10)) {
                updates.referralRewardApplied = true;
                updates.referralRewardDate = admin.firestore.FieldValue.serverTimestamp();
            }
        }

        await referrerDoc.ref.update(updates);
        console.log(`Referral tracked: subscriber ${subscriberUid} → referrer ${referrerDoc.id} (count now ${newCount}, new tiers: ${newlyRewardedTiers.map(t => t.threshold).join(',') || 'none'})`);
    }

    // Expose as a plain function (not a Cloud Function) for stripe.js to call
    exports.trackPaidReferral = trackPaidReferral;

    // ─────────────────────────────────────────────
    // REFERRAL STATUS (client-facing)
    // ─────────────────────────────────────────────

    exports.getReferralStatus = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const uid = request.auth.uid;
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) {
            throw new HttpsError("not-found", "User not found.");
        }

        const data = userDoc.data();
        const paidReferralCount = data.paidReferralCount || 0;
        const tiersApplied = data.referralTiersApplied || [];
        const legacyFullYear = !!data.referralRewardApplied && tiersApplied.length === 0;

        // Compute tier state for each threshold so the UI can render the
        // ladder without re-encoding the structure client-side.
        const tiers = REFERRAL_TIERS.map(t => ({
            threshold: t.threshold,
            totalMonths: t.totalMonths,
            reached: paidReferralCount >= t.threshold,
            // Either explicitly marked applied, or legacy "referralRewardApplied" covers all tiers
            rewarded: tiersApplied.includes(t.threshold) || legacyFullYear,
        }));

        // Find the next unreached tier for UI copy like "2 more for tier 2".
        const nextTier = REFERRAL_TIERS.find(t => paidReferralCount < t.threshold) || null;

        // Total months the user has ever been awarded (cumulative, across tiers).
        const totalMonthsEarned = tiers.filter(t => t.rewarded)
            .reduce((max, t) => Math.max(max, t.totalMonths), 0);

        return {
            referralCode: data.referralCode || null,
            referralLink: data.referralCode
                ? `https://pennyhelm.com/login?ref=${data.referralCode}`
                : null,
            paidReferralCount,
            targetCount: 10,
            tiers,
            nextTier: nextTier ? {
                threshold: nextTier.threshold,
                totalMonths: nextTier.totalMonths,
                remaining: nextTier.threshold - paidReferralCount,
            } : null,
            totalMonthsEarned,
            // Legacy field retained so older clients don't break
            rewardEarned: !!data.referralRewardApplied || tiers.every(t => t.rewarded),
        };
    });

    return exports;
};
