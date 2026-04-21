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

// Render the acquisition source block for the admin user detail view. Returns
// empty string if the user has no tracking data (old accounts, or landed with
// no UTM/ref params).
function renderAcquisitionSource(src) {
    if (!src || typeof src !== 'object') return '';
    const keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','gclid','fbclid','referrer','landingPath','capturedAt'];
    const present = keys.filter(k => src[k]);
    if (present.length === 0) return '';
    const labels = {
        utm_source: 'source',
        utm_medium: 'medium',
        utm_campaign: 'campaign',
        utm_content: 'content',
        utm_term: 'term',
        ref: 'ref',
        gclid: 'gclid',
        fbclid: 'fbclid',
        referrer: 'referrer',
        landingPath: 'landing',
        capturedAt: 'captured',
    };
    const chips = present.map(k => {
        const v = String(src[k]);
        const shown = v.length > 60 ? v.slice(0, 57) + '...' : v;
        return `<span title="${escapeHtml(v)}" style="display:inline-block;background:var(--bg-input);padding:2px 8px;border-radius:3px;font-size:11px;margin-right:6px;margin-top:4px;"><strong>${labels[k]}:</strong> ${escapeHtml(shown)}</span>`;
    }).join('');
    return `
        <div style="margin-top:10px;font-size:12px;color:var(--text-secondary);">
            <div style="margin-bottom:2px;">Acquisition:</div>
            ${chips}
        </div>
    `;
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

        <!-- Active Users (DAU / MAU) -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3>Active Users</h3>
                    <select id="active-users-range" class="form-select" style="max-width:140px;font-size:12px;">
                        <option value="7">Last 7 days</option>
                        <option value="30" selected>Last 30 days</option>
                        <option value="90">Last 90 days</option>
                    </select>
                </div>
                <div id="active-users-summary" style="color:var(--text-secondary);font-size:12px;margin-bottom:12px;">
                    Loading...
                </div>
                <div id="active-users-content"></div>
            </div>
        </div>

        <!-- Ad Attribution -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3>Ad Attribution</h3>
                    <select id="ad-attr-range" class="form-select" style="max-width:140px;font-size:12px;">
                        <option value="7">Last 7 days</option>
                        <option value="30" selected>Last 30 days</option>
                        <option value="90">Last 90 days</option>
                    </select>
                </div>
                <div id="ad-attr-summary" style="color:var(--text-secondary);font-size:12px;margin-bottom:12px;">
                    Loading...
                </div>
                <div id="ad-attr-content"></div>
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
                    <input type="text" class="form-input" id="user-lookup-email" placeholder="Search by email, display name, or UID..." style="flex:1;" autocomplete="off">
                    <button class="btn btn-primary btn-sm" id="user-lookup-btn">Search</button>
                </div>
                <div id="user-lookup-result" class="mt-16"></div>
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
                    <div class="modal-actions mt-16">
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

            const saveBtn = document.getElementById('modal-save');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Creating...';

            try {
                const createTestUserFn = firebase.functions().httpsCallable('createTestUser');
                const result = await createTestUserFn({
                    displayName: name,
                    email: email || undefined,
                    subscriptionStatus: status,
                });

                closeModal();

                // Show the generated credentials — only chance to see the password
                openModal('Test User Created', `
                    <div style="text-align:center;">
                        <p class="mb-8">User <strong>${escapeHtml(name)}</strong> created successfully.</p>
                        <div style="background:var(--bg-secondary);border-radius:8px;padding:16px;margin:16px 0;text-align:left;">
                            <p style="margin:0 0 8px 0;"><strong>UID:</strong> <code>${escapeHtml(result.data.uid)}</code></p>
                            <p style="margin:0 0 8px 0;"><strong>Email:</strong> <code>${escapeHtml(result.data.email)}</code></p>
                            <p style="margin:0;"><strong>Temporary Password:</strong> <code style="color:var(--accent);font-weight:600;">${escapeHtml(result.data.tempPassword)}</code></p>
                        </div>
                        <p style="color:var(--text-secondary);font-size:13px;">Save this password — it won't be shown again.</p>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-primary" id="modal-ok">OK</button>
                    </div>
                `);
                document.getElementById('modal-ok').addEventListener('click', () => {
                    closeModal();
                    refreshPage();
                });
            } catch (e) {
                console.error('Failed to create test user:', e);
                alert('Failed to create test user: ' + (e.message || 'Check console for details.'));
                saveBtn.disabled = false;
                saveBtn.textContent = 'Create';
            }
        });
    });

    // Load and render test users
    loadTestUsers(container, db, store);

    // === Active Users Handlers ===

    const activeRangeSel = document.getElementById('active-users-range');
    if (activeRangeSel) {
        loadActiveUsers(parseInt(activeRangeSel.value, 10) || 30);
        activeRangeSel.addEventListener('change', () => {
            loadActiveUsers(parseInt(activeRangeSel.value, 10) || 30);
        });
    }

    // === Ad Attribution Handlers ===

    const rangeSel = document.getElementById('ad-attr-range');
    if (rangeSel) {
        loadAdAttribution(parseInt(rangeSel.value, 10) || 30);
        rangeSel.addEventListener('change', () => {
            loadAdAttribution(parseInt(rangeSel.value, 10) || 30);
        });
    }

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

