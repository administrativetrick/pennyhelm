import { firebaseConfig } from './firebase-config.js';
import { APP_MODE } from './mode-config.js';

class AuthManager {
    constructor() {
        this._user = null;
        this._idToken = null;
        this._ready = false;
        this._mode = 'selfhost';
        this._refreshInterval = null;
        this._isAdmin = false;
        this._mfaEnabled = false;
    }

    async init() {
        this._mode = APP_MODE;

        if (this._mode === 'selfhost') {
            this._ready = true;
            return;
        }

        // Cloud mode — initialize Firebase Auth
        if (typeof firebase === 'undefined') {
            console.error('Firebase SDK not loaded. Add Firebase scripts to app.html.');
            window.location.href = '/login';
            return;
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        // Wait for auth state
        return new Promise((resolve) => {
            firebase.auth().onAuthStateChanged(async (user) => {
                if (user) {
                    this._user = user;
                    this._idToken = await user.getIdToken();

                    // Check custom claims for admin status
                    try {
                        const tokenResult = await user.getIdTokenResult();
                        this._isAdmin = tokenResult.claims.admin === true;
                    } catch (e) {
                        console.warn('Failed to read token claims:', e);
                        this._isAdmin = false;
                    }

                    // Refresh token every 10 minutes
                    if (this._refreshInterval) clearInterval(this._refreshInterval);
                    this._refreshInterval = setInterval(async () => {
                        try {
                            this._idToken = await user.getIdToken(true);
                        } catch (e) {
                            console.error('Token refresh failed:', e);
                            clearInterval(this._refreshInterval);
                            window.location.href = '/login';
                        }
                    }, 10 * 60 * 1000);

                    this._ready = true;
                    resolve();
                } else {
                    // Not signed in — redirect to login
                    window.location.href = '/login';
                }
            });
        });
    }

    isCloud() {
        return this._mode === 'cloud';
    }

    isMFAEnabled() {
        if (this._mode === 'selfhost') return true; // no MFA in self-host, don't block
        return this._mfaEnabled;
    }

    setMFAEnabled(val) {
        this._mfaEnabled = !!val;
    }

    isAdmin() {
        return this._isAdmin;
    }

    getUser() {
        return this._user;
    }

    getIdToken() {
        return this._idToken;
    }

    getUserId() {
        return this._user ? this._user.uid : 'local';
    }

    getAuthHeaders() {
        if (this._mode === 'selfhost' || !this._idToken) return {};
        return { 'Authorization': `Bearer ${this._idToken}` };
    }

    // Get user subscription/trial status from Firestore (cloud) or return active (selfhost)
    async getUserStatus() {
        if (this._mode === 'selfhost') {
            return { mode: 'selfhost', status: 'active' };
        }

        const db = firebase.firestore();
        let userDoc = await db.collection('users').doc(this._user.uid).get();

        if (!userDoc.exists) {
            // Safety net: create the users doc if it's missing (fixes Google Sign-In bug)
            console.warn('users doc missing for', this._user.uid, '— auto-creating');
            try {
                await db.collection('users').doc(this._user.uid).set({
                    email: this._user.email || '',
                    displayName: this._user.displayName || '',
                    trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
                    subscriptionStatus: 'trial',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                // Re-read after creation
                userDoc = await db.collection('users').doc(this._user.uid).get();
            } catch (e) {
                console.error('Failed to auto-create users doc:', e);
                return { mode: 'cloud', status: 'trial', trialDaysRemaining: 30, trialLength: 30, isUnlimited: false };
            }
        }

        const data = userDoc.data();
        this._mfaEnabled = data.mfaEnabled === true;

        // Guard against missing trialStartDate (shouldn't happen, but be safe)
        const trialStart = data.trialStartDate ? data.trialStartDate.toDate() : new Date();
        const daysSinceStart = (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24);

        // Support custom trial length; 0 = unlimited
        const trialLength = data.trialDays || 30;
        const isUnlimited = trialLength === 0;

        const trialDaysRemaining = isUnlimited ? Infinity : Math.max(0, trialLength - Math.floor(daysSinceStart));

        let status = data.subscriptionStatus || 'trial';
        // Active subscribers and past_due keep their status (handled by Stripe webhooks)
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
    }

    // Create a Stripe Checkout session and redirect
    async createCheckoutSession(plan) {
        if (this._mode !== 'cloud') return;
        const functions = firebase.functions();
        const createCheckout = functions.httpsCallable('createCheckoutSession');
        const result = await createCheckout({ plan });
        return result.data; // { sessionId, url }
    }

    // Create a Stripe Customer Portal session
    async createPortalSession() {
        if (this._mode !== 'cloud') return;
        const functions = firebase.functions();
        const createPortal = functions.httpsCallable('createPortalSession');
        const result = await createPortal();
        return result.data; // { url }
    }

    async signOut() {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
        }
        if (this._mode === 'cloud' && typeof firebase !== 'undefined') {
            await firebase.auth().signOut();
        }
        window.location.href = '/';
    }
}

export const auth = new AuthManager();
