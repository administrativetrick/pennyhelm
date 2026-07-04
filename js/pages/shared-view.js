/**
 * Shared view — read-only window into someone else's finances, scoped by
 * the RBAC role they granted you (companion / advisor / viewer / partner /
 * full). All data comes from the getSharedSnapshot Cloud Function, which
 * filters server-side: a companion grant never receives bills, expenses,
 * debts, or income — only allowlisted account balances and computed budget
 * numbers.
 *
 * Entry: settings → "Shared with me" → View (sets sessionStorage key and
 * navigates to #shared). Cloud mode only.
 */

import { formatCurrency, escapeHtml } from '../utils.js';
import { navigate } from '../app.js';

const STATE_KEY = 'pennyhelm-shared-view';

function getViewState() {
    try { return JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch (e) { return null; }
}

export function renderSharedView(container, store) {
    const state = getViewState();
    if (!state || !state.ownerUid) {
        container.innerHTML = `<div class="card" style="max-width:480px;">
            <h3>No shared finances selected</h3>
            <p style="font-size:13px;color:var(--text-secondary);margin-top:8px;">
                Open <strong>Settings → People with access → Shared with me</strong> and pick whose finances to view.
            </p></div>`;
        return;
    }

    container.innerHTML = `<div class="card"><div style="display:flex;align-items:center;gap:10px;">
        <div class="spinner" style="width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        Loading ${escapeHtml(state.ownerName || 'shared')} finances…
    </div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

    (async () => {
        let snapshot;
        try {
            const fn = firebase.functions().httpsCallable('getSharedSnapshot');
            const result = await fn({ ownerUid: state.ownerUid });
            snapshot = result.data && result.data.snapshot;
        } catch (err) {
            container.innerHTML = `<div class="card" style="max-width:520px;border-color:var(--red);">
                <h3 class="text-red">Couldn't load shared finances</h3>
                <p style="font-size:13px;color:var(--text-secondary);margin-top:8px;">${escapeHtml(err.message || 'Access may have been revoked.')}</p>
                <button class="btn btn-secondary btn-sm" style="margin-top:12px;" id="shared-back">Back to my finances</button></div>`;
            container.querySelector('#shared-back').addEventListener('click', () => navigate('dashboard'));
            return;
        }
        if (!snapshot) return;
        renderSnapshot(container, store, state, snapshot);
    })();
}

function renderSnapshot(container, store, state, snap) {
    const role = snap._shared.role;
    const ownerName = snap._shared.ownerName;

    let html = `
        <div class="card" style="margin-bottom:20px;background:var(--accent-bg);border-color:color-mix(in oklab, var(--accent) 30%, var(--border));">
            <div class="flex-between">
                <div>
                    <div style="font-size:15px;font-weight:700;">Viewing ${escapeHtml(ownerName)}'s finances</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Your access: <strong style="text-transform:capitalize;">${escapeHtml(role)}</strong>${snap._shared.canEditBudgets ? ' · you can adjust budgets' : ' · read-only'}</div>
                </div>
                <button class="btn btn-secondary btn-sm" id="shared-back">Back to my finances</button>
            </div>
        </div>`;

    // ── Accounts (all roles; companion sees only allowlisted) ──
    if ((snap.accounts || []).length > 0) {
        html += `<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Accounts</h3>
        <div class="card-grid">` + snap.accounts.map(a => `
            <div class="stat-card ${a.balance >= 0 ? 'green' : 'red'}">
                <div class="label">${escapeHtml(a.name)}</div>
                <div class="value">${formatCurrency(a.balance)}</div>
                <div class="sub" style="text-transform:capitalize;">${escapeHtml(a.type || '')}</div>
            </div>`).join('') + `</div>`;
    }

    // ── Budgets (all roles) ──
    const statuses = ((snap.budgets || {}).statuses || []).filter(s => !s.notStarted);
    if (statuses.length > 0) {
        const t = snap.budgets.totals || {};
        html += `
        <div class="card" style="margin-bottom:20px;">
            <div class="flex-between mb-16">
                <h3>Budgets · ${escapeHtml(snap.budgets.asOfMonth)}</h3>
                <span style="font-size:13px;color:${(t.remaining ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600;">
                    ${formatCurrency(t.spent || 0)} spent · ${formatCurrency(Math.abs(t.remaining || 0))} ${(t.remaining ?? 0) >= 0 ? 'left' : 'over'}
                </span>
            </div>
            <div style="display:flex;flex-direction:column;gap:14px;">` + statuses.map(s => {
                const over = s.remaining < 0;
                const pct = Math.min(100, Math.round((s.available > 0 ? s.spent / s.available : 0) * 100));
                const label = s.tag ? `#${s.tag}` : s.category;
                const targetKey = s.tag ? `tag:${s.tag}` : `cat:${s.category}`;
                return `
                <div>
                    <div class="flex-between" style="margin-bottom:5px;">
                        <span style="font-size:13px;font-weight:600;${s.tag ? 'color:var(--purple);' : 'text-transform:capitalize;'}">${escapeHtml(label)}</span>
                        <span style="font-size:12.5px;color:${over ? 'var(--red)' : 'var(--text-secondary)'};font-variant-numeric:tabular-nums;">
                            ${formatCurrency(s.spent)} of ${formatCurrency(s.available)} · ${over ? formatCurrency(-s.remaining) + ' over' : formatCurrency(s.remaining) + ' left'}
                            ${snap._shared.canEditBudgets ? `<button class="btn-icon shared-edit-budget" data-target="${escapeHtml(targetKey)}" title="Adjust budget" style="margin-left:6px;">✏️</button>` : ''}
                        </span>
                    </div>
                    <div style="height:8px;border-radius:5px;background:var(--bg-input);overflow:hidden;">
                        <div style="height:100%;border-radius:5px;width:${pct}%;background:${over ? 'var(--red)' : 'var(--accent)'};"></div>
                    </div>
                </div>`;
            }).join('') + `</div></div>`;
    } else {
        html += `<div class="card" style="margin-bottom:20px;"><div style="font-size:13px;color:var(--text-muted);">No budgets set up yet.</div></div>`;
    }

    // ── Advisor+ sections ──
    if (snap.debts) {
        html += `<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Debts</h3><div class="card" style="margin-bottom:20px;">` +
            (snap.debts.length === 0 ? '<div style="font-size:13px;color:var(--text-muted);">No debts.</div>' :
            snap.debts.map(d => `
            <div class="settings-row">
                <div><div class="setting-label">${escapeHtml(d.name)}</div>
                <div class="setting-desc">${escapeHtml(d.type || '')}${d.interestRate ? ` · ${d.interestRate}% APR` : ''}${d.minimumPayment ? ` · min ${formatCurrency(d.minimumPayment)}` : ''}</div></div>
                <div class="text-red" style="font-weight:600;font-variant-numeric:tabular-nums;">${formatCurrency(d.currentBalance || 0)}</div>
            </div>`).join('')) + `</div>`;
    }

    if (snap.savingsGoals && snap.savingsGoals.length > 0) {
        html += `<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Savings goals</h3><div class="card-grid">` +
            snap.savingsGoals.map(g => `
            <div class="stat-card green">
                <div class="label">${escapeHtml(g.name)}</div>
                <div class="value">${formatCurrency(g.currentAmount || 0)}</div>
                <div class="sub">of ${formatCurrency(g.targetAmount || 0)}</div>
            </div>`).join('') + `</div>`;
    }

    if (snap.bills) {
        html += `<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Bills (${snap.bills.length})</h3><div class="card" style="margin-bottom:20px;">` +
            snap.bills.slice(0, 100).map(b => `
            <div class="settings-row">
                <div><div class="setting-label">${escapeHtml(b.name)}</div>
                <div class="setting-desc">${escapeHtml(b.category || '')}${b.dueDay ? ` · due ${b.dueDay}` : ''}</div></div>
                <div style="font-weight:600;font-variant-numeric:tabular-nums;">${formatCurrency(b.amount || 0)}</div>
            </div>`).join('') + `</div>`;
    }

    container.innerHTML = html;
    container.querySelector('#shared-back').addEventListener('click', () => {
        sessionStorage.removeItem(STATE_KEY);
        navigate('dashboard');
    });

    // Companion/advisor budget adjustment (requires canEditBudgets grant) —
    // sends the full replacement config set through sharedUpdateBudget.
    container.querySelectorAll('.shared-edit-budget').forEach(btn => {
        btn.addEventListener('click', async () => {
            const [kind, ...rest] = btn.dataset.target.split(':');
            const name = rest.join(':');
            const configs = snap.budgetConfigs || [];
            const target = kind === 'tag'
                ? configs.find(c => String(c.tag || '').toLowerCase() === name.toLowerCase())
                : configs.find(c => !c.tag && String(c.category || '').toLowerCase() === name.toLowerCase());
            if (!target) { alert('This budget cannot be adjusted.'); return; }
            const input = prompt(`New monthly amount for ${kind === 'tag' ? '#' + name : name}:`, target.monthlyAmount);
            if (input === null) return;
            const amount = parseFloat(input);
            if (!Number.isFinite(amount) || amount <= 0) { alert('Enter a positive number.'); return; }
            try {
                const fn = firebase.functions().httpsCallable('sharedUpdateBudget');
                const updated = configs.map(c => c === target ? { ...c, monthlyAmount: amount } : c);
                await fn({ ownerUid: state.ownerUid, budgets: updated });
                renderSharedView(container, store); // reload fresh snapshot
            } catch (err) {
                alert('Could not update the budget: ' + (err.message || 'permission denied'));
            }
        });
    });
}
