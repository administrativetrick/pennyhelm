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

    /**
     * Called internally (not exported as a Cloud Function) from the Stripe
     * webhook when a subscription becomes active. Looks up the subscriber's
     * referredBy code, finds the referrer, increments their paidReferralCount,
     * and applies a free-year reward at 10 conversions.
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
        const updates = {
            paidReferralCount: admin.firestore.FieldValue.increment(1),
            _trackedReferrals: admin.firestore.FieldValue.arrayUnion(subscriberUid),
        };

        // At 10 paid referrals, reward the referrer with a free year
        if (newCount >= 10 && !referrerData.referralRewardApplied) {
            try {
                const referrerStripeId = referrerData.stripeCustomerId;
                const referrerSubId = referrerData.stripeSubscriptionId;

                if (referrerStripeId && referrerSubId) {
                    // Create a 100% off coupon valid for 12 months
                    const coupon = await stripe.coupons.create({
                        percent_off: 100,
                        duration: "repeating",
                        duration_in_months: 12,
                        name: `Referral reward — ${referrerData.email || referrerDoc.id}`,
                    });

                    // Apply to the referrer's subscription
                    await stripe.subscriptions.update(referrerSubId, {
                        coupon: coupon.id,
                    });

                    updates.referralRewardApplied = true;
                    updates.referralRewardDate = admin.firestore.FieldValue.serverTimestamp();
                    console.log(`Applied free-year reward to referrer ${referrerDoc.id} (coupon ${coupon.id})`);
                } else {
                    console.warn(`Referrer ${referrerDoc.id} has no Stripe subscription — reward deferred`);
                }
            } catch (err) {
                console.error(`Failed to apply referral reward to ${referrerDoc.id}:`, err);
            }
        }

        await referrerDoc.ref.update(updates);
        console.log(`Referral tracked: subscriber ${subscriberUid} → referrer ${referrerDoc.id} (count now ${newCount})`);
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
        return {
            referralCode: data.referralCode || null,
            referralLink: data.referralCode
                ? `https://pennyhelm.com/login?ref=${data.referralCode}`
                : null,
            paidReferralCount: data.paidReferralCount || 0,
            targetCount: 10,
            rewardEarned: !!data.referralRewardApplied,
        };
    });

    return exports;
};
