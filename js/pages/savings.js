/**
 * Savings Goals — dedicated page.
 *
 * Reuses the existing store CRUD (getSavingsGoals, addSavingsGoal, etc.)
 * and adds:
 *   - Auto-sync from linked accounts (balance → currentAmount)
 *   - Monthly contribution projection ("save $X/mo → reach goal by Y")
 *   - Days / months remaining countdown
 *   - Full-page layout with progress bars and edit/delete
 */

import { openModal, closeModal, refreshPage } from '../app.js';
import { formatCurrency, escapeHtml } from '../utils.js';

const GOAL_CATEGORIES = [
    { value: 'emergency', label: 'Emergency Fund', icon: '🛡️' },
    { value: 'vacation',  label: 'Vacation',       icon: '✈️' },
    { value: 'car',       label: 'Vehicle',        icon: '🚗' },
    { value: 'home',      label: 'Home',           icon: '🏠' },
    { value: 'education', label: 'Education',      icon: '📚' },
    { value: 'retirement',label: 'Retirement',     icon: '🏖️' },
    { value: 'other',     label: 'Other',          icon: '🎯' },
];

function getCatInfo(cat) {
    return GOAL_CATEGORIES.find(c => c.value === cat) || GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
}

function monthsUntil(targetDateStr) {
    if (!targetDateStr) return null;
    const now = new Date();
    const target = new Date(targetDateStr);
    const diff = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
    return Math.max(0, diff);
}

function monthlyNeeded(remaining, targetDateStr) {
    const months = monthsUntil(targetDateStr);
    if (!months || months <= 0) return null;
    return remaining / months;
}

