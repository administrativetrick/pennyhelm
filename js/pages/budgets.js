/**
 * Category budgets page.
 *
 * Set a monthly limit per expense category. Spending is derived from the
 * existing expenses list — nothing separate to track. Optional rollover
 * carries unused (or overspent) amounts into the next month.
 */

import { openModal, closeModal, refreshPage } from '../app.js';
import { formatCurrency, escapeHtml } from '../utils.js';
import { EXPENSE_CATEGORIES, getAllExpenseCategories, renderCategoryOptions, mountSearchableCategoryPicker } from '../expense-categories.js';
import { monthKey, addMonth } from '../services/budget-service.js';

// Track the month the page is currently showing. Defaults to the current month
// on first load; the user can page back/forward to review history.
let viewMonth = null;
let activeTab = 'status'; // 'status' | 'variance'

function formatMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

function progressBar(status) {
    const pct = Math.min(100, (status.pctUsed || 0) * 100);
    const overBudget = status.remaining < -0.005;
    const almost = !overBudget && status.pctUsed >= 0.9;
    const color = overBudget ? 'var(--red)' : almost ? 'var(--orange)' : 'var(--green)';
    return `
        <div style="height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${isFinite(pct) ? pct : 100}%;background:${color};transition:width 0.2s;"></div>
        </div>
    `;
}

