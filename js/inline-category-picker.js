/**
 * Floating, searchable inline category picker for table cells.
 *
 * Appended to `document.body` and positioned over the clicked badge, so it
 * doesn't get clipped by the table's `overflow-x:auto` wrapper (which is
 * otherwise inherited on the y axis too in most browsers).
 *
 * Used by the Expenses and Bills tables to let users re-categorize rows
 * without opening the full Edit modal — a huge win when re-tagging a
 * Plaid-imported batch. Closes on Escape, outside click, window resize,
 * or scroll (so the anchor can't drift out from under the popover).
 */

import { escapeHtml } from './utils.js';

/**
 * @typedef {Object} CatItem
 * @property {string} key    — identifier (for expenses: the category key;
 *                             for bills: the category name)
 * @property {string} label  — human-readable label shown in the list
 * @property {string} [group] — group name for the header row
 * @property {string} [color] — CSS color for the little swatch
 */

/**
 * @param {HTMLElement} anchorEl — the clicked badge element we anchor to
 * @param {object} opts
 * @param {CatItem[]} opts.items
 * @param {string}   [opts.currentKey] — pre-highlighted row
 * @param {string}   [opts.placeholder]
 * @param {(key:string) => void} opts.onPick
 */
export function openInlineCategoryPicker(anchorEl, opts) {
    const { items = [], currentKey, placeholder = 'Search categories...', onPick } = opts;

    // Only ever one picker open at a time — tearing down the previous one
    // also ensures clicking a second badge while one is already open just
    // moves the popover.
    document.querySelectorAll('.inline-cat-picker').forEach(el => el.remove());

    const rect = anchorEl.getBoundingClientRect();

    const wrapper = document.createElement('div');
    wrapper.className = 'inline-cat-picker';
    wrapper.style.cssText = `
        position: fixed;
        top: ${rect.bottom + 4}px;
        left: ${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px;
        width: 260px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        z-index: 9999;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    `;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.style.cssText = 'width:100%;border:none;border-bottom:1px solid var(--border);border-radius:0;padding:8px 10px;box-sizing:border-box;';
    wrapper.appendChild(input);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:280px;overflow-y:auto;';
    wrapper.appendChild(list);

    document.body.appendChild(wrapper);

    // Filtered view state — `filtered` is the currently-visible items in
    // render order, `highlighted` indexes into it so keyboard nav works.
    let filtered = items.slice();
    let highlighted = 0;

    function renderList(filter = '') {
        const q = filter.toLowerCase().trim();
        filtered = !q ? items.slice() : items.filter(it =>
            it.label.toLowerCase().includes(q) ||
            (it.group || '').toLowerCase().includes(q) ||
            (it.key || '').toLowerCase().includes(q)
        );

        if (filtered.length === 0) {
            list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">No matches</div>';
            return;
        }

        // Group by item.group, preserving input order within each group.
        const groups = {};
        for (const it of filtered) {
            const g = it.group || 'Other';
            if (!groups[g]) groups[g] = [];
            groups[g].push(it);
        }

        let html = '';
        let idx = 0;
        for (const [group, cats] of Object.entries(groups)) {
            html += `<div style="padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);position:sticky;top:0;">${escapeHtml(group)}</div>`;
            for (const c of cats) {
                const isHighlighted = idx === highlighted;
                const isCurrent = c.key === currentKey;
                html += `<div class="cat-pick-row" data-idx="${idx}" data-key="${escapeHtml(c.key)}" style="padding:7px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;${isHighlighted ? 'background:var(--bg-input);' : ''}${isCurrent ? 'font-weight:600;' : ''}">`;
                if (c.color) {
                    html += `<span style="width:8px;height:8px;border-radius:2px;background:${c.color};flex-shrink:0;"></span>`;
                }
                html += `${escapeHtml(c.label)}${isCurrent ? ' <span style="margin-left:auto;color:var(--text-muted);font-size:11px;">current</span>' : ''}</div>`;
                idx++;
            }
        }
        list.innerHTML = html;

        list.querySelectorAll('.cat-pick-row').forEach(row => {
            row.addEventListener('mouseenter', () => {
                highlighted = Number(row.dataset.idx);
                syncHighlight();
            });
            // mousedown (not click) so we fire before the input's blur handler
            // can strip focus and race with the close sequence.
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                pickByKey(row.dataset.key);
            });
        });
    }

    function syncHighlight() {
        list.querySelectorAll('.cat-pick-row').forEach(r => {
            const isH = Number(r.dataset.idx) === highlighted;
            r.style.background = isH ? 'var(--bg-input)' : '';
            if (isH) r.scrollIntoView({ block: 'nearest' });
        });
    }

    function pickByKey(key) {
        close();
        if (typeof onPick === 'function') onPick(key);
    }

    function close() {
        wrapper.remove();
        document.removeEventListener('mousedown', onDocClick, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', close);
        window.removeEventListener('scroll', close, true);
    }

    function onDocClick(e) {
        // Capture-phase listener — if the click originated inside the wrapper,
        // let the row's own handler do its thing. Otherwise dismiss.
        if (!wrapper.contains(e.target)) close();
    }

    function onKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlighted = Math.min(filtered.length - 1, highlighted + 1);
            syncHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlighted = Math.max(0, highlighted - 1);
            syncHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[highlighted]) pickByKey(filtered[highlighted].key);
        }
    }

    input.addEventListener('input', () => {
        highlighted = 0;
        renderList(input.value);
    });

    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    // Close on resize/scroll so the popover can't end up floating over the
    // wrong row after a layout change.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);

    renderList('');

    // Pre-highlight the current selection when it's visible in the list.
    if (currentKey) {
        const idx = filtered.findIndex(it => it.key === currentKey);
        if (idx >= 0) {
            highlighted = idx;
            syncHighlight();
        }
    }

    // Autofocus so the user can type immediately. Select any placeholder
    // text so the first keystroke replaces it.
    input.focus();
    input.select();
}
