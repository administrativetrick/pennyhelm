import { escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage, navigate } from '../app.js';
import { auth } from '../auth.js';

// Debounce utility for real-time search
function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

export async function renderAdmin(container, store) {
    const db = firebase.firestore();

    // Load trial codes
    let trialCodes = [];
    try {
        const snap = await db.collection('trialCodes').orderBy('createdAt', 'desc').get();
        trialCodes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Failed to load trial codes:', e);
    }

    container.innerHTML = `
        <div class="page-header">
            <h2>Admin Panel</h2>
            <p style="color:var(--text-secondary);font-size:13px;margin-top:4px;">
                Manage trial codes, test users, and user accounts
            </p>
        </div>

        <!-- Trial Codes -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3>Trial Codes</h3>
                    <button class="btn btn-primary btn-sm" id="create-trial-code">+ New Code</button>
                </div>
                <div id="trial-codes-list">
                    ${trialCodes.length === 0
                        ? '<p style="color:var(--text-secondary);font-size:13px;">No trial codes yet.</p>'
                        : trialCodes.map(code => `
                            <div class="settings-row" style="opacity:${code.active ? 1 : 0.5};">
                                <div>
                                    <div class="setting-label" style="font-family:monospace;letter-spacing:1px;">
                                        ${escapeHtml(code.code)}
                                    </div>
                                    <div class="setting-desc">
                                        ${code.trialDays === 0 ? 'Unlimited' : code.trialDays + ' days'}
                                        &middot; ${code.maxUses === 0 ? 'Unlimited uses' : code.maxUses + ' max uses'}
                                        &middot; ${code.active
                                            ? '<span style="color:var(--green);">Active</span>'
                                            : '<span style="color:var(--red);">Inactive</span>'}
                                    </div>
                                </div>
                                <div style="display:flex;gap:6px;">
                                    <button class="btn btn-secondary btn-sm view-code-usage" data-id="${code.id}" data-code="${escapeHtml(code.code)}">
                                        Usage
                                    </button>
                                    <button class="btn btn-secondary btn-sm toggle-code" data-id="${code.id}" data-code="${escapeHtml(code.code)}" data-active="${code.active}">
                                        ${code.active ? 'Deactivate' : 'Activate'}
                                    </button>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            </div>
        </div>

        <!-- Test Users -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3>Test Users</h3>
                    <button class="btn btn-primary btn-sm" id="create-test-user">+ Create Test User</button>
                </div>
                <div id="test-users-list">
                    <p style="color:var(--text-secondary);font-size:13px;">Loading test users...</p>
                </div>
            </div>
        </div>

        <!-- User Lookup -->
        <div class="card mb-24">
            <div class="settings-section">
                <h3>User Lookup</h3>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <input type="text" class="form-input" id="user-lookup-email" placeholder="Start typing email..." style="flex:1;" autocomplete="off">
                    <button class="btn btn-primary btn-sm" id="user-lookup-btn">Search</button>
                </div>
                <div id="user-lookup-result" style="margin-top:16px;"></div>
            </div>
        </div>
    `;

    // === Trial Code Handlers ===

    document.getElementById('create-trial-code').addEventListener('click', () => {
        openModal('Create Trial Code', `
            <div class="form-group">
                <label>Code</label>
                <input type="text" class="form-input" id="tc-code" placeholder="e.g., BETA2026"
                       style="text-transform:uppercase;font-family:monospace;">
            </div>
            <div class="form-group">
                <label>Trial Length</label>
                <select class="form-select" id="tc-days">
                    <option value="7">7 days</option>
                    <option value="30" selected>30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                    <option value="0">Unlimited</option>
                </select>
            </div>
            <div class="form-group">
                <label>Max Uses (0 = unlimited)</label>
                <input type="number" class="form-input" id="tc-max-uses" value="1" min="0">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Create</button>
            </div>
        `);

        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', async () => {
            const code = document.getElementById('tc-code').value.trim().toUpperCase();
            const trialDays = parseInt(document.getElementById('tc-days').value);
            const maxUses = parseInt(document.getElementById('tc-max-uses').value) || 0;

            if (!code) { alert('Please enter a code'); return; }

            const codeData = {
                code,
                trialDays,
                maxUses,
                currentUses: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: auth.getUserId(),
                active: true
            };

            try {
                // Write to both collections
                await db.collection('trialCodes').add(codeData);
                await db.collection('trialCodeLookup').doc(code).set({
                    trialDays,
                    maxUses,
                    currentUses: 0,
                    active: true
                });

                closeModal();
                refreshPage();
            } catch (e) {
                console.error('Failed to create trial code:', e);
                alert('Failed to create trial code. Check console for details.');
            }
        });
    });

    // Toggle code active/inactive
    container.querySelectorAll('.toggle-code').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const codeStr = btn.dataset.code;
            const currentlyActive = btn.dataset.active === 'true';

            try {
                await db.collection('trialCodes').doc(id).update({ active: !currentlyActive });
                await db.collection('trialCodeLookup').doc(codeStr).update({ active: !currentlyActive });
                refreshPage();
            } catch (e) {
                console.error('Failed to toggle code:', e);
            }
        });
    });

    // View code usage
    container.querySelectorAll('.view-code-usage').forEach(btn => {
        btn.addEventListener('click', async () => {
            const codeStr = btn.dataset.code;

            try {
                const usersSnap = await db.collection('users').where('trialCode', '==', codeStr).get();
                const users = usersSnap.docs.map(d => d.data());

                openModal(`Usage: ${codeStr}`, `
                    <div style="margin-bottom:8px;font-size:13px;color:var(--text-secondary);">
                        ${users.length} redemption${users.length !== 1 ? 's' : ''}
                    </div>
                    ${users.length === 0
                        ? '<p style="color:var(--text-secondary);font-size:13px;">No one has redeemed this code yet.</p>'
                        : `<div style="max-height:300px;overflow-y:auto;">
                            ${users.map(u => `
                                <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
                                    <strong>${escapeHtml(u.displayName || 'Unknown')}</strong>
                                    <span style="color:var(--text-secondary);margin-left:8px;">${escapeHtml(u.email || '')}</span>
                                </div>
                            `).join('')}
                        </div>`
                    }
                    <div class="modal-actions" style="margin-top:16px;">
                        <button class="btn btn-secondary" id="modal-cancel">Close</button>
                    </div>
                `);
                document.getElementById('modal-cancel').addEventListener('click', closeModal);
            } catch (e) {
                console.error('Failed to load usage:', e);
            }
        });
    });

    // === Test User Handlers ===

    document.getElementById('create-test-user').addEventListener('click', () => {
        openModal('Create Test User', `
            <div class="form-group">
                <label>Display Name</label>
                <input type="text" class="form-input" id="tu-name" placeholder="Test User 1">
            </div>
            <div class="form-group">
                <label>Email (for identification only)</label>
                <input type="email" class="form-input" id="tu-email" placeholder="test1@pennyhelm.test">
            </div>
            <div class="form-group">
                <label>Subscription Status</label>
                <select class="form-select" id="tu-status">
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-save">Create</button>
            </div>
        `);

        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-save').addEventListener('click', async () => {
            const name = document.getElementById('tu-name').value.trim();
            const email = document.getElementById('tu-email').value.trim();
            const status = document.getElementById('tu-status').value;

            if (!name) { alert('Please enter a name'); return; }

            const testUid = 'test-' + crypto.randomUUID().slice(0, 8);

            try {
                // Create user profile doc
                await db.collection('users').doc(testUid).set({
                    email: email || testUid + '@pennyhelm.test',
                    displayName: name,
                    trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
                    subscriptionStatus: status,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    isTestUser: true,
                    createdByAdmin: true
                });

                // Create empty userData doc
                await db.collection('userData').doc(testUid).set({
                    data: JSON.stringify({
                        userName: name,
                        bills: [],
                        dependentBills: [],
                        accounts: [],
                        debts: [],
                        paymentSources: ['Checking Account', 'Credit Card'],
                        setupComplete: false
                    }),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                closeModal();
                refreshPage();
            } catch (e) {
                console.error('Failed to create test user:', e);
                alert('Failed to create test user. Check console for details.');
            }
        });
    });

    // Load and render test users
    loadTestUsers(container, db, store);

    // === User Lookup Handlers ===

    document.getElementById('user-lookup-btn').addEventListener('click', () => {
        lookupUser(db);
    });

    // Allow Enter key in search input
    document.getElementById('user-lookup-email').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') lookupUser(db);
    });

    // Real-time search as user types (debounced)
    const debouncedSearch = debounce(() => searchUsers(db), 300);
    document.getElementById('user-lookup-email').addEventListener('input', debouncedSearch);
}

async function loadTestUsers(container, db, store) {
    const listDiv = document.getElementById('test-users-list');
    try {
        const snap = await db.collection('users').where('isTestUser', '==', true).get();
        const testUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

        if (testUsers.length === 0) {
            listDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No test users yet.</p>';
            return;
        }

        listDiv.innerHTML = testUsers.map(u => `
            <div class="settings-row">
                <div>
                    <div class="setting-label">${escapeHtml(u.displayName || 'Unknown')}</div>
                    <div class="setting-desc">
                        ${escapeHtml(u.email || '')}
                        &middot; <span style="color:${u.subscriptionStatus === 'expired' ? 'var(--red)' : u.subscriptionStatus === 'active' ? 'var(--green)' : 'var(--accent)'};">${u.subscriptionStatus}</span>
                        &middot; ${u.uid}
                    </div>
                </div>
                <div style="display:flex;gap:6px;">
                    <button class="btn btn-secondary btn-sm impersonate-user" data-uid="${u.uid}" data-name="${escapeHtml(u.displayName || 'Test User')}">
                        Impersonate
                    </button>
                    <button class="btn btn-secondary btn-sm delete-test-user" data-uid="${u.uid}" style="color:var(--red);">
                        Delete
                    </button>
                </div>
            </div>
        `).join('');

        // Wire impersonation buttons
        listDiv.querySelectorAll('.impersonate-user').forEach(btn => {
            btn.addEventListener('click', async () => {
                const uid = btn.dataset.uid;
                const name = btn.dataset.name;

                store.startImpersonation(uid);
                await store.initFromServer();
                showImpersonationBanner(name, uid, store);
                navigate('dashboard');
            });
        });

        // Wire delete buttons
        listDiv.querySelectorAll('.delete-test-user').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this test user and all their data?')) return;
                const uid = btn.dataset.uid;

                try {
                    await db.collection('users').doc(uid).delete();
                    await db.collection('userData').doc(uid).delete();
                    refreshPage();
                } catch (e) {
                    console.error('Failed to delete test user:', e);
                }
            });
        });
    } catch (e) {
        console.error('Failed to load test users:', e);
        listDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Failed to load test users.</p>';
    }
}

function showImpersonationBanner(name, uid, store) {
    // Remove existing banner if any
    const existing = document.getElementById('impersonation-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'impersonation-banner';
    banner.style.cssText = 'background:var(--orange-bg);color:var(--orange);text-align:center;padding:10px 16px;font-size:13px;font-weight:600;border-bottom:2px solid var(--orange);position:fixed;top:0;left:0;right:0;z-index:300;display:flex;align-items:center;justify-content:center;gap:12px;';
    banner.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Impersonating: <strong>${escapeHtml(name)}</strong> (${escapeHtml(uid)})
        <button id="exit-impersonation" style="background:var(--orange);color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">Exit</button>
    `;
    document.body.prepend(banner);
    document.body.style.paddingTop = '42px';

    document.getElementById('exit-impersonation').addEventListener('click', async () => {
        store.stopImpersonation();
        banner.remove();
        document.body.style.paddingTop = '0';
        await store.initFromServer();
        navigate('admin');
    });
}