export function renderBudgets(container, store) {
    if (!viewMonth) viewMonth = monthKey();

    const budgets = store.getBudgets();
    const statuses = store.getBudgetStatuses(viewMonth);
    const totals = store.getBudgetTotals(viewMonth);

    // Sort: started-and-active first, then by largest overage, then alphabetical.
    const sorted = [...statuses].sort((a, b) => {
        if (a.notStarted !== b.notStarted) return a.notStarted ? 1 : -1;
        const aOver = a.remaining < 0 ? 1 : 0;
        const bOver = b.remaining < 0 ? 1 : 0;
        if (aOver !== bOver) return bOver - aOver;
        return (a.category || '').localeCompare(b.category || '');
    });

    const isCurrentMonth = viewMonth === monthKey();

    const showVariance = activeTab === 'variance' && budgets.length > 0;

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Category Budgets</h1>
                <div class="subtitle">${budgets.length} budget${budgets.length !== 1 ? 's' : ''}${showVariance ? ' &middot; variance across the last 6 months' : ` &middot; ${formatMonth(viewMonth)}${isCurrentMonth ? ' &middot; current month' : ''}`}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                ${showVariance ? '' : `
                    <button class="btn btn-secondary btn-sm" id="month-prev" title="Previous month">&larr;</button>
                    <button class="btn btn-secondary btn-sm" id="month-today" ${isCurrentMonth ? 'disabled' : ''}>Today</button>
                    <button class="btn btn-secondary btn-sm" id="month-next" ${isCurrentMonth ? 'disabled' : ''} title="Next month">&rarr;</button>
                `}
                <button class="btn btn-primary" id="add-budget-btn">+ Add Budget</button>
            </div>
        </div>

        ${budgets.length === 0 ? '' : `
            <div style="margin-bottom:16px;display:flex;gap:8px;">
                <button class="filter-chip ${activeTab === 'status' ? 'active' : ''}" data-tab="status">Status</button>
                <button class="filter-chip ${activeTab === 'variance' ? 'active' : ''}" data-tab="variance">Variance Report</button>
            </div>
        `}

        ${showVariance ? renderVarianceReport(store, budgets) : ''}

        ${showVariance || budgets.length === 0 ? '' : `
            <div class="card mb-24">
                <div class="settings-section">
                    <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:16px;">
                        <div>
                            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);">Monthly limit</div>
                            <div style="font-size:22px;font-weight:700;margin-top:4px;">${formatCurrency(totals.monthlyAmount)}</div>
                        </div>
                        <div>
                            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);">Rolled in</div>
                            <div style="font-size:22px;font-weight:700;margin-top:4px;color:${totals.rolledIn >= 0 ? 'var(--green)' : 'var(--red)'};">${totals.rolledIn >= 0 ? '+' : ''}${formatCurrency(totals.rolledIn)}</div>
                        </div>
                        <div>
                            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);">Spent</div>
                            <div style="font-size:22px;font-weight:700;margin-top:4px;color:var(--red);">${formatCurrency(totals.spent)}</div>
                        </div>
                        <div>
                            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);">Remaining</div>
                            <div style="font-size:22px;font-weight:700;margin-top:4px;color:${totals.remaining >= 0 ? 'var(--green)' : 'var(--red)'};">${formatCurrency(totals.remaining)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `}

        ${showVariance ? '' : (budgets.length === 0 ? `
            <div class="card">
                <div class="settings-section" style="text-align:center;padding:40px 20px;">
                    <div style="font-size:40px;margin-bottom:12px;">🎯</div>
                    <h3 style="margin-bottom:8px;">No budgets yet</h3>
                    <p style="color:var(--text-secondary);margin-bottom:20px;max-width:520px;margin-left:auto;margin-right:auto;">
                        Set a monthly limit per category. Spending is tracked automatically
                        from your expenses. Optionally enable rollover to carry unused
                        (or overspent) amounts into the next month.
                    </p>
                    <button class="btn btn-primary" id="empty-add-budget">+ Add Your First Budget</button>
                </div>
            </div>
        ` : `
            <div style="display:flex;flex-direction:column;gap:12px;">
                ${sorted.map(s => {
                    const budget = budgets.find(b => b.category === s.category);
                    const catMeta = getAllExpenseCategories(store)[s.category] || getAllExpenseCategories(store)['other'];
                    const label = catMeta.label;
                    const color = catMeta.color;
                    if (s.notStarted) {
                        return `
                            <div class="card" style="opacity:0.5;">
                                <div class="settings-row" style="gap:16px;">
                                    <div style="flex:1;">
                                        <div style="font-weight:600;">${escapeHtml(label)}</div>
                                        <div style="font-size:12px;color:var(--text-muted);">Starts ${budget?.startMonth ? formatMonth(budget.startMonth) : '—'}</div>
                                    </div>
                                    <div style="display:flex;gap:4px;">
                                        <button class="btn-icon edit-budget" data-budget-id="${budget?.id || ''}" title="Edit"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                                        <button class="btn-icon delete-budget" data-budget-id="${budget?.id || ''}" title="Delete" style="color:var(--red);"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                    const overBudget = s.remaining < -0.005;
                    const rolloverNote = budget.rollover
                        ? (Math.abs(s.rolledIn) > 0.005
                            ? `<span style="color:${s.rolledIn >= 0 ? 'var(--green)' : 'var(--red)'};">${s.rolledIn >= 0 ? '+' : ''}${formatCurrency(s.rolledIn)} rolled in</span>`
                            : '<span style="color:var(--text-muted);">rollover enabled</span>')
                        : '';
                    return `
                        <div class="card">
                            <div class="settings-section">
                                <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                                    <div style="width:12px;height:12px;border-radius:3px;background:${color};"></div>
                                    <div style="flex:1;font-weight:600;font-size:15px;">${escapeHtml(label)}</div>
                                    <div style="display:flex;gap:4px;">
                                        <button class="btn-icon edit-budget" data-budget-id="${budget.id}" title="Edit"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                                        <button class="btn-icon delete-budget" data-budget-id="${budget.id}" title="Delete" style="color:var(--red);"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
                                    </div>
                                </div>
                                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
                                    <div style="font-size:20px;font-weight:700;color:${overBudget ? 'var(--red)' : 'var(--text-primary)'};">
                                        ${formatCurrency(s.spent)} <span style="font-size:13px;color:var(--text-muted);font-weight:500;">of ${formatCurrency(s.available)}</span>
                                    </div>
                                    <div style="font-size:13px;color:${overBudget ? 'var(--red)' : 'var(--text-secondary)'};font-weight:600;">
                                        ${overBudget ? `${formatCurrency(Math.abs(s.remaining))} over` : `${formatCurrency(s.remaining)} left`}
                                    </div>
                                </div>
                                ${progressBar(s)}
                                <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:var(--text-muted);flex-wrap:wrap;gap:6px;">
                                    <span>${formatCurrency(s.monthlyAmount)}/mo limit</span>
                                    ${s.billSpent > 0
                                        ? `<span>Bills ${formatCurrency(s.billSpent)} &middot; Expenses ${formatCurrency(s.expenseSpent)}</span>`
                                        : ''}
                                    <span>${rolloverNote}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `)}
    `;

    // Tab switch
    container.querySelectorAll('.filter-chip[data-tab]').forEach(chip => {
        chip.addEventListener('click', () => {
            activeTab = chip.dataset.tab;
            refreshPage();
        });
    });

    // Month navigation
    const prev = container.querySelector('#month-prev');
    const next = container.querySelector('#month-next');
    const today = container.querySelector('#month-today');
    if (prev) prev.addEventListener('click', () => { viewMonth = addMonth(viewMonth, -1); refreshPage(); });
    if (next) next.addEventListener('click', () => { viewMonth = addMonth(viewMonth, 1); refreshPage(); });
    if (today) today.addEventListener('click', () => { viewMonth = monthKey(); refreshPage(); });

    const add = () => showBudgetForm(store);
    const addBtn = container.querySelector('#add-budget-btn');
    if (addBtn) addBtn.addEventListener('click', add);
    const emptyBtn = container.querySelector('#empty-add-budget');
    if (emptyBtn) emptyBtn.addEventListener('click', add);

    container.querySelectorAll('.edit-budget').forEach(btn => {
        btn.addEventListener('click', () => {
            const budget = store.getBudgets().find(b => b.id === btn.dataset.budgetId);
            if (budget) showBudgetForm(store, budget);
        });
    });

    container.querySelectorAll('.delete-budget').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this budget? Your expense history is unaffected — only the target and rollover state go away.')) return;
            store.deleteBudget(btn.dataset.budgetId);
            refreshPage();
        });
    });
}

function showBudgetForm(store, existing = null) {
    const isEdit = !!existing;
    const budget = existing || {
        category: 'groceries',
        monthlyAmount: 0,
        rollover: false,
        startMonth: monthKey(),
        notes: '',
    };

    const html = `
        <div class="form-group">
            <label>Category</label>
            <select class="form-select" id="budget-category" ${isEdit ? 'disabled' : ''}>
                ${renderCategoryOptions(budget.category, store)}
            </select>
            ${isEdit ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Category is locked once a budget is created — delete and re-add to change.</div>' : ''}
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Monthly limit</label>
                <input type="number" step="0.01" class="form-input" id="budget-amount" value="${budget.monthlyAmount || ''}" placeholder="0.00">
            </div>
            <div class="form-group">
                <label>Start month</label>
                <input type="month" class="form-input" id="budget-start-month" value="${escapeHtml(budget.startMonth || monthKey())}">
            </div>
        </div>
        <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="budget-rollover" ${budget.rollover ? 'checked' : ''}>
                <span>
                    <strong>Roll unused amounts into next month</strong>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                        Under-spent months carry forward as extra headroom; over-spent months carry forward as a debit.
                    </div>
                </span>
            </label>
        </div>
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" class="form-input" id="budget-notes" value="${escapeHtml(budget.notes || '')}">
        </div>
        <div id="budget-form-error" style="color:var(--red);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update Budget' : 'Add Budget'}</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Budget' : 'Add Budget', html);

    // Searchable category picker (only on new budgets — category is locked on edit)
    if (!isEdit) {
        mountSearchableCategoryPicker(document.getElementById('budget-category'), store);
    }

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const payload = {
            category: document.getElementById('budget-category').value,
            monthlyAmount: Number(document.getElementById('budget-amount').value) || 0,
            rollover: document.getElementById('budget-rollover').checked,
            startMonth: document.getElementById('budget-start-month').value || monthKey(),
            notes: document.getElementById('budget-notes').value.trim(),
        };

        const err = document.getElementById('budget-form-error');
        try {
            if (isEdit) {
                store.updateBudget(existing.id, payload);
            } else {
                // Guard against duplicates (store.addBudget replaces, but surface the intent)
                const dup = store.getBudgets().find(b => b.category === payload.category);
                if (dup) {
                    if (!confirm(`A budget already exists for ${getAllExpenseCategories(store)[payload.category]?.label || payload.category}. Replace it?`)) return;
                }
                store.addBudget(payload);
            }
            closeModal();
            refreshPage();
        } catch (ex) {
            err.textContent = ex.message;
            err.style.display = 'block';
        }
    });
}

