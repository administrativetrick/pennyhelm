import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';

export function renderDependent(container, store) {
    const userName = store.getUserName();
    const depName = store.getDependentName();
    const income = store.getIncome();
    const dependentBills = store.getDependentBills();

    const totalDependentBills = dependentBills.reduce((s, b) => s + b.amount, 0);
    const coveredBills = dependentBills.filter(b => b.userCovering);
    const coverageTotal = coveredBills.reduce((s, b) => s + b.amount, 0);
    const dependentHandles = totalDependentBills - coverageTotal;

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>${escapeHtml(depName)}'s Bills</h2>
                <div class="subtitle">${income.dependent.employed ? 'Employed' : '<span class="text-orange">Currently Unemployed</span>'} &middot; Normal pay: ${formatCurrency(income.dependent.payAmount)}/mo</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" id="toggle-employment">
                    ${income.dependent.employed ? 'Mark Unemployed' : 'Mark Employed'}
                </button>
                <button class="btn btn-primary" id="add-dependent-bill-btn">+ Add Bill</button>
            </div>
        </div>

        <div class="dependent-summary">
            <div class="stat-card">
                <div class="label">${escapeHtml(depName)}'s Total Bills</div>
                <div class="value">${formatCurrency(totalDependentBills)}</div>
                <div class="sub">${dependentBills.length} bills</div>
            </div>
            <div class="stat-card orange">
                <div class="label">${escapeHtml(userName)} Covering</div>
                <div class="value">${formatCurrency(coverageTotal)}</div>
                <div class="sub">${coveredBills.length} bills</div>
            </div>
            <div class="stat-card green">
                <div class="label">${escapeHtml(depName)} Handles</div>
                <div class="value">${formatCurrency(dependentHandles)}</div>
                <div class="sub">${dependentBills.length - coveredBills.length} bills</div>
            </div>
            ${!income.dependent.employed ? `
            <div class="stat-card red">
                <div class="label">${escapeHtml(depName)}'s Shortfall</div>
                <div class="value">${formatCurrency(totalDependentBills)}</div>
                <div class="sub">Full amount when unemployed</div>
            </div>
            ` : `
            <div class="stat-card blue">
                <div class="label">${escapeHtml(depName)}'s Remaining</div>
                <div class="value">${formatCurrency(income.dependent.payAmount - dependentHandles)}</div>
                <div class="sub">After their bills</div>
            </div>
            `}
        </div>

        <div class="card mb-24">
            <div class="flex-between mb-16">
                <h3>Quick Actions</h3>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" id="cover-all">Cover All Bills</button>
                <button class="btn btn-secondary btn-sm" id="uncover-all">Uncover All Bills</button>
                <button class="btn btn-secondary btn-sm" id="cover-essentials">Cover Essentials Only</button>
            </div>
        </div>

        <div id="dependent-bills-list">
            ${dependentBills.map(bill => `
                <div class="dependent-bill-row ${bill.userCovering ? 'covering' : ''}" data-bill-id="${bill.id}">
                    <div class="dependent-bill-info">
                        <div class="name">${escapeHtml(bill.name)}</div>
                        <div class="amount">
                            ${bill.amount > 0 ? formatCurrency(bill.amount) : 'Variable'}
                            &middot; <span class="text-muted">Due ${bill.dueDay}${getOrdinal(bill.dueDay)}</span>
                            ${bill.notes ? ` &middot; <span class="text-muted">${escapeHtml(bill.notes)}</span>` : ''}
                        </div>
                    </div>
                    <div class="dependent-bill-actions">
                        <span style="font-size:12px;color:${bill.userCovering ? 'var(--accent)' : 'var(--text-muted)'};">
                            ${bill.userCovering ? 'Covering' : 'Not covering'}
                        </span>
                        <label class="toggle">
                            <input type="checkbox" ${bill.userCovering ? 'checked' : ''} class="dependent-covering-toggle" data-bill-id="${bill.id}">
                            <span class="toggle-slider"></span>
                        </label>
                        <button class="btn-icon edit-dependent-bill" data-bill-id="${bill.id}" title="Edit">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn-icon delete-dependent-bill" data-bill-id="${bill.id}" title="Delete" style="color:var(--red);">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>

        ${!income.dependent.employed ? `
        <div class="card mt-16" style="border-color:var(--orange);">
            <h3 class="text-orange mb-16">Impact on ${escapeHtml(userName)}'s Budget</h3>
            <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;">
                ${escapeHtml(userName)}'s monthly income: <strong>${formatCurrency(income.user.payAmount * 26 / 12)}</strong><br>
                ${escapeHtml(userName)}'s own bills: <strong>${formatCurrency(store.getBills().filter(b => !b.frozen).reduce((s, b) => s + (b.frequency === 'per-paycheck' ? b.amount * 2 : b.amount), 0))}</strong><br>
                Covering ${escapeHtml(depName)}: <strong class="text-orange">${formatCurrency(coverageTotal)}</strong><br>
                <br>
                <strong>Net remaining: <span class="${(income.user.payAmount * 26 / 12 - store.getBills().filter(b => !b.frozen).reduce((s, b) => s + (b.frequency === 'per-paycheck' ? b.amount * 2 : b.amount), 0) - coverageTotal) >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(income.user.payAmount * 26 / 12 - store.getBills().filter(b => !b.frozen).reduce((s, b) => s + (b.frequency === 'per-paycheck' ? b.amount * 2 : b.amount), 0) - coverageTotal)}</span></strong>
            </p>
        </div>
        ` : ''}
    `;

    // Toggle covering
    container.querySelectorAll('.dependent-covering-toggle').forEach(toggle => {
        toggle.addEventListener('change', () => {
            store.toggleDependentCovering(toggle.dataset.billId);
            refreshPage();
        });
    });

    // Employment toggle
    container.querySelector('#toggle-employment').addEventListener('click', () => {
        store.updateIncome('dependent', { employed: !income.dependent.employed });
        refreshPage();
    });

    // Quick actions
    container.querySelector('#cover-all').addEventListener('click', () => {
        dependentBills.forEach(b => { if (!b.userCovering) store.toggleDependentCovering(b.id); });
        refreshPage();
    });

    container.querySelector('#uncover-all').addEventListener('click', () => {
        dependentBills.forEach(b => { if (b.userCovering) store.toggleDependentCovering(b.id); });
        refreshPage();
    });

    container.querySelector('#cover-essentials').addEventListener('click', () => {
        const essentials = ['Rent', 'Daycare', 'Insurance', 'Car Payment', 'Gas', 'Groceries', 'Diapers', 'SMUD'];
        dependentBills.forEach(b => {
            const shouldCover = essentials.some(e => b.name.toLowerCase().includes(e.toLowerCase()));
            if (shouldCover && !b.userCovering) store.toggleDependentCovering(b.id);
            if (!shouldCover && b.userCovering) store.toggleDependentCovering(b.id);
        });
        refreshPage();
    });

    // Add bill
    container.querySelector('#add-dependent-bill-btn').addEventListener('click', () => {
        showDependentBillForm(store);
    });

    // Edit bills
    container.querySelectorAll('.edit-dependent-bill').forEach(btn => {
        btn.addEventListener('click', () => {
            const bill = dependentBills.find(b => b.id === btn.dataset.billId);
            if (bill) showDependentBillForm(store, bill);
        });
    });

    // Delete bills
    container.querySelectorAll('.delete-dependent-bill').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Delete this bill?')) {
                store.deleteDependentBill(btn.dataset.billId);
                refreshPage();
            }
        });
    });
}

