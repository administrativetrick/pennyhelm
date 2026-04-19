/**
 * Cloud mode strategy.
 *
 * Registers every cloud-only feature and owns the entire cloud-boot pipeline.
 * All imports of Firebase/Plaid/chatbot/cloud-sidebar live here — the selfhost
 * module never reaches this file, so its bundle graph stays clean.
 */

import { loadFirebaseSdk } from '../cloud-loader.js';
import { firebaseConfig, APP_CHECK_SITE_KEY } from '../firebase-config.js';
import { activateAppCheck } from '../app-check-boot.js';

const cloud = Object.freeze({
    name: 'cloud',

    capabilities: Object.freeze({
        plaid: true,
        chatbot: true,
        mfa: true,
        subscriptions: true,
        admin: true,
        sharing: true,
        deleteAccount: true,
        registrationCodes: true,
    }),

    // Cloud dispatches Plaid calls through Firebase Cloud Functions.
    plaidTransport: Object.freeze({
        async call(name, data) {
            const fn = firebase.app().functions().httpsCallable(name);
            const result = await fn(data);
            return result.data;
        },
    }),

    authStrategy: makeCloudAuthStrategy(),

    async initStorage(store, auth) {
        store.setMode('cloud');
        store.initFirestore(auth.getUserId());
    },

    async gateAccess({ auth }) {
        const {
            showPastDueBanner, showTrialBanner, showTrialExpiredScreen,
            showSubscriptionModal, showRedeemCodeModal, openManageSubscription, showToast,
        } = await import('../services/modal-manager.js');

        try {
            if (auth.isAdmin()) return true;

            const status = await auth.getUserStatus();

            if (status.status === 'active') return true;

            if (status.status === 'past_due') {
                showPastDueBanner(() => openManageSubscription(auth));
                return true;
            }

            if (status.status === 'expired') {
                showTrialExpiredScreen(
                    auth,
                    () => showSubscriptionModal(auth),
                    () => showRedeemCodeModal(auth)
                );
                return false;
            }

            if (status.status === 'trial' && status.trialDaysRemaining <= 7 && !status.isUnlimited) {
                showTrialBanner(status.trialDaysRemaining, () => showSubscriptionModal(auth));
            }

            if (window.location.hash === '#subscription-success') {
                showToast('Subscription activated! Welcome to PennyHelm Cloud.', 'success');
                window.location.hash = '#dashboard';
            }

            if (window.location.hash === '#subscription-needed') {
                window.location.hash = '#dashboard';
                setTimeout(() => showSubscriptionModal(auth), 300);
            }

            return true;
        } catch (e) {
            console.error('Failed to check trial status:', e);
            return true; // fail open
        }
    },

    async finalize({ store, auth, navigate }) {
        // Plaid daily auto-sync
        try {
            const { shouldSyncTransactions, syncPlaidTransactions } = await import('../plaid.js');
            if (shouldSyncTransactions(store)) {
                syncPlaidTransactions(store).then(result => {
                    if (result.imported > 0) {
                        console.log(`Auto-imported ${result.imported} transaction(s) as expenses.`);
                        if (window.location.hash.includes('expenses')) {
                            navigate(window.location.hash.slice(1));
                        }
                    }
                }).catch(() => { /* non-critical */ });
            }
        } catch (e) { /* non-critical */ }

        // Cloud sidebar (admin link + sign-out)
        const { addCloudUI } = await import('../ui/cloud-sidebar.js');
        addCloudUI(auth, navigate);

        // Chatbot
        const { initChatbot } = await import('../chatbot.js');
        initChatbot();
    },
});

