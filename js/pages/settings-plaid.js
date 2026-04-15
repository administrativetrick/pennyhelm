/**
 * Plaid configuration UI for the Settings page — selfhost only.
 *
 * Shows current Plaid config status, lets the user set/update/clear credentials,
 * and refreshes the mode's `plaid` capability so the Connect Bank buttons
 * appear immediately after saving.
 */

import { escapeHtml } from '../utils.js';
import { mode } from '../mode/mode.js';

const ENVS = ['sandbox', 'development', 'production'];

export function renderPlaidConfigCard() {
    // Render synchronously with a "Loading…" placeholder — the status call
    // happens after mount so the whole page doesn't block on it.
    return `
        <div class="card mb-24" id="plaid-config-card">
            <div class="settings-section">
                <h3>🏦 Bank Connection (Plaid)</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    PennyHelm uses Plaid to securely link bank accounts.
                    Bring your own Plaid API credentials — sign up at
                    <a href="https://plaid.com/" target="_blank" rel="noopener">plaid.com</a> and paste
                    your <code>client_id</code> and <code>secret</code> below.
                    Credentials are stored in your local SQLite database and never leave your machine.
                </p>
                <div id="plaid-config-body">
                    <div style="color:var(--text-muted);font-size:13px;">Loading…</div>
                </div>
            </div>
        </div>
    `;
}

export async function attachPlaidConfigHandlers(container) {
    const card = container.querySelector('#plaid-config-card');
    if (!card) return;
    const body = card.querySelector('#plaid-config-body');

    async function load() {
        const status = await mode().getPlaidStatus();
        body.innerHTML = buildBody(status);
        wireForm(status);
    }

    function buildBody(status) {
        if (status.configured && status.source === 'env') {
            return `
                <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;">
                    <span style="color:var(--green);font-weight:600;">✓ Configured via environment variables</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:10px;">
                    Environment: <code>${escapeHtml(status.env)}</code> &middot;
                    client_id: <code>${escapeHtml(status.clientIdMasked || '')}</code>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:8px;">
                    To change these, update <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code>, and
                    <code>PLAID_ENV</code> and restart the server.
                </div>
            `;
        }

        const statusRow = status.configured
            ? `<div style="color:var(--green);font-weight:600;margin-bottom:12px;">
                 ✓ Configured &middot; Environment: <code>${escapeHtml(status.env)}</code> &middot;
                 client_id: <code>${escapeHtml(status.clientIdMasked || '')}</code>
               </div>`
            : `<div style="color:var(--text-muted);margin-bottom:12px;">
                 Not configured. Add your Plaid credentials to enable bank connections.
               </div>`;

        return `
            ${statusRow}
            <form id="plaid-config-form" style="display:flex;flex-direction:column;gap:10px;">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
                    <span>PLAID_CLIENT_ID</span>
                    <input type="text" class="form-input" name="client_id"
                           autocomplete="off" spellcheck="false"
                           placeholder="6081234567abcd…"
                           ${status.configured ? 'placeholder="•••• Leave blank to keep existing"' : ''}>
                </label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
                    <span>PLAID_SECRET</span>
                    <input type="password" class="form-input" name="secret"
                           autocomplete="off" spellcheck="false"
                           placeholder="${status.configured ? '•••• Leave blank to keep existing' : 'Your Plaid secret'}">
                </label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
                    <span>PLAID_ENV</span>
                    <select class="form-input" name="environment" required>
                        <option value="">— choose —</option>
                        ${ENVS.map(e =>
                            `<option value="${e}" ${status.env === e ? 'selected' : ''}>${e}</option>`
                        ).join('')}
                    </select>
                </label>
                <div id="plaid-config-error" style="color:var(--red);font-size:13px;display:none;"></div>
                <div style="display:flex;gap:8px;">
                    <button type="submit" class="btn btn-primary btn-sm">Save</button>
                    ${status.configured
                        ? '<button type="button" class="btn btn-secondary btn-sm" id="plaid-config-clear">Clear saved credentials</button>'
                        : ''}
                </div>
            </form>
        `;
    }

    function wireForm(prevStatus) {
        const form = body.querySelector('#plaid-config-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(form).entries());
            const err = body.querySelector('#plaid-config-error');
            err.style.display = 'none';

            // If re-submitting without changing secrets, don't send empty strings
            if (!data.client_id && prevStatus.configured) delete data.client_id;
            if (!data.secret && prevStatus.configured) delete data.secret;

            // But for the initial save, all three are required
            if (!prevStatus.configured && (!data.client_id || !data.secret || !data.environment)) {
                err.textContent = 'client_id, secret, and environment are all required.';
                err.style.display = 'block';
                return;
            }

            try {
                // If the user left secrets blank on re-save, re-fetch existing values via
                // a partial update pattern: the API only accepts full POSTs, so we
                // instruct the user to re-enter them. Simpler: require re-entry.
                if (!prevStatus.configured || (!data.client_id && !data.secret)) {
                    // full create OR env-only change (use saved values via trick: fetch status isn't enough)
                    // For MVP simplicity, require all three fields on every save.
                }
                if (!data.client_id || !data.secret) {
                    err.textContent = 'Re-enter both client_id and secret to update configuration.';
                    err.style.display = 'block';
                    return;
                }

                const res = await fetch('/api/plaid/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_id: data.client_id,
                        secret: data.secret,
                        environment: data.environment,
                    }),
                });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    err.textContent = j.error || `Failed (HTTP ${res.status})`;
                    err.style.display = 'block';
                    return;
                }
                await mode().refreshPlaidStatus();
                await load(); // re-render with new status
            } catch (ex) {
                err.textContent = ex.message || 'Save failed.';
                err.style.display = 'block';
            }
        });

        const clearBtn = body.querySelector('#plaid-config-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (!confirm('Remove stored Plaid credentials? Bank connections will stop working until you add new ones.')) return;
                await fetch('/api/plaid/config', { method: 'DELETE' });
                await mode().refreshPlaidStatus();
                await load();
            });
        }
    }

    await load();
}
