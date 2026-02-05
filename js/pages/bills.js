import { formatCurrency, getCategoryBadgeClass, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let billsViewMode = 'paycheck'; // 'paycheck' or 'month'
let billsSortCol = 'dueDay';
let billsSortDir = 'asc';
let selectedBillIds = new Set();

export function renderBills(container, store) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const userName = store.getUserName();
    const allBills = store.getBills();
    const sources = store.getPaymentSources();

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

    // Filter bills based on view mode
    let bills, periodicBills;
    if (billsViewMode === 'paycheck' && periodStart && periodEnd) {
        // Count paychecks in this month for per-paycheck bill logic
        const monthPaychecks = sorted.filter(d =>
            d.getFullYear() === periodStart.getFullYear() && d.getMonth() === periodStart.getMonth()
        );
        const isThreeCheckMonth = monthPaychecks.length >= 3;
        const isFirstCheck = isThreeCheckMonth && periodStart.getTime() === Math.min(...monthPaychecks.map(d => d.getTime()));
        const isLastCheck = isThreeCheckMonth && periodStart.getTime() === Math.max(...monthPaychecks.map(d => d.getTime()));

        bills = allRegularBills.filter(b => {
            if (b.frozen) return false;

            // Per-paycheck bills: show on every check, except 3-check months (first & last only)
            if (b.frequency === 'per-paycheck') {
                if (isThreeCheckMonth) {
                    return isFirstCheck || isLastCheck;
                }
                return true;
            }

            const dueThisMonth = new Date(periodStart.getFullYear(), periodStart.getMonth(), b.dueDay);
            const dueNextMonth = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, b.dueDay);
            return (dueThisMonth >= periodStart && dueThisMonth <= periodEnd) ||
                   (dueNextMonth >= periodStart && dueNextMonth <= periodEnd);
        });

        // Only show periodic bills if they're due in this pay period
        periodicBills = allPeriodicBills.filter(b => !b.frozen && isPeriodicBillDueInRange(b, periodStart, periodEnd));
    } else {
        bills = allRegularBills;
        periodicBills = allPeriodicBills;
    }

    // Get unique categories
    const categories = [...new Set(allBills.map(b => b.category))].sort();

    const viewLabel = billsViewMode === 'paycheck' && periodLabel
        ? `Current Paycheck (${periodLabel})`
        : 'Full Month';

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>${escapeHtml(userName)}'s Bills</h2>
                <div class="subtitle">${billsViewMode === 'paycheck' ? `${bills.length} bills this period${periodicBills.length > 0 ? ` + ${periodicBills.length} annual/semi-annual` : ''}` : `${allRegularBills.length} bills + ${allPeriodicBills.length} annual/semi-annual &middot; ${allBills.filter(b => b.frozen).length} frozen`}</div>
            </div>
            <button class="btn btn-primary" id="add-bill-btn">+ Add Bill</button>
        </div>

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
            <span style="font-size:12px;color:var(--text-secondary);">View:</span>
            <button class="btn btn-sm ${billsViewMode === 'paycheck' ? 'btn-primary' : 'btn-secondary'}" id="view-paycheck">Current Paycheck</button>
            <button class="btn btn-sm ${billsViewMode === 'month' ? 'btn-primary' : 'btn-secondary'}" id="view-month">Full Month</button>
            ${billsViewMode === 'paycheck' && periodLabel ? `<span style="font-size:12px;color:var(--text-muted);margin-left:4px;">${periodLabel}</span>` : ''}
        </div>

        <div class="filters" id="filters">
            <button class="filter-chip active" data-filter="all">All</button>
            ${categories.map(c => `<button class="filter-chip" data-filter="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
            ${billsViewMode === 'month' ? '<button class="filter-chip" data-filter="frozen" style="border-color:var(--blue);color:var(--blue);">Frozen</button>' : ''}
            <button class="filter-chip" data-filter="unpaid" style="border-color:var(--red);color:var(--red);">Unpaid</button>
        </div>

        <div class="table-wrapper">
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
                    ${renderBillRows(sortBills(bills, store, year, month), store, year, month)}
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
            <div class="table-wrapper">
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
                        ${renderBillRows(sortBills(periodicBills, store, year, month), store, year, month)}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${(() => {
            const regularTotal = bills.filter(b => !b.frozen && !b.excludeFromTotal).reduce((s, b) => {
                if (billsViewMode === 'month' && b.frequency === 'per-paycheck') return s + b.amount * 2;
                return s + b.amount;
            }, 0);
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
            if (selectedBillIds.size === 0) return '<div id="selection-bar" style="display:none;"></div>';
            const selectedBills = [...selectedBillIds].map(id => allBills.find(b => b.id === id)).filter(Boolean);
            const bySource = {};
            selectedBills.forEach(b => {
                const src = b.paymentSource || 'No Source';
                if (!bySource[src]) bySource[src] = 0;
                bySource[src] += b.amount;
            });
            const sourceEntries = Object.entries(bySource).sort((a, b) => a[0].localeCompare(b[0]));
            const grandTotal = selectedBills.reduce((s, b) => s + b.amount, 0);
            return `<div id="selection-bar" style="display:flex;position:fixed;bottom:0;left:170px;right:0;background:var(--bg-card);border-top:2px solid var(--accent);padding:12px 24px;align-items:center;justify-content:space-between;z-index:100;box-shadow:0 -2px 12px rgba(0,0,0,0.3);">
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-size:13px;color:var(--text-secondary);">${selectedBillIds.size} bill${selectedBillIds.size !== 1 ? 's' : ''} selected</span>
                    <button class="btn btn-sm btn-secondary" id="clear-selection">Clear</button>
                </div>
                <div style="display:flex;align-items:center;gap:20px;">
                    ${sourceEntries.map(([src, total]) => `<div style="text-align:right;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:1px;">${escapeHtml(src)}</div><div style="font-size:14px;font-weight:600;color:var(--text-primary);">${formatCurrency(total)}</div></div>`).join('')}
                    ${sourceEntries.length > 1 ? `<div style="border-left:1px solid var(--border);padding-left:20px;text-align:right;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:1px;">Total</div><div style="font-size:16px;font-weight:700;color:var(--accent);">${formatCurrency(grandTotal)}</div></div>` : ''}
                </div>
            </div>`;
        })()}
    `;

    // View toggle events
    container.querySelector('#view-paycheck').addEventListener('click', () => {
        billsViewMode = 'paycheck';
        renderBills(container, store);
    });
    container.querySelector('#view-month').addEventListener('click', () => {
        billsViewMode = 'month';
        renderBills(container, store);
    });

    // Event: Add bill
    container.querySelector('#add-bill-btn').addEventListener('click', () => {
        showBillForm(store, sources, categories);
    });

    // Event: Filter chips
    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const filter = chip.dataset.filter;
            const tbody = container.querySelector('#bills-tbody');
            tbody.innerHTML = renderBillRows(sortBills(filterBills(bills, filter), store, year, month), store, year, month);
            attachRowEvents(tbody, store, allBills, sources, categories, year, month);
            attachSelectionEvents(tbody);
            // Also filter periodic bills section
            const periodicTbody = container.querySelector('#periodic-bills-tbody');
            if (periodicTbody) {
                periodicTbody.innerHTML = renderBillRows(sortBills(filterBills(periodicBills, filter), store, year, month), store, year, month);
                attachRowEvents(periodicTbody, store, allBills, sources, categories, year, month);
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

    // Multi-select: Ctrl/Cmd+click or Shift+click on rows
    function attachSelectionEvents(tbody) {
        tbody.querySelectorAll('tr[data-bill-id]').forEach(tr => {
            tr.addEventListener('click', (e) => {
                // Don't select when clicking on interactive elements
                if (e.target.closest('button, input, label, a, .toggle')) return;
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;

                e.preventDefault();
                const billId = tr.dataset.billId;

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
                } else {
                    // Ctrl/Cmd+click: toggle individual
                    if (selectedBillIds.has(billId)) {
                        selectedBillIds.delete(billId);
                    } else {
                        selectedBillIds.add(billId);
                    }
                }
                renderBills(container, store);
            });
        });
    }
    attachSelectionEvents(container.querySelector('#bills-tbody'));
    const periodicTbodyForSelect = container.querySelector('#periodic-bills-tbody');
    if (periodicTbodyForSelect) attachSelectionEvents(periodicTbodyForSelect);

    // Clear selection button
    const clearBtn = container.querySelector('#clear-selection');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            selectedBillIds.clear();
            renderBills(container, store);
        });
    }

    // Attach row events
    attachRowEvents(container.querySelector('#bills-tbody'), store, allBills, sources, categories, year, month);
    const periodicTbody = container.querySelector('#periodic-bills-tbody');
    if (periodicTbody) {
        attachRowEvents(periodicTbody, store, allBills, sources, categories, year, month);
    }
}