export function renderSavingsGoalsPage(container, store) {
    // Auto-sync from linked accounts on every render
    store.syncGoalsFromLinkedAccounts();

    const goals = store.getSavingsGoals();
    const accounts = store.getAccounts();
    const linkableAccounts = accounts.filter(a =>
        a.type === 'savings' || a.type === 'checking' || a.type === 'investment' || a.type === 'retirement'
    );

    const totalTarget = goals.reduce((s, g) => s + (g.targetAmount || 0), 0);
    const totalCurrent = goals.reduce((s, g) => s + (g.currentAmount || 0), 0);
    const overallPct = totalTarget > 0 ? (totalCurrent / totalTarget) * 100 : 0;

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Savings Goals</h1>
                <div class="subtitle">${goals.length} goal${goals.length !== 1 ? 's' : ''} &middot; ${formatCurrency(totalCurrent)} saved of ${formatCurrency(totalTarget)}</div>
            </div>
            <button class="btn btn-primary" id="add-goal-btn">+ Add Goal</button>
        </div>

        ${goals.length > 0 ? `
            <div class="card mb-24">
                <div class="settings-section">
                    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">
                        <div style="font-size:13px;color:var(--text-muted);">Overall Progress</div>
                        <div style="font-size:14px;font-weight:600;">${overallPct.toFixed(0)}%</div>
                    </div>
                    <div style="height:10px;background:var(--bg-input);border-radius:5px;overflow:hidden;">
                        <div style="height:100%;width:${Math.min(100, overallPct)}%;background:${overallPct >= 100 ? 'var(--green)' : 'var(--accent)'};transition:width 0.3s;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-top:6px;">
                        <span>${formatCurrency(totalCurrent)} saved</span>
                        <span>${formatCurrency(Math.max(0, totalTarget - totalCurrent))} remaining</span>
                    </div>
                </div>
            </div>
        ` : ''}

        ${goals.length === 0 ? `
            <div class="card">
                <div class="settings-section" style="text-align:center;padding:40px 20px;">
                    <div style="font-size:48px;margin-bottom:12px;">🎯</div>
                    <h3 class="mb-8">No savings goals yet</h3>
                    <p style="color:var(--text-secondary);margin-bottom:20px;max-width:520px;margin-left:auto;margin-right:auto;">
                        Set goals for an emergency fund, vacation, house down payment, or anything else you're saving toward.
                        Link a savings account to auto-track your progress.
                    </p>
                    <button class="btn btn-primary" id="empty-add-goal">+ Add Your First Goal</button>
                </div>
            </div>
        ` : `
            <div style="display:flex;flex-direction:column;gap:14px;">
                ${goals.map(goal => {
                    const cat = getCatInfo(goal.category);
                    const pct = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
                    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
                    const isComplete = pct >= 100;
                    const months = monthsUntil(goal.targetDate);
                    const perMonth = monthlyNeeded(remaining, goal.targetDate);
                    const linkedAcct = goal.linkedAccountId
                        ? accounts.find(a => a.id === goal.linkedAccountId)
                        : null;
                    const barColor = isComplete ? 'var(--green)' : pct >= 75 ? 'var(--accent)' : pct >= 40 ? 'var(--blue)' : 'var(--text-muted)';

                    return `
                        <div class="card goal-card-page" data-goal-id="${goal.id}" style="cursor:pointer;">
                            <div class="settings-section">
                                <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
                                    <div style="font-size:32px;">${cat.icon}</div>
                                    <div style="flex:1;">
                                        <div style="font-size:16px;font-weight:700;">${escapeHtml(goal.name)}</div>
                                        <div class="text-muted-sm">
                                            ${cat.label}
                                            ${linkedAcct ? ` &middot; <span style="color:var(--accent);">Linked to ${escapeHtml(linkedAcct.name)}</span>` : ''}
                                        </div>
                                    </div>
                                    <div style="text-align:right;">
                                        <div style="font-size:20px;font-weight:700;${isComplete ? 'color:var(--green);' : ''}">${formatCurrency(goal.currentAmount)}</div>
                                        <div class="text-muted-sm">of ${formatCurrency(goal.targetAmount)}</div>
                                    </div>
                                </div>

                                <div style="height:10px;background:var(--bg-input);border-radius:5px;overflow:hidden;margin-bottom:10px;">
                                    <div style="height:100%;width:${pct}%;background:${barColor};transition:width 0.3s;"></div>
                                </div>

                                <div style="display:flex;justify-content:space-between;font-size:12px;flex-wrap:wrap;gap:6px;">
                                    <span style="color:var(--text-muted);">${pct.toFixed(0)}% complete</span>
                                    ${isComplete
                                        ? '<span style="color:var(--green);font-weight:600;">Goal reached! 🎉</span>'
                                        : `<span style="color:var(--text-secondary);">${formatCurrency(remaining)} to go</span>`
                                    }
                                </div>

                                ${!isComplete && (months !== null || perMonth !== null || goal.targetDate) ? `
                                    <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;color:var(--text-muted);flex-wrap:wrap;">
                                        ${goal.targetDate ? `
                                            <span>Target: ${new Date(goal.targetDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                                        ` : ''}
                                        ${months !== null && months > 0 ? `
                                            <span>${months} month${months !== 1 ? 's' : ''} left</span>
                                        ` : ''}
                                        ${perMonth !== null && perMonth > 0 ? `
                                            <span style="color:var(--accent);font-weight:500;">Save ${formatCurrency(perMonth)}/mo to hit target</span>
                                        ` : ''}
                                    </div>
                                ` : ''}

                                ${goal.notes ? `
                                    <div style="font-size:12px;color:var(--text-muted);margin-top:8px;font-style:italic;">${escapeHtml(goal.notes)}</div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `}
    `;

    // Handlers
    const addBtn = container.querySelector('#add-goal-btn');
    if (addBtn) addBtn.addEventListener('click', () => showGoalForm(store, linkableAccounts));

    const emptyBtn = container.querySelector('#empty-add-goal');
    if (emptyBtn) emptyBtn.addEventListener('click', () => showGoalForm(store, linkableAccounts));

    container.querySelectorAll('.goal-card-page').forEach(card => {
        card.addEventListener('click', () => {
            const goal = store.getSavingsGoals().find(g => g.id === card.dataset.goalId);
            if (goal) showGoalForm(store, linkableAccounts, goal);
        });
    });
}

function showGoalForm(store, linkableAccounts, existing = null) {
    const isEdit = !!existing;
    const goal = existing || {
        name: '', category: 'other', targetAmount: 0, currentAmount: 0,
        targetDate: null, linkedAccountId: null, notes: '',
    };

    const html = `
        <div class="form-group">
            <label>Goal Name</label>
            <input type="text" class="form-input" id="goal-name" value="${escapeHtml(goal.name || '')}" placeholder="e.g., Emergency Fund">
        </div>
        <div class="form-group">
            <label>Category</label>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px;">
                ${GOAL_CATEGORIES.map(cat => {
                    const checked = goal.category === cat.value;
                    return `
                        <label style="display:flex;flex-direction:column;align-items:center;padding:10px 8px;border:1px solid ${checked ? 'var(--accent)' : 'var(--border)'};border-radius:6px;cursor:pointer;text-align:center;background:${checked ? 'var(--accent-bg)' : 'transparent'};">
                            <input type="radio" name="goal-category" value="${cat.value}" ${checked ? 'checked' : ''} style="display:none;">
                            <span style="font-size:20px;margin-bottom:4px;">${cat.icon}</span>
                            <span style="font-size:10px;color:var(--text-secondary);">${cat.label}</span>
                        </label>
                    `;
                }).join('')}
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Target Amount</label>
                <input type="number" class="form-input" id="goal-target" step="0.01" min="0" value="${goal.targetAmount || ''}" placeholder="10000">
            </div>
            <div class="form-group">
                <label>Current Amount</label>
                <input type="number" class="form-input" id="goal-current" step="0.01" min="0" value="${goal.currentAmount || ''}" placeholder="0"
                    ${goal.linkedAccountId ? 'disabled title="Auto-synced from linked account"' : ''}>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Target Date (optional)</label>
                <input type="month" class="form-input" id="goal-date" value="${goal.targetDate ? goal.targetDate.slice(0, 7) : ''}">
            </div>
            <div class="form-group">
                <label>Link to Account (optional)</label>
                <select class="form-select" id="goal-linked-account">
                    <option value="">— none (manual tracking) —</option>
                    ${linkableAccounts.map(a =>
                        `<option value="${a.id}" ${goal.linkedAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.type)}) — ${formatCurrency(a.balance)}</option>`
                    ).join('')}
                </select>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                    When linked, the goal's current amount auto-updates from the account balance.
                </div>
            </div>
        </div>
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" class="form-input" id="goal-notes" value="${escapeHtml(goal.notes || '')}">
        </div>
        <div class="modal-actions">
            ${isEdit ? '<button class="btn" id="modal-delete" style="margin-right:auto;color:var(--red);background:transparent;border:1px solid var(--red);">Delete</button>' : ''}
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Save Changes' : 'Add Goal'}</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Savings Goal' : 'Add Savings Goal', html);

    // Category radio visual feedback
    document.querySelectorAll('input[name="goal-category"]').forEach(radio => {
        radio.addEventListener('change', () => {
            document.querySelectorAll('input[name="goal-category"]').forEach(r => {
                r.parentElement.style.borderColor = 'var(--border)';
                r.parentElement.style.background = 'transparent';
            });
            if (radio.checked) {
                radio.parentElement.style.borderColor = 'var(--accent)';
                radio.parentElement.style.background = 'var(--accent-bg)';
            }
        });
    });

    // Toggle current-amount editability based on linked account
    const linkedSelect = document.getElementById('goal-linked-account');
    const currentInput = document.getElementById('goal-current');
    linkedSelect.addEventListener('change', () => {
        if (linkedSelect.value) {
            const acct = linkableAccounts.find(a => a.id === linkedSelect.value);
            currentInput.value = acct ? acct.balance : 0;
            currentInput.disabled = true;
            currentInput.title = 'Auto-synced from linked account';
        } else {
            currentInput.disabled = false;
            currentInput.title = '';
        }
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    document.getElementById('modal-save').addEventListener('click', () => {
        const name = document.getElementById('goal-name').value.trim();
        const category = document.querySelector('input[name="goal-category"]:checked')?.value || 'other';
        const targetAmount = parseFloat(document.getElementById('goal-target').value) || 0;
        const currentAmount = parseFloat(currentInput.value) || 0;
        const dateVal = document.getElementById('goal-date').value;
        const targetDate = dateVal ? dateVal + '-01' : null;
        const linkedAccountId = linkedSelect.value || null;
        const notes = document.getElementById('goal-notes').value.trim();

        if (!name) { alert('Please enter a goal name.'); return; }
        if (targetAmount <= 0) { alert('Target amount must be greater than 0.'); return; }

        const payload = { name, category, targetAmount, currentAmount, targetDate, linkedAccountId, notes };

        if (isEdit) {
            store.updateSavingsGoal(existing.id, payload);
        } else {
            store.addSavingsGoal(payload);
        }
        closeModal();
        refreshPage();
    });

    const deleteBtn = document.getElementById('modal-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!confirm(`Delete "${existing.name}"? This cannot be undone.`)) return;
            store.deleteSavingsGoal(existing.id);
            closeModal();
            refreshPage();
        });
    }
}
