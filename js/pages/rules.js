/**
 * Transaction Rules page.
 *
 * CRUD for user-defined categorization rules. Rules auto-apply to new
 * transactions imported from Plaid; a "Re-run on all expenses" button
 * retroactively applies them to existing ones.
 */

import { openModal, closeModal, refreshPage } from '../app.js';
import { escapeHtml } from '../utils.js';

const MATCH_FIELDS = [
    { value: 'name',     label: 'Transaction name' },
    { value: 'vendor',   label: 'Vendor / merchant' },
    { value: 'amount',   label: 'Amount' },
    { value: 'category', label: 'Current category' },
];

const MATCH_OPS_STRING = [
    { value: 'contains', label: 'contains' },
    { value: 'equals',   label: 'equals (exact)' },
    { value: 'regex',    label: 'matches regex' },
];

const MATCH_OPS_NUMBER = [
    { value: 'equals', label: 'equals' },
    { value: 'gt',     label: 'is greater than' },
    { value: 'gte',    label: 'is at least' },
    { value: 'lt',     label: 'is less than' },
    { value: 'lte',    label: 'is at most' },
];

function opsFor(field) {
    return field === 'amount' ? MATCH_OPS_NUMBER : MATCH_OPS_STRING;
}

function opLabel(op) {
    return [...MATCH_OPS_STRING, ...MATCH_OPS_NUMBER].find(o => o.value === op)?.label || op;
}

function fieldLabel(field) {
    return MATCH_FIELDS.find(f => f.value === field)?.label || field;
}

function actionSummary(actions) {
    const parts = [];
    if (actions.category) parts.push(`set category → <code>${escapeHtml(actions.category)}</code>`);
    if (actions.rename) parts.push(`rename → <code>${escapeHtml(actions.rename)}</code>`);
    if (Array.isArray(actions.addTags) && actions.addTags.length) {
        parts.push(`add tags: ${actions.addTags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join(' ')}`);
    }
    if (actions.ignore) parts.push('<em>mark as ignored</em>');
    return parts.join(' &middot; ') || '<em>no actions</em>';
}

export function renderRules(container, store) {
    const rules = store.getRules()
        .slice()
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Transaction Rules</h1>
                <div class="subtitle">${rules.length} rule${rules.length !== 1 ? 's' : ''} configured &middot; auto-applied to new Plaid imports</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" id="reapply-rules-btn" ${rules.length === 0 ? 'disabled' : ''}>Re-run on all expenses</button>
                <button class="btn btn-primary" id="add-rule-btn">+ Add Rule</button>
            </div>
        </div>

        <div class="card mb-24">
            <div class="settings-section">
                <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0;">
                    Rules run in priority order on every imported transaction. Each matching rule
                    applies its actions in sequence — later rules can override earlier ones, so you
                    can set up broad defaults and then specific overrides.
                </p>
            </div>
        </div>

        ${rules.length === 0 ? `
            <div class="card">
                <div class="settings-section" style="text-align:center;padding:40px 20px;">
                    <div style="font-size:40px;margin-bottom:12px;">🪄</div>
                    <h3 style="margin-bottom:8px;">No rules yet</h3>
                    <p style="color:var(--text-secondary);margin-bottom:20px;">
                        Rules auto-categorize transactions as they're imported. For example:
                        <em>"Vendor contains 'STARBUCKS' → category = Coffee"</em>.
                    </p>
                    <button class="btn btn-primary" id="empty-add-rule">+ Add Your First Rule</button>
                </div>
            </div>
        ` : `
            <div class="card">
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th style="width:40px;">#</th>
                                <th>Rule</th>
                                <th>When</th>
                                <th>Do</th>
                                <th style="width:80px;">Active</th>
                                <th style="width:110px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rules.map((r, i) => `
                                <tr ${r.enabled ? '' : 'style="opacity:0.5;"'}>
                                    <td style="color:var(--text-muted);">${i + 1}</td>
                                    <td><div style="font-weight:600;">${escapeHtml(r.name)}</div></td>
                                    <td style="font-size:13px;">
                                        <code>${escapeHtml(fieldLabel(r.match.field))}</code>
                                        ${escapeHtml(opLabel(r.match.op))}
                                        <code>${escapeHtml(String(r.match.value))}</code>
                                    </td>
                                    <td style="font-size:13px;">${actionSummary(r.actions)}</td>
                                    <td>
                                        <input type="checkbox" class="rule-enable-toggle" data-rule-id="${r.id}" ${r.enabled ? 'checked' : ''}>
                                    </td>
                                    <td>
                                        <div style="display:flex;gap:4px;">
                                            <button class="btn-icon edit-rule" data-rule-id="${r.id}" title="Edit">
                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                            </button>
                                            <button class="btn-icon delete-rule" data-rule-id="${r.id}" title="Delete" style="color:var(--red);">
                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `}
    `;

    const add = () => showRuleForm(store);

    const addBtn = container.querySelector('#add-rule-btn');
    if (addBtn) addBtn.addEventListener('click', add);

    const emptyBtn = container.querySelector('#empty-add-rule');
    if (emptyBtn) emptyBtn.addEventListener('click', add);

    container.querySelectorAll('.edit-rule').forEach(btn => {
        btn.addEventListener('click', () => {
            const rule = store.getRules().find(r => r.id === btn.dataset.ruleId);
            if (rule) showRuleForm(store, rule);
        });
    });

    container.querySelectorAll('.delete-rule').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this rule? Existing expenses keep their current categorization.')) return;
            store.deleteRule(btn.dataset.ruleId);
            refreshPage();
        });
    });

    container.querySelectorAll('.rule-enable-toggle').forEach(chk => {
        chk.addEventListener('change', () => {
            store.updateRule(chk.dataset.ruleId, { enabled: chk.checked });
            refreshPage();
        });
    });

    const reapply = container.querySelector('#reapply-rules-btn');
    if (reapply) {
        reapply.addEventListener('click', () => {
            if (!confirm('Re-apply all enabled rules to every existing expense? Manual edits that rules would overwrite will be lost.')) return;
            const changed = store.reapplyRulesToAllExpenses();
            alert(`Updated ${changed} expense${changed === 1 ? '' : 's'}.`);
            refreshPage();
        });
    }
}

