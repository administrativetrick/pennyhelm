/**
 * Selfhost mode strategy.
 *
 * Registers only the features a local SQLite + Express deployment needs.
 * Nothing in this file touches Firebase, Plaid, Stripe, or any external CDN.
 *
 * The `plaid` capability is dynamic: it flips true when the user configures
 * Plaid API keys (via env vars or the settings UI). Call `refreshPlaidStatus()`
 * at boot and after the user saves config to keep UI gates in sync.
 */

const _state = {
    plaidConfigured: false,
};

async function fetchPlaidStatus() {
    try {
        const res = await fetch('/api/plaid/status');
        if (!res.ok) return { configured: false };
        return await res.json();
    } catch {
        return { configured: false };
    }
}

const selfhost = {
    name: 'selfhost',

    // Mutable by design — `plaid` is a live getter so UI reads pick up
    // config changes without a full page reload.
    capabilities: Object.freeze({
        get plaid() { return _state.plaidConfigured; },
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

    // Selfhost dispatches Plaid calls to the local Express service that
    // talks to Plaid directly with the user's own API keys.
    plaidTransport: Object.freeze({
        async call(name, data) {
            const res = await fetch(`/api/plaid/${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data || {}),
            });
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try { const j = await res.json(); msg = j.error || msg; } catch {}
                throw new Error(msg);
            }
            return res.json();
        },
    }),

    async initStorage(store, auth) {
        store.setMode('selfhost');
        store.setAuthProvider(() => auth.getAuthHeaders());
        // Resolve Plaid configuration before first render so capabilities().plaid
        // returns the right value when pages gate their UI on it.
        await selfhost.refreshPlaidStatus();
    },

    async gateAccess() { return true; },

    async finalize({ store }) {
        // Plaid auto-sync on selfhost: once per day, only if configured + connected.
        if (!_state.plaidConfigured) return;
        try {
            const { shouldSyncTransactions, syncPlaidTransactions } = await import('../plaid.js');
            if (shouldSyncTransactions(store)) {
                syncPlaidTransactions(store).catch(() => { /* non-critical */ });
            }
        } catch { /* non-critical */ }
    },

    async refreshPlaidStatus() {
        const status = await fetchPlaidStatus();
        _state.plaidConfigured = !!status.configured;
        return status;
    },

    getPlaidStatus: fetchPlaidStatus,
};

export default selfhost;