// ─── Active Users (DAU / MAU) ───────────────────────────────

async function loadActiveUsers(daysBack) {
    const summaryEl = document.getElementById('active-users-summary');
    const contentEl = document.getElementById('active-users-content');
    if (!summaryEl || !contentEl) return;

    summaryEl.textContent = 'Loading...';
    contentEl.innerHTML = '';

    try {
        const fn = firebase.app().functions().httpsCallable('getActiveUserStats');
        const result = await fn({ daysBack });
        const data = result.data;

        const dauToday = Number(data.dauToday) || 0;
        const wau = Number(data.wau) || 0;
        const mau = Number(data.mau) || 0;

        // Stickiness = DAU / MAU — standard industry engagement metric.
        // Higher = users come back daily. 20%+ is healthy for a utility app.
        const stickiness = mau > 0 ? (dauToday / mau) * 100 : 0;

        summaryEl.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:4px;">
                <div style="background:var(--bg-input,#1a2431);padding:12px;border-radius:8px;border:1px solid var(--border,#2a2f3a);">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">DAU (today)</div>
                    <div style="font-size:22px;font-weight:700;color:#22c55e;margin-top:4px;">${dauToday.toLocaleString()}</div>
                </div>
                <div style="background:var(--bg-input,#1a2431);padding:12px;border-radius:8px;border:1px solid var(--border,#2a2f3a);">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">WAU (7d)</div>
                    <div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-top:4px;">${wau.toLocaleString()}</div>
                </div>
                <div style="background:var(--bg-input,#1a2431);padding:12px;border-radius:8px;border:1px solid var(--border,#2a2f3a);">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">MAU (30d)</div>
                    <div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-top:4px;">${mau.toLocaleString()}</div>
                </div>
                <div style="background:var(--bg-input,#1a2431);padding:12px;border-radius:8px;border:1px solid var(--border,#2a2f3a);" title="DAU ÷ MAU — higher means users return more frequently">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Stickiness</div>
                    <div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-top:4px;">${stickiness.toFixed(1)}%</div>
                </div>
            </div>
        `;

        contentEl.innerHTML = `
            ${renderDauSparkline(data.dau || [])}
            <p style="color:var(--text-secondary);font-size:11px;margin-top:12px;">
                One Firestore doc per (user, UTC day). Bars show daily active users over the window.
                MAU is the distinct user count in the trailing 30-day window. No financial data recorded —
                see privacy.html §1.8.
            </p>
        `;
    } catch (err) {
        console.error('getActiveUserStats failed:', err);
        summaryEl.textContent = '';
        contentEl.innerHTML = `<p style="color:var(--danger,#e53e3e);font-size:13px;">Failed to load active-user data: ${escapeHtml(err.message || 'unknown error')}</p>`;
    }
}

/**
 * Lightweight inline bar-chart of DAU over the window. No chart library —
 * one CSS-styled bar per day scaled against the max value in the series.
 */
function renderDauSparkline(series) {
    if (!Array.isArray(series) || series.length === 0) {
        return `<p style="color:var(--text-secondary);font-size:12px;">No activity recorded in this window.</p>`;
    }

    const max = series.reduce((m, d) => Math.max(m, d.activeUsers || 0), 0);
    // If max is 0, show flat bars so the layout doesn't collapse.
    const scale = max > 0 ? max : 1;

    const bars = series.map((d) => {
        const n = d.activeUsers || 0;
        const pct = (n / scale) * 100;
        const heightPct = max > 0 ? pct : 0;
        // Show the date on hover; day-of-month label below the bar for dense series.
        const dayOfMonth = d.date.slice(8, 10);
        return `
            <div style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;min-width:0;" title="${escapeHtml(d.date)}: ${n.toLocaleString()} DAU">
                <div style="width:100%;height:80px;display:flex;align-items:flex-end;">
                    <div style="width:100%;height:${heightPct}%;background:#22c55e;border-radius:2px 2px 0 0;min-height:${n > 0 ? '2px' : '0'};"></div>
                </div>
                <div style="font-size:9px;color:var(--text-secondary);margin-top:4px;">${dayOfMonth}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="mt-16">
            <h4 style="font-size:13px;margin-bottom:8px;color:var(--text-primary);">Daily Active Users</h4>
            <div style="background:var(--bg-input,#1a2431);padding:12px;border-radius:8px;border:1px solid var(--border,#2a2f3a);">
                <div style="display:flex;gap:2px;align-items:flex-end;">${bars}</div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);margin-top:6px;">
                    <span>${escapeHtml(series[0].date)}</span>
                    <span>Peak: ${max.toLocaleString()}</span>
                    <span>${escapeHtml(series[series.length - 1].date)}</span>
                </div>
            </div>
        </div>
    `;
}

// ─── Ad Attribution ──────────────────────────────────────────

async function loadAdAttribution(daysBack) {
    const summaryEl = document.getElementById('ad-attr-summary');
    const contentEl = document.getElementById('ad-attr-content');
    if (!summaryEl || !contentEl) return;

    summaryEl.textContent = 'Loading...';
    contentEl.innerHTML = '';

    try {
        const fn = firebase.app().functions().httpsCallable('getAdAttributionStats');
        const result = await fn({ daysBack });
        const data = result.data;

        const v = Number(data.totalUniqueVisitors) || 0;
        const s = Number(data.totalSignupsInWindow) || 0;
        summaryEl.textContent = `${v.toLocaleString()} unique visitor${v === 1 ? '' : 's'} · ${s.toLocaleString()} signup${s === 1 ? '' : 's'} in the last ${data.daysBack} day${data.daysBack === 1 ? '' : 's'}.`;

        contentEl.innerHTML = `
            ${renderAttributionTable('By Source', data.sources, 'source', 'utm_source')}
            ${renderAttributionTable('By Campaign', data.campaigns, 'campaign', 'utm_campaign')}
            ${renderAttributionTable('By Creative', data.creatives, 'creative', 'utm_content')}
            <p style="color:var(--text-secondary);font-size:11px;margin-top:12px;">
                <strong>Views</strong> = landings on /switch · <strong>Clicks</strong> = CTA presses ·
                <strong>Signups</strong> = users whose acquisitionSource matches ·
                <strong>Abandoned</strong> = clicked CTA but never completed signup in-window.
            </p>
        `;
    } catch (err) {
        console.error('getAdAttributionStats failed:', err);
        summaryEl.textContent = '';
        contentEl.innerHTML = `<p style="color:var(--danger,#e53e3e);font-size:13px;">Failed to load attribution data: ${escapeHtml(err.message || 'unknown error')}</p>`;
    }
}

function renderAttributionTable(title, rows, keyLabel, keyField) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return `
            <div class="mt-16">
                <h4 style="font-size:13px;margin-bottom:8px;color:var(--text-primary);">${escapeHtml(title)}</h4>
                <p style="color:var(--text-secondary);font-size:12px;">No data yet.</p>
            </div>
        `;
    }

    const pct = (n) => {
        if (!isFinite(n)) return '—';
        return (n * 100).toFixed(1) + '%';
    };

    const bodyRows = rows.map((r) => `
        <tr>
            <td style="padding:6px 8px;font-family:monospace;font-size:12px;">${escapeHtml(r.key || '(unknown)')}</td>
            <td style="padding:6px 8px;text-align:right;">${r.uniqueVisitors.toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;">${r.views.toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;">${r.clicks.toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;color:var(--text-secondary);">${pct(r.clickThroughRate)}</td>
            <td style="padding:6px 8px;text-align:right;color:#22c55e;font-weight:600;">${r.signups.toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;color:var(--text-secondary);">${pct(r.conversionRate)}</td>
            <td style="padding:6px 8px;text-align:right;color:var(--text-secondary);">${r.abandoned.toLocaleString()}</td>
        </tr>
    `).join('');

    return `
        <div class="mt-16">
            <h4 style="font-size:13px;margin-bottom:8px;color:var(--text-primary);">${escapeHtml(title)}</h4>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid var(--border,#2a2f3a);border-radius:6px;overflow:hidden;">
                    <thead>
                        <tr style="background:var(--bg-input,#1a2431);">
                            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">${escapeHtml(keyLabel)}</th>
                            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Unique</th>
                            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Views</th>
                            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Clicks</th>
                            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);" title="Click-through rate: clicks / views">CTR</th>
                            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Signups</th>
                            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);" title="Conversion rate: signups / clicks">Conv</th>
                            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);" title="Clicked CTA but didn't sign up in-window">Abandoned</th>
                        </tr>
                    </thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>
        </div>
    `;
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
                    <button class="btn btn-secondary btn-sm reset-password-user" data-uid="${u.uid}" data-name="${escapeHtml(u.displayName || 'Test User')}">
                        Reset Password
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

        // Wire reset password buttons
        listDiv.querySelectorAll('.reset-password-user').forEach(btn => {
            btn.addEventListener('click', async () => {
                const uid = btn.dataset.uid;
                const name = btn.dataset.name;

                if (!confirm(`Reset password for ${name}?`)) return;

                btn.disabled = true;
                btn.textContent = 'Resetting...';

                try {
                    const resetFn = firebase.functions().httpsCallable('resetTestUserPassword');
                    const result = await resetFn({ uid });

                    openModal('Password Reset', `
                        <div style="text-align:center;">
                            <p class="mb-8">Password reset for <strong>${escapeHtml(name)}</strong>.</p>
                            <div style="background:var(--bg-secondary);border-radius:8px;padding:16px;margin:16px 0;">
                                <p style="margin:0;"><strong>New Temporary Password:</strong><br>
                                <code style="color:var(--accent);font-weight:600;font-size:16px;">${escapeHtml(result.data.tempPassword)}</code></p>
                            </div>
                            <p style="color:var(--text-secondary);font-size:13px;">Save this password — it won't be shown again.</p>
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-primary" id="modal-ok">OK</button>
                        </div>
                    `);
                    document.getElementById('modal-ok').addEventListener('click', closeModal);
                } catch (e) {
                    console.error('Failed to reset password:', e);
                    alert('Failed to reset password: ' + (e.message || 'Check console.'));
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Reset Password';
                }
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

// Cache all users for client-side substring search (admin-only, small user base)
let _usersCache = null;
let _usersCacheTime = 0;
const USERS_CACHE_TTL = 60000; // 1 minute

async function getAllUsers(db) {
    const now = Date.now();
    if (_usersCache && (now - _usersCacheTime) < USERS_CACHE_TTL) {
        return _usersCache;
    }
    const snap = await db.collection('users').get();
    _usersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    _usersCacheTime = now;
    return _usersCache;
}

// Build a match function based on wildcard position:
//   *term  → endsWith (suffix)
//   term*  → startsWith (prefix)
//   *term* → includes (substring)
//   term   → startsWith (prefix, default)
function buildMatchFn(rawInput) {
    const leading = rawInput.startsWith('*');
    const trailing = rawInput.endsWith('*');
    const term = rawInput.replace(/\*/g, '').toLowerCase();
    if (leading && trailing) return (field) => field.includes(term);
    if (leading)             return (field) => field.endsWith(term);
    if (trailing)            return (field) => field.startsWith(term);
    /* no wildcard */        return (field) => field.startsWith(term);
}

// Real-time search as user types (case-insensitive)
async function searchUsers(db) {
    const rawInput = document.getElementById('user-lookup-email').value.trim();
    const searchTerm = rawInput.replace(/\*/g, '');
    const resultDiv = document.getElementById('user-lookup-result');

    // Clear results if search is empty
    if (!searchTerm) {
        resultDiv.innerHTML = '';
        return;
    }

    // Require at least 2 characters (after stripping wildcards)
    if (searchTerm.length < 2) {
        resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Type at least 2 characters...</p>';
        return;
    }

    resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Searching...</p>';

    try {
        // Fetch all users (cached) and filter client-side
        const allUsers = await getAllUsers(db);

        const matchFn = buildMatchFn(rawInput);

        const users = allUsers.filter(u => {
            const email = (u.email || '').toLowerCase();
            const name = (u.displayName || '').toLowerCase();
            const uid = (u.uid || '').toLowerCase();
            return matchFn(email) || matchFn(name) || matchFn(uid);
        }).slice(0, 20);

        if (users.length === 0) {
            resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No users found matching "' + escapeHtml(searchTerm) + '"</p>';
            return;
        }

        // Show list of matching users
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

        // Add hover styles and click handler
        resultDiv.querySelectorAll('.user-search-result').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
            el.addEventListener('mouseleave', () => el.style.background = '');
            el.addEventListener('click', () => {
                // Use UID for lookup to ensure we find the right user
                document.getElementById('user-lookup-email').value = el.dataset.uid;
                lookupUser(db);
            });
        });

    } catch (e) {
        console.error('Search error:', e);
        resultDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Search failed. Check console.</p>';
    }
}

async function lookupUser(db) {
    const searchValue = document.getElementById('user-lookup-email').value.trim().replace(/\*/g, '');
    const resultDiv = document.getElementById('user-lookup-result');

    if (!searchValue) {
        resultDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Enter an email, display name, or UID.</p>';
        return;
    }

    resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Searching...</p>';

    try {
        let userDoc = null;
        let uid = null;

        // Strategy 1: Try as UID (direct document lookup)
        const uidDoc = await db.collection('users').doc(searchValue).get();
        if (uidDoc.exists) {
            userDoc = uidDoc;
            uid = uidDoc.id;
        }

        // Strategy 2: Try as exact email match (case-insensitive)
        if (!userDoc) {
            const emailSnap = await db.collection('users').where('email', '==', searchValue.toLowerCase()).get();
            if (!emailSnap.empty) {
                userDoc = emailSnap.docs[0];
                uid = emailSnap.docs[0].id;
            }
        }

        // Strategy 3: Try as displayName match (case-insensitive, substring)
        if (!userDoc) {
            // Fetch all users and find by case-insensitive substring match on displayName
            const allUsers = await getAllUsers(db);
            const match = allUsers.find(u => (u.displayName || '').toLowerCase() === searchValue.toLowerCase());
            if (match) {
                userDoc = await db.collection('users').doc(match.uid).get();
                uid = match.uid;
            }
        }

        if (!userDoc) {
            resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No user found matching "' + escapeHtml(searchValue) + '".</p>';
            return;
        }

        const userData = userDoc.data();
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
                <div style="margin-top:6px;font-size:13px;color:var(--text-secondary);">
                    Referred by: ${userData.referredBy ? '<code style="background:var(--bg-input);padding:2px 6px;border-radius:3px;font-size:12px;">' + escapeHtml(userData.referredBy) + '</code>' : 'N/A'}
                    &middot; Referral code: ${userData.referralCode ? '<code style="background:var(--bg-input);padding:2px 6px;border-radius:3px;font-size:12px;">' + escapeHtml(userData.referralCode) + '</code>' : 'Not generated'}
                    &middot; Paid referrals: ${userData.paidReferralCount || 0}/10${userData.referralRewardApplied ? ' &middot; <span style="color:var(--green);">Free year earned</span>' : ''}
                </div>
                ${renderAcquisitionSource(userData.acquisitionSource)}
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-secondary btn-sm" id="extend-trial-btn">Extend Trial</button>
                    <button class="btn btn-secondary btn-sm" id="reset-trial-btn">Reset Trial</button>
                    <button class="btn btn-secondary btn-sm" id="grant-unlimited-btn" style="color:var(--green);">Grant Unlimited</button>
                    <button class="btn btn-secondary btn-sm" id="repair-plaid-btn" style="color:var(--accent);">Repair Plaid</button>
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

        document.getElementById('repair-plaid-btn').addEventListener('click', async () => {
            const btn = document.getElementById('repair-plaid-btn');
            btn.textContent = 'Repairing...';
            btn.disabled = true;
            try {
                const fn = firebase.app().functions().httpsCallable('repairPlaidAccounts');
                const result = await fn({ uid });
                const data = result.data;
                if (data.repaired > 0) {
                    alert(`Repaired ${data.repaired} Plaid connection(s).\n\n${data.details.map(d => `${d.institution || d.itemId}: ${d.status}`).join('\n')}`);
                } else {
                    const msg = data.details?.length > 0
                        ? `No orphaned Plaid accounts found.\n\n${data.details.map(d => `${d.itemId || d.uid}: ${d.status}`).join('\n')}`
                        : data.message || 'No Plaid items found for this user.';
                    alert(msg);
                }
            } catch (e) {
                console.error('Repair Plaid failed:', e);
                alert('Failed to repair Plaid accounts: ' + (e.message || 'Unknown error'));
            }
            btn.textContent = 'Repair Plaid';
            btn.disabled = false;
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
