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

        <!-- Registration Invite Codes -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                    <h3>Registration Invite Codes</h3>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-primary btn-sm" id="generate-admin-codes">+ Generate Codes</button>
                        <button class="btn btn-secondary btn-sm" id="grandfather-users">Grandfather Users</button>
                    </div>
                </div>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">
                    Generate admin invite codes or grant existing users their invite codes.
                </p>
                <div id="admin-reg-codes-result"></div>
            </div>
        </div>

        <!-- Send Invite Emails -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                    <h3>Send Invite Emails</h3>
                </div>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">
                    Paste email addresses (one per line or comma-separated). Each recipient gets a unique invite code sent from no-reply@pennyhelm.com.
                </p>
                <textarea id="invite-email-list" class="form-input" rows="4" placeholder="friend@example.com&#10;family@example.com&#10;coworker@example.com" style="resize:vertical;font-family:monospace;font-size:13px;"></textarea>
                <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" id="send-invite-emails">📧 Send Invite Emails</button>
                    <button class="btn btn-secondary btn-sm" id="copy-invite-template">📋 Copy Email Template</button>
                </div>
                <div id="invite-email-result" style="margin-top:12px;"></div>
            </div>
        </div>

        <!-- Invite Code Tracker -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                    <h3>Invite Code Tracker</h3>
                    <button class="btn btn-secondary btn-sm" id="refresh-invite-tracker">↻ Refresh</button>
                </div>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">
                    All invite codes you've generated or sent. See who redeemed them and when.
                </p>
                <div id="invite-tracker-stats" style="margin-bottom:12px;"></div>
                <div style="margin-bottom:12px;">
                    <input type="text" id="invite-tracker-search" class="form-input" placeholder="Search by code, email, or user..." style="font-size:13px;">
                </div>
                <div id="invite-tracker-list">
                    <p style="color:var(--text-secondary);font-size:13px;">Loading invite codes...</p>
                </div>
            </div>
        </div>

        <!-- Waitlist Management -->
        <div class="card mb-24">
            <div class="settings-section">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                    <h3>Waitlist</h3>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-primary btn-sm" id="approve-waitlist-ready">Approve Eligible (7+ days)</button>
                    </div>
                </div>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">
                    People who joined the waitlist without an invite code. Entries are auto-eligible after 7 days.
                </p>
                <div id="waitlist-entries" style="margin-bottom:12px;">
                    <p style="color:var(--text-secondary);font-size:13px;">Loading waitlist...</p>
                </div>
                <div id="waitlist-action-result"></div>
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

    // === Registration Invite Code Handlers ===

    document.getElementById('generate-admin-codes').addEventListener('click', async () => {
        const btn = document.getElementById('generate-admin-codes');
        const resultDiv = document.getElementById('admin-reg-codes-result');
        btn.disabled = true;
        btn.textContent = 'Generating...';
        resultDiv.innerHTML = '<p style="color:var(--text-secondary);">Generating codes...</p>';
        try {
            const fn = firebase.functions().httpsCallable('generateAdminInviteCodes');
            const result = await fn({ count: 10 });
            const codes = result.data.codes;
            let html = `<p style="color:var(--success-color);margin-bottom:8px;">Generated ${codes.length} admin invite codes:</p>`;
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">';
            codes.forEach(c => {
                html += `<span style="font-family:monospace;background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;font-size:13px;">${escapeHtml(c)}</span>`;
            });
            html += '</div>';
            html += `<button class="btn btn-sm btn-secondary" id="copy-admin-reg-codes">Copy All</button>`;
            resultDiv.innerHTML = html;
            document.getElementById('copy-admin-reg-codes').addEventListener('click', () => {
                navigator.clipboard.writeText(codes.join('\n'));
                document.getElementById('copy-admin-reg-codes').textContent = 'Copied!';
                setTimeout(() => { document.getElementById('copy-admin-reg-codes').textContent = 'Copy All'; }, 2000);
            });
        } catch (e) {
            resultDiv.innerHTML = `<p style="color:var(--error-color);">Error: ${escapeHtml(e.message)}</p>`;
        }
        btn.disabled = false;
        btn.textContent = '+ Generate Codes';
    });

    document.getElementById('grandfather-users').addEventListener('click', async () => {
        const btn = document.getElementById('grandfather-users');
        const resultDiv = document.getElementById('admin-reg-codes-result');
        btn.disabled = true;
        btn.textContent = 'Processing...';
        resultDiv.innerHTML = '<p style="color:var(--text-secondary);">Grandfathering existing users (this may take a moment)...</p>';
        try {
            const fn = firebase.functions().httpsCallable('grandfatherExistingUsers');
            const result = await fn();
            const d = result.data;
            resultDiv.innerHTML = `<p style="color:var(--success-color);">Done! Processed ${d.processed} users, skipped ${d.skipped} (already had codes).</p>`;
        } catch (e) {
            resultDiv.innerHTML = `<p style="color:var(--error-color);">Error: ${escapeHtml(e.message)}</p>`;
        }
        btn.disabled = false;
        btn.textContent = 'Grandfather Users';
    });

    // === Send Invite Email Handlers ===

    document.getElementById('send-invite-emails').addEventListener('click', async () => {
        const btn = document.getElementById('send-invite-emails');
        const resultDiv = document.getElementById('invite-email-result');
        const raw = document.getElementById('invite-email-list').value.trim();
        if (!raw) {
            resultDiv.innerHTML = '<p style="color:var(--error-color);">Please enter at least one email address.</p>';
            return;
        }
        // Parse emails: split on newlines, commas, semicolons
        const emails = raw.split(/[\n,;]+/).map(e => e.trim()).filter(e => e);
        if (emails.length === 0) {
            resultDiv.innerHTML = '<p style="color:var(--error-color);">No valid email addresses found.</p>';
            return;
        }
        if (emails.length > 50) {
            resultDiv.innerHTML = '<p style="color:var(--error-color);">Maximum 50 emails per batch.</p>';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Sending...';
        resultDiv.innerHTML = `<p style="color:var(--text-secondary);">Sending ${emails.length} invite(s)...</p>`;

        try {
            const fn = firebase.functions().httpsCallable('sendRegistrationInviteEmail');
            const result = await fn({ emails });
            const d = result.data;
            let html = `<p style="color:var(--success-color);margin-bottom:8px;">Sent ${d.sent} invite(s)${d.failed ? `, ${d.failed} failed` : ''}.</p>`;
            if (d.results && d.results.length > 0) {
                html += '<div style="font-size:12px;max-height:200px;overflow-y:auto;">';
                d.results.forEach(r => {
                    if (r.success) {
                        html += `<div style="color:var(--success-color);padding:2px 0;">✓ ${escapeHtml(r.email)} — code: <code style="background:var(--bg-input);padding:1px 4px;border-radius:3px;">${escapeHtml(r.code)}</code></div>`;
                    } else {
                        html += `<div style="color:var(--error-color);padding:2px 0;">✗ ${escapeHtml(r.email)} — ${escapeHtml(r.error)}</div>`;
                    }
                });
                html += '</div>';
            }
            resultDiv.innerHTML = html;
            document.getElementById('invite-email-list').value = '';
        } catch (e) {
            resultDiv.innerHTML = `<p style="color:var(--error-color);">Error: ${escapeHtml(e.message)}</p>`;
        }
        btn.disabled = false;
        btn.textContent = '📧 Send Invite Emails';
    });

    document.getElementById('copy-invite-template').addEventListener('click', async () => {
        const btn = document.getElementById('copy-invite-template');
        const resultDiv = document.getElementById('invite-email-result');

        // Generate a single admin code to fill into the template
        btn.disabled = true;
        btn.textContent = 'Generating code...';
        try {
            const fn = firebase.functions().httpsCallable('generateAdminInviteCodes');
            const result = await fn({ count: 1 });
            const code = result.data.codes[0];

            const template = `Subject: You're Invited to PennyHelm Cloud (Private Access)

Hey,

I've been using PennyHelm to manage my finances and wanted to share access with you. It's an invite-only budgeting platform right now — each user only gets 10 invite codes, so spots are limited.

What PennyHelm does:
- Track bills, income, debts, and accounts in one place
- See upcoming bills mapped to your pay schedule so you always know what's due and when
- Link bank accounts for real-time balances (Plaid integration)
- Share finances with a partner — both of you can view and manage together
- Works on web and mobile (Android app available)

Why invite-only:
We're keeping the user base small intentionally. Smaller community = faster feature development, direct access to the developer, and a product that actually gets shaped by early users. Once public access opens up, early members keep all their data, codes, and priority status.

Your invite code: ${code}

Sign up at: https://pennyhelm.com/login.html

The code is single-use — once someone claims it, it's gone. You'll get your own 10 codes to share once you're in.

Let me know if you have questions!`;

            navigator.clipboard.writeText(template);
            resultDiv.innerHTML = `<p style="color:var(--success-color);">Template copied with code <code style="background:var(--bg-input);padding:2px 6px;border-radius:3px;font-family:monospace;">${escapeHtml(code)}</code></p>`;
        } catch (e) {
            resultDiv.innerHTML = `<p style="color:var(--error-color);">Error: ${escapeHtml(e.message)}</p>`;
        }
        btn.disabled = false;
        btn.textContent = '📋 Copy Email Template';
    });

    // === Invite Code Tracker ===

    let allInviteCodes = [];

    async function loadInviteTracker() {
        const listDiv = document.getElementById('invite-tracker-list');
        const statsDiv = document.getElementById('invite-tracker-stats');
        try {
            const snap = await db.collection('registrationCodes').orderBy('createdAt', 'desc').get();
            allInviteCodes = snap.docs.map(d => ({ code: d.id, ...d.data() }));

            const total = allInviteCodes.length;
            const redeemed = allInviteCodes.filter(c => c.status === 'redeemed');
            const available = allInviteCodes.filter(c => c.status === 'available');
            const adminCodes = allInviteCodes.filter(c => c.ownerUid === 'admin');
            const sentCodes = allInviteCodes.filter(c => c.sentTo);

            statsDiv.innerHTML = `
                <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">
                    <span><strong>${total}</strong> total</span>
                    <span style="color:var(--success-color);"><strong>${redeemed.length}</strong> redeemed</span>
                    <span style="color:var(--accent-color);"><strong>${available.length}</strong> available</span>
                    <span style="color:var(--text-secondary);"><strong>${adminCodes.length}</strong> admin-generated</span>
                    <span style="color:var(--text-secondary);"><strong>${sentCodes.length}</strong> sent via email</span>
                </div>
            `;

            renderInviteList(allInviteCodes);
        } catch (e) {
            console.error('Failed to load invite codes:', e);
            listDiv.innerHTML = `<p style="color:var(--error-color);font-size:13px;">Failed to load invite codes: ${escapeHtml(e.message)}</p>`;
        }
    }

    // Cache for user lookups
    const userCache = {};
    async function lookupUser(uid) {
        if (!uid || uid === 'admin') return null;
        if (userCache[uid]) return userCache[uid];
        try {
            const doc = await db.collection('users').doc(uid).get();
            if (doc.exists) {
                const data = doc.data();
                userCache[uid] = { email: data.email || '', displayName: data.displayName || '' };
                return userCache[uid];
            }
        } catch (_) {}
        userCache[uid] = null;
        return null;
    }

    async function renderInviteList(codes) {
        const listDiv = document.getElementById('invite-tracker-list');

        if (codes.length === 0) {
            listDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No invite codes found.</p>';
            return;
        }

        // Resolve all redeemer UIDs up front
        const redeemerUids = [...new Set(codes.filter(c => c.redeemedBy).map(c => c.redeemedBy))];
        await Promise.all(redeemerUids.map(uid => lookupUser(uid)));

        let html = '<div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);">';
        html += `<table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="background:var(--bg-tertiary);position:sticky;top:0;">
                    <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);">Code</th>
                    <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);">Sent To</th>
                    <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);">Status</th>
                    <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);">Redeemed By</th>
                    <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);">Date</th>
                </tr>
            </thead>
            <tbody>`;

        for (const c of codes) {
            const isRedeemed = c.status === 'redeemed';
            const statusColor = isRedeemed ? 'var(--success-color)' : 'var(--accent-color)';
            const statusLabel = isRedeemed ? '✓ Redeemed' : '○ Available';

            let redeemerDisplay = '—';
            if (isRedeemed && c.redeemedBy) {
                const user = userCache[c.redeemedBy];
                if (user) {
                    redeemerDisplay = escapeHtml(user.displayName || user.email || c.redeemedBy);
                    if (user.displayName && user.email) {
                        redeemerDisplay += ` <span style="color:var(--text-secondary);">(${escapeHtml(user.email)})</span>`;
                    }
                } else {
                    redeemerDisplay = `<span style="color:var(--text-secondary);">${escapeHtml(c.redeemedBy)}</span>`;
                }
            }

            const sentTo = c.sentTo ? escapeHtml(c.sentTo) : '<span style="color:var(--text-secondary);">—</span>';

            let dateDisplay = '—';
            if (isRedeemed && c.redeemedAt) {
                const d = c.redeemedAt.toDate ? c.redeemedAt.toDate() : new Date(c.redeemedAt);
                dateDisplay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            } else if (c.createdAt) {
                const d = c.createdAt.toDate ? c.createdAt.toDate() : new Date(c.createdAt);
                dateDisplay = `<span style="color:var(--text-secondary);">Created ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`;
            }

            html += `<tr style="border-bottom:1px solid var(--border);" data-code="${escapeHtml(c.code)}" data-sent="${escapeHtml(c.sentTo || '')}" data-redeemer="${escapeHtml(c.redeemedBy || '')}">
                <td style="padding:6px 10px;font-family:monospace;font-weight:600;">${escapeHtml(c.code)}</td>
                <td style="padding:6px 10px;">${sentTo}</td>
                <td style="padding:6px 10px;color:${statusColor};font-weight:600;">${statusLabel}</td>
                <td style="padding:6px 10px;">${redeemerDisplay}</td>
                <td style="padding:6px 10px;white-space:nowrap;">${dateDisplay}</td>
            </tr>`;
        }

        html += '</tbody></table></div>';
        listDiv.innerHTML = html;
    }

    // Search/filter handler
    const searchInput = document.getElementById('invite-tracker-search');
    searchInput.addEventListener('input', debounce(() => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) {
            renderInviteList(allInviteCodes);
            return;
        }
        const filtered = allInviteCodes.filter(c => {
            if (c.code.toLowerCase().includes(q)) return true;
            if (c.sentTo && c.sentTo.toLowerCase().includes(q)) return true;
            if (c.redeemedBy) {
                const user = userCache[c.redeemedBy];
                if (user) {
                    if ((user.email || '').toLowerCase().includes(q)) return true;
                    if ((user.displayName || '').toLowerCase().includes(q)) return true;
                }
                if (c.redeemedBy.toLowerCase().includes(q)) return true;
            }
            if (c.status.toLowerCase().includes(q)) return true;
            return false;
        });
        renderInviteList(filtered);
    }, 300));

    // Refresh button
    document.getElementById('refresh-invite-tracker').addEventListener('click', () => {
        document.getElementById('invite-tracker-list').innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Loading invite codes...</p>';
        loadInviteTracker();
    });

    // Initial load
    loadInviteTracker();

    // === Waitlist Handlers ===

    // Load waitlist entries
    async function loadWaitlist() {
        const entriesDiv = document.getElementById('waitlist-entries');
        try {
            const snap = await db.collection('waitlist').orderBy('joinedAt', 'asc').get();
            const entries = snap.docs.map(d => ({ email: d.id, ...d.data() }));
            const waiting = entries.filter(e => e.status === 'waiting');
            const approved = entries.filter(e => e.status === 'approved');

            if (entries.length === 0) {
                entriesDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">No one on the waitlist yet.</p>';
                return;
            }

            let html = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
                ${waiting.length} waiting &middot; ${approved.length} approved &middot; ${entries.length} total
            </div>`;

            if (waiting.length > 0) {
                const now = Date.now();
                html += '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);">';
                waiting.forEach(e => {
                    const joinedAt = e.joinedAt?.toDate ? e.joinedAt.toDate() : (e.joinedAt ? new Date(e.joinedAt) : null);
                    const daysWaited = joinedAt ? Math.floor((now - joinedAt.getTime()) / 86400000) : 0;
                    const eligible = daysWaited >= 7;
                    html += `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;">
                            <div>
                                <span style="font-weight:500;">${escapeHtml(e.email)}</span>
                                <span style="color:var(--text-secondary);margin-left:8px;font-size:11px;">
                                    #${e.position || '?'} &middot; ${daysWaited}d ago
                                    ${eligible ? '<span style="color:var(--green);font-weight:600;"> &middot; Eligible</span>' : ''}
                                </span>
                            </div>
                            <button class="btn btn-secondary btn-sm approve-single-waitlist" data-email="${escapeHtml(e.email)}" style="font-size:11px;padding:2px 8px;">
                                Approve
                            </button>
                        </div>`;
                });
                html += '</div>';
            }

            if (approved.length > 0) {
                html += `<details style="margin-top:8px;"><summary style="font-size:12px;color:var(--text-secondary);cursor:pointer;">Show ${approved.length} approved</summary>`;
                html += '<div style="max-height:200px;overflow-y:auto;margin-top:4px;">';
                approved.forEach(e => {
                    html += `<div style="padding:4px 12px;font-size:12px;color:var(--text-secondary);">
                        ${escapeHtml(e.email)} &mdash; <code style="font-size:11px;background:var(--bg-input);padding:1px 4px;border-radius:3px;">${escapeHtml(e.inviteCode || '')}</code>
                    </div>`;
                });
                html += '</div></details>';
            }

            entriesDiv.innerHTML = html;

            // Attach approve-single handlers
            entriesDiv.querySelectorAll('.approve-single-waitlist').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    btn.textContent = '...';
                    try {
                        const fn = firebase.functions().httpsCallable('approveWaitlistEntries');
                        const result = await fn({ emails: [btn.dataset.email] });
                        const d = result.data;
                        const r = d.results[0];
                        if (r && r.success) {
                            document.getElementById('waitlist-action-result').innerHTML =
                                `<p style="color:var(--success-color);font-size:12px;">Approved ${escapeHtml(r.email)} with code <code style="background:var(--bg-input);padding:1px 4px;border-radius:3px;">${escapeHtml(r.code)}</code></p>`;
                        } else {
                            document.getElementById('waitlist-action-result').innerHTML =
                                `<p style="color:var(--error-color);font-size:12px;">Failed: ${escapeHtml(r?.reason || 'Unknown error')}</p>`;
                        }
                        loadWaitlist();
                    } catch (e) {
                        document.getElementById('waitlist-action-result').innerHTML =
                            `<p style="color:var(--error-color);font-size:12px;">Error: ${escapeHtml(e.message)}</p>`;
                        btn.disabled = false;
                        btn.textContent = 'Approve';
                    }
                });
            });
        } catch (e) {
            console.error('Failed to load waitlist:', e);
            entriesDiv.innerHTML = '<p style="color:var(--red);font-size:13px;">Failed to load waitlist.</p>';
        }
    }
    loadWaitlist();

    // Approve all eligible (7+ days)
    document.getElementById('approve-waitlist-ready').addEventListener('click', async () => {
        const btn = document.getElementById('approve-waitlist-ready');
        const resultDiv = document.getElementById('waitlist-action-result');
        btn.disabled = true;
        btn.textContent = 'Approving...';
        resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;">Approving eligible entries...</p>';

        try {
            const fn = firebase.functions().httpsCallable('approveWaitlistEntries');
            const result = await fn({ count: 50 });
            const d = result.data;

            if (d.approved === 0) {
                resultDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;">No entries eligible yet (must wait 7+ days).</p>';
            } else {
                let html = `<p style="color:var(--success-color);font-size:12px;margin-bottom:4px;">Approved ${d.approved} entries!</p>`;
                d.results.filter(r => r.success).forEach(r => {
                    html += `<div style="font-size:11px;color:var(--text-secondary);">✓ ${escapeHtml(r.email)} → <code style="background:var(--bg-input);padding:1px 4px;border-radius:3px;">${escapeHtml(r.code)}</code></div>`;
                });
                resultDiv.innerHTML = html;
                loadWaitlist();
            }
        } catch (e) {
            resultDiv.innerHTML = `<p style="color:var(--error-color);font-size:12px;">Error: ${escapeHtml(e.message)}</p>`;
        }
        btn.disabled = false;
        btn.textContent = 'Approve Eligible (7+ days)';
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
                    Invited by: ${userData.invitedBy ? '<code style="background:var(--bg-input);padding:2px 6px;border-radius:3px;font-size:12px;">' + escapeHtml(userData.invitedBy) + '</code>' : 'N/A (grandfathered)'}
                    &middot; Invite codes: ${userData.registrationCodes ? userData.registrationCodes.length : 0}${userData.registrationCodesGenerated ? '' : ' (not yet generated)'}
                </div>
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
