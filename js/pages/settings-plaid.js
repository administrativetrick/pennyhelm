/**
 * Plaid configuration UI for the Settings page — selfhost only.
 *
 * Shows current Plaid config status. When nothing is configured yet,
 * the card presents a single "Set Up Bank Connection" button that opens
 * a choice modal:
 *   1. Upgrade to PennyHelm Cloud (colored, recommended)
 *   2. Bring your own Plaid developer key (opens the inline form)
 *
 * Once credentials are saved (or set via environment variables), the
 * card shows the status + update/clear controls as before.
 */

import { escapeHtml } from '../utils.js';
import { mode } from '../mode/mode.js';
import { openModal, closeModal } from '../services/modal-manager.js';

const ENVS = ['sandbox', 'development', 'production'];
const UPGRADE_URL = 'https://pennyhelm.com/switch?utm_source=selfhost&utm_campaign=plaid-gate';

export function renderPlaidConfigCard() {
    // Render synchronously with a "Loading…" placeholder — the status call
    // happens after mount so the whole page doesn't block on it.
    return `
        <div class="card mb-24" id="plaid-config-card">
            <div class="settings-section">
                <h3>🏦 Bank Connection (Plaid)</h3>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
                    Link bank accounts to auto-import transactions. Choose the
                    hosted option (no Plaid account needed) or bring your own
                    Plaid developer credentials.
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

    // View state: 'status' (default, shows status + setup button),
    // 'byo-form' (shown after the user picks "BYO Plaid Key" in the modal).
    let view = 'status';
    let currentStatus = null;

    async function load() {
        currentStatus = await mode().getPlaidStatus();
        render();
    }

    function render() {
        if (view === 'byo-form') {
            body.innerHTML = buildByoForm(currentStatus);
            wireForm(currentStatus);
            return;
        }
        body.innerHTML = buildStatusView(currentStatus);
        wireStatusView();
    }

    function buildStatusView(status) {
        // Env-configured: read-only, can't change from UI.
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

        // Saved credentials: show status + Update / Clear controls.
        if (status.configured) {
            return `
                <div style="color:var(--green);font-weight:600;margin-bottom:12px;">
                    ✓ Configured &middot; Environment: <code>${escapeHtml(status.env)}</code> &middot;
                    client_id: <code>${escapeHtml(status.clientIdMasked || '')}</code>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-secondary btn-sm" id="plaid-config-update">Update credentials</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="plaid-config-clear">Clear saved credentials</button>
                </div>
            `;
        }

        // Not configured: single CTA button that opens the choice modal.
        return `
            <div style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">
                Not configured. Set up bank connections to auto-import transactions.
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="plaid-setup-btn">
                Set Up Bank Connection
            </button>
        `;
    }

    function buildByoForm(status) {
        const statusRow = status.configured
            ? `<div style="color:var(--green);font-weight:600;margin-bottom:12px;">
                 ✓ Configured &middot; Environment: <code>${escapeHtml(status.env)}</code> &middot;
                 client_id: <code>${escapeHtml(status.clientIdMasked || '')}</code>
               </div>`
            : `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">
                 Sign up at <a href="https://plaid.com/" target="_blank" rel="noopener">plaid.com</a>
                 and grab your <code>client_id</code> and <code>secret</code> from the
                 <a href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noopener">Plaid dashboard</a>.
                 Credentials are stored in your local SQLite database and never leave your machine.
               </div>`;

        return `
            ${statusRow}
            <form id="plaid-config-form" style="display:flex;flex-direction:column;gap:10px;">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
                    <span>PLAID_CLIENT_ID</span>
                    <input type="text" class="form-input" name="client_id"
                           autocomplete="off" spellcheck="false"
                           placeholder="${status.configured ? '•••• Re-enter to change' : '6081234567abcd…'}">
                </label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
                    <span>PLAID_SECRET</span>
                    <input type="password" class="form-input" name="secret"
                           autocomplete="off" spellcheck="false"
                           placeholder="${status.configured ? '•••• Re-enter to change' : 'Your Plaid secret'}">
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
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="submit" class="btn btn-primary btn-sm">Save</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="plaid-config-back">Back</button>
                    ${status.configured
                        ? '<button type="button" class="btn btn-secondary btn-sm" id="plaid-config-clear">Clear saved credentials</button>'
                        : ''}
                </div>
            </form>
        `;
    }

    function wireStatusView() {
        const setupBtn = body.querySelector('#plaid-setup-btn');
        if (setupBtn) {
            setupBtn.addEventListener('click', () => openChoiceModal());
        }

        const updateBtn = body.querySelector('#plaid-config-update');
        if (updateBtn) {
            updateBtn.addEventListener('click', () => {
                view = 'byo-form';
                render();
            });
        }

        const clearBtn = body.querySelector('#plaid-config-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', handleClear);
        }
    }

    function openChoiceModal() {
        openModal('Connect Your Bank', `
            <p style="color:var(--text-secondary);margin:0 0 16px;font-size:13px;">
                Choose how you'd like to link bank accounts and auto-import transactions.
            </p>
            <div style="display:flex;flex-direction:column;gap:12px;">
                <button type="button" id="plaid-choice-cloud" style="
                    text-align:left;
                    background:linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%);
                    color:#fff;
                    border:none;
                    border-radius:12px;
                    padding:18px 20px;
                    cursor:pointer;
                    font-family:inherit;
                    position:relative;
                    box-shadow:0 2px 8px rgba(124,58,237,0.18);
                ">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.6px;opacity:0.9;margin-bottom:6px;">RECOMMENDED</div>
                    <div style="font-size:16px;font-weight:700;margin-bottom:6px;">Upgrade to PennyHelm Cloud</div>
                    <div style="font-size:13px;opacity:0.95;line-height:1.45;">
                        Bank connections included — no Plaid account needed. Access from any device with end-to-end sync. Plans from $6.49&#8202;/&#8202;mo.
                    </div>
                </button>
                <button type="button" id="plaid-choice-byo" style="
                    text-align:left;
                    background:var(--bg-input);
                    color:var(--text-primary);
                    border:1px solid var(--border);
                    border-radius:12px;
                    padding:18px 20px;
                    cursor:pointer;
                    font-family:inherit;
                ">
                    <div style="font-size:16px;font-weight:700;margin-bottom:6px;">Bring your own Plaid key</div>
                    <div style="font-size:13px;color:var(--text-secondary);line-height:1.45;">
                        Use your own Plaid developer credentials. Free sandbox tier available at plaid.com. Technical setup required.
                    </div>
                </button>
            </div>
            <div class="modal-actions" style="margin-top:16px;">
                <button class="btn btn-secondary" id="modal-cancel" type="button">Cancel</button>
            </div>
        `);

        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('plaid-choice-cloud').addEventListener('click', () => {
            window.open(UPGRADE_URL, '_blank', 'noopener,noreferrer');
            closeModal();
        });
        document.getElementById('plaid-choice-byo').addEventListener('click', () => {
            closeModal();
            view = 'byo-form';
            render();
        });
    }

    async function handleClear() {
        if (!confirm('Remove stored Plaid credentials? Bank connections will stop working until you add new ones.')) return;
        await fetch('/api/plaid/config', { method: 'DELETE' });
        await mode().refreshPlaidStatus();
        view = 'status';
        await load();
    }

    function wireForm(prevStatus) {
        const form = body.querySelector('#plaid-config-form');
        if (!form) return;

        const backBtn = body.querySelector('#plaid-config-back');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                view = 'status';
                render();
            });
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(form).entries());
            const err = body.querySelector('#plaid-config-error');
            err.style.display = 'none';

            // The API requires a full POST; require both secrets on every save
            // so partial updates never silently keep stale values.
            if (!data.client_id || !data.secret || !data.environment) {
                err.textContent = prevStatus.configured
                    ? 'Re-enter client_id, secret, and environment to update configuration.'
                    : 'client_id, secret, and environment are all required.';
                err.style.display = 'block';
                return;
            }

            try {
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
                view = 'status';
                await load(); // re-render with new status
            } catch (ex) {
                err.textContent = ex.message || 'Save failed.';
                err.style.display = 'block';
            }
        });

        const clearBtn = body.querySelector('#plaid-config-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', handleClear);
        }
    }

    await load();
}
