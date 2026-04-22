/**
 * Floating, searchable inline category picker for table cells.
 *
 * Appended to `document.body` and positioned over the clicked badge, so it
 * doesn't get clipped by the table's `overflow-x:auto` wrapper (which is
 * otherwise inherited on the y axis too in most browsers).
 *
 * Used by the Expenses and Bills tables to let users re-categorize rows
 * without opening the full Edit modal — a huge win when re-tagging a
 * Plaid-imported batch.
 *
 * Responsive layout:
 *   • Desktop (≥640px): floating popover anchored under the badge, with
 *     flip-above logic when the cell is too close to the viewport bottom.
 *   • Mobile (<640px): bottom sheet with a dimmed backdrop — full-width,
 *     keyboard-friendly, with large tap targets.
 *
 * Close triggers are chosen carefully: Escape, outside click, page scroll
 * past a threshold. We deliberately do NOT close on `resize` because mobile
 * keyboards fire resize when they open, and we don't close on every scroll
 * pixel because iOS rubber-banding makes that miserable.
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
    // also ensures tapping a second badge while one is already open just
    // moves the popover.
    document.querySelectorAll('.inline-cat-picker, .inline-cat-picker-backdrop').forEach(el => el.remove());

    const isMobile = window.innerWidth < 640;
    const rect = anchorEl.getBoundingClientRect();

    // Mobile gets a dimmed backdrop that acts as the outside-click target.
    let backdrop = null;
    if (isMobile) {
        backdrop = document.createElement('div');
        backdrop.className = 'inline-cat-picker-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.35);
            z-index: 9998;
        `;
        document.body.appendChild(backdrop);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'inline-cat-picker';

    if (isMobile) {
        // Bottom sheet — rises from the bottom so it doesn't collide with
        // the on-screen keyboard, and the user's thumb reaches the list
        // without contorting.
        wrapper.style.cssText = `
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            width: auto;
            max-height: 70vh;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px 12px 0 0;
            box-shadow: 0 -8px 24px rgba(0,0,0,0.25);
            z-index: 9999;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding-bottom: env(safe-area-inset-bottom, 0);
        `;
    } else {
        // Desktop floating popover — if the anchor is close to the bottom
        // of the viewport, flip above it so the list doesn't get clipped.
        const desiredHeight = 320;
        const flipAbove = rect.bottom + desiredHeight > window.innerHeight && rect.top > desiredHeight;
        const top = flipAbove
            ? Math.max(8, rect.top - desiredHeight - 4)
            : rect.bottom + 4;
        wrapper.style.cssText = `
            position: fixed;
            top: ${top}px;
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
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    // 16px font on mobile prevents iOS Safari's automatic zoom-on-focus.
    input.style.cssText = `width:100%;border:none;border-bottom:1px solid var(--border);border-radius:0;padding:${isMobile ? '12px 14px' : '8px 10px'};box-sizing:border-box;font-size:${isMobile ? '16px' : '13px'};`;
    wrapper.appendChild(input);

    const list = document.createElement('div');
    list.style.cssText = `max-height:${isMobile ? 'calc(70vh - 56px)' : '280px'};overflow-y:auto;-webkit-overflow-scrolling:touch;`;
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

        // Bigger touch targets on mobile: at least 44px tall per Apple HIG.
        const rowPadding = isMobile ? '12px 14px' : '7px 12px';
        const fontSize = isMobile ? '15px' : '13px';
        const minHeight = isMobile ? 'min-height:44px;' : '';
        const swatchSize = isMobile ? '10px' : '8px';

        let html = '';
        let idx = 0;
        for (const [group, cats] of Object.entries(groups)) {
            html += `<div style="padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);position:sticky;top:0;">${escapeHtml(group)}</div>`;
            for (const c of cats) {
                const isHighlighted = idx === highlighted;
                const isCurrent = c.key === currentKey;
                html += `<div class="cat-pick-row" data-idx="${idx}" data-key="${escapeHtml(c.key)}" style="padding:${rowPadding};cursor:pointer;font-size:${fontSize};display:flex;align-items:center;gap:8px;${minHeight}${isHighlighted ? 'background:var(--bg-input);' : ''}${isCurrent ? 'font-weight:600;' : ''}">`;
                if (c.color) {
                    html += `<span style="width:${swatchSize};height:${swatchSize};border-radius:2px;background:${c.color};flex-shrink:0;"></span>`;
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
            // Visual press feedback for touch.
            row.addEventListener('touchstart', () => {
                row.style.background = 'var(--bg-input)';
            }, { passive: true });
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

    // Gate scroll-close on a meaningful delta. iOS rubber-band and the
    // address-bar hide/show each fire small scroll events that must NOT
    // dismiss the picker.
    const startScrollY = window.scrollY;
    const startScrollX = window.scrollX;
    function onScroll() {
        if (Math.abs(window.scrollY - startScrollY) > 40 ||
            Math.abs(window.scrollX - startScrollX) > 40) {
            close();
        }
    }

    function close() {
        wrapper.remove();
        if (backdrop) backdrop.remove();
        document.removeEventListener('mousedown', onDocClick, true);
        document.removeEventListener('touchstart', onDocTouch, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
    }

    function onDocClick(e) {
        // Capture-phase listener — if the click originated inside the wrapper,
        // let the row's own handler do its thing. Otherwise dismiss.
        if (backdrop && e.target === backdrop) { close(); return; }
        if (!wrapper.contains(e.target)) close();
    }
    // Separate touch handler so the backdrop dismiss works on the first tap
    // without waiting for the synthetic click.
    function onDocTouch(e) {
        if (backdrop && e.target === backdrop) { close(); return; }
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
    document.addEventListener('touchstart', onDocTouch, true);
    document.addEventListener('keydown', onKey, true);
    // Intentionally NOT listening to `resize` — mobile keyboards open/close
    // fire resize events that would dismiss the picker right as the user
    // starts typing. Scroll-past-threshold is enough.
    window.addEventListener('scroll', onScroll, true);

    renderList('');

    // Pre-highlight the current selection when it's visible in the list.
    if (currentKey) {
        const idx = filtered.findIndex(it => it.key === currentKey);
        if (idx >= 0) {
            highlighted = idx;
            syncHighlight();
        }
    }

    // Desktop: autofocus the search input so the user can type immediately.
    // Mobile: don't — autofocus triggers the soft keyboard instantly, which
    // is jarring for a simple "tap a row" flow. The user can still tap the
    // input to search.
    if (!isMobile) {
        input.focus();
        input.select();
    }
}