// ─── Variance report ──────────────────────────────────────────

/**
 * 6-month grid of actual vs budget per category. Negative variance =
 * under-spent (good). Positive variance = over-spent (bad).
 */
function renderVarianceReport(store, budgets) {
    // Build last 6 months ending with current month, in chronological order.
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(addMonth(monthKey(), -i));

    // Precompute statuses: rows = budgets, cols = months
    const rows = budgets.map(budget => {
        const cells = months.map(m => {
            const status = store.getBudgetStatuses(m).find(s => s.category === budget.category);
            if (!status || status.notStarted) return { notStarted: true };
            const variance = status.spent - status.monthlyAmount;
            return {
                spent: status.spent,
                target: status.monthlyAmount,
                variance,
                pctUsed: status.pctUsed,
            };
        });
        const started = cells.filter(c => !c.notStarted);
        const avgVariance = started.length > 0
            ? started.reduce((s, c) => s + c.variance, 0) / started.length
            : 0;
        return { budget, cells, avgVariance };
    });

    // Column totals (across categories)
    const colTotals = months.map((_, colIdx) => {
        const liveCells = rows.map(r => r.cells[colIdx]).filter(c => !c.notStarted);
        return {
            spent: liveCells.reduce((s, c) => s + c.spent, 0),
            target: liveCells.reduce((s, c) => s + c.target, 0),
            variance: liveCells.reduce((s, c) => s + c.variance, 0),
        };
    });

    return `
        <div class="card">
            <div class="settings-section">
                <p style="font-size:13px;color:var(--text-secondary);margin:0 0 12px;line-height:1.6;">
                    Each cell shows <strong>actual ÷ target</strong> with the variance below. Green = under budget,
                    red = over. Bills tagged with a category count toward their matching budget.
                </p>
                <div class="table-wrapper">
                    <table style="font-size:13px;">
                        <thead>
                            <tr>
                                <th style="text-align:left;">Category</th>
                                ${months.map(m => `<th style="text-align:right;white-space:nowrap;">${formatMonth(m).replace(/ \d{4}$/, '')}</th>`).join('')}
                                <th style="text-align:right;">Avg variance</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => {
                                const cat = getAllExpenseCategories(store)[r.budget.category] || getAllExpenseCategories(store)['other'];
                                return `
                                    <tr>
                                        <td style="font-weight:600;">
                                            <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${cat.color};margin-right:6px;vertical-align:middle;"></span>
                                            ${escapeHtml(cat.label)}
                                        </td>
                                        ${r.cells.map(c => {
                                            if (c.notStarted) {
                                                return `<td style="text-align:right;color:var(--text-muted);">—</td>`;
                                            }
                                            const over = c.variance > 0.005;
                                            const under = c.variance < -0.005;
                                            const color = over ? 'var(--red)' : under ? 'var(--green)' : 'var(--text-primary)';
                                            return `
                                                <td style="text-align:right;white-space:nowrap;">
                                                    <div>${formatCurrency(c.spent)} / ${formatCurrency(c.target)}</div>
                                                    <div style="font-size:11px;color:${color};">
                                                        ${over ? '+' : ''}${formatCurrency(c.variance)}
                                                    </div>
                                                </td>
                                            `;
                                        }).join('')}
                                        <td style="text-align:right;white-space:nowrap;font-weight:600;color:${r.avgVariance > 0.005 ? 'var(--red)' : r.avgVariance < -0.005 ? 'var(--green)' : 'var(--text-primary)'};">
                                            ${r.avgVariance > 0 ? '+' : ''}${formatCurrency(r.avgVariance)}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                        <tfoot>
                            <tr style="border-top:2px solid var(--border);">
                                <td style="font-weight:700;">Total</td>
                                ${colTotals.map(t => {
                                    const color = t.variance > 0.005 ? 'var(--red)' : t.variance < -0.005 ? 'var(--green)' : 'var(--text-primary)';
                                    return `
                                        <td style="text-align:right;white-space:nowrap;font-weight:600;">
                                            <div>${formatCurrency(t.spent)} / ${formatCurrency(t.target)}</div>
                                            <div style="font-size:11px;color:${color};">
                                                ${t.variance > 0 ? '+' : ''}${formatCurrency(t.variance)}
                                            </div>
                                        </td>
                                    `;
                                }).join('')}
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    `;
}