function makeCloudAuthStrategy() {
    let _mfaEnabled = false;
    let _refreshInterval = null;

    return {
        async init(auth) {
            try {
                await loadFirebaseSdk();
            } catch (e) {
                console.error('Failed to load Firebase SDK:', e);
                window.location.href = '/login';
                throw e;
            }

            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
                // App Check must activate before any auth/firestore/functions
                // calls — tokens are attached to outgoing requests from that
                // point on. No-op if APP_CHECK_SITE_KEY is empty.
                activateAppCheck(firebase, APP_CHECK_SITE_KEY);
            }

            return new Promise((resolve) => {
                firebase.auth().onAuthStateChanged(async (user) => {
                    if (!user) {
                        window.location.href = '/login';
                        return;
                    }
                    const idToken = await user.getIdToken();
                    let isAdmin = false;
                    try {
                        const tokenResult = await user.getIdTokenResult();
                        isAdmin = tokenResult.claims.admin === true;
                    } catch (e) {
                        console.warn('Failed to read token claims:', e);
                    }

                    auth._applyStrategyState({ user, idToken, isAdmin });

                    if (_refreshInterval) clearInterval(_refreshInterval);
                    _refreshInterval = setInterval(async () => {
                        try {
                            const refreshed = await user.getIdToken(true);
                            auth._applyStrategyState({ user, idToken: refreshed, isAdmin });
                        } catch (e) {
                            console.error('Token refresh failed:', e);
                            clearInterval(_refreshInterval);
                            window.location.href = '/login';
                        }
                    }, 10 * 60 * 1000);

                    resolve();
                });
            });
        },

        isMFAEnabled() { return _mfaEnabled; },
        setMFAEnabled(v) { _mfaEnabled = !!v; },

        getAuthHeaders(auth) {
            const t = auth.getIdToken();
            return t ? { Authorization: `Bearer ${t}` } : {};
        },

        async getUserStatus(auth) {
            const user = auth.getUser();
            const db = firebase.firestore();
            let userDoc = await db.collection('users').doc(user.uid).get();

            if (!userDoc.exists) {
                console.warn('users doc missing for', user.uid, '— auto-creating');
                try {
                    await db.collection('users').doc(user.uid).set({
                        email: user.email || '',
                        displayName: user.displayName || '',
                        trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
                        subscriptionStatus: 'trial',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    userDoc = await db.collection('users').doc(user.uid).get();
                } catch (e) {
                    console.error('Failed to auto-create users doc:', e);
                    return { mode: 'cloud', status: 'trial', trialDaysRemaining: 30, trialLength: 30, isUnlimited: false };
                }
            }

            const data = userDoc.data();
            _mfaEnabled = data.mfaEnabled === true;

            const trialStart = data.trialStartDate ? data.trialStartDate.toDate() : new Date();
            const daysSinceStart = (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24);
            const trialLength = data.trialDays || 30;
            const isUnlimited = trialLength === 0;
            const trialDaysRemaining = isUnlimited ? Infinity : Math.max(0, trialLength - Math.floor(daysSinceStart));

            let status = data.subscriptionStatus || 'trial';
            if (status === 'trial' && !isUnlimited && daysSinceStart > trialLength) {
                status = 'expired';
            }

            return {
                mode: 'cloud',
                status,
                trialDaysRemaining,
                trialLength,
                isUnlimited,
                email: data.email,
                displayName: data.displayName,
                stripeCustomerId: data.stripeCustomerId || null,
                stripeSubscriptionId: data.stripeSubscriptionId || null,
            };
        },

        async createCheckoutSession(plan) {
            const functions = firebase.functions();
            const createCheckout = functions.httpsCallable('createCheckoutSession');
            const result = await createCheckout({ plan });
            return result.data;
        },

        async createPortalSession() {
            const functions = firebase.functions();
            const createPortal = functions.httpsCallable('createPortalSession');
            const result = await createPortal();
            return result.data;
        },

        async signOut() {
            if (_refreshInterval) clearInterval(_refreshInterval);
            if (typeof firebase !== 'undefined') await firebase.auth().signOut();
            window.location.href = '/';
        },
    };
}

export default cloud;
