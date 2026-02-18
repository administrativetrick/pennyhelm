const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const Stripe = require("stripe");

module.exports = function({ admin, db, secrets }) {
    const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_ANNUAL_PRICE_ID, STRIPE_MONTHLY_PRICE_ID, STRIPE_FIRST_YEAR_COUPON_ID } = secrets;
    const exports = {};

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

    // createCheckoutSession
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

    // createPortalSession
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

    // stripeWebhook
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

    return exports;
};
