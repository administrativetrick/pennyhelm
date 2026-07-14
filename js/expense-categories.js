/**
 * Web category rendering — HTML badge, <select> options, and the searchable
 * picker. The canonical category DATA and pure lookups live in
 * js/services/category-service.js (shared with functions + mobile); this file
 * re-exports them so existing `../expense-categories.js` imports keep working.
 */

import { escapeHtml } from './utils.js';
import {
    EXPENSE_CATEGORIES,
    normalizeCategoryKey,
    getCategoryGroups,
    getAllExpenseCategories,
    getCategoryLabel,
    getCategoryColor,
    getCategoryOptionList,
} from './services/category-service.js';

export {
    EXPENSE_CATEGORIES,
    normalizeCategoryKey,
    getCategoryGroups,
    getAllExpenseCategories,
    getCategoryLabel,
    getCategoryColor,
    getCategoryOptionList,
};


export function getExpenseCategoryBadge(category, store) {
    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    const cat = all[category] || all['other'];
    return `<span class="badge" style="background:${cat.color}20;color:${cat.color};border:1px solid ${cat.color}40;">${escapeHtml(cat.label)}</span>`;
}

/**
 * Render a grouped <optgroup> dropdown with a "Create new..." option at the bottom.
 * Returns the inner HTML for a <select> element.
 */
export function renderCategoryOptions(selectedKey, store) {
    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    const groups = {};
    for (const [key, cat] of Object.entries(all)) {
        const g = cat.group || 'Other';
        if (!groups[g]) groups[g] = [];
        groups[g].push({ key, ...cat });
    }

    let html = '<option value="">— select a category —</option>';
    for (const [groupName, cats] of Object.entries(groups)) {
        html += `<optgroup label="${groupName}">`;
        for (const c of cats) {
            html += `<option value="${c.key}" ${c.key === selectedKey ? 'selected' : ''}>${escapeHtml(c.label)}</option>`;
        }
        html += '</optgroup>';
    }
    html += '<optgroup label="───────────"><option value="__create_new__">+ Create new category...</option></optgroup>';
    return html;
}

// ─── Searchable category picker ───────────────────

/**
 * Replace a plain <select> with a searchable text input + dropdown.
 * The hidden <select> retains the selected value for form reads.
 *
 * @param {HTMLSelectElement} selectEl — the <select> to enhance
 * @param {object} store — for custom categories
 * @param {object} [opts]
 * @param {Function} [opts.onCreateNew] — called when user picks "+ Create new"
 */
