import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal } from '../app.js';

let currentTab = 'overview';
let currentVehicleId = null;
let currentStore = null;

export function showVehicleDetail(store, vehicleAccountId) {
    currentStore = store;
    currentVehicleId = vehicleAccountId;
    currentTab = 'overview';

    const account = store.getAccounts().find(a => a.id === vehicleAccountId);
    if (!account) return;

    openModal(escapeHtml(account.name), buildModalContent(store, account));
    wireTabEvents(store, account);
}

function buildModalContent(store, account) {
    return `
        <div class="vehicle-tabs">
            <button class="vehicle-tab ${currentTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
            <button class="vehicle-tab ${currentTab === 'mileage' ? 'active' : ''}" data-tab="mileage">Mileage</button>
            <button class="vehicle-tab ${currentTab === 'trips' ? 'active' : ''}" data-tab="trips">Trips</button>
        </div>
        <div id="vehicle-tab-content">
            ${renderTabContent(store, account)}
        </div>
    `;
}

function renderTabContent(store, account) {
    switch (currentTab) {
        case 'overview': return renderOverview(store, account);
        case 'mileage': return renderMileageLog(store, account);
        case 'trips': return renderTripTracker(store, account);
        default: return '';
    }
}

function renderOverview(store, account) {
    const mileageEntries = store.getVehicleMileage(account.id);
    const latestMileage = mileageEntries.length > 0 ? mileageEntries[0].mileage : null;
    const trips = store.getVehicleTrips(account.id);
    const totalTripMiles = trips.reduce((s, t) => s + (t.distance || 0), 0);
    const equity = account.balance - (account.amountOwed || 0);

    return `
        <div class="vehicle-overview-grid">
            <div class="vehicle-overview-item">
                <div class="label">Estimated Value</div>
                <div class="value text-green">${formatCurrency(account.balance)}</div>
            </div>
            <div class="vehicle-overview-item">
                <div class="label">Amount Owed</div>
                <div class="value ${account.amountOwed > 0 ? 'text-red' : ''}">${formatCurrency(account.amountOwed || 0)}</div>
            </div>
            <div class="vehicle-overview-item">
                <div class="label">Equity</div>
                <div class="value ${equity >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(equity)}</div>
            </div>
            <div class="vehicle-overview-item">
                <div class="label">Current Mileage</div>
                <div class="value">${latestMileage !== null ? latestMileage.toLocaleString() + ' mi' : 'No readings'}</div>
            </div>
        </div>
        <div class="vehicle-overview-grid">
            <div class="vehicle-overview-item">
                <div class="label">Mileage Readings</div>
                <div class="value">${mileageEntries.length}</div>
            </div>
            <div class="vehicle-overview-item">
                <div class="label">Trips Logged</div>
                <div class="value">${trips.length}</div>
            </div>
        </div>
        ${totalTripMiles > 0 ? `
        <div class="vehicle-overview-grid">
            <div class="vehicle-overview-item" style="grid-column:1/-1;">
                <div class="label">Total Trip Miles</div>
                <div class="value">${totalTripMiles.toLocaleString()} mi</div>
            </div>
        </div>
        ` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn btn-primary btn-sm" id="quick-log-mileage">Log Mileage</button>
            <button class="btn btn-secondary btn-sm" id="quick-log-trip">Log Trip</button>
        </div>
    `;
}

function renderMileageLog(store, account) {
    const entries = store.getVehicleMileage(account.id);
    const today = new Date().toISOString().slice(0, 10);

    let html = `
        <div id="mileage-add-form" class="vehicle-add-form" style="display:none;">
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label>Mileage</label>
                    <input type="number" class="form-input" id="mileage-input" placeholder="e.g. 45000" step="1">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Date</label>
                    <input type="date" class="form-input" id="mileage-date" value="${today}">
                </div>
            </div>
            <div class="form-group">
                <label>Notes (optional)</label>
                <input type="text" class="form-input" id="mileage-notes" placeholder="e.g. Oil change, inspection">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-secondary btn-sm" id="mileage-cancel">Cancel</button>
                <button class="btn btn-primary btn-sm" id="mileage-save">Save</button>
            </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:12px;color:var(--text-muted);">${entries.length} reading${entries.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-primary btn-sm" id="add-mileage-btn">+ Add Reading</button>
        </div>
    `;

    if (entries.length === 0) {
        html += '<div class="vehicle-empty">No mileage readings yet. Add your first reading to start tracking.</div>';
    } else {
        entries.forEach((entry, i) => {
            const date = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const prevEntry = entries[i + 1]; // previous chronologically (entries are desc)
            const change = prevEntry ? entry.mileage - prevEntry.mileage : null;
            html += `
                <div class="vehicle-log-item">
                    <div class="log-info">
                        <div>
                            <span class="log-value">${entry.mileage.toLocaleString()} mi</span>
                            ${change !== null ? `<span class="log-change text-muted">${change >= 0 ? '+' : ''}${change.toLocaleString()} mi</span>` : ''}
                        </div>
                        <div class="log-date">${date}</div>
                        ${entry.notes ? `<div class="log-notes">${escapeHtml(entry.notes)}</div>` : ''}
                    </div>
                    <button class="btn-icon delete-mileage-btn" data-id="${entry.id}" title="Delete" style="color:var(--red);">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            `;
        });
    }

    return html;
}