function showRuleForm(store, existing = null) {
    const isEdit = !!existing;
    const rule = existing || {
        name: '',
        enabled: true,
        match: { field: 'vendor', op: 'contains', value: '' },
        actions: { category: '', addTags: [], rename: '', ignore: false },
    };

    const html = `
        <div class="form-group">
            <label>Rule name</label>
            <input type="text" class="form-input" id="rule-name" value="${escapeHtml(rule.name)}" placeholder="e.g., Coffee shops">
        </div>

        <h4 style="margin:16px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">When</h4>
        <div class="form-row">
            <div class="form-group">
                <label>Field</label>
                <select class="form-select" id="rule-match-field">
                    ${MATCH_FIELDS.map(f =>
                        `<option value="${f.value}" ${rule.match.field === f.value ? 'selected' : ''}>${f.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Operator</label>
                <select class="form-select" id="rule-match-op"></select>
            </div>
        </div>
        <div class="form-group">
            <label>Value</label>
            <input type="text" class="form-input" id="rule-match-value" value="${escapeHtml(String(rule.match.value ?? ''))}" placeholder="e.g., STARBUCKS">
        </div>

        <h4 style="margin:16px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Then</h4>
        <div class="form-group">
            <label>Set category (optional)</label>
            <input type="text" class="form-input" id="rule-action-category" value="${escapeHtml(rule.actions.category || '')}" placeholder="e.g., coffee">
        </div>
        <div class="form-group">
            <label>Add tags (comma-separated, optional)</label>
            <input type="text" class="form-input" id="rule-action-tags" value="${escapeHtml((rule.actions.addTags || []).join(', '))}" placeholder="e.g., weekly, discretionary">
        </div>
        <div class="form-group">
            <label>Rename transaction (optional)</label>
            <input type="text" class="form-input" id="rule-action-rename" value="${escapeHtml(rule.actions.rename || '')}" placeholder="Leave blank to keep original name">
        </div>
        <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="rule-action-ignore" ${rule.actions.ignore ? 'checked' : ''}>
                Mark matching transactions as ignored (excluded from reports)
            </label>
        </div>

        <div id="rule-form-error" style="color:var(--red);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update Rule' : 'Add Rule'}</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Rule' : 'Add Rule', html);

    const fieldSel = document.getElementById('rule-match-field');
    const opSel = document.getElementById('rule-match-op');

    function renderOps() {
        const currentField = fieldSel.value;
        const ops = opsFor(currentField);
        const prev = opSel.value;
        opSel.innerHTML = ops.map(o =>
            `<option value="${o.value}" ${rule.match.op === o.value || prev === o.value ? 'selected' : ''}>${o.label}</option>`
        ).join('');
    }
    renderOps();
    fieldSel.addEventListener('change', renderOps);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const tagsRaw = document.getElementById('rule-action-tags').value;
        const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
        const category = document.getElementById('rule-action-category').value.trim();
        const rename = document.getElementById('rule-action-rename').value.trim();
        const ignore = document.getElementById('rule-action-ignore').checked;

        const field = fieldSel.value;
        const op = opSel.value;
        let value = document.getElementById('rule-match-value').value.trim();
        if (field === 'amount') value = Number(value);

        const payload = {
            name: document.getElementById('rule-name').value.trim(),
            match: { field, op, value },
            actions: {
                category: category || undefined,
                addTags: tags.length > 0 ? tags : undefined,
                rename: rename || undefined,
                ignore: ignore ? true : undefined,
            },
        };
        // Strip undefined so validateRule sees a clean object
        Object.keys(payload.actions).forEach(k => payload.actions[k] === undefined && delete payload.actions[k]);

        const err = document.getElementById('rule-form-error');
        try {
            if (isEdit) {
                store.updateRule(existing.id, payload);
            } else {
                store.addRule(payload);
            }
            closeModal();
            refreshPage();
        } catch (ex) {
            err.textContent = ex.message;
            err.style.display = 'block';
        }
    });
}
