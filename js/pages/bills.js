import { formatCurrency, getCategoryBadgeClass, escapeHtml, getOrdinal } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';
import { DEFAULT_CATEGORIES, CATEGORY_GROUPS, CATEGORY_COLORS, getCategoriesByGroup } from '../categories.js';
import { expandBillOccurrences, buildPayPeriods, getMonthlyMultiplier } from '../services/financial-service.js';
import { renderCashflowSankey } from './cashflow-sankey.js';
import { EXPENSE_CATEGORIES, renderCategoryOptions, mountSearchableCategoryPicker } from '../expense-categories.js';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_OF_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let billsViewMode = 'paycheck'; // 'paycheck', 'month', or 'cashflow'
let cfPeriodOffset = 0; // For cashflow view pay period navigation
let billsSortCol = 'dueDay';
let billsSortDir = 'asc';
let selectedBillIds = new Set();
let selectionMode = false; // Mobile multi-select mode
let billsOwnerFilter = 'all'; // 'all', 'user', or 'dependent'

export function renderBills(container, store) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const userName = store.getUserName();
    const depName = store.getDependentName();
    const depEnabled = store.isDependentEnabled();
    const rawBills = store.getBills();
    const sources = store.getPaymentSources();

    // Filter bills by owner
    const allBills = billsOwnerFilter === 'all'
        ? rawBills
        : rawBills.filter(b => (b.owner || 'user') === billsOwnerFilter);

    // Determine current pay period for paycheck view
    const payDates = store.getPayDates();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sorted = [...payDates].sort((a, b) => a - b);
    let periodStart = null, periodEnd = null, periodLabel = '';
    for (let i = 0; i < sorted.length; i++) {
        const pStart = sorted[i];
        const pEnd = sorted[i + 1]
            ? new Date(sorted[i + 1].getTime() - 86400000)
            : new Date(pStart.getTime() + 13 * 86400000);
        if (today >= pStart && today <= pEnd) {
            periodStart = pStart;
            periodEnd = pEnd;
            const dateOpts = { month: 'short', day: 'numeric' };
            periodLabel = `${pStart.toLocaleDateString('en-US', dateOpts)} – ${pEnd.toLocaleDateString('en-US', dateOpts)}`;
            break;
        }
    }

    // Separate regular vs periodic (yearly/semi-annual) bills
    const allRegularBills = allBills.filter(b => b.frequency !== 'yearly' && b.frequency !== 'semi-annual');
    const allPeriodicBills = allBills.filter(b => b.frequency === 'yearly' || b.frequency === 'semi-annual');

    // Helper: check if a periodic bill is due in a date range
    function isPeriodicBillDueInRange(bill, rangeStart, rangeEnd) {
        if (bill.dueMonth == null) return false;
        const startYear = rangeStart.getFullYear();
        const endYear = rangeEnd.getFullYear();
        const months = [bill.dueMonth];
        if (bill.frequency === 'semi-annual') months.push((bill.dueMonth + 6) % 12);
        for (const m of months) {
            for (let y = startYear; y <= endYear + 1; y++) {
                const dueDate = new Date(y, m, bill.dueDay);
                if (dueDate >= rangeStart && dueDate <= rangeEnd) return true;
            }
        }
        return false;
    }

    // Helper: check if a periodic bill is due in a given month
    function isPeriodicBillDueInMonth(bill, checkYear, checkMonth) {
        if (bill.dueMonth == null) return false;
        if (bill.frequency === 'yearly') return bill.dueMonth === checkMonth;
        if (bill.frequency === 'semi-annual') {
            const secondMonth = (bill.dueMonth + 6) % 12;
            return bill.dueMonth === checkMonth || secondMonth === checkMonth;
        }
        return false;
    }

    // Get pay dates in current month for expansion
    const payDatesInMonth = sorted.filter(d => d.getFullYear() === year && d.getMonth() === month);

    // Filter bills based on view mode, expanding recurring bills into individual occurrences
    let bills, periodicBills;
    if (billsViewMode === 'paycheck' && periodStart && periodEnd) {
        const payDatesInPeriod = sorted.filter(d => d >= periodStart && d <= periodEnd);

        const expandedBills = [];
        allRegularBills.forEach(b => {
            if (b.frozen) return;
            const expanded = expandBillOccurrences(b, periodStart, periodEnd, payDatesInPeriod);
            if (expanded !== null) {
                expandedBills.push(...expanded);
            } else {
                const dueThisMonth = new Date(periodStart.getFullYear(), periodStart.getMonth(), b.dueDay);
                const dueNextMonth = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, b.dueDay);
                if ((dueThisMonth >= periodStart && dueThisMonth <= periodEnd) ||
                    (dueNextMonth >= periodStart && dueNextMonth <= periodEnd)) {
                    expandedBills.push(b);
                }
            }
        });
        bills = expandedBills;

        periodicBills = allPeriodicBills.filter(b => !b.frozen && isPeriodicBillDueInRange(b, periodStart, periodEnd));
    } else if (billsViewMode === 'month') {
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);

        const expandedBills = [];
        allRegularBills.forEach(b => {
            const expanded = expandBillOccurrences(b, monthStart, monthEnd, payDatesInMonth);
            if (expanded !== null) {
                expandedBills.push(...expanded);
            } else {
                expandedBills.push(b);
            }
        });
        bills = expandedBills;
        periodicBills = allPeriodicBills;
    } else {
        bills = allRegularBills;
        periodicBills = allPeriodicBills;
    }

    // Get unique categories
    const categories = [...new Set(allBills.map(b => b.category))].sort();

    const viewLabel = billsViewMode === 'paycheck' && periodLabel
        ? `Current Paycheck (${periodLabel})`
        : 'Full Month';

    // Render Cashflow view if selected
    if (billsViewMode === 'cashflow') {
        renderCashflowView(container, store, allBills, sources, categories, year, month, payDates);
        return;
    }

    // Build page title based on owner filter
    const pageTitle = billsOwnerFilter === 'dependent' ? `${escapeHtml(depName)}'s Bills`
        : billsOwnerFilter === 'user' ? `${escapeHtml(userName)}'s Bills`
        : 'All Bills';

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>${pageTitle}</h2>
                <div class="subtitle">${billsViewMode === 'paycheck' ? `${bills.length} bills this period${periodicBills.length > 0 ? ` + ${periodicBills.length} annual/semi-annual` : ''}` : `${allRegularBills.length} bills + ${allPeriodicBills.length} annual/semi-annual &middot; ${allBills.filter(b => b.frozen).length} frozen`}</div>
            </div>
            <button class="btn btn-primary" id="add-bill-btn">+ Add Bill</button>
        </div>

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
            ${depEnabled ? `
            <select class="form-select" id="owner-filter" style="font-size:12px;padding:4px 8px;min-width:140px;">
                <option value="all" ${billsOwnerFilter === 'all' ? 'selected' : ''}>All Bills</option>
                <option value="user" ${billsOwnerFilter === 'user' ? 'selected' : ''}>${escapeHtml(userName)}'s Bills</option>
                <option value="dependent" ${billsOwnerFilter === 'dependent' ? 'selected' : ''}>${escapeHtml(depName)}'s Bills</option>
            </select>
            <span style="border-left:1px solid var(--border);height:20px;margin:0 4px;"></span>
            ` : ''}
            <span style="font-size:12px;color:var(--text-secondary);">View:</span>
            <button class="btn btn-sm ${billsViewMode === 'paycheck' ? 'btn-primary' : 'btn-secondary'}" id="view-paycheck">Paycheck</button>
            <button class="btn btn-sm ${billsViewMode === 'month' ? 'btn-primary' : 'btn-secondary'}" id="view-month">Month</button>
            <button class="btn btn-sm ${billsViewMode === 'cashflow' ? 'btn-primary' : 'btn-secondary'}" id="view-cashflow">Cashflow</button>
            ${billsViewMode === 'paycheck' && periodLabel ? `<span style="font-size:12px;color:var(--text-muted);margin-left:4px;">${periodLabel}</span>` : ''}
        </div>

        <div class="filters" id="filters">
            <button class="filter-chip active" data-filter="unpaid" style="border-color:var(--red);color:var(--red);">Unpaid</button>
            <button class="filter-chip" data-filter="all">All</button>
            ${categories.map(c => `<button class="filter-chip" data-filter="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
            ${billsViewMode === 'month' ? '<button class="filter-chip" data-filter="frozen" style="border-color:var(--blue);color:var(--blue);">Frozen</button>' : ''}
        </div>

        <div class="table-wrapper bills-table">
            <table>
                <thead>
                    <tr>
                        <th>Paid</th>
                        <th data-sort="name">Name <span class="sort-arrow${billsSortCol === 'name' ? ' active' : ''}">${billsSortCol === 'name' ? (billsSortDir === 'asc' ? '▲' : '▼') : '▲'}</span></th>
                        <th data-sort="amount">Amount <span class="sort-arrow${billsSortCol === 'amount' ? ' active' : ''}">${billsSortCol === 'amount' ? (billsSortDir === 'asc' ? '▲' : '▼') : '▲'}</span></th>
                        <th data-sort="category">Category <span class="sort-arrow${billsSortCol === 'category' ? ' active' : ''}">${billsSortCol === 'category' ? (billsSortDir === 'asc' ? '▲' : '▼') : '▲'}</span></th>
                        <th data-sort="dueDay">Due Day <span class="sort-arrow${billsSortCol === 'dueDay' ? ' active' : ''}">${billsSortCol === 'dueDay' ? (billsSortDir === 'asc' ? '▲' : '▼') : '▲'}</span></th>
                        <th>Payment Source</th>
                        <th data-sort="status">Status <span class="sort-arrow${billsSortCol === 'status' ? ' active' : ''}">${billsSortCol === 'status' ? (billsSortDir === 'asc' ? '▲' : '▼') : '▲'}</span></th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="bills-tbody">
                    ${renderBillRows(sortBills(filterBills(bills, 'unpaid', store, year, month), store, year, month), store, year, month, depEnabled, userName, depName)}
                </tbody>
            </table>
        </div>

        ${periodicBills.length > 0 || billsViewMode === 'month' ? `
        <div style="margin-top:24px;">
            <h3 style="font-size:15px;font-weight:600;margin-bottom:8px;color:var(--text-secondary);">
                Annual &amp; Semi-Annual Bills
                ${billsViewMode === 'paycheck' && periodicBills.length > 0 ? '<span style="font-size:11px;font-weight:400;margin-left:8px;color:var(--accent);">Due this period</span>' : ''}
                ${billsViewMode === 'month' ? `<span style="font-size:11px;font-weight:400;margin-left:8px;color:var(--text-muted);">${allPeriodicBills.filter(b => !b.frozen).length} total</span>` : ''}
            </h3>
            <div class="table-wrapper bills-table">
                <table>
                    <thead>
                        <tr>
                            <th>Paid</th>
                            <th>Name</th>
                            <th>Amount</th>
                            <th>Category</th>
                            <th>Due Date</th>
                            <th>Payment Source</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="periodic-bills-tbody">
                        ${renderBillRows(sortBills(filterBills(periodicBills, 'unpaid', store, year, month), store, year, month), store, year, month, depEnabled, userName, depName)}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${(() => {
            // Bills are already expanded into individual occurrences, so just sum
            const regularTotal = bills.filter(b => !b.frozen && !b.excludeFromTotal).reduce((s, b) => s + b.amount, 0);
            const periodicDueTotal = (() => {
                if (billsViewMode === 'paycheck') {
                    return periodicBills.filter(b => !b.frozen && !b.excludeFromTotal).reduce((s, b) => s + b.amount, 0);
                } else {
                    return allPeriodicBills.filter(b => !b.frozen && !b.excludeFromTotal && isPeriodicBillDueInMonth(b, year, month))
                        .reduce((s, b) => s + b.amount, 0);
                }
            })();
            const grandTotal = regularTotal + periodicDueTotal;
            return `
        <div class="card mt-16">
            <div class="flex-between">
                <span style="font-size:13px;color:var(--text-secondary);">${billsViewMode === 'paycheck' ? 'Monthly Bills This Period' : 'Monthly Bills'}</span>
                <span class="font-bold">${formatCurrency(regularTotal)}</span>
            </div>
            ${periodicDueTotal > 0 ? `
            <div class="flex-between" style="margin-top:6px;">
                <span style="font-size:13px;color:var(--text-secondary);">Annual/Semi-Annual Due ${billsViewMode === 'paycheck' ? 'This Period' : 'This Month'}</span>
                <span class="font-bold" style="color:var(--accent);">${formatCurrency(periodicDueTotal)}</span>
            </div>
            <div class="flex-between" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
                <span style="font-size:13px;font-weight:600;">Total</span>
                <span class="font-bold">${formatCurrency(grandTotal)}</span>
            </div>
            ` : ''}
        </div>`;
        })()}

        ${(() => {
            if (!selectionMode && selectedBillIds.size === 0) return '<div id="selection-bar" style="display:none;"></div>';
            const selectedBills = [...selectedBillIds].map(id => allBills.find(b => b.id === id)).filter(Boolean);
            const bySource = {};
            selectedBills.forEach(b => {
                const src = b.paymentSource || 'No Source';
                if (!bySource[src]) bySource[src] = 0;
                bySource[src] += b.amount;
            });
            const sourceEntries = Object.entries(bySource).sort((a, b) => a[0].localeCompare(b[0]));
            const grandTotal = selectedBills.reduce((s, b) => s + b.amount, 0);
            const visibleBillIds = [...bills, ...periodicBills].map(b => b.id);
            const allSelected = visibleBillIds.length > 0 && visibleBillIds.every(id => selectedBillIds.has(id));
            return `<div id="selection-bar" class="selection-bar">
                <div class="selection-bar-actions">
                    <span class="selection-count">${selectedBillIds.size} selected</span>
                    <button class="btn btn-sm btn-secondary" id="select-all-btn">${allSelected ? 'Deselect All' : 'Select All'}</button>
                    <button class="btn btn-sm btn-primary" id="clear-selection">Done</button>
                </div>
                <div class="selection-bar-totals">
                    ${sourceEntries.map(([src, total]) => `<div class="selection-source"><span class="source-name">${escapeHtml(src)}</span><span class="source-total">${formatCurrency(total)}</span></div>`).join('')}
                    ${selectedBillIds.size > 0 ? `<div class="selection-grand-total"><span class="total-label">Total</span><span class="total-amount">${formatCurrency(grandTotal)}</span></div>` : ''}
                </div>
            </div>`;
        })()}
    `;

    // Owner filter dropdown
    const ownerFilter = container.querySelector('#owner-filter');
    if (ownerFilter) {
        ownerFilter.addEventListener('change', () => {
            billsOwnerFilter = ownerFilter.value;
            renderBills(container, store);
        });
    }

    // View toggle events
    container.querySelector('#view-paycheck').addEventListener('click', () => {
        billsViewMode = 'paycheck';
        renderBills(container, store);
    });
    container.querySelector('#view-month').addEventListener('click', () => {
        billsViewMode = 'month';
        renderBills(container, store);
    });
    container.querySelector('#view-cashflow').addEventListener('click', () => {
        billsViewMode = 'cashflow';
        cfPeriodOffset = 0;
        renderBills(container, store);
    });

    // Event: Add bill
    container.querySelector('#add-bill-btn').addEventListener('click', () => {
        showBillForm(store, sources, categories, null, depEnabled, userName, depName);
    });

    // Event: Filter chips
    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const filter = chip.dataset.filter;
            const tbody = container.querySelector('#bills-tbody');
            tbody.innerHTML = renderBillRows(sortBills(filterBills(bills, filter, store, year, month), store, year, month), store, year, month, depEnabled, userName, depName);
            attachRowEvents(tbody, store, allBills, sources, categories, year, month, depEnabled, userName, depName);
            attachSelectionEvents(tbody);
            // Also filter periodic bills section
            const periodicTbody = container.querySelector('#periodic-bills-tbody');
            if (periodicTbody) {
                periodicTbody.innerHTML = renderBillRows(sortBills(filterBills(periodicBills, filter, store, year, month), store, year, month), store, year, month, depEnabled, userName, depName);
                attachRowEvents(periodicTbody, store, allBills, sources, categories, year, month, depEnabled, userName, depName);
                attachSelectionEvents(periodicTbody);
            }
        });
    });

    // Sort header clicks
    container.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (billsSortCol === col) {
                billsSortDir = billsSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                billsSortCol = col;
                billsSortDir = 'asc';
            }
            renderBills(container, store);
        });
    });

    // Multi-select: Ctrl/Cmd+click, Shift+click, or long-press (mobile) on rows
    function attachSelectionEvents(tbody) {
        tbody.querySelectorAll('tr[data-bill-id]').forEach(tr => {
            let longPressTimer = null;
            let touchStartX = 0;
            let touchStartY = 0;

            // Long press for mobile
            tr.addEventListener('touchstart', (e) => {
                if (e.target.closest('button, input, label, a, .toggle')) return;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                longPressTimer = setTimeout(() => {
                    // Vibrate if supported
                    if (navigator.vibrate) navigator.vibrate(50);
                    selectionMode = true;
                    const billId = tr.dataset.billId;
                    if (selectedBillIds.has(billId)) {
                        selectedBillIds.delete(billId);
                    } else {
                        selectedBillIds.add(billId);
                    }
                    renderBills(container, store);
                }, 500);
            }, { passive: true });

            tr.addEventListener('touchmove', (e) => {
                // Cancel long press if finger moves too much
                if (longPressTimer) {
                    const moveX = Math.abs(e.touches[0].clientX - touchStartX);
                    const moveY = Math.abs(e.touches[0].clientY - touchStartY);
                    if (moveX > 10 || moveY > 10) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                }
            }, { passive: true });

            tr.addEventListener('touchend', () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });

            tr.addEventListener('touchcancel', () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });

            // Tap to select when in selection mode (mobile)
            tr.addEventListener('click', (e) => {
                // Don't select when clicking on interactive elements
                if (e.target.closest('button, input, label, a, .toggle')) return;

                const billId = tr.dataset.billId;

                // If in selection mode, toggle on tap
                if (selectionMode) {
                    e.preventDefault();
                    if (selectedBillIds.has(billId)) {
                        selectedBillIds.delete(billId);
                    } else {
                        selectedBillIds.add(billId);
                    }
                    renderBills(container, store);
                    return;
                }

                // Desktop: Ctrl/Cmd+click or Shift+click
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;

                e.preventDefault();

                if (e.shiftKey && selectedBillIds.size > 0) {
                    // Shift+click: select range from last selected to this row
                    const allRows = [...container.querySelectorAll('tr[data-bill-id]')];
                    const allIds = allRows.map(r => r.dataset.billId);
                    const lastSelected = [...selectedBillIds].pop();
                    const lastIdx = allIds.indexOf(lastSelected);
                    const curIdx = allIds.indexOf(billId);
                    if (lastIdx !== -1 && curIdx !== -1) {
                        const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
                        for (let i = start; i <= end; i++) {
                            selectedBillIds.add(allIds[i]);
                        }
                    }
                    selectionMode = true;
                } else {
                    // Ctrl/Cmd+click: toggle individual
                    if (selectedBillIds.has(billId)) {
                        selectedBillIds.delete(billId);
                    } else {
                        selectedBillIds.add(billId);
                    }
                    selectionMode = true;
                }
                renderBills(container, store);
            });
        });
    }
    attachSelectionEvents(container.querySelector('#bills-tbody'));
    const periodicTbodyForSelect = container.querySelector('#periodic-bills-tbody');
    if (periodicTbodyForSelect) attachSelectionEvents(periodicTbodyForSelect);

    // Select All button
    const selectAllBtn = container.querySelector('#select-all-btn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const visibleBillIds = [...bills, ...periodicBills].map(b => b.id);
            const allSelected = visibleBillIds.every(id => selectedBillIds.has(id));
            if (allSelected) {
                visibleBillIds.forEach(id => selectedBillIds.delete(id));
            } else {
                visibleBillIds.forEach(id => selectedBillIds.add(id));
            }
            renderBills(container, store);
        });
    }

    // Clear/Done selection button
    const clearBtn = container.querySelector('#clear-selection');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            selectedBillIds.clear();
            selectionMode = false;
            renderBills(container, store);
        });
    }

    // Attach row events
    attachRowEvents(container.querySelector('#bills-tbody'), store, rawBills, sources, categories, year, month, depEnabled, userName, depName);
    const periodicTbody = container.querySelector('#periodic-bills-tbody');
    if (periodicTbody) {
        attachRowEvents(periodicTbody, store, rawBills, sources, categories, year, month, depEnabled, userName, depName);
    }
}

function filterBills(bills, filter, store = null, year = null, month = null) {
    if (filter === 'all') return bills;
    if (filter === 'frozen') return bills.filter(b => b.frozen);
    if (filter === 'unpaid') {
        if (!store || year === null || month === null) return bills;
        return bills.filter(b => !b.frozen && !store.isBillPaid(b.id, year, month, b._occurrenceKey));
    }
    return bills.filter(b => b.category === filter);
}

function sortBills(bills, store, year, month) {
    const sorted = [...bills];
    const dir = billsSortDir === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
        let cmp = 0;
        switch (billsSortCol) {
            case 'name':
                cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                break;
            case 'amount':
                cmp = (a.amount || 0) - (b.amount || 0);
                break;
            case 'category':
                cmp = (a.category || '').toLowerCase().localeCompare((b.category || '').toLowerCase());
                break;
            case 'dueDay': {
                // Sort by occurrence date if expanded, otherwise by due day
                const dayA = a._occurrenceDate ? a._occurrenceDate.getDate() : (a.dueDay || 0);
                const dayB = b._occurrenceDate ? b._occurrenceDate.getDate() : (b.dueDay || 0);
                cmp = dayA - dayB;
                break;
            }
            case 'status': {
                const statusOrder = (bill) => {
                    if (bill.frozen) return 2;
                    if (store.isBillPaid(bill.id, year, month, bill._occurrenceKey)) return 1;
                    return 0; // unpaid first
                };
                cmp = statusOrder(a) - statusOrder(b);
                break;
            }
        }
        return cmp * dir;
    });

    return sorted;
}

function renderBillRows(bills, store, year, month, depEnabled = false, userName = 'User', depName = 'Dependent') {
    const customCategories = store.getCustomCategories();
    return bills.map(bill => {
        const isPaid = store.isBillPaid(bill.id, year, month, bill._occurrenceKey);
        const statusClass = bill.frozen ? 'status-frozen' : isPaid ? 'status-paid' : 'status-unpaid';
        const statusText = bill.frozen ? 'FROZEN' : isPaid ? 'Paid' : 'Unpaid';
        const isLinked = !!bill.linkedDebtId;
        const isDepBill = bill.owner === 'dependent';
        const isCovering = isDepBill && bill.userCovering;
        const badgeClass = getCategoryBadgeClass(bill.category, customCategories);

        return `
            <tr data-bill-id="${bill.id}" data-occurrence-key="${bill._occurrenceKey || ''}" style="${isPaid ? 'opacity:0.6;' : ''}${bill.frozen ? 'opacity:0.5;' : ''}" class="${selectedBillIds.has(bill.id) ? 'bill-selected' : ''}">
                <td>
                    <label class="toggle">
                        <input type="checkbox" ${isPaid ? 'checked' : ''} ${bill.frozen ? 'disabled' : ''} data-bill-id="${bill.id}" data-occurrence-key="${bill._occurrenceKey || ''}" class="paid-toggle">
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td>
                    <div style="font-weight:600;">
                        ${escapeHtml(bill.name)}
                        ${depEnabled && isDepBill ? `<span style="display:inline-block;margin-left:6px;font-size:9px;padding:1px 5px;background:var(--purple)15;color:var(--purple);border:1px solid var(--purple)40;border-radius:3px;vertical-align:middle;font-weight:600;" title="${escapeHtml(depName)}'s bill">${escapeHtml(depName)}</span>` : ''}
                        ${isCovering ? `<span style="display:inline-block;margin-left:4px;font-size:9px;padding:1px 5px;background:var(--orange)15;color:var(--orange);border:1px solid var(--orange)40;border-radius:3px;vertical-align:middle;font-weight:600;" title="${escapeHtml(userName)} covering">Covering</span>` : ''}
                        ${isLinked ? '<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;" title="Linked to debt">&#128279; Linked</span>' : ''}
                        ${bill.excludeFromTotal ? '<span style="display:inline-block;margin-left:4px;font-size:9px;padding:1px 5px;background:var(--yellow-bg);color:var(--yellow);border:1px solid var(--yellow);border-radius:3px;vertical-align:middle;font-weight:600;letter-spacing:0.3px;" title="Excluded from bill totals">EXCL</span>' : ''}
                    </div>
                    ${bill.notes ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(bill.notes)}</div>` : ''}
                </td>
                <td class="font-bold">${bill.amount > 0 ? formatCurrency(bill.amount) : '-'}${bill.frequency === 'per-paycheck' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">every check</div>' : bill.frequency === 'twice-monthly' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">2x/month</div>' : bill.frequency === 'weekly' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">weekly</div>' : bill.frequency === 'biweekly' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">biweekly</div>' : bill.frequency === 'yearly' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">yearly</div>' : bill.frequency === 'semi-annual' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">semi-annual</div>' : ''}</td>
                <td><span class="badge ${badgeClass}">${escapeHtml(bill.category)}</span></td>
                <td>${bill._occurrenceDate ? `<span style="font-size:11px;color:var(--blue);">${DAYS_OF_WEEK[bill._occurrenceDate.getDay()]} ${MONTH_ABBR[bill._occurrenceDate.getMonth()]} ${bill._occurrenceDate.getDate()}</span>` : bill.frequency === 'per-paycheck' ? '<span style="font-size:11px;color:var(--accent);">Every check</span>' : bill.frequency === 'twice-monthly' ? '<span style="font-size:11px;color:var(--accent);">1st &amp; last check</span>' : bill.frequency === 'weekly' ? `<span style="font-size:11px;color:var(--blue);">Every ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][bill.dueDay % 7] || 'week'}</span>` : bill.frequency === 'biweekly' ? `<span style="font-size:11px;color:var(--blue);">Every other ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][bill.dueDay % 7] || 'week'}</span>` : `${bill.dueDay}${getOrdinal(bill.dueDay)}${(bill.frequency === 'yearly' || bill.frequency === 'semi-annual') && bill.dueMonth != null ? ` <span style="font-size:10px;color:var(--text-muted);">${MONTH_ABBR[bill.dueMonth]}${bill.frequency === 'semi-annual' ? '/' + MONTH_ABBR[(bill.dueMonth + 6) % 12] : ''}</span>` : ''}`}</td>
                <td style="font-size:12px;">
                    ${escapeHtml(bill.paymentSource || '-')}
                    ${bill.autoPay ? '<span style="display:inline-block;margin-left:4px;font-size:9px;padding:1px 5px;background:var(--green)18;color:var(--green);border:1px solid var(--green)40;border-radius:3px;vertical-align:middle;font-weight:600;letter-spacing:0.3px;">AUTO</span>' : ''}
                </td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td>
                    <div style="display:flex;gap:4px;">
                        <button class="btn-icon edit-bill" data-bill-id="${bill.id}" title="Edit">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn-icon delete-bill" data-bill-id="${bill.id}" title="Delete" style="color:var(--red);">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function attachRowEvents(tbody, store, bills, sources, categories, year, month, depEnabled, userName, depName) {
    // Paid toggles
    tbody.querySelectorAll('.paid-toggle').forEach(toggle => {
        toggle.addEventListener('change', () => {
            const occKey = toggle.dataset.occurrenceKey || undefined;
            store.toggleBillPaid(toggle.dataset.billId, year, month, occKey);
            refreshPage();
        });
    });

    // Edit buttons
    tbody.querySelectorAll('.edit-bill').forEach(btn => {
        btn.addEventListener('click', () => {
            const bill = bills.find(b => b.id === btn.dataset.billId);
            if (bill) showBillForm(store, sources, categories, bill, depEnabled, userName, depName);
        });
    });

    // Delete buttons
    tbody.querySelectorAll('.delete-bill').forEach(btn => {
        btn.addEventListener('click', () => {
            const bill = bills.find(b => b.id === btn.dataset.billId);
            const isLinked = bill && bill.linkedDebtId;
            const msg = isLinked
                ? 'This bill is synced with a debt. Deleting it will remove the sync but keep the debt. Continue?'
                : 'Delete this bill?';
            if (confirm(msg)) {
                store.deleteBill(btn.dataset.billId);
                refreshPage();
            }
        });
    });
}

// Render grouped category dropdown HTML
function renderCategoryDropdown(customCategories = []) {
    const grouped = getCategoriesByGroup(customCategories);
    const groups = [...CATEGORY_GROUPS];
    if (customCategories.length > 0) groups.push('Custom');

    return groups.map(group => {
        const cats = grouped[group];
        if (!cats || cats.length === 0) return '';

        return `
            <div class="category-group">
                <div class="category-group-header">${escapeHtml(group)}</div>
                ${cats.map(cat => `
                    <div class="category-option" data-category="${escapeHtml(cat.name)}" data-color="${cat.color}">
                        <span class="category-dot" style="background:var(--${cat.color === 'pink' ? 'pink' : cat.color})"></span>
                        ${escapeHtml(cat.name)}
                    </div>
                `).join('')}
            </div>
        `;
    }).join('');
}

// Setup category picker event handlers
function setupCategoryPicker() {
    const input = document.getElementById('bill-category');
    const dropdown = document.getElementById('category-dropdown');
    const toggle = document.getElementById('category-picker-toggle');
    if (!input || !dropdown || !toggle) return;

    // Toggle dropdown on button click
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            filterCategoryOptions('');
        }
    });

    // Filter as user types
    input.addEventListener('input', () => {
        dropdown.classList.add('open');
        filterCategoryOptions(input.value);
    });

    // Focus shows dropdown
    input.addEventListener('focus', () => {
        dropdown.classList.add('open');
        filterCategoryOptions(input.value);
    });

    // Select category on click
    dropdown.querySelectorAll('.category-option').forEach(opt => {
        opt.addEventListener('click', () => {
            input.value = opt.dataset.category;
            dropdown.classList.remove('open');
        });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.category-picker-wrapper') && !e.target.closest('.category-dropdown')) {
            dropdown.classList.remove('open');
        }
    });
}

// Filter category options based on search text
function filterCategoryOptions(search) {
    const dropdown = document.getElementById('category-dropdown');
    if (!dropdown) return;

    const term = search.toLowerCase().trim();
    let anyVisible = false;

    dropdown.querySelectorAll('.category-group').forEach(group => {
        let groupVisible = false;
        group.querySelectorAll('.category-option').forEach(opt => {
            const name = opt.dataset.category.toLowerCase();
            const visible = !term || name.includes(term);
            opt.style.display = visible ? '' : 'none';
            if (visible) groupVisible = true;
        });
        group.style.display = groupVisible ? '' : 'none';
        if (groupVisible) anyVisible = true;
    });

    // Show "no results" message if needed
    let noResults = dropdown.querySelector('.no-results');
    if (!anyVisible && term) {
        if (!noResults) {
            noResults = document.createElement('div');
            noResults.className = 'no-results';
            noResults.style.cssText = 'padding:12px;color:var(--text-secondary);font-size:13px;text-align:center;';
            noResults.textContent = 'No matching categories. Type to use custom value.';
            dropdown.appendChild(noResults);
        }
        noResults.style.display = '';
    } else if (noResults) {
        noResults.style.display = 'none';
    }
}

function showBillForm(store, sources, categories, existingBill = null, depEnabled = false, userName = 'User', depName = 'Dependent') {
    const isEdit = !!existingBill;
    const bill = existingBill || {
        name: '', amount: 0, category: '', dueDay: 1,
        frequency: 'monthly', paymentSource: '', frozen: false,
        autoPay: false, excludeFromTotal: false, notes: '',
        owner: billsOwnerFilter === 'dependent' ? 'dependent' : 'user',
        userCovering: false
    };
    const billOwner = bill.owner || 'user';
    const isDepBill = billOwner === 'dependent';

    const formHtml = `
        ${depEnabled ? `
        <div class="form-row">
            <div class="form-group">
                <label>Bill Owner</label>
                <select class="form-select" id="bill-owner">
                    <option value="user" ${billOwner === 'user' ? 'selected' : ''}>${escapeHtml(userName)}</option>
                    <option value="dependent" ${billOwner === 'dependent' ? 'selected' : ''}>${escapeHtml(depName)}</option>
                </select>
            </div>
            <div class="form-group" id="bill-covering-group" style="${isDepBill ? '' : 'display:none;'}">
                <label>&nbsp;</label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;" title="${escapeHtml(userName)} is covering this bill for ${escapeHtml(depName)}">
                    <input type="checkbox" id="bill-covering" ${bill.userCovering ? 'checked' : ''}> ${escapeHtml(userName)} covering
                </label>
            </div>
        </div>
        ` : ''}
        <div class="form-group">
            <label>Bill Name</label>
            <input type="text" class="form-input" id="bill-name" value="${escapeHtml(bill.name)}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" class="form-input" id="bill-amount" step="0.01" value="${bill.amount}">
            </div>
            <div class="form-group" id="bill-due-group" style="${bill.frequency === 'weekly' || bill.frequency === 'biweekly' || bill.frequency === 'per-paycheck' || bill.frequency === 'twice-monthly' ? 'display:none;' : ''}">
                <label>Due Day of Month</label>
                <input type="number" class="form-input" id="bill-due" min="1" max="31" value="${bill.dueDay}">
            </div>
            <div class="form-group" id="bill-dayofweek-group" style="${bill.frequency === 'weekly' || bill.frequency === 'biweekly' ? '' : 'display:none;'}">
                <label>Day of Week</label>
                <select class="form-select" id="bill-dayofweek">
                    <option value="0" ${bill.dueDay === 0 ? 'selected' : ''}>Sunday</option>
                    <option value="1" ${bill.dueDay === 1 || (!bill.dueDay && bill.frequency !== 'weekly' && bill.frequency !== 'biweekly') ? 'selected' : ''}>Monday</option>
                    <option value="2" ${bill.dueDay === 2 ? 'selected' : ''}>Tuesday</option>
                    <option value="3" ${bill.dueDay === 3 ? 'selected' : ''}>Wednesday</option>
                    <option value="4" ${bill.dueDay === 4 ? 'selected' : ''}>Thursday</option>
                    <option value="5" ${bill.dueDay === 5 ? 'selected' : ''}>Friday</option>
                    <option value="6" ${bill.dueDay === 6 ? 'selected' : ''}>Saturday</option>
                </select>
            </div>
        </div>
        <div class="form-group" id="bill-duemonth-group" style="${bill.frequency === 'yearly' || bill.frequency === 'semi-annual' ? '' : 'display:none;'}">
            <label id="bill-duemonth-label">${bill.frequency === 'semi-annual' ? 'First Due Month (repeats 6 months later)' : 'Due Month'}</label>
            <select class="form-select" id="bill-duemonth">
                ${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) =>
                    `<option value="${i}" ${(bill.dueMonth || 0) === i ? 'selected' : ''}>${m}</option>`
                ).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group" style="position:relative;">
                <label>Category</label>
                <div class="category-picker-wrapper">
                    <input type="text" class="form-input" id="bill-category" placeholder="Search or select..."
                           value="${escapeHtml(bill.category)}" autocomplete="off">
                    <button type="button" class="category-picker-btn" id="category-picker-toggle">▼</button>
                </div>
                <div class="category-dropdown" id="category-dropdown">
                    ${renderCategoryDropdown(store.getCustomCategories())}
                </div>
            </div>
            <div class="form-group">
                <label>Payment Source</label>
                <select class="form-select" id="bill-source">
                    <option value="">None</option>
                    ${sources.map(s => `<option value="${escapeHtml(s)}" ${bill.paymentSource === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Frequency</label>
                <select class="form-select" id="bill-frequency">
                    <option value="monthly" ${bill.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="per-paycheck" ${bill.frequency === 'per-paycheck' ? 'selected' : ''}>Per Paycheck</option>
                    <option value="twice-monthly" ${bill.frequency === 'twice-monthly' ? 'selected' : ''}>2x/Month (1st &amp; last check)</option>
                    <option value="biweekly" ${bill.frequency === 'biweekly' ? 'selected' : ''}>Biweekly</option>
                    <option value="weekly" ${bill.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="semi-annual" ${bill.frequency === 'semi-annual' ? 'selected' : ''}>Semi-Annual (6 months)</option>
                    <option value="yearly" ${bill.frequency === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select>
            </div>
            <div class="form-group" style="display:flex;gap:20px;align-items:end;padding-bottom:8px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="bill-frozen" ${bill.frozen ? 'checked' : ''}> Frozen
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="bill-autopay" ${bill.autoPay ? 'checked' : ''}> Auto Pay
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;" title="Bill still shows in list but won't count toward Total Bills (e.g. paid via charge card already tracked as a debt)">
                    <input type="checkbox" id="bill-exclude" ${bill.excludeFromTotal ? 'checked' : ''}> Exclude from Totals
                </label>
            </div>
        </div>
        <div class="form-group">
            <label>Budget Category (optional)</label>
            <select class="form-select" id="bill-expense-category">
                <option value="">— none (don't count toward a budget) —</option>
                ${renderCategoryOptions(bill.expenseCategory, store)}
            </select>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                Tag this bill with a budget category to have it counted toward the matching Category Budget each month.
            </div>
        </div>
        <div class="form-group">
            <label>Notes</label>
            <input type="text" class="form-input" id="bill-notes" value="${escapeHtml(bill.notes)}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Bill</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Bill' : 'Add New Bill', formHtml);

    // Setup category picker dropdown (bill category — the Housing/Utilities taxonomy)
    setupCategoryPicker();

    // Searchable category picker for the budget-category field
    mountSearchableCategoryPicker(document.getElementById('bill-expense-category'), store);

    // Show/hide covering checkbox based on owner
    const ownerSelect = document.getElementById('bill-owner');
    const coveringGroup = document.getElementById('bill-covering-group');
    if (ownerSelect && coveringGroup) {
        ownerSelect.addEventListener('change', () => {
            coveringGroup.style.display = ownerSelect.value === 'dependent' ? '' : 'none';
        });
    }

    // Show/hide fields based on frequency
    const freqSelect = document.getElementById('bill-frequency');
    const dueMonthGroup = document.getElementById('bill-duemonth-group');
    const dueMonthLabel = document.getElementById('bill-duemonth-label');
    const dueDayGroup = document.getElementById('bill-due-group');
    const dayOfWeekGroup = document.getElementById('bill-dayofweek-group');
    freqSelect.addEventListener('change', () => {
        const freq = freqSelect.value;
        const showMonth = freq === 'yearly' || freq === 'semi-annual';
        const showDayOfWeek = freq === 'weekly' || freq === 'biweekly';
        const isPaycheckBased = freq === 'per-paycheck' || freq === 'twice-monthly';
        dueMonthGroup.style.display = showMonth ? '' : 'none';
        dueMonthLabel.textContent = freq === 'semi-annual' ? 'First Due Month (repeats 6 months later)' : 'Due Month';
        dueDayGroup.style.display = (showDayOfWeek || isPaycheckBased) ? 'none' : '';
        dayOfWeekGroup.style.display = showDayOfWeek ? '' : 'none';
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const freq = document.getElementById('bill-frequency').value;
        const isWeeklyType = freq === 'weekly' || freq === 'biweekly';
        const ownerEl = document.getElementById('bill-owner');
        const coveringEl = document.getElementById('bill-covering');
        const owner = ownerEl ? ownerEl.value : 'user';

        const data = {
            name: document.getElementById('bill-name').value.trim(),
            amount: parseFloat(document.getElementById('bill-amount').value) || 0,
            dueDay: isWeeklyType
                ? parseInt(document.getElementById('bill-dayofweek').value) || 1
                : parseInt(document.getElementById('bill-due').value) || 1,
            category: document.getElementById('bill-category').value.trim(),
            paymentSource: document.getElementById('bill-source').value,
            frequency: freq,
            dueMonth: (freq === 'yearly' || freq === 'semi-annual') ? parseInt(document.getElementById('bill-duemonth').value) : null,
            frozen: document.getElementById('bill-frozen').checked,
            autoPay: document.getElementById('bill-autopay').checked,
            excludeFromTotal: document.getElementById('bill-exclude').checked,
            notes: document.getElementById('bill-notes').value.trim(),
            owner: owner,
            userCovering: owner === 'dependent' && coveringEl ? coveringEl.checked : false,
            expenseCategory: document.getElementById('bill-expense-category').value || null
        };

        if (!data.name) { alert('Please enter a bill name'); return; }

        if (isEdit) {
            store.updateBill(existingBill.id, data);
        } else {
            store.addBill(data);
        }

        closeModal();
        refreshPage();
    });
}

// =============== CASHFLOW VIEW ===============

function renderCashflowView(container, store, allBills, sources, categories, year, month, payDates) {
    const now = new Date();
    const userName = store.getUserName();
    const income = store.getIncome();
    const bills = store.getBills();
    const depEnabled = store.isDependentEnabled();
    const paySchedule = store.getPaySchedule();
    const otherIncome = store.getOtherIncome();
    const combineDepIncome = income.combineDependentIncome !== false;
    const accounts = store.getAccounts();

    // Monthly income calculation
    const monthlyMult = getMonthlyMultiplier(paySchedule.frequency);
    const userPayMonthly = income.user.payAmount * monthlyMult;
    const otherIncomeMonthly = otherIncome.reduce((s, src) => s + getOtherIncomeMonthly(src), 0);
    const depMonthlyPay = depEnabled && combineDepIncome ? (income.dependent.payAmount || 0) : 0;
    const totalMonthlyIncome = userPayMonthly + otherIncomeMonthly + depMonthlyPay;

    // Find dependent bills the user is covering (now using owner field instead of separate array)
    const depCoveredBills = depEnabled ? bills.filter(b => b.owner === 'dependent' && b.userCovering) : [];
    const depCoverageTotal = depCoveredBills.reduce((sum, b) => sum + b.amount, 0);

    const monthlyOutflow = bills.reduce((sum, b) => {
        if (b.frozen || b.excludeFromTotal) return sum;
        return sum + getBillMonthlyAmount(b, month, store);
    }, 0) + depCoverageTotal;

    const netCashflow = totalMonthlyIncome - monthlyOutflow;
    const savingsRate = totalMonthlyIncome > 0 ? (netCashflow / totalMonthlyIncome * 100) : 0;

    // Category breakdown for waterfall (annualized monthly)
    const categoryTotals = {};
    bills.filter(b => !b.frozen && !b.excludeFromTotal).forEach(bill => {
        const cat = bill.category || 'Uncategorized';
        if (!categoryTotals[cat]) categoryTotals[cat] = 0;
        categoryTotals[cat] += getBillAnnualizedMonthly(bill);
    });
    if (depCoverageTotal > 0) {
        categoryTotals['Dependent Coverage'] = depCoverageTotal;
    }
    const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const annualizedOutflow = sortedCategories.reduce((s, [, v]) => s + v, 0);
    const waterfallNet = totalMonthlyIncome - annualizedOutflow;

    // 6-month projection
    const projection = [];
    for (let i = 0; i < 6; i++) {
        const projMonth = (month + i) % 12;
        const monthExpenses = bills.reduce((sum, b) => {
            if (b.frozen || b.excludeFromTotal) return sum;
            return sum + getBillMonthlyAmount(b, projMonth, store);
        }, 0) + depCoverageTotal;
        projection.push({
            month: projMonth,
            label: new Date(year, month + i, 1).toLocaleDateString('en-US', { month: 'short' }),
            income: totalMonthlyIncome,
            expenses: monthExpenses,
            net: totalMonthlyIncome - monthExpenses
        });
    }
    const projMax = Math.max(...projection.map(p => Math.max(p.income, p.expenses)));

    // Income sources breakdown
    const incomeSources = [];
    if (userPayMonthly > 0) incomeSources.push({ name: store.getUserName() + "'s Pay", amount: userPayMonthly });
    if (depMonthlyPay > 0) incomeSources.push({ name: store.getDependentName() + "'s Pay", amount: depMonthlyPay });
    otherIncome.forEach(src => {
        const amt = getOtherIncomeMonthly(src);
        if (amt > 0) incomeSources.push({ name: src.name, amount: amt });
    });
    const incomeMax = incomeSources.length > 0 ? Math.max(...incomeSources.map(s => s.amount)) : 0;
    const expenseMax = sortedCategories.length > 0 ? sortedCategories[0][1] : 0;

    // ─── Sankey data: prefer actual transactions (last 30 days) when available ───
    // Falls back to recurring bills if the user has no imported transactions yet.
    const allExpenses = (store.getExpenses ? store.getExpenses() : []) || [];
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentExpenses = allExpenses.filter(e => {
        if (!e || !e.date) return false;
        const d = new Date(e.date);
        return !isNaN(d) && d >= thirtyDaysAgo && d <= today && (e.amount || 0) > 0;
    });

    let sankeyCategories;
    let sankeySource = 'bills';
    if (recentExpenses.length >= 3) {
        const txnTotals = {};
        recentExpenses.forEach(e => {
            const cat = (e.category || 'Uncategorized').replace(/^\w/, c => c.toUpperCase());
            txnTotals[cat] = (txnTotals[cat] || 0) + (e.amount || 0);
        });
        sankeyCategories = Object.entries(txnTotals).sort((a, b) => b[1] - a[1]);
        sankeySource = 'transactions';
    } else {
        sankeyCategories = sortedCategories;
    }
    const sankeyOutflow = sankeyCategories.reduce((s, [, v]) => s + v, 0);
    const sankeyNet = totalMonthlyIncome - sankeyOutflow;

    // Pay periods
    const payPeriods = buildPayPeriods(payDates, bills, store, income, year, month, depCoveredBills, otherIncome);
    const startingBalance = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);

    // Waterfall chart max value
    const waterfallMax = Math.max(totalMonthlyIncome, annualizedOutflow);

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>${escapeHtml(userName)}'s Bills</h2>
                <div class="subtitle">${monthNames[month]} ${year} Cashflow</div>
            </div>
            <button class="btn btn-primary" id="add-bill-btn">+ Add Bill</button>
        </div>

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <span style="font-size:12px;color:var(--text-secondary);">View:</span>
            <button class="btn btn-sm btn-secondary" id="view-paycheck">Paycheck</button>
            <button class="btn btn-sm btn-secondary" id="view-month">Month</button>
            <button class="btn btn-sm btn-primary" id="view-cashflow">Cashflow</button>
        </div>

        <!-- Summary Stat Cards -->
        <div class="card-grid">
            <div class="stat-card green">
                <div class="label">Monthly Income</div>
                <div class="value">${formatCurrency(totalMonthlyIncome)}</div>
                <div class="sub">${formatCurrency(userPayMonthly)} pay${otherIncomeMonthly > 0 ? ` + ${formatCurrency(otherIncomeMonthly)} other` : ''}${depMonthlyPay > 0 ? ` + ${formatCurrency(depMonthlyPay)} dep` : ''}</div>
            </div>
            <div class="stat-card red">
                <div class="label">Monthly Outflow</div>
                <div class="value">${formatCurrency(monthlyOutflow)}</div>
                <div class="sub">${bills.filter(b => !b.frozen && !b.excludeFromTotal).length} bills${depCoverageTotal > 0 ? ` + ${formatCurrency(depCoverageTotal)} dep coverage` : ''}</div>
            </div>
            <div class="stat-card ${netCashflow >= 0 ? 'green' : 'red'}">
                <div class="label">Net Cashflow</div>
                <div class="value">${netCashflow >= 0 ? '+' : ''}${formatCurrency(netCashflow)}</div>
                <div class="sub">${totalMonthlyIncome > 0 ? `${Math.abs(netCashflow / totalMonthlyIncome * 100).toFixed(1)}% of income` : 'Income minus outflow'}</div>
            </div>
            <div class="stat-card ${savingsRate >= 20 ? 'green' : savingsRate >= 0 ? 'blue' : 'red'}">
                <div class="label">Savings Rate</div>
                <div class="value">${savingsRate.toFixed(1)}%</div>
                <div class="sub">${savingsRate >= 20 ? 'Healthy' : savingsRate >= 10 ? 'Moderate' : savingsRate >= 0 ? 'Low' : 'Negative'}</div>
            </div>
        </div>

        <!-- Cashflow Sankey -->
        <div class="card mb-24">
            <div class="flex-between mb-16">
                <div>
                    <h3>Cashflow Sankey</h3>
                    <p style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                        Interactive view — how income flows through ${sankeySource === 'transactions' ? 'your actual spending (last 30 days)' : 'your recurring bills'} to ${sankeyNet >= 0 ? 'savings' : 'shortfall'}
                        ${sankeySource === 'transactions' ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;background:rgba(99,102,241,0.15);color:#818cf8;border-radius:10px;font-size:10px;font-weight:600;">${recentExpenses.length} transactions</span>` : ''}
                    </p>
                </div>
                <div style="display:flex;align-items:center;gap:12px;font-size:11px;color:var(--text-muted);">
                    <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#10b981;border-radius:2px;display:inline-block;"></span> Income</span>
                    <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#ef4444;border-radius:2px;display:inline-block;"></span> Expenses</span>
                    <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${sankeyNet >= 0 ? '#22c55e' : '#f59e0b'};border-radius:2px;display:inline-block;"></span> ${sankeyNet >= 0 ? 'Savings' : 'Shortfall'}</span>
                </div>
            </div>
            <div id="cashflow-sankey-mount" style="min-height:360px;width:100%;"></div>
        </div>

        <!-- 6-Month Projection -->
        <div class="card mb-24">
            <div class="flex-between mb-16">
                <h3>6-Month Projection</h3>
                <div style="display:flex;align-items:center;gap:16px;font-size:11px;">
                    <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--green);border-radius:2px;display:inline-block;"></span> Income</span>
                    <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--red);border-radius:2px;display:inline-block;"></span> Expenses</span>
                </div>
            </div>
            ${projMax > 0 ? `
            <div class="timeline-chart">
                ${projection.map(p => {
                    const incH = (p.income / projMax * 100).toFixed(1);
                    const expH = (p.expenses / projMax * 100).toFixed(1);
                    return `
                <div class="timeline-month">
                    <div class="timeline-net" style="color:${p.net >= 0 ? 'var(--green)' : 'var(--red)'};">${p.net >= 0 ? '+' : ''}${formatCurrency(p.net)}</div>
                    <div class="timeline-bar-group">
                        <div class="timeline-bar income" style="height:${incH}%;"></div>
                        <div class="timeline-bar expense" style="height:${expH}%;"></div>
                    </div>
                    <div class="timeline-label">${p.label}</div>
                </div>`;
                }).join('')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:8px;text-align:center;">
                ${projection.map(p => `
                <div style="font-size:10px;">
                    <div style="color:var(--text-muted);">Exp: ${formatCurrency(p.expenses)}</div>
                </div>`).join('')}
            </div>
            ` : '<div style="font-size:13px;color:var(--text-muted);padding:24px;text-align:center;">No data to project</div>'}
        </div>

        <!-- Income vs Expenses Breakdown -->
        <div class="card mb-24">
            <h3 class="mb-16">Income vs. Expenses Breakdown</h3>
            <div class="breakdown-grid">
                <div>
                    <div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:12px;">Income Sources</div>
                    ${incomeSources.length > 0 ? incomeSources.map(src => {
                        const pct = totalMonthlyIncome > 0 ? (src.amount / totalMonthlyIncome * 100) : 0;
                        const barPct = incomeMax > 0 ? (src.amount / incomeMax * 100) : 0;
                        return `
                    <div class="breakdown-item">
                        <div class="flex-between" style="margin-bottom:4px;">
                            <span style="font-size:13px;font-weight:500;">${escapeHtml(src.name)}</span>
                            <span style="font-size:13px;font-weight:700;">${formatCurrency(src.amount)} <span style="font-size:11px;color:var(--text-muted);font-weight:400;">(${pct.toFixed(1)}%)</span></span>
                        </div>
                        <div class="breakdown-bar"><div class="breakdown-bar-fill green" style="width:${barPct.toFixed(1)}%;"></div></div>
                    </div>`;
                    }).join('') : '<div style="font-size:13px;color:var(--text-muted);">No income configured</div>'}
                    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:8px;">
                        <div class="flex-between" style="font-size:13px;font-weight:700;">
                            <span>Total Income</span>
                            <span class="text-green">${formatCurrency(totalMonthlyIncome)}</span>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:12px;">Expense Categories</div>
                    ${sortedCategories.length > 0 ? sortedCategories.map(([cat, amount]) => {
                        const pct = totalMonthlyIncome > 0 ? (amount / totalMonthlyIncome * 100) : 0;
                        const barPct = expenseMax > 0 ? (amount / expenseMax * 100) : 0;
                        return `
                    <div class="breakdown-item">
                        <div class="flex-between" style="margin-bottom:4px;">
                            <span style="font-size:13px;font-weight:500;">${escapeHtml(cat)}</span>
                            <span style="font-size:13px;font-weight:700;">${formatCurrency(amount)} <span style="font-size:11px;color:var(--text-muted);font-weight:400;">(${pct.toFixed(1)}%)</span></span>
                        </div>
                        <div class="breakdown-bar"><div class="breakdown-bar-fill red" style="width:${barPct.toFixed(1)}%;"></div></div>
                    </div>`;
                    }).join('') : '<div style="font-size:13px;color:var(--text-muted);">No bills configured</div>'}
                    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:8px;">
                        <div class="flex-between" style="font-size:13px;font-weight:700;">
                            <span>Total Expenses</span>
                            <span class="text-red">${formatCurrency(annualizedOutflow)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Pay Period Cashflow Detail -->
        ${payPeriods.length > 0 ? (() => {
            let currentIdx = payPeriods.findIndex(p => p.isCurrent);
            if (currentIdx === -1) currentIdx = 0;
            const startIdx = Math.max(0, Math.min(currentIdx + cfPeriodOffset, payPeriods.length - 1));
            const visiblePeriods = payPeriods.slice(startIdx, startIdx + 3);
            const canGoPrev = startIdx > 0;
            const canGoNext = startIdx + 3 < payPeriods.length;
            const showingCurrent = cfPeriodOffset === 0;

            // Running balance
            let runningBalance = startingBalance;
            for (let i = 0; i < startIdx; i++) {
                runningBalance += payPeriods[i].available;
            }

            return `
        <div class="card mb-24">
            <div class="flex-between mb-16">
                <div>
                    <h3>Pay Period Cashflow</h3>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Starting balance: ${formatCurrency(startingBalance)} (checking + savings)</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="btn-icon" id="cf-period-prev" ${!canGoPrev ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    ${!showingCurrent ? '<button class="btn btn-secondary btn-sm" id="cf-period-today" style="font-size:11px;padding:2px 8px;">Current</button>' : ''}
                    <button class="btn-icon" id="cf-period-next" ${!canGoNext ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
                ${visiblePeriods.map(period => {
                    const periodStart = runningBalance;
                    const periodEnd = runningBalance + period.available;
                    runningBalance = periodEnd;
                    const progressPct = periodStart > 0 ? Math.max(0, Math.min(100, (periodEnd / periodStart) * 100)) : 50;
                    const isCurrent = period.isCurrent;
                    const borderStyle = isCurrent ? 'border-color:var(--accent);background:var(--accent-bg);' : '';
                    return `
                    <div class="card" style="padding:16px;${borderStyle}">
                        <div class="flex-between mb-16">
                            <div>
                                <div style="font-size:14px;font-weight:700;">
                                    ${isCurrent ? '<span style="display:inline-block;width:8px;height:8px;background:var(--accent);border-radius:50%;margin-right:6px;"></span>' : ''}
                                    ${period.label}
                                </div>
                                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                                    ${period.startLabel} &rarr; ${period.endLabel}
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:12px;color:var(--text-secondary);">${formatCurrency(periodStart)} &rarr;</div>
                                <div style="font-size:20px;font-weight:700;color:${periodEnd >= 0 ? 'var(--green)' : 'var(--red)'};">${formatCurrency(periodEnd)}</div>
                            </div>
                        </div>
                        <div style="background:var(--bg-input);border-radius:8px;height:8px;overflow:hidden;margin-bottom:12px;">
                            <div style="height:100%;width:${progressPct}%;background:${periodEnd >= periodStart ? 'var(--green)' : 'var(--red)'};border-radius:8px;"></div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
                            <div style="background:var(--bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                                <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">Income</div>
                                <div style="font-size:14px;font-weight:700;color:var(--green);">${formatCurrency(income.user.payAmount + period.otherIncomeTotal)}</div>
                            </div>
                            <div style="background:var(--bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                                <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">Bills</div>
                                <div style="font-size:14px;font-weight:700;color:var(--red);">${formatCurrency(period.billsTotal)}</div>
                            </div>
                            <div style="background:var(--bg-secondary);padding:8px;border-radius:var(--radius-sm);">
                                <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">Net</div>
                                <div style="font-size:14px;font-weight:700;color:${period.available >= 0 ? 'var(--green)' : 'var(--red)'};">${period.available >= 0 ? '+' : ''}${formatCurrency(period.available)}</div>
                            </div>
                        </div>
                        ${period.bills.length > 0 ? `
                        <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:12px;">
                            ${period.bills.map(bill => {
                                const isExcluded = bill.excludeFromTotal;
                                const isVirtual = bill._virtual;
                                return `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;${isVirtual ? 'color:var(--purple);' : ''}${isExcluded ? 'opacity:0.45;' : ''}">
                                    <span>${escapeHtml(bill.name)} <span class="text-muted">(${bill.dueDay}${getOrdinal(bill.dueDay)})</span>${isExcluded ? ' <span style="font-size:9px;color:var(--yellow);">EXCL</span>' : ''}</span>
                                    <span class="font-bold">${formatCurrency(bill.amount)}</span>
                                </div>`;
                            }).join('')}
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
        })() : `
        <div class="card mb-24" style="border-color:var(--yellow);">
            <div class="flex-between">
                <div>
                    <h3 class="text-yellow">Set Up Pay Dates</h3>
                    <p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                        Go to <strong>Settings</strong> and add your pay dates to see pay period cashflow details.
                    </p>
                </div>
            </div>
        </div>`}
    `;

    // Render the Sankey diagram (requires DOM insertion, so run after innerHTML)
    const sankeyMount = container.querySelector('#cashflow-sankey-mount');
    if (sankeyMount) {
        const renderSankey = () => renderCashflowSankey(sankeyMount, {
            incomeSources,
            expenseCategories: sankeyCategories,
            netCashflow: sankeyNet,
        });
        // Defer to next frame so the container has measurable layout width.
        // Without this, clientWidth can be 0 in some layouts and the SVG renders blank.
        requestAnimationFrame(() => {
            if (document.body.contains(sankeyMount)) renderSankey();
        });
        // Re-render on resize (debounced) so the SVG adapts to container width
        if (window._cashflowSankeyResize) {
            window.removeEventListener('resize', window._cashflowSankeyResize);
        }
        let resizeTimer = null;
        window._cashflowSankeyResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (document.body.contains(sankeyMount)) renderSankey();
            }, 150);
        };
        window.addEventListener('resize', window._cashflowSankeyResize);
    }

    // Event handlers
    container.querySelector('#view-paycheck').addEventListener('click', () => {
        billsViewMode = 'paycheck';
        renderBills(container, store);
    });
    container.querySelector('#view-month').addEventListener('click', () => {
        billsViewMode = 'month';
        renderBills(container, store);
    });
    container.querySelector('#view-cashflow').addEventListener('click', () => {
        billsViewMode = 'cashflow';
        cfPeriodOffset = 0;
        renderBills(container, store);
    });

    // Add bill button
    container.querySelector('#add-bill-btn').addEventListener('click', () => {
        showBillForm(store, sources, categories);
    });

    // Period navigation
    const prevBtn = container.querySelector('#cf-period-prev');
    const nextBtn = container.querySelector('#cf-period-next');
    const todayBtn = container.querySelector('#cf-period-today');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            cfPeriodOffset--;
            renderCashflowView(container, store, allBills, sources, categories, year, month, payDates);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            cfPeriodOffset++;
            renderCashflowView(container, store, allBills, sources, categories, year, month, payDates);
        });
    }
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            cfPeriodOffset = 0;
            renderCashflowView(container, store, allBills, sources, categories, year, month, payDates);
        });
    }
}

