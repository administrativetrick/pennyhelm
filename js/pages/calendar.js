import { getMonthName, getDaysInMonth, getFirstDayOfMonth, formatCurrency, getCategoryBadgeClass, escapeHtml } from '../utils.js';

let viewYear, viewMonth;

export function renderCalendar(container, store) {
    const now = new Date();
    if (viewYear === undefined) {
        viewYear = now.getFullYear();
        viewMonth = now.getMonth();
    }

    const bills = store.getBills().filter(b => !b.frozen);
    // Get pay dates for this month from schedule
    const firstOfMonth = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
    const lastOfMonth = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${lastDay}`;
    const payDates = store.getPayDates(firstOfMonth, lastOfMonth);
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

    // Build day data
    const dayData = {};
    for (let d = 1; d <= daysInMonth; d++) {
        dayData[d] = { bills: [], isPayday: false };
    }

    bills.forEach(bill => {
        let dueDay = bill.dueDay;
        if (dueDay > daysInMonth) dueDay = daysInMonth;
        if (dayData[dueDay]) {
            dayData[dueDay].bills.push(bill);
        }
    });

    payDates.forEach(d => {
        const day = d.getDate();
        if (dayData[day]) dayData[day].isPayday = true;
    });

    const today = now.getDate();
    const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Calendar</h2>
                <div class="subtitle">Bill due dates and pay days</div>
            </div>
        </div>

        <div class="calendar-nav">
            <button class="btn-icon" id="cal-prev">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h3>${getMonthName(viewMonth)} ${viewYear}</h3>
            <button class="btn-icon" id="cal-next">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="btn btn-secondary btn-sm" id="cal-today">Today</button>
        </div>

        <div class="calendar-grid">
            <div class="calendar-header-cell">Sun</div>
            <div class="calendar-header-cell">Mon</div>
            <div class="calendar-header-cell">Tue</div>
            <div class="calendar-header-cell">Wed</div>
            <div class="calendar-header-cell">Thu</div>
            <div class="calendar-header-cell">Fri</div>
            <div class="calendar-header-cell">Sat</div>
            ${renderCalendarDays(firstDay, daysInMonth, dayData, isCurrentMonth, today, store, viewYear, viewMonth)}
        </div>

        <div class="card mt-16">
            <h3 class="mb-16">Legend</h3>
            <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;">
                <span style="display:flex;align-items:center;gap:6px;">
                    <span style="width:12px;height:12px;background:var(--green);border-radius:3px;"></span> Pay Day
                </span>
                <span style="display:flex;align-items:center;gap:6px;">
                    <span style="width:12px;height:12px;background:var(--green-bg);border:1px solid var(--green);border-radius:3px;"></span> Housing
                </span>
                <span style="display:flex;align-items:center;gap:6px;">
                    <span style="width:12px;height:12px;background:var(--orange-bg);border:1px solid var(--orange);border-radius:3px;"></span> Car
                </span>
                <span style="display:flex;align-items:center;gap:6px;">
                    <span style="width:12px;height:12px;background:var(--blue-bg);border:1px solid var(--blue);border-radius:3px;"></span> Subscription
                </span>
                <span style="display:flex;align-items:center;gap:6px;">
                    <span style="width:12px;height:12px;background:var(--red-bg);border:1px solid var(--red);border-radius:3px;"></span> Credit Card
                </span>
                <span style="display:flex;align-items:center;gap:6px;">
                    <span style="width:12px;height:12px;background:var(--purple-bg);border:1px solid var(--purple);border-radius:3px;"></span> Necessity
                </span>
            </div>
        </div>

        <div id="day-detail" class="card mt-16" style="display:none;">
            <h3 id="day-detail-title" class="mb-16"></h3>
            <div id="day-detail-content"></div>
        </div>
    `;

    // Nav events
    container.querySelector('#cal-prev').addEventListener('click', () => {
        viewMonth--;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        renderCalendar(container, store);
    });

    container.querySelector('#cal-next').addEventListener('click', () => {
        viewMonth++;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        renderCalendar(container, store);
    });

    container.querySelector('#cal-today').addEventListener('click', () => {
        viewYear = now.getFullYear();
        viewMonth = now.getMonth();
        renderCalendar(container, store);
    });

    // Day click events
    container.querySelectorAll('.calendar-day[data-day]').forEach(cell => {
        cell.addEventListener('click', () => {
            const day = parseInt(cell.dataset.day);
            showDayDetail(container, day, dayData[day], store, viewYear, viewMonth);
        });
    });
}

