/**
 * Mode registry — single source of truth for what the current app mode can do.
 *
 * Reads APP_MODE once, imports the matching strategy module (cloud or selfhost),
 * and returns a frozen object exposing:
 *   - name            'cloud' | 'selfhost'
 *   - capabilities    feature flags (plaid, chatbot, mfa, admin, ...)
 *   - authStrategy    methods the AuthManager delegates to
 *   - initStorage     wires the store's backend
 *   - gateAccess      trial/subscription checks (or no-op for selfhost)
 *   - finalize        post-boot side-effects (Plaid sync, chatbot, sidebar UI)
 *
 * Every boot path goes through this module, so scattered `auth.isCloud()` checks
 * can be replaced with `mode().capabilities.X` or — better — simply not run at
 * all, because the selfhost strategy doesn't register the cloud-only code paths.
 */

import { APP_MODE } from '../mode-config.js';

let _mode = null;

export async function initMode() {
    if (_mode) return _mode;
    const m = APP_MODE === 'cloud'
        ? await import('./cloud.js')
        : await import('./selfhost.js');
    _mode = m.default;
    return _mode;
}

export function mode() {
    if (!_mode) throw new Error('mode() called before initMode()');
    return _mode;
}

export function capabilities() {
    return mode().capabilities;
}