// Real-time prefix search as user types
async function searchUsers(db) {
    const searchTerm = document.getElementById('user-lookup-email').value.trim().toLowerCase();
    const resultDiv = document.getElementById('user-lookup-result');

    // Clear results if search is empty
    if (!searchTerm) {
        resultDiv.innerHTML = '';
        return;
    }

    // Require at least 3 characters
    if (searchTerm.length < 3) {
        resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Type at least 3 characters...</p>';
        return;
    }

    resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Searching...</p>';

    try {
        // Firestore prefix range query
        const snap = await db.collection('users')
            .where('email', '>=', searchTerm)
            .where('email', '<', searchTerm + '\uf8ff')
            .limit(10)
            .get();

        if (snap.empty) {
            resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No users found matching "' + escapeHtml(searchTerm) + '"</p>';
            return;
        }

        // Show list of matching users
        const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        resultDiv.innerHTML = `
            <div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
                ${users.map(u => `
                    <div class="user-search-result" data-uid="${escapeHtml(u.uid)}" style="padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;">
                        <div style="font-weight:500;font-size:14px;">${escapeHtml(u.email || 'No email')}</div>
                        <div style="color:var(--text-secondary);font-size:12px;">${escapeHtml(u.displayName || 'Unknown')} &middot; ${u.subscriptionStatus || 'unknown'}</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Add hover styles
        resultDiv.querySelectorAll('.user-search-result').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
            el.addEventListener('mouseleave', () => el.style.background = '');
            el.addEventListener('click', () => {
                // Set the email in the input and trigger full lookup
                const email = el.querySelector('div').textContent;
                document.getElementById('user-lookup-email').value = email;
                lookupUser(db);
            });
        });

    } catch (e) {
        console.error('Search error:', e);
        resultDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Search failed. Check console.</p>';
    }
}

