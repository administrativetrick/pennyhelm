/**
 * AuthManager — thin shell that delegates mode-specific behavior to a strategy.
 *
 * The strategy is registered once at boot time from the active mode module
 * (js/mode/cloud.js or js/mode/selfhost.js). All public methods forward to the
 * strategy; this class only holds the shared state (user, idToken, isAdmin).
 *
 * There are no `if (mode === 'selfhost')` branches here. The only thing that
 * remembers which mode we're in is `isCloud()`, which exists solely as a shim
 * for legacy UI template call sites not yet migrated to `capabilities.*`.
 */

import { initMode } from './mode/mode.js';

class AuthManager {
    constructor() {
        this._strategy = null;
        this._modeName = null;
        this._user = null;
        this._idToken = null;
        this._isAdmin = false;
    }

    async init() {
        const m = await initMode();
        this._strategy = m.authStrategy;
        this._modeName = m.name;
        await this._strategy.init(this);
    }

    // Called by cloud strategy when Firebase auth state changes or token refreshes.
    _applyStrategyState({ user, idToken, isAdmin } = {}) {
        if (user !== undefined) this._user = user;
        if (idToken !== undefined) this._idToken = idToken;
        if (isAdmin !== undefined) this._isAdmin = !!isAdmin;
    }

    // ─── Identity ────────────────────────────────
    isAdmin()   { return this._isAdmin; }
    getUser()   { return this._user; }
    getIdToken(){ return this._idToken; }
    getUserId() { return this._user ? this._user.uid : 'local'; }

    // Legacy shim — kept for UI template ternaries (`${auth.isCloud() ? ... : ''}`).
    // Prefer importing `capabilities()` from ./mode/mode.js for new code.
    isCloud() { return this._modeName === 'cloud'; }

    // ─── Delegated to strategy ───────────────────
    isMFAEnabled()        { return this._strategy.isMFAEnabled(); }
    setMFAEnabled(v)      { this._strategy.setMFAEnabled(v); }
    getAuthHeaders()      { return this._strategy.getAuthHeaders(this); }
    getUserStatus()       { return this._strategy.getUserStatus(this); }
    createCheckoutSession(plan) { return this._strategy.createCheckoutSession(plan); }
    createPortalSession() { return this._strategy.createPortalSession(); }
    signOut()             { return this._strategy.signOut(this); }
}

export const auth = new AuthManager();