function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

function showDependentBillForm(store, existingBill = null) {
    const isEdit = !!existingBill;
    const userName = store.getUserName();
    const bill = existingBill || { name: '', amount: 0, dueDay: 1, frequency: 'monthly', userCovering: false, notes: '' };

    const formHtml = `
        <div class="form-group">
            <label>Bill Name</label>
            <input type="text" class="form-input" id="dependent-bill-name" value="${escapeHtml(bill.name)}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" class="form-input" id="dependent-bill-amount" step="0.01" value="${bill.amount}">
            </div>
            <div class="form-group">
                <label>Due Day</label>
                <input type="number" class="form-input" id="dependent-bill-due" min="1" max="31" value="${bill.dueDay}">
            </div>
        </div>
        <div class="form-group">
            <label>Notes</label>
            <input type="text" class="form-input" id="dependent-bill-notes" value="${escapeHtml(bill.notes)}">
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="dependent-bill-covering" ${bill.userCovering ? 'checked' : ''}>
            <label style="margin:0;text-transform:none;font-size:14px;">${escapeHtml(userName)} is covering this bill</label>
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Bill</button>
        </div>
    `;

    const depName = store.getDependentName();
    openModal(isEdit ? `Edit ${depName}'s Bill` : `Add ${depName}'s Bill`, formHtml);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const data = {
            name: document.getElementById('dependent-bill-name').value.trim(),
            amount: parseFloat(document.getElementById('dependent-bill-amount').value) || 0,
            dueDay: parseInt(document.getElementById('dependent-bill-due').value) || 1,
            frequency: 'monthly',
            userCovering: document.getElementById('dependent-bill-covering').checked,
            notes: document.getElementById('dependent-bill-notes').value.trim()
        };

        if (!data.name) { alert('Please enter a bill name'); return; }

        if (isEdit) {
            store.updateDependentBill(existingBill.id, data);
        } else {
            store.addDependentBill(data);
        }

        closeModal();
        refreshPage();
    });
}