function renderTripTracker(store, account) {
    const trips = store.getVehicleTrips(account.id);
    const mileageEntries = store.getVehicleMileage(account.id);
    const latestMileage = mileageEntries.length > 0 ? mileageEntries[0].mileage : 0;
    const today = new Date().toISOString().slice(0, 10);
    const totalMiles = trips.reduce((s, t) => s + (t.distance || 0), 0);

    let html = `
        <div id="trip-add-form" class="vehicle-add-form" style="display:none;">
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label>Date</label>
                    <input type="date" class="form-input" id="trip-date" value="${today}">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Purpose</label>
                    <input type="text" class="form-input" id="trip-purpose" placeholder="e.g. Work, Errand">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label>Start Mileage</label>
                    <input type="number" class="form-input" id="trip-start" step="1" value="${latestMileage || ''}">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>End Mileage</label>
                    <input type="number" class="form-input" id="trip-end" step="1" placeholder="e.g. ${latestMileage ? latestMileage + 25 : '45025'}">
                </div>
            </div>
            <div class="form-group">
                <label>Notes (optional)</label>
                <input type="text" class="form-input" id="trip-notes" placeholder="e.g. Round trip to office">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-secondary btn-sm" id="trip-cancel">Cancel</button>
                <button class="btn btn-primary btn-sm" id="trip-save">Save</button>
            </div>
        </div>
    `;

    if (trips.length > 0) {
        html += `
            <div class="vehicle-stats">
                <span>Total trips: <strong>${trips.length}</strong></span>
                <span>Total miles: <strong>${totalMiles.toLocaleString()}</strong></span>
            </div>
        `;
    }

    html += `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:12px;color:var(--text-muted);">${trips.length} trip${trips.length !== 1 ? 's' : ''}</span>
            <button class="btn btn-primary btn-sm" id="add-trip-btn">+ Add Trip</button>
        </div>
    `;

    if (trips.length === 0) {
        html += '<div class="vehicle-empty">No trips logged yet. Add your first trip to start tracking.</div>';
    } else {
        trips.forEach(trip => {
            const date = new Date(trip.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            html += `
                <div class="vehicle-log-item">
                    <div class="log-info">
                        <div>
                            <span class="log-value">${(trip.distance || 0).toLocaleString()} mi</span>
                            <span class="log-change text-muted">${(trip.startMileage || 0).toLocaleString()} &rarr; ${(trip.endMileage || 0).toLocaleString()}</span>
                        </div>
                        <div class="log-date">${date}${trip.purpose ? ` &middot; ${escapeHtml(trip.purpose)}` : ''}</div>
                        ${trip.notes ? `<div class="log-notes">${escapeHtml(trip.notes)}</div>` : ''}
                    </div>
                    <button class="btn-icon delete-trip-btn" data-id="${trip.id}" title="Delete" style="color:var(--red);">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            `;
        });
    }

    return html;
}

function wireTabEvents(store, account) {
    const modal = document.querySelector('.modal-body');
    if (!modal) return;

    // Tab switching
    modal.querySelectorAll('.vehicle-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentTab = tab.dataset.tab;
            modal.innerHTML = buildModalContent(store, account);
            wireTabEvents(store, account);
        });
    });

    // Overview quick buttons
    const quickLogMileage = modal.querySelector('#quick-log-mileage');
    if (quickLogMileage) {
        quickLogMileage.addEventListener('click', () => {
            currentTab = 'mileage';
            modal.innerHTML = buildModalContent(store, account);
            wireTabEvents(store, account);
            // Auto-show the add form
            const form = modal.querySelector('#mileage-add-form');
            if (form) {
                form.style.display = '';
                const input = modal.querySelector('#mileage-input');
                if (input) input.focus();
            }
        });
    }

    const quickLogTrip = modal.querySelector('#quick-log-trip');
    if (quickLogTrip) {
        quickLogTrip.addEventListener('click', () => {
            currentTab = 'trips';
            modal.innerHTML = buildModalContent(store, account);
            wireTabEvents(store, account);
            const form = modal.querySelector('#trip-add-form');
            if (form) {
                form.style.display = '';
                const input = modal.querySelector('#trip-purpose');
                if (input) input.focus();
            }
        });
    }

    // Mileage tab events
    const addMileageBtn = modal.querySelector('#add-mileage-btn');
    if (addMileageBtn) {
        addMileageBtn.addEventListener('click', () => {
            const form = modal.querySelector('#mileage-add-form');
            form.style.display = form.style.display === 'none' ? '' : 'none';
            if (form.style.display !== 'none') {
                const input = modal.querySelector('#mileage-input');
                if (input) input.focus();
            }
        });
    }

    const mileageCancel = modal.querySelector('#mileage-cancel');
    if (mileageCancel) {
        mileageCancel.addEventListener('click', () => {
            modal.querySelector('#mileage-add-form').style.display = 'none';
        });
    }

    const mileageSave = modal.querySelector('#mileage-save');
    if (mileageSave) {
        mileageSave.addEventListener('click', () => {
            const mileage = parseInt(modal.querySelector('#mileage-input').value);
            const date = modal.querySelector('#mileage-date').value;
            const notes = modal.querySelector('#mileage-notes').value.trim();
            if (!mileage || mileage <= 0) { alert('Please enter a valid mileage'); return; }
            if (!date) { alert('Please enter a date'); return; }
            store.addVehicleMileage({
                vehicleAccountId: account.id,
                mileage,
                date,
                notes
            });
            // Refresh modal content
            modal.innerHTML = buildModalContent(store, account);
            wireTabEvents(store, account);
        });
    }

    // Delete mileage entries
    modal.querySelectorAll('.delete-mileage-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Delete this mileage reading?')) {
                store.deleteVehicleMileage(btn.dataset.id);
                modal.innerHTML = buildModalContent(store, account);
                wireTabEvents(store, account);
            }
        });
    });

    // Trip tab events
    const addTripBtn = modal.querySelector('#add-trip-btn');
    if (addTripBtn) {
        addTripBtn.addEventListener('click', () => {
            const form = modal.querySelector('#trip-add-form');
            form.style.display = form.style.display === 'none' ? '' : 'none';
            if (form.style.display !== 'none') {
                const input = modal.querySelector('#trip-purpose');
                if (input) input.focus();
            }
        });
    }

    const tripCancel = modal.querySelector('#trip-cancel');
    if (tripCancel) {
        tripCancel.addEventListener('click', () => {
            modal.querySelector('#trip-add-form').style.display = 'none';
        });
    }

    const tripSave = modal.querySelector('#trip-save');
    if (tripSave) {
        tripSave.addEventListener('click', () => {
            const date = modal.querySelector('#trip-date').value;
            const purpose = modal.querySelector('#trip-purpose').value.trim();
            const startMileage = parseInt(modal.querySelector('#trip-start').value);
            const endMileage = parseInt(modal.querySelector('#trip-end').value);
            const notes = modal.querySelector('#trip-notes').value.trim();
            if (!date) { alert('Please enter a date'); return; }
            if (!startMileage || !endMileage) { alert('Please enter start and end mileage'); return; }
            if (endMileage <= startMileage) { alert('End mileage must be greater than start mileage'); return; }
            store.addVehicleTrip({
                vehicleAccountId: account.id,
                startMileage,
                endMileage,
                date,
                purpose,
                notes
            });
            // Also add a mileage reading for the end mileage
            const mileageEntries = store.getVehicleMileage(account.id);
            const latestMileage = mileageEntries.length > 0 ? mileageEntries[0].mileage : 0;
            if (endMileage > latestMileage) {
                store.addVehicleMileage({
                    vehicleAccountId: account.id,
                    mileage: endMileage,
                    date,
                    notes: purpose ? `Trip: ${purpose}` : 'Trip logged'
                });
            }
            modal.innerHTML = buildModalContent(store, account);
            wireTabEvents(store, account);
        });
    }

    // Delete trip entries
    modal.querySelectorAll('.delete-trip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Delete this trip?')) {
                store.deleteVehicleTrip(btn.dataset.id);
                modal.innerHTML = buildModalContent(store, account);
                wireTabEvents(store, account);
            }
        });
    });
}