export function mountSearchableCategoryPicker(selectEl, store, opts = {}) {
    if (!selectEl || selectEl.dataset.searchable === 'true') return; // already mounted
    selectEl.dataset.searchable = 'true';

    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    const entries = Object.entries(all).map(([key, cat]) => ({
        key, label: cat.label, group: cat.group || 'Other', color: cat.color,
    }));

    // Build wrapper
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;';
    selectEl.parentNode.insertBefore(wrapper, selectEl);

    // Hidden select stays for value reads
    selectEl.style.display = 'none';
    wrapper.appendChild(selectEl);

    // Text input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.placeholder = 'Search categories...';
    input.autocomplete = 'off';
    input.style.cssText = 'width:100%;';
    // Pre-fill with current selection label
    const currentKey = selectEl.value;
    if (currentKey && all[currentKey]) {
        input.value = all[currentKey].label;
    }
    wrapper.appendChild(input);

    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;max-height:260px;overflow-y:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:0 0 6px 6px;z-index:100;display:none;box-shadow:0 8px 24px rgba(0,0,0,0.2);';
    wrapper.appendChild(dropdown);

    // Common categories shown at the top when no filter is active
    const COMMON_KEYS = [
        'groceries', 'dining', 'gas', 'rent', 'mortgage', 'utilities',
        'electric', 'internet', 'phone', 'streaming', 'subscriptions',
        'coffee', 'shopping', 'clothing', 'healthcare', 'pharmacy',
        'gym', 'car-insurance', 'car-payment', 'car-maintenance',
        'childcare', 'pet-food', 'gifts', 'entertainment',
    ];

    function renderDropdown(filter) {
        const q = (filter || '').toLowerCase();
        const groups = {};
        for (const e of entries) {
            if (q && !e.label.toLowerCase().includes(q) && !e.group.toLowerCase().includes(q) && !e.key.includes(q)) continue;
            if (!groups[e.group]) groups[e.group] = [];
            groups[e.group].push(e);
        }

        let html = '';

        // When no filter, show common categories first for quick selection
        if (!q) {
            const common = COMMON_KEYS
                .map(k => entries.find(e => e.key === k))
                .filter(Boolean);
            if (common.length > 0) {
                html += `<div style="padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);position:sticky;top:0;">Common</div>`;
                for (const c of common) {
                    html += `<div class="cat-pick-item" data-key="${c.key}" style="padding:7px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;" onmouseover="this.style.background='var(--bg-input)'" onmouseout="this.style.background=''">`;
                    html += `<span style="width:8px;height:8px;border-radius:2px;background:${c.color};flex-shrink:0;"></span>`;
                    html += `${escapeHtml(c.label)}</div>`;
                }
                html += `<div style="border-top:1px solid var(--border);margin:4px 0;"></div>`;
            }
        }

        for (const [groupName, cats] of Object.entries(groups)) {
            html += `<div style="padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);position:sticky;top:0;">${groupName}</div>`;
            for (const c of cats) {
                html += `<div class="cat-pick-item" data-key="${c.key}" style="padding:7px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;" onmouseover="this.style.background='var(--bg-input)'" onmouseout="this.style.background=''">`;
                html += `<span style="width:8px;height:8px;border-radius:2px;background:${c.color};flex-shrink:0;"></span>`;
                html += `${escapeHtml(c.label)}</div>`;
            }
        }
        // "Create new" always visible
        html += `<div style="border-top:1px solid var(--border);padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);">───</div>`;
        html += `<div class="cat-pick-item" data-key="__create_new__" style="padding:7px 12px;cursor:pointer;font-size:13px;color:var(--accent);font-weight:600;" onmouseover="this.style.background='var(--bg-input)'" onmouseout="this.style.background=''">+ Create new category...</div>`;

        if (!html.includes('cat-pick-item')) {
            html = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">No matches</div>' + html;
        }

        dropdown.innerHTML = html;

        dropdown.querySelectorAll('.cat-pick-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // prevent input blur
                const key = item.dataset.key;
                if (key === '__create_new__') {
                    if (opts.onCreateNew) {
                        dropdown.style.display = 'none';
                        opts.onCreateNew(input, selectEl);
                    } else {
                        showCreateForm();
                    }
                } else {
                    selectEl.value = key;
                    input.value = item.textContent.trim();
                    dropdown.style.display = 'none';
                    selectEl.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    // Inline create-category form (replaces the old window.prompt — native
    // dialogs look broken next to the app's styled modals).
    let creating = false;

    function showCreateForm() {
        creating = true;
        const prefill = userTyping ? input.value.trim() : '';
        dropdown.innerHTML =
            '<div style="padding:12px;">' +
                '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:6px;">New category</div>' +
                '<input type="text" class="form-input cat-create-input" placeholder="e.g. House Cleaner" style="width:100%;font-size:13px;">' +
                '<div class="cat-create-error" style="display:none;color:var(--red);font-size:11.5px;margin-top:6px;"></div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
                    '<button type="button" class="btn btn-secondary btn-sm cat-create-cancel">Cancel</button>' +
                    '<button type="button" class="btn btn-primary btn-sm cat-create-add">Add Category</button>' +
                '</div>' +
            '</div>';
        dropdown.style.display = '';

        const createInput = dropdown.querySelector('.cat-create-input');
        const errorEl = dropdown.querySelector('.cat-create-error');
        createInput.value = prefill;
        setTimeout(() => createInput.focus(), 0);

        const done = () => {
            creating = false;
            dropdown.style.display = 'none';
        };
        const backToList = () => {
            creating = false;
            renderDropdown('');
            dropdown.style.display = '';
            input.focus();
        };
        const submit = () => {
            const name = createInput.value.trim();
            if (!name) {
                errorEl.textContent = 'Enter a category name.';
                errorEl.style.display = '';
                return;
            }
            if (!store || !store.addCustomExpenseCategory) { done(); return; }
            try {
                const created = store.addCustomExpenseCategory({ name, color: '#94a3b8' });
                selectEl.innerHTML = renderCategoryOptions(created.key, store);
                selectEl.value = created.key;
                input.value = created.name;
                done();
                selectEl.dispatchEvent(new Event('change'));
            } catch (err) {
                errorEl.textContent = err.message || 'Could not create category.';
                errorEl.style.display = '';
            }
        };

        dropdown.querySelector('.cat-create-add').addEventListener('click', submit);
        dropdown.querySelector('.cat-create-cancel').addEventListener('click', backToList);
        createInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.stopPropagation(); backToList(); }
        });
    }

    let userTyping = false;

    input.addEventListener('focus', () => {
        // On focus, show common categories (no filter) — user hasn't typed yet.
        // Select the text so typing immediately replaces the current label.
        userTyping = false;
        input.select();
        renderDropdown('');
        dropdown.style.display = '';
    });

    input.addEventListener('input', () => {
        userTyping = true;
        renderDropdown(input.value);
        dropdown.style.display = '';
    });

    input.addEventListener('blur', () => {
        // Small delay so mousedown on item fires first. While the inline
        // create-category form is open, focus legitimately lives inside the
        // dropdown — don't hide it.
        setTimeout(() => { if (!creating) dropdown.style.display = 'none'; }, 150);
    });

    // Clear input restores default
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdown.style.display = 'none';
            input.blur();
        }
    });
}
