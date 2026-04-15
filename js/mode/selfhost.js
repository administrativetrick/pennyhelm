/**
 * Selfhost mode strategy.
 *
 * Registers only the features a local SQLite + Express deployment needs.
 * Nothing in this file touches Firebase, Plaid, Stripe, or any external CDN.
 */

const selfhost = Object.freeze({
    name: 'selfhost',

    capabilities: Object.freeze({
        plaid: false,
        chatbot: false,
        mfa: false,
        subscriptions: false,
        admin: false,
        sharing: false,
        deleteAccount: false,
        registrationCodes: false,
    }),

    authStrategy: Object.freeze({
        async init(/* auth */) { /* no-op */ },
        isMFAEnabled() { return true; }, // no MFA in selfhost — don't block gated UI
        setMFAEnabled() { /* no-op */ },
        getAuthHeaders(/* auth */) { return {}; },
        async getUserStatus(/* auth */) { return { mode: 'selfhost', status: 'active' }; },
        async createCheckoutSession() { /* no-op */ },
        async createPortalSession() { /* no-op */ },
        async signOut(/* auth */) { window.location.href = '/'; },
    }),

    async initStorage(store, auth) {
        store.setMode('selfhost');
        store.setAuthProvider(() => auth.getAuthHeaders());
    },

    async gateAccess() { return true; },

    async finalize() { /* nothing to do */ },
});

export default selfhost;
