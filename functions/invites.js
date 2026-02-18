const { onCall, HttpsError } = require("firebase-functions/v2/https");
const crypto = require("crypto");

module.exports = function({ admin, db, getEmailTransporter, secrets }) {
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

    // Generate invite code: PH- + 7 random chars (no I/O/0/1 to avoid confusion)
    function generateInviteCode() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = crypto.randomBytes(7);
        let code = "PH-";
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
    // REGISTRATION CODE FUNCTIONS
    // ─────────────────────────────────────────────

    // Validate a registration code (no auth required -- user hasn't signed up yet)
    exports.validateRegistrationCode = onCall(async (request) => {
        const { code } = request.data || {};
        if (!code || typeof code !== "string") {
            throw new HttpsError("invalid-argument", "Registration code is required.");
        }

        const normalized = code.trim().toUpperCase();
        const codeDoc = await db.collection("registrationCodes").doc(normalized).get();

        if (!codeDoc.exists) {
            throw new HttpsError("not-found", "Invalid registration code.");
        }
        if (codeDoc.data().status !== "available") {
            throw new HttpsError("already-exists", "This code has already been used.");
        }

        return { valid: true };
    });

    // Redeem a registration code (auth required -- called after account creation)
    exports.redeemRegistrationCode = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be authenticated.");
        }

        const { code } = request.data || {};
        if (!code || typeof code !== "string") {
            throw new HttpsError("invalid-argument", "Registration code is required.");
        }

        const normalized = code.trim().toUpperCase();
        const uid = request.auth.uid;
        const codeRef = db.collection("registrationCodes").doc(normalized);

        await db.runTransaction(async (t) => {
            const codeDoc = await t.get(codeRef);
            if (!codeDoc.exists) {
                throw new HttpsError("not-found", "Invalid registration code.");
            }
            if (codeDoc.data().status !== "available") {
                throw new HttpsError("already-exists", "This code has already been used.");
            }
            t.update(codeRef, {
                status: "redeemed",
                redeemedBy: uid,
                redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });

        return { success: true };
    });

    // Generate registration codes for a user (10 codes, idempotent)
    exports.generateRegistrationCodes = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be authenticated.");
        }

        const targetUid = (request.data && request.data.targetUid) || request.auth.uid;

        // Only admin can generate for other users
        if (targetUid !== request.auth.uid) {
            const caller = await admin.auth().getUser(request.auth.uid);
            if (!caller.customClaims || !caller.customClaims.admin) {
                throw new HttpsError("permission-denied", "Only admin can generate codes for other users.");
            }
        }

        const userRef = db.collection("users").doc(targetUid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            throw new HttpsError("not-found", "User not found.");
        }

        // Idempotent -- return existing codes if already generated
        if (userDoc.data().registrationCodesGenerated) {
            return { codes: userDoc.data().registrationCodes || [] };
        }

        const count = (request.data && request.data.count) || 10;
        const codes = [];
        const batch = db.batch();

        for (let i = 0; i < count; i++) {
            const code = generateInviteCode();
            codes.push(code);
            batch.set(db.collection("registrationCodes").doc(code), {
                ownerUid: targetUid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                redeemedBy: null,
                redeemedAt: null,
                status: "available",
            });
        }

        batch.update(userRef, {
            registrationCodes: codes,
            registrationCodesGenerated: true,
        });

        await batch.commit();
        return { codes };
    });

    // Admin: generate unlimited invite codes not tied to any user
    exports.generateAdminInviteCodes = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be authenticated.");
        }
        const caller = await admin.auth().getUser(request.auth.uid);
        if (!caller.customClaims || !caller.customClaims.admin) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const count = (request.data && request.data.count) || 10;
        const codes = [];
        const batch = db.batch();

        for (let i = 0; i < count; i++) {
            const code = generateInviteCode();
            codes.push(code);
            batch.set(db.collection("registrationCodes").doc(code), {
                ownerUid: "admin",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                redeemedBy: null,
                redeemedAt: null,
                status: "available",
            });
        }

        await batch.commit();
        return { codes };
    });

    // Admin: one-time grandfather existing users with 10 invite codes each
    exports.grandfatherExistingUsers = onCall(async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be authenticated.");
        }
        const caller = await admin.auth().getUser(request.auth.uid);
        if (!caller.customClaims || !caller.customClaims.admin) {
            throw new HttpsError("permission-denied", "Admin only.");
        }

        const usersSnap = await db.collection("users").get();
        let processed = 0;

        for (const userDoc of usersSnap.docs) {
            const data = userDoc.data();
            // Skip users already grandfathered
            if (data.registrationCodesGenerated) continue;

            const uid = userDoc.id;
            const codes = [];
            const batch = db.batch();

            for (let i = 0; i < 10; i++) {
                const code = generateInviteCode();
                codes.push(code);
                batch.set(db.collection("registrationCodes").doc(code), {
                    ownerUid: uid,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    redeemedBy: null,
                    redeemedAt: null,
                    status: "available",
                });
            }

            batch.update(db.collection("users").doc(uid), {
                registrationCodes: codes,
                registrationCodesGenerated: true,
                invitedBy: null,
            });

            await batch.commit();
            processed++;
        }

        return { processed };
    });

    // Admin: send registration invite emails with auto-generated codes
    exports.sendRegistrationInviteEmail = onCall(
        { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be authenticated.");
            }
            const caller = await admin.auth().getUser(request.auth.uid);
            if (!caller.customClaims || !caller.customClaims.admin) {
                throw new HttpsError("permission-denied", "Admin only.");
            }

            const { emails } = request.data || {};
            if (!emails || !Array.isArray(emails) || emails.length === 0) {
                throw new HttpsError("invalid-argument", "Must provide an array of email addresses.");
            }
            if (emails.length > 50) {
                throw new HttpsError("invalid-argument", "Maximum 50 emails per batch.");
            }

            const results = [];
            const transporter = getEmailTransporter();

            for (const rawEmail of emails) {
                const email = rawEmail.trim().toLowerCase();
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    results.push({ email: rawEmail, success: false, error: "Invalid email format" });
                    continue;
                }

                try {
                    // Generate a unique code for this invite
                    const code = generateInviteCode();

                    // Save code to Firestore
                    await db.collection("registrationCodes").doc(code).set({
                        ownerUid: "admin",
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        redeemedBy: null,
                        redeemedAt: null,
                        status: "available",
                        sentTo: email,
                    });

                    // Send the email
                    await transporter.sendMail({
                        from: `"PennyHelm" <${SMTP_FROM.value()}>`,
                        to: email,
                        subject: "You're Invited to PennyHelm Cloud (Private Access)",
                        html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <h1 style="color: #4f8cff; margin: 0;">PennyHelm</h1>
                                <p style="color: #666; margin: 5px 0 0 0;">Navigate Your Finances</p>
                            </div>

                            <h2 style="color: #333;">You've Been Invited!</h2>

                            <p>You've been personally selected for early access to <strong>PennyHelm Cloud</strong> — an invite-only budgeting platform built for people who want real control over their finances.</p>

                            <p><strong>What PennyHelm does:</strong></p>
                            <ul style="color: #333; line-height: 1.8;">
                                <li>Track bills, income, debts, and accounts in one place</li>
                                <li>See upcoming bills mapped to your pay schedule</li>
                                <li>Link bank accounts for real-time balances</li>
                                <li>Share finances with a partner</li>
                                <li>Works on web and mobile</li>
                            </ul>

                            <div style="background: #f0f6ff; border: 2px dashed #4f8cff; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0;">
                                <p style="color: #666; margin: 0 0 8px 0; font-size: 13px;">YOUR PERSONAL INVITE CODE</p>
                                <p style="font-family: 'Courier New', monospace; font-size: 28px; font-weight: 700; color: #4f8cff; letter-spacing: 2px; margin: 0;">${code}</p>
                                <p style="color: #999; margin: 8px 0 0 0; font-size: 12px;">Single-use — this code is reserved for you</p>
                            </div>

                            <div style="text-align: center; margin: 28px 0;">
                                <a href="https://pennyhelm.com/login.html" style="display: inline-block; background: #4f8cff; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                                    Create Your Account
                                </a>
                            </div>

                            <p style="color: #666; font-size: 14px;">
                                PennyHelm is currently invite-only. Each user only receives 10 invite codes, so spots are limited. Early members get priority access and help shape the product.
                            </p>

                            <p style="color: #666; font-size: 14px;">
                                Once you sign up, you'll get your own 10 codes to share with friends and family.
                            </p>

                            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                            <p style="color: #999; font-size: 12px; text-align: center;">
                                If you didn't expect this invitation, you can safely ignore this email.
                            </p>
                        </div>
                    `,
                        text: `You're Invited to PennyHelm Cloud (Private Access)

You've been personally selected for early access to PennyHelm Cloud — an invite-only budgeting platform built for people who want real control over their finances.

YOUR INVITE CODE: ${code}

Sign up at: https://pennyhelm.com/login.html

What PennyHelm does:
- Track bills, income, debts, and accounts in one place
- See upcoming bills mapped to your pay schedule
- Link bank accounts for real-time balances
- Share finances with a partner
- Works on web and mobile

This code is single-use and reserved for you. Once you sign up, you'll get your own 10 codes to share.

If you didn't expect this invitation, you can safely ignore this email.`
                    });

                    results.push({ email, success: true, code });
                } catch (err) {
                    console.error(`Failed to send invite to ${email}:`, err);
                    results.push({ email, success: false, error: err.message || "Send failed" });
                }
            }

            const sent = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;
            return { results, sent, failed };
        }
    );

    // ─────────────────────────────────────────────
    // WAITLIST FUNCTIONS
    // ─────────────────────────────────────────────

    // joinWaitlist -- No auth required. Adds email to waitlist.
    // Sends a confirmation email to the user.
    exports.joinWaitlist = onCall(
        { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
        async (request) => {
            const email = (request.data?.email || '').trim().toLowerCase();
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new HttpsError("invalid-argument", "Please enter a valid email address.");
            }

            // Check if already on waitlist
            const existing = await db.collection('waitlist').doc(email).get();
            if (existing.exists) {
                const data = existing.data();
                if (data.status === 'approved') {
                    return { alreadyApproved: true, message: "You've already been approved! Check your email for your invite code." };
                }
                return { alreadyOnList: true, position: data.position, message: "You're already on the waitlist." };
            }

            // Check if email already has a registered account
            try {
                const userByEmail = await admin.auth().getUserByEmail(email);
                if (userByEmail) {
                    throw new HttpsError("already-exists", "An account with this email already exists. Try signing in.");
                }
            } catch (e) {
                if (e.code === 'auth/user-not-found') {
                    // Good -- no existing account
                } else if (e instanceof HttpsError) {
                    throw e;
                }
                // Ignore other auth errors, proceed with waitlist
            }

            // Get current waitlist count for position
            const countSnap = await db.collection('waitlist')
                .where('status', '==', 'waiting')
                .count().get();
            const position = (countSnap.data().count || 0) + 1;

            // Add to waitlist
            await db.collection('waitlist').doc(email).set({
                email,
                position,
                joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'waiting', // waiting | approved
                approvedAt: null,
                inviteCode: null,
            });

            // Send confirmation email
            try {
                const transporter = getEmailTransporter();
                await transporter.sendMail({
                    from: `"PennyHelm" <${SMTP_FROM.value()}>`,
                    to: email,
                    subject: "You're on the PennyHelm Waitlist!",
                    html: `
                    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
                        <div style="text-align:center;margin-bottom:24px;">
                            <div style="font-size:48px;">&#9973;</div>
                            <h1 style="margin:8px 0 4px;font-size:22px;color:#1a1a2e;">PennyHelm</h1>
                        </div>
                        <h2 style="text-align:center;font-size:18px;color:#1a1a2e;">You're on the list!</h2>
                        <p style="color:#555;line-height:1.6;">
                            Thanks for your interest in PennyHelm Cloud. You're currently <strong>#${position}</strong> on the waitlist.
                        </p>
                        <p style="color:#555;line-height:1.6;">
                            PennyHelm is invite-only right now, and we're letting people in on a rolling basis.
                            You'll receive an email with your personal invite code when it's your turn — typically within 7 days.
                        </p>
                        <p style="color:#555;line-height:1.6;">
                            <strong>Can't wait?</strong> If you know someone who already uses PennyHelm, ask them for one of their invite codes — every user gets 10 to share.
                        </p>
                        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
                        <p style="color:#999;font-size:12px;text-align:center;">
                            PennyHelm &mdash; Navigate Your Finances
                        </p>
                    </div>
                `,
                    text: `You're on the PennyHelm Waitlist!\n\nThanks for your interest in PennyHelm Cloud. You're currently #${position} on the waitlist.\n\nPennyHelm is invite-only right now, and we're letting people in on a rolling basis. You'll receive an email with your personal invite code when it's your turn — typically within 7 days.\n\nCan't wait? If you know someone who already uses PennyHelm, ask them for one of their invite codes — every user gets 10 to share.\n\nPennyHelm — Navigate Your Finances`
                });
            } catch (err) {
                console.error('Failed to send waitlist confirmation email:', err);
                // Don't fail the waitlist join if email fails
            }

            return { success: true, position, message: `You're #${position} on the waitlist!` };
        }
    );

    // getWaitlistStatus -- No auth required. Check waitlist status by email.
    exports.getWaitlistStatus = onCall(async (request) => {
        const email = (request.data?.email || '').trim().toLowerCase();
        if (!email) {
            throw new HttpsError("invalid-argument", "Email is required.");
        }

        const doc = await db.collection('waitlist').doc(email).get();
        if (!doc.exists) {
            return { onWaitlist: false };
        }

        const data = doc.data();
        if (data.status === 'approved') {
            return {
                onWaitlist: true,
                status: 'approved',
                inviteCode: data.inviteCode,
            };
        }

        // Calculate days waited
        const joinedAt = data.joinedAt?.toDate ? data.joinedAt.toDate() : new Date(data.joinedAt);
        const daysWaited = Math.floor((Date.now() - joinedAt.getTime()) / 86400000);

        return {
            onWaitlist: true,
            status: 'waiting',
            position: data.position,
            daysWaited,
        };
    });

    // approveWaitlistEntries -- Admin only. Approves waitlisted users and sends invite codes.
    exports.approveWaitlistEntries = onCall(
        { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }
            const tokenResult = await admin.auth().getUser(request.auth.uid);
            if (!tokenResult.customClaims?.admin) {
                throw new HttpsError("permission-denied", "Admin only.");
            }

            // Accept either specific emails or a count to auto-approve oldest entries
            const { emails, count } = request.data || {};
            let toApprove = [];

            if (emails && Array.isArray(emails) && emails.length > 0) {
                // Approve specific emails
                toApprove = emails.map(e => e.trim().toLowerCase()).filter(e => e);
            } else {
                // Auto-approve oldest N waiting entries (default: those who've waited 7+ days)
                const approveCount = count || 10;
                const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
                const waitingSnap = await db.collection('waitlist')
                    .where('status', '==', 'waiting')
                    .where('joinedAt', '<=', sevenDaysAgo)
                    .orderBy('joinedAt', 'asc')
                    .limit(approveCount)
                    .get();
                toApprove = waitingSnap.docs.map(d => d.id);
            }

            if (toApprove.length === 0) {
                return { approved: 0, message: "No eligible waitlist entries to approve." };
            }

            const results = [];
            const transporter = getEmailTransporter();

            for (const email of toApprove) {
                try {
                    const docRef = db.collection('waitlist').doc(email);
                    const docSnap = await docRef.get();
                    if (!docSnap.exists || docSnap.data().status === 'approved') {
                        results.push({ email, success: false, reason: 'Not found or already approved' });
                        continue;
                    }

                    // Generate an invite code for this person
                    const code = 'PH-' + generateInviteCode();
                    await db.collection('registrationCodes').doc(code).set({
                        ownerUid: 'waitlist',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        redeemedBy: null,
                        redeemedAt: null,
                        status: 'available',
                    });

                    // Update waitlist entry
                    await docRef.update({
                        status: 'approved',
                        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
                        inviteCode: code,
                    });

                    // Send invite email
                    await transporter.sendMail({
                        from: `"PennyHelm" <${SMTP_FROM.value()}>`,
                        to: email,
                        subject: "Your PennyHelm Invite is Ready!",
                        html: `
                        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
                            <div style="text-align:center;margin-bottom:24px;">
                                <div style="font-size:48px;">&#9973;</div>
                                <h1 style="margin:8px 0 4px;font-size:22px;color:#1a1a2e;">PennyHelm</h1>
                            </div>
                            <h2 style="text-align:center;font-size:18px;color:#1a1a2e;">You're In!</h2>
                            <p style="color:#555;line-height:1.6;">
                                Great news — your spot on the PennyHelm waitlist has been approved. Here's your personal invite code:
                            </p>
                            <div style="text-align:center;margin:24px 0;">
                                <div style="display:inline-block;background:#f0f4ff;border:2px dashed #4361ee;border-radius:8px;padding:16px 32px;">
                                    <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;">Your Invite Code</div>
                                    <div style="font-family:monospace;font-size:24px;font-weight:700;color:#4361ee;letter-spacing:2px;">${code}</div>
                                </div>
                            </div>
                            <div style="text-align:center;margin:24px 0;">
                                <a href="https://pennyhelm.com/login.html" style="display:inline-block;background:#4361ee;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:600;font-size:16px;">
                                    Create Your Account
                                </a>
                            </div>
                            <p style="color:#555;line-height:1.6;font-size:14px;">
                                Once you sign up, you'll get your own 10 invite codes to share with friends and family.
                            </p>
                            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
                            <p style="color:#999;font-size:12px;text-align:center;">
                                PennyHelm &mdash; Navigate Your Finances
                            </p>
                        </div>
                    `,
                        text: `Your PennyHelm Invite is Ready!\n\nGreat news — your spot on the PennyHelm waitlist has been approved.\n\nYour Invite Code: ${code}\n\nSign up at: https://pennyhelm.com/login.html\n\nOnce you sign up, you'll get your own 10 invite codes to share.\n\nPennyHelm — Navigate Your Finances`
                    });

                    results.push({ email, success: true, code });
                } catch (err) {
                    console.error(`Failed to approve ${email}:`, err);
                    results.push({ email, success: false, reason: err.message });
                }
            }

            const approved = results.filter(r => r.success).length;

            // Recalculate positions for remaining waiting entries
            if (approved > 0) {
                const remainingSnap = await db.collection('waitlist')
                    .where('status', '==', 'waiting')
                    .orderBy('joinedAt', 'asc')
                    .get();
                const batch = db.batch();
                remainingSnap.docs.forEach((doc, idx) => {
                    batch.update(doc.ref, { position: idx + 1 });
                });
                await batch.commit();
            }

            return { results, approved, failed: results.length - approved };
        }
    );

    return exports;
};