// Helper: other income source to monthly amount
function getOtherIncomeMonthly(src) {
    const amt = src.amount || 0;
    switch (src.frequency) {
        case 'weekly': return amt * 52 / 12;
        case 'biweekly': return amt * 26 / 12;
        case 'monthly': return amt;
        case 'quarterly': return amt / 3;
        case 'yearly': return amt / 12;
        default: return 0;
    }
}

// Helper: count occurrences of a day-of-week in a given month
function countDayOfWeekInMonth(targetDay, yr, mo) {
    const lastOfMonth = new Date(yr, mo + 1, 0);
    let count = 0;
    let d = new Date(yr, mo, 1);
    while (d.getDay() !== targetDay) d = new Date(d.getTime() + 86400000);
    while (d <= lastOfMonth) { count++; d = new Date(d.getTime() + 7 * 86400000); }
    return count;
}

// Helper: bill amount for a specific month (respects frequency using occurrence counting)
function getBillMonthlyAmount(bill, targetMonth, store) {
    if (bill.frozen || bill.excludeFromTotal) return 0;
    const yr = new Date().getFullYear();
    if (bill.frequency === 'per-paycheck') {
        // Count actual pay dates in the month
        const payDates = store ? store.getPayDates() : [];
        const count = payDates.filter(d => d.getFullYear() === yr && d.getMonth() === targetMonth).length;
        return bill.amount * (count || 2);
    }
    if (bill.frequency === 'twice-monthly') {
        return bill.amount * 2;
    }
    if (bill.frequency === 'weekly') {
        const targetDay = (bill.dueDay || 0) % 7;
        return bill.amount * countDayOfWeekInMonth(targetDay, yr, targetMonth);
    }
    if (bill.frequency === 'biweekly') {
        const targetDay = (bill.dueDay || 0) % 7;
        return bill.amount * Math.ceil(countDayOfWeekInMonth(targetDay, yr, targetMonth) / 2);
    }
    if (bill.frequency === 'yearly') {
        return bill.dueMonth === targetMonth ? bill.amount : 0;
    }
    if (bill.frequency === 'semi-annual') {
        const secondMonth = (bill.dueMonth + 6) % 12;
        return (bill.dueMonth === targetMonth || secondMonth === targetMonth) ? bill.amount : 0;
    }
    return bill.amount;
}

// Helper: annualized monthly amount for waterfall
function getBillAnnualizedMonthly(bill) {
    if (bill.frozen || bill.excludeFromTotal) return 0;
    if (bill.frequency === 'per-paycheck') return bill.amount * 2;
    if (bill.frequency === 'twice-monthly') return bill.amount * 2;
    if (bill.frequency === 'weekly') return bill.amount * 52 / 12;
    if (bill.frequency === 'biweekly') return bill.amount * 26 / 12;
    if (bill.frequency === 'yearly') return bill.amount / 12;
    if (bill.frequency === 'semi-annual') return bill.amount / 6;
    return bill.amount;
}