async function lookupUser(db) {
    const email = document.getElementById('user-lookup-email').value.trim().toLowerCase();
    const resultDiv = document.getElementById('user-lookup-result');

    if (!email) {
        resultDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Enter an email address.</p>';
        return;
    }

    resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Searching...</p>';

    try {
        const snap = await db.collection('users').where('email', '==', email).get();

        if (snap.empty) {
            resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No user found with that email.</p>';
            return;
        }

        const userDoc = snap.docs[0];
        const userData = userDoc.data();
        const uid = userDoc.id;
        // Handle both Firestore Timestamp and string/Date formats
        const trialStart = userData.trialStartDate?.toDate
            ? userData.trialStartDate.toDate()
            : (userData.trialStartDate ? new Date(userData.trialStartDate) : null);
        const daysSince = trialStart ? Math.floor((Date.now() - trialStart.getTime()) / 86400000) : 0;
        const trialLength = userData.trialDays ?? 30;  // Use ?? so 0 (unlimited) isn't treated as falsy

        const statusColor = userData.subscriptionStatus === 'trial' ? 'var(--accent)'
            : userData.subscriptionStatus === 'expired' ? 'var(--red)'
            : 'var(--green)';
        const statusBg = userData.subscriptionStatus === 'trial' ? 'var(--accent-bg)'
            : userData.subscriptionStatus === 'expired' ? 'var(--red-bg)'
            : 'var(--green-bg)';

        resultDiv.innerHTML = `
            <div style="padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);">
                <div style="display:flex;justify-content:space-between;align-items:start;">
                    <div>
                        <div style="font-weight:600;font-size:15px;">${escapeHtml(userData.displayName || 'Unknown')}</div>
                        <div style="color:var(--text-secondary);font-size:12px;">${escapeHtml(userData.email || '')}</div>
                        <div style="color:var(--text-secondary);font-size:12px;margin-top:4px;">UID: ${escapeHtml(uid)}</div>
                    </div>
                    <div>
                        <span style="padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;background:${statusBg};color:${statusColor};">
                            ${userData.subscriptionStatus}
                        </span>
                    </div>
                </div>
                <div style="margin-top:12px;font-size:13px;color:var(--text-secondary);">
                    Trial started: ${trialStart ? trialStart.toLocaleDateString() : 'N/A'}
                    &middot; ${daysSince} days ago
                    &middot; Trial length: ${trialLength === 0 ? 'Unlimited' : trialLength + ' days'}
                    ${userData.trialCode ? '&middot; Code: <code style="background:var(--bg-input);padding:2px 6px;border-radius:3px;font-size:12px;">' + escapeHtml(userData.trialCode) + '</code>' : ''}
                </div>
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-secondary btn-sm" id="extend-trial-btn">Extend Trial</button>
                    <button class="btn btn-secondary btn-sm" id="reset-trial-btn">Reset Trial</button>
                    <button class="btn btn-secondary btn-sm" id="grant-unlimited-btn" style="color:var(--green);">Grant Unlimited</button>
                    <button class="btn btn-secondary btn-sm" id="view-telemetry-btn" style="color:var(--accent);">View Telemetry</button>
                </div>
                <div id="telemetry-results" style="margin-top:16px;display:none;"></div>
            </div>
        `;

        document.getElementById('extend-trial-btn').addEventListener('click', async () => {
            openModal('Extend Trial', `
                <div class="form-group">
                    <label>Extend by how many days?</label>
                    <input type="number" class="form-input" id="extend-days" value="30" min="1">
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Extend</button>
                </div>
            `);
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', async () => {
                const days = parseInt(document.getElementById('extend-days').value) || 30;
                const newTrialDays = (userData.trialDays || 30) + days;
                try {
                    await db.collection('users').doc(uid).update({
                        trialDays: newTrialDays,
                        subscriptionStatus: 'trial'
                    });
                    closeModal();
                    lookupUser(db); // Refresh result
                } catch (e) {
                    console.error('Failed to extend trial:', e);
                    alert('Failed to extend trial.');
                }
            });
        });

        document.getElementById('reset-trial-btn').addEventListener('click', async () => {
            if (!confirm('Reset trial start date to today?')) return;
            try {
                await db.collection('users').doc(uid).update({
                    trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
                    subscriptionStatus: 'trial',
                    trialDays: 30
                });
                lookupUser(db);
            } catch (e) {
                console.error('Failed to reset trial:', e);
            }
        });

        document.getElementById('grant-unlimited-btn').addEventListener('click', async () => {
            if (!confirm('Grant unlimited trial to this user?')) return;
            try {
                await db.collection('users').doc(uid).update({
                    trialDays: 0,
                    subscriptionStatus: 'trial'
                });
                lookupUser(db);
            } catch (e) {
                console.error('Failed to grant unlimited:', e);
            }
        });

        document.getElementById('view-telemetry-btn').addEventListener('click', async () => {
            const telemetryDiv = document.getElementById('telemetry-results');
            const btn = document.getElementById('view-telemetry-btn');

            // Toggle visibility if already loaded
            if (telemetryDiv.dataset.loaded === 'true') {
                telemetryDiv.style.display = telemetryDiv.style.display === 'none' ? 'block' : 'none';
                btn.textContent = telemetryDiv.style.display === 'none' ? 'View Telemetry' : 'Hide Telemetry';
                return;
            }

            btn.textContent = 'Loading...';
            btn.disabled = true;

            try {
                const telemetrySnap = await db.collection('telemetry')
                    .where('uid', '==', uid)
                    .orderBy('timestamp', 'desc')
                    .limit(50)
                    .get();

                const logs = telemetrySnap.docs.map(d => ({ id: d.id, ...d.data() }));

                if (logs.length === 0) {
                    telemetryDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No telemetry data found for this user.</p>';
                } else {
                    telemetryDiv.innerHTML = `
                        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">
                            ${logs.length} telemetry entries (most recent first)
                        </div>
                        <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);">
                            ${logs.map(log => {
                                const time = log.timestamp?.toDate ? log.timestamp.toDate() : (log.timestamp ? new Date(log.timestamp) : null);
                                const timeStr = time ? time.toLocaleString() : 'N/A';
                                const typeColor = log.type === 'error' ? 'var(--red)' : log.type === 'action' ? 'var(--green)' : 'var(--accent)';
                                const details = log.details ? JSON.stringify(log.details, null, 2) : '';

                                return `
                                    <div style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;">
                                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                            <span style="color:${typeColor};font-weight:600;text-transform:uppercase;">${escapeHtml(log.type || 'unknown')}</span>
                                            <span style="color:var(--text-secondary);">${timeStr}</span>
                                        </div>
                                        <div style="font-weight:500;">${escapeHtml(log.action || '')} ${log.screen ? '<span style="color:var(--text-secondary);">on ' + escapeHtml(log.screen) + '</span>' : ''}</div>
                                        ${details ? `<pre style="margin:6px 0 0 0;padding:8px;background:var(--bg-input);border-radius:4px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${escapeHtml(details)}</pre>` : ''}
                                        ${log.appVersion ? `<div style="margin-top:4px;color:var(--text-secondary);font-size:11px;">v${escapeHtml(log.appVersion)} • ${escapeHtml(log.platform || '')}</div>` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `;
                }

                telemetryDiv.style.display = 'block';
                telemetryDiv.dataset.loaded = 'true';
                btn.textContent = 'Hide Telemetry';
                btn.disabled = false;
            } catch (e) {
                console.error('Failed to load telemetry:', e);
                telemetryDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Failed to load telemetry. Check console for details.</p>';
                telemetryDiv.style.display = 'block';
                btn.textContent = 'View Telemetry';
                btn.disabled = false;
            }
        });
    } catch (e) {
        console.error('User lookup failed:', e);
        resultDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Lookup failed. Check console for details.</p>';
    }
}