function renderCalendarDays(firstDay, daysInMonth, dayData, isCurrentMonth, today, store, year, month) {
    let html = '';

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day other-month"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const data = dayData[d];
        const isToday = isCurrentMonth && d === today;
        const classes = ['calendar-day'];
        if (isToday) classes.push('today');

        html += `<div class="${classes.join(' ')}" data-day="${d}">`;
        html += `<div class="day-number">${d}</div>`;
        html += '<div class="day-bills">';

        if (data.isPayday) {
            html += '<div class="calendar-payday">PAYDAY</div>';
        }

        data.bills.slice(0, 3).forEach(bill => {
            const isPaid = store.isBillPaid(bill.id, year, month);
            const bgColor = getBillColor(bill.category);
            html += `<div class="calendar-bill-dot" style="background:${bgColor};${isPaid ? 'text-decoration:line-through;opacity:0.5;' : ''}">${escapeHtml(bill.name.length > 12 ? bill.name.slice(0, 12) + '...' : bill.name)}</div>`;
        });

        if (data.bills.length > 3) {
            html += `<div class="calendar-bill-dot" style="background:var(--bg-secondary);color:var(--text-muted);">+${data.bills.length - 3} more</div>`;
        }

        html += '</div></div>';
    }

    // Fill remaining cells
    const totalCells = firstDay + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder > 0) {
        for (let i = 0; i < 7 - remainder; i++) {
            html += '<div class="calendar-day other-month"></div>';
        }
    }

    return html;
}

function getBillColor(category) {
    const map = {
        'Housing': 'var(--green-bg)',
        'HOUSING': 'var(--green-bg)',
        'Mortgage': 'var(--green-bg)',
        'Car': 'var(--orange-bg)',
        'Subscription': 'var(--blue-bg)',
        'Necessity': 'var(--purple-bg)',
        'Credit Card': 'var(--red-bg)',
        'UTILITIES': 'var(--yellow-bg)',
        'Utilities': 'var(--yellow-bg)',
        'Storage': 'var(--cyan-bg)',
        'INTERNET': 'var(--blue-bg)',
        'Insurance': 'rgba(236,72,153,0.12)'
    };
    return map[category] || 'var(--bg-secondary)';
}

function showDayDetail(container, day, data, store, year, month) {
    const detail = container.querySelector('#day-detail');
    const title = container.querySelector('#day-detail-title');
    const content = container.querySelector('#day-detail-content');

    const date = new Date(year, month, day);
    title.textContent = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    let html = '';

    if (data.isPayday) {
        html += `<div class="upcoming-item" style="border-color:var(--green);margin-bottom:8px;">
            <div class="bill-name text-green">Payday</div>
            <div class="bill-amount text-green">${formatCurrency(store.getIncome().user.payAmount)}</div>
        </div>`;
    }

    if (data.bills.length === 0 && !data.isPayday) {
        html += '<div class="text-muted" style="padding:8px;font-size:13px;">No bills due on this day</div>';
    }

    data.bills.forEach(bill => {
        const isPaid = store.isBillPaid(bill.id, year, month);
        html += `<div class="upcoming-item" style="margin-bottom:8px;">
            <div>
                <div class="bill-name" style="${isPaid ? 'text-decoration:line-through;opacity:0.6;' : ''}">${escapeHtml(bill.name)}</div>
                <div class="bill-due" style="font-size:11px;">${escapeHtml(bill.paymentSource || 'No source')} &middot; <span class="${isPaid ? 'status-paid' : 'status-unpaid'}">${isPaid ? 'Paid' : 'Unpaid'}</span></div>
            </div>
            <div class="bill-amount">${formatCurrency(bill.amount)}</div>
        </div>`;
    });

    if (data.bills.length > 0) {
        const total = data.bills.reduce((s, b) => s + b.amount, 0);
        html += `<div style="text-align:right;padding-top:8px;border-top:1px solid var(--border);font-size:13px;">
            Total: <strong>${formatCurrency(total)}</strong>
        </div>`;
    }

    content.innerHTML = html;
    detail.style.display = 'block';
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