function filterBills(bills, filter) {
    if (filter === 'all') return bills;
    if (filter === 'frozen') return bills.filter(b => b.frozen);
    if (filter === 'unpaid') return bills; // handled differently in rendering
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
                const dayA = a.frequency === 'per-paycheck' ? 99 : (a.dueDay || 0);
                const dayB = b.frequency === 'per-paycheck' ? 99 : (b.dueDay || 0);
                cmp = dayA - dayB;
                break;
            }
            case 'status': {
                const statusOrder = (bill) => {
                    if (bill.frozen) return 2;
                    if (store.isBillPaid(bill.id, year, month)) return 1;
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

function renderBillRows(bills, store, year, month) {
    return bills.map(bill => {
        const isPaid = store.isBillPaid(bill.id, year, month);
        const statusClass = bill.frozen ? 'status-frozen' : isPaid ? 'status-paid' : 'status-unpaid';
        const statusText = bill.frozen ? 'FROZEN' : isPaid ? 'Paid' : 'Unpaid';
        const isLinked = !!bill.linkedDebtId;

        return `
            <tr data-bill-id="${bill.id}" style="${isPaid ? 'opacity:0.6;' : ''}${bill.frozen ? 'opacity:0.5;' : ''}" class="${selectedBillIds.has(bill.id) ? 'bill-selected' : ''}">
                <td>
                    <label class="toggle">
                        <input type="checkbox" ${isPaid ? 'checked' : ''} ${bill.frozen ? 'disabled' : ''} data-bill-id="${bill.id}" class="paid-toggle">
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td>
                    <div style="font-weight:600;">
                        ${escapeHtml(bill.name)}
                        ${isLinked ? '<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;" title="Linked to debt">&#128279; Linked</span>' : ''}
                        ${bill.excludeFromTotal ? '<span style="display:inline-block;margin-left:4px;font-size:9px;padding:1px 5px;background:rgba(251,191,36,0.1);color:var(--yellow);border:1px solid rgba(251,191,36,0.3);border-radius:3px;vertical-align:middle;font-weight:600;letter-spacing:0.3px;" title="Excluded from bill totals">EXCL</span>' : ''}
                    </div>
                    ${bill.notes ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(bill.notes)}</div>` : ''}
                </td>
                <td class="font-bold">${bill.amount > 0 ? formatCurrency(bill.amount) : '-'}${bill.frequency === 'per-paycheck' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">per check</div>' : bill.frequency === 'yearly' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">yearly</div>' : bill.frequency === 'semi-annual' ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400;">semi-annual</div>' : ''}</td>
                <td><span class="badge ${getCategoryBadgeClass(bill.category)}">${escapeHtml(bill.category)}</span></td>
                <td>${bill.frequency === 'per-paycheck' ? '<span style="font-size:11px;color:var(--accent);">Per check</span>' : `${bill.dueDay}${getOrdinal(bill.dueDay)}${(bill.frequency === 'yearly' || bill.frequency === 'semi-annual') && bill.dueMonth != null ? ` <span style="font-size:10px;color:var(--text-muted);">${MONTH_ABBR[bill.dueMonth]}${bill.frequency === 'semi-annual' ? '/' + MONTH_ABBR[(bill.dueMonth + 6) % 12] : ''}</span>` : ''}`}</td>
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

function attachRowEvents(tbody, store, bills, sources, categories, year, month) {
    // Paid toggles
    tbody.querySelectorAll('.paid-toggle').forEach(toggle => {
        toggle.addEventListener('change', () => {
            store.toggleBillPaid(toggle.dataset.billId, year, month);
            refreshPage();
        });
    });

    // Edit buttons
    tbody.querySelectorAll('.edit-bill').forEach(btn => {
        btn.addEventListener('click', () => {
            const bill = bills.find(b => b.id === btn.dataset.billId);
            if (bill) showBillForm(store, sources, categories, bill);
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

function showBillForm(store, sources, categories, existingBill = null) {
    const isEdit = !!existingBill;
    const bill = existingBill || {
        name: '', amount: 0, category: '', dueDay: 1,
        frequency: 'monthly', paymentSource: '', frozen: false,
        autoPay: false, excludeFromTotal: false, notes: ''
    };

    const formHtml = `
        <div class="form-group">
            <label>Bill Name</label>
            <input type="text" class="form-input" id="bill-name" value="${escapeHtml(bill.name)}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" class="form-input" id="bill-amount" step="0.01" value="${bill.amount}">
            </div>
            <div class="form-group">
                <label>Due Day of Month</label>
                <input type="number" class="form-input" id="bill-due" min="1" max="31" value="${bill.dueDay}">
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
            <div class="form-group">
                <label>Category</label>
                <input type="text" class="form-input" id="bill-category" list="categories-list" value="${escapeHtml(bill.category)}">
                <datalist id="categories-list">
                    ${categories.map(c => `<option value="${escapeHtml(c)}">`).join('')}
                    <option value="Housing">
                    <option value="Car">
                    <option value="Subscription">
                    <option value="Necessity">
                    <option value="Credit Card">
                    <option value="Utilities">
                    <option value="Insurance">
                    <option value="Storage">
                </datalist>
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
            <label>Notes</label>
            <input type="text" class="form-input" id="bill-notes" value="${escapeHtml(bill.notes)}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Bill</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Bill' : 'Add New Bill', formHtml);

    // Show/hide due month based on frequency
    const freqSelect = document.getElementById('bill-frequency');
    const dueMonthGroup = document.getElementById('bill-duemonth-group');
    const dueMonthLabel = document.getElementById('bill-duemonth-label');
    freqSelect.addEventListener('change', () => {
        const freq = freqSelect.value;
        const showMonth = freq === 'yearly' || freq === 'semi-annual';
        dueMonthGroup.style.display = showMonth ? '' : 'none';
        dueMonthLabel.textContent = freq === 'semi-annual' ? 'First Due Month (repeats 6 months later)' : 'Due Month';
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const freq = document.getElementById('bill-frequency').value;
        const data = {
            name: document.getElementById('bill-name').value.trim(),
            amount: parseFloat(document.getElementById('bill-amount').value) || 0,
            dueDay: parseInt(document.getElementById('bill-due').value) || 1,
            category: document.getElementById('bill-category').value.trim(),
            paymentSource: document.getElementById('bill-source').value,
            frequency: freq,
            dueMonth: (freq === 'yearly' || freq === 'semi-annual') ? parseInt(document.getElementById('bill-duemonth').value) : null,
            frozen: document.getElementById('bill-frozen').checked,
            autoPay: document.getElementById('bill-autopay').checked,
            excludeFromTotal: document.getElementById('bill-exclude').checked,
            notes: document.getElementById('bill-notes').value.trim()
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

function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}
