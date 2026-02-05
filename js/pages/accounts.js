import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';

export function renderAccounts(container, store) {
    const accounts = store.getAccounts();

    // Calculate totals
    const cashTotal = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0);
    const creditTotal = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + a.balance, 0);
    const investTotal = accounts.filter(a => a.type === 'investment' || a.type === 'retirement').reduce((s, a) => s + a.balance, 0);
    const propEquity = accounts.filter(a => a.type === 'property').reduce((s, a) => s + (a.balance - (a.amountOwed || 0)), 0);
    const propCount = accounts.filter(a => a.type === 'property').length;
    const netTotal = cashTotal + investTotal + propEquity - creditTotal;

    const typeLabels = { credit: 'Credit Card', savings: 'Savings', checking: 'Checking', investment: 'Brokerage/Investment', retirement: '401(k) / Retirement', property: 'Property' };

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Accounts & Investments</h2>
                <div class="subtitle">${accounts.length} account${accounts.length !== 1 ? 's' : ''} &middot; Net: ${formatCurrency(netTotal)}</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" id="scan-statement-btn">Scan Statement</button>
                <button class="btn btn-primary" id="add-account-btn">+ Add Account</button>
            </div>
        </div>

        ${accounts.length > 0 ? `
        <div class="card-grid">
            ${cashTotal !== 0 || accounts.some(a => a.type === 'checking' || a.type === 'savings') ? `
            <div class="stat-card ${cashTotal >= 0 ? 'green' : 'red'}">
                <div class="label">Cash / Savings</div>
                <div class="value">${formatCurrency(cashTotal)}</div>
                <div class="sub">${accounts.filter(a => a.type === 'checking' || a.type === 'savings').length} account${accounts.filter(a => a.type === 'checking' || a.type === 'savings').length !== 1 ? 's' : ''}</div>
            </div>
            ` : ''}
            ${investTotal > 0 ? `
            <div class="stat-card green">
                <div class="label">Investments / Retirement</div>
                <div class="value">${formatCurrency(investTotal)}</div>
                <div class="sub">${accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length} account${accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length !== 1 ? 's' : ''}</div>
            </div>
            ` : ''}
            ${propCount > 0 ? `
            <div class="stat-card ${propEquity >= 0 ? 'green' : 'red'}">
                <div class="label">Property Equity</div>
                <div class="value">${formatCurrency(propEquity)}</div>
                <div class="sub">${propCount} propert${propCount !== 1 ? 'ies' : 'y'}</div>
            </div>
            ` : ''}
            ${creditTotal > 0 ? `
            <div class="stat-card red">
                <div class="label">Credit Owed</div>
                <div class="value">${formatCurrency(creditTotal)}</div>
                <div class="sub">${accounts.filter(a => a.type === 'credit').length} card${accounts.filter(a => a.type === 'credit').length !== 1 ? 's' : ''}</div>
            </div>
            ` : ''}
            <div class="stat-card ${netTotal >= 0 ? 'blue' : 'red'}">
                <div class="label">Net Total</div>
                <div class="value">${formatCurrency(netTotal)}</div>
                <div class="sub">${accounts.length} account${accounts.length !== 1 ? 's' : ''} total</div>
            </div>
        </div>

        <div class="card" style="margin-top:24px;">
            <h3 style="margin-bottom:16px;">All Accounts</h3>
            <div id="accounts-list">
                ${accounts.map(a => {
                    const updated = a.lastUpdated ? new Date(a.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
                    const typeLabel = typeLabels[a.type] || 'Checking';
                    const balanceClass = a.type === 'credit' ? 'text-red' : 'text-green';
                    const isLinked = !!a.linkedDebtId;
                    const linkedDebt = isLinked ? store.getDebts().find(d => d.id === a.linkedDebtId) : null;
                    const balanceHtml = a.type === 'property' ? (() => {
                        const owed = a.amountOwed || 0;
                        const equity = a.balance - owed;
                        return `<div style="text-align:right;">
                            <div class="text-green" style="font-size:16px;font-weight:700;">${formatCurrency(a.balance)}</div>
                            ${owed > 0 ? `<div class="text-red" style="font-size:12px;">Owed: ${formatCurrency(owed)}</div>` : ''}
                            <div class="${equity >= 0 ? 'text-green' : 'text-red'}" style="font-size:13px;font-weight:600;">Equity: ${formatCurrency(equity)}</div>
                        </div>`;
                    })() : `<span class="${balanceClass}" style="font-size:16px;font-weight:700;">${a.type === 'credit' ? '-' : ''}${formatCurrency(Math.abs(a.balance))}</span>`;
                    return `
                    <div class="settings-row" style="flex-wrap:wrap;">
                        <div style="flex:1;min-width:150px;">
                            <div class="setting-label">
                                ${escapeHtml(a.name)}
                                ${isLinked ? '<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;" title="Linked to debt">&#128279; Linked</span>' : ''}
                            </div>
                            <div class="setting-desc">${typeLabel} &middot; Updated ${updated}${linkedDebt ? ` &middot; ${linkedDebt.interestRate.toFixed(1)}% APR &middot; ${formatCurrency(linkedDebt.minimumPayment)} min` : ''}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            ${balanceHtml}
                            <button class="btn btn-secondary btn-sm update-balance-btn" data-account-id="${a.id}" style="font-size:11px;padding:2px 8px;">Update</button>
                            <button class="btn-icon edit-account-btn" data-account-id="${a.id}" title="Edit">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button class="btn-icon delete-account-btn" data-account-id="${a.id}" title="Delete" style="color:var(--red);">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : `
        <div class="card" style="text-align:center;padding:48px 24px;margin-top:24px;">
            <div style="font-size:48px;margin-bottom:16px;">&#127974;</div>
            <h3 style="margin-bottom:8px;">No accounts tracked</h3>
            <p style="color:var(--text-muted);margin-bottom:24px;">Add your bank accounts, investments, and property to track your net worth.</p>
            <button class="btn btn-primary" id="empty-add-account">+ Add Your First Account</button>
        </div>
        `}

        <input type="file" id="ocr-file-input" accept=".jpg,.jpeg,.png,.webp" style="display:none;">
    `;

    // Event handlers
    container.querySelector('#add-account-btn').addEventListener('click', () => {
        showAccountForm(store);
    });

    const emptyAddBtn = container.querySelector('#empty-add-account');
    if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => showAccountForm(store));
    }

    container.querySelector('#scan-statement-btn').addEventListener('click', () => {
        container.querySelector('#ocr-file-input').click();
    });
    container.querySelector('#ocr-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleOcrImport(file, store, accounts);
        e.target.value = '';
    });

    // Update balance (quick)
    container.querySelectorAll('.update-balance-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            if (!account) return;
            const isProperty = account.type === 'property';
            const isCredit = account.type === 'credit';
            const linkedDebt = isCredit && account.linkedDebtId ? store.getDebts().find(d => d.id === account.linkedDebtId) : null;
            openModal(`Update ${escapeHtml(account.name)}`, `
                <div class="form-group">
                    <label>${isProperty ? 'Estimated Market Value' : 'Current Balance'}</label>
                    <input type="number" class="form-input" id="quick-balance-input" step="0.01" value="${account.balance}">
                </div>
                ${isProperty ? `
                <div class="form-group">
                    <label>Amount Owed (Mortgage)</label>
                    <input type="number" class="form-input" id="quick-owed-input" step="0.01" value="${account.amountOwed || 0}">
                </div>
                ` : ''}
                ${isCredit && linkedDebt ? `
                <div class="form-row">
                    <div class="form-group">
                        <label>APR %</label>
                        <input type="number" class="form-input" id="quick-apr-input" step="0.01" value="${linkedDebt.interestRate || 0}">
                    </div>
                    <div class="form-group">
                        <label>Min Payment</label>
                        <input type="number" class="form-input" id="quick-min-input" step="0.01" value="${linkedDebt.minimumPayment || 0}">
                    </div>
                </div>
                ` : ''}
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">Update</button>
                </div>
            `);
            document.getElementById('quick-balance-input').select();
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-save').addEventListener('click', () => {
                const val = parseFloat(document.getElementById('quick-balance-input').value);
                if (!isNaN(val)) {
                    const updates = { balance: val };
                    if (isProperty) {
                        const owedVal = parseFloat(document.getElementById('quick-owed-input').value);
                        if (!isNaN(owedVal)) updates.amountOwed = owedVal;
                    }
                    if (isCredit && linkedDebt) {
                        const aprEl = document.getElementById('quick-apr-input');
                        const minEl = document.getElementById('quick-min-input');
                        if (aprEl) updates._interestRate = parseFloat(aprEl.value) || 0;
                        if (minEl) updates._minimumPayment = parseFloat(minEl.value) || 0;
                    }
                    store.updateAccount(account.id, updates);
                    closeModal();
                    refreshPage();
                }
            });
        });
    });

    // Edit account
    container.querySelectorAll('.edit-account-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            if (account) showAccountForm(store, account);
        });
    });

    // Delete account
    container.querySelectorAll('.delete-account-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = accounts.find(a => a.id === btn.dataset.accountId);
            const hasLink = account && account.linkedDebtId;
            const msg = hasLink
                ? 'Delete this account? This will also remove the linked debt and its payment bill.'
                : 'Delete this account?';
            if (confirm(msg)) {
                store.deleteAccount(btn.dataset.accountId);
                refreshPage();
            }
        });
    });
}

function showAccountForm(store, existingAccount = null) {
    const isEdit = !!existingAccount;
    const account = existingAccount || { name: '', type: 'checking', balance: 0, amountOwed: 0 };
    const isProperty = account.type === 'property';
    const isCredit = account.type === 'credit';

    // Pull APR + min payment from linked debt (if editing existing linked credit card)
    let linkedAPR = 0;
    let linkedMinPayment = 0;
    if (isEdit && account.linkedDebtId) {
        const linkedDebt = store.getDebts().find(d => d.id === account.linkedDebtId);
        if (linkedDebt) {
            linkedAPR = linkedDebt.interestRate || 0;
            linkedMinPayment = linkedDebt.minimumPayment || 0;
        }
    }

    const formHtml = `
        <div class="form-group">
            <label>Account Name</label>
            <input type="text" class="form-input" id="account-name" value="${escapeHtml(account.name)}" placeholder="e.g. Bills Checking, Chase Savings">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Account Type</label>
                <select class="form-select" id="account-type">
                    <option value="checking" ${account.type === 'checking' ? 'selected' : ''}>Checking</option>
                    <option value="savings" ${account.type === 'savings' ? 'selected' : ''}>Savings</option>
                    <option value="credit" ${account.type === 'credit' ? 'selected' : ''}>Credit Card</option>
                    <option value="investment" ${account.type === 'investment' ? 'selected' : ''}>Brokerage / Investment</option>
                    <option value="retirement" ${account.type === 'retirement' ? 'selected' : ''}>401(k) / Retirement</option>
                    <option value="property" ${account.type === 'property' ? 'selected' : ''}>Property</option>
                </select>
            </div>
            <div class="form-group">
                <label id="balance-label">${isProperty ? 'Estimated Market Value' : 'Current Balance'}</label>
                <input type="number" class="form-input" id="account-balance" step="0.01" value="${account.balance}">
            </div>
        </div>
        <div class="form-group" id="amount-owed-group" style="display:${isProperty ? '' : 'none'};">
            <label>Amount Owed (Mortgage)</label>
            <input type="number" class="form-input" id="account-amount-owed" step="0.01" value="${account.amountOwed || 0}">
        </div>
        <div id="credit-fields-group" style="display:${isCredit ? '' : 'none'};">
            <div class="form-row">
                <div class="form-group">
                    <label>Interest Rate (APR %)</label>
                    <input type="number" class="form-input" id="account-apr" step="0.01" value="${linkedAPR}">
                </div>
                <div class="form-group">
                    <label>Minimum Payment</label>
                    <input type="number" class="form-input" id="account-min-payment" step="0.01" value="${linkedMinPayment}">
                </div>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:-8px;margin-bottom:12px;">
                &#128279; Linked to Debts page — changes here update the linked debt &amp; bill automatically.
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Account</button>
        </div>
    `;

    openModal(isEdit ? 'Edit Account' : 'Add Account', formHtml);

    // Dynamic form behavior for property/credit type
    const typeSelect = document.getElementById('account-type');
    const amountOwedGroup = document.getElementById('amount-owed-group');
    const creditFieldsGroup = document.getElementById('credit-fields-group');
    const balanceLabel = document.getElementById('balance-label');
    typeSelect.addEventListener('change', () => {
        const isProp = typeSelect.value === 'property';
        const isCred = typeSelect.value === 'credit';
        amountOwedGroup.style.display = isProp ? '' : 'none';
        creditFieldsGroup.style.display = isCred ? '' : 'none';
        balanceLabel.textContent = isProp ? 'Estimated Market Value' : 'Current Balance';
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const data = {
            name: document.getElementById('account-name').value.trim(),
            type: document.getElementById('account-type').value,
            balance: parseFloat(document.getElementById('account-balance').value) || 0
        };

        if (data.type === 'property') {
            data.amountOwed = parseFloat(document.getElementById('account-amount-owed').value) || 0;
        }

        if (data.type === 'credit') {
            // Pass APR + min payment as transient fields for the sync engine
            data._interestRate = parseFloat(document.getElementById('account-apr').value) || 0;
            data._minimumPayment = parseFloat(document.getElementById('account-min-payment').value) || 0;
        }

        if (!data.name) { alert('Please enter an account name'); return; }

        if (isEdit) {
            store.updateAccount(existingAccount.id, data);
        } else {
            store.addAccount(data);
        }

        closeModal();
        refreshPage();
    });
}

// ===== OCR Import =====

function parseOcrText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const accounts = [];
    const balanceRegex = /\$?\s*([\d,]+\.?\d{0,2})\s*$/;
    const closedRegex = /\b(closed|inactive|cancelled|canceled)\b/i;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip closed accounts
        if (closedRegex.test(line)) continue;

        const match = line.match(balanceRegex);
        if (!match) continue;

        const rawAmount = match[1].replace(/,/g, '');
        const balance = parseFloat(rawAmount);
        if (isNaN(balance) || balance <= 0) continue;

        // Account name is the text before the dollar amount on this line,
        // or the previous line if this line is mostly just a number
        let name = line.replace(balanceRegex, '').replace(/[\$\s]+$/, '').trim();

        // Clean up common OCR artifacts
        name = name.replace(/^[\-\—\–\|\s]+/, '').replace(/[\-\—\–\|\s]+$/, '').trim();

        // If name is too short or empty, try previous line
        if (name.length < 2 && i > 0) {
            const prevLine = lines[i - 1];
            if (!closedRegex.test(prevLine) && !balanceRegex.test(prevLine)) {
                name = prevLine.replace(/^[\-\—\–\|\s]+/, '').replace(/[\-\—\–\|\s]+$/, '').trim();
            }
        }

        // Skip if we still don't have a usable name
        if (name.length < 2) continue;

        // Check if previous line indicates closed
        if (i > 0 && closedRegex.test(lines[i - 1])) continue;
        // Check if next line indicates closed
        if (i < lines.length - 1 && closedRegex.test(lines[i + 1])) continue;

        accounts.push({ name, balance, type: 'credit' });
    }

    return accounts;
}

async function handleOcrImport(file, store, existingAccounts) {
    // Show processing modal with image preview
    const imageUrl = URL.createObjectURL(file);

    openModal('Scanning Image...', `
        <img src="${imageUrl}" class="ocr-preview" alt="Uploaded image">
        <div style="text-align:center;padding:20px 0;">
            <div class="ocr-spinner"></div>
            <span style="font-size:14px;color:var(--text-secondary);">Processing image with OCR...</span>
            <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">This may take a few seconds on first use (downloading language data)</div>
        </div>
    `);

    try {
        // Dynamic import of Tesseract.js from CDN
        const Tesseract = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
        const worker = await Tesseract.createWorker('eng');
        const result = await worker.recognize(file);
        await worker.terminate();

        const ocrText = result.data.text;
        const parsed = parseOcrText(ocrText);

        // Filter out accounts that already exist by name
        const existingNames = new Set(existingAccounts.map(a => a.name.toLowerCase()));
        const newAccounts = parsed.filter(a => !existingNames.has(a.name.toLowerCase()));

        URL.revokeObjectURL(imageUrl);
        showOcrResults(newAccounts, ocrText, store);
    } catch (err) {
        URL.revokeObjectURL(imageUrl);
        console.error('OCR error:', err);
        openModal('Scan Failed', `
            <div style="text-align:center;padding:16px 0;">
                <div style="font-size:14px;color:var(--red);margin-bottom:12px;">Failed to process image</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">${escapeHtml(err.message || 'Unknown error')}</div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Close</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
    }
}

function showOcrResults(accounts, rawText, store) {
    if (accounts.length === 0) {
        openModal('No Accounts Found', `
            <div style="padding:16px 0;">
                <div style="font-size:14px;color:var(--text-muted);margin-bottom:12px;">
                    No credit card accounts could be detected in this image.
                </div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Tips:</div>
                <ul style="font-size:12px;color:var(--text-secondary);padding-left:20px;margin-bottom:16px;">
                    <li>Use a clear, high-resolution screenshot</li>
                    <li>Make sure account names and balances are visible</li>
                    <li>Crop to show only the relevant section</li>
                </ul>
                ${rawText ? `
                <details style="margin-top:12px;">
                    <summary style="font-size:11px;color:var(--text-muted);cursor:pointer;">Show raw OCR text</summary>
                    <pre style="font-size:10px;color:var(--text-muted);margin-top:8px;white-space:pre-wrap;max-height:150px;overflow-y:auto;background:var(--bg-input);padding:8px;border-radius:4px;">${escapeHtml(rawText)}</pre>
                </details>
                ` : ''}
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Close</button>
            </div>
        `);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        return;
    }

    const accountCards = accounts.map((a, idx) => `
        <div class="ocr-account-card" data-ocr-idx="${idx}" id="ocr-card-${idx}">
            <button class="ocr-remove-btn" data-ocr-remove="${idx}" title="Remove">&times;</button>
            <div style="margin-bottom:8px;">
                <span class="badge-unverified">Unverified</span>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
                <label>Account Name</label>
                <input type="text" class="form-input ocr-name" data-ocr-idx="${idx}" value="${escapeHtml(a.name)}" style="font-size:13px;padding:6px 10px;">
            </div>
            <div class="form-row" style="gap:8px;">
                <div class="form-group" style="margin-bottom:0;">
                    <label>Balance</label>
                    <input type="number" class="form-input ocr-balance" data-ocr-idx="${idx}" step="0.01" value="${a.balance}" style="font-size:13px;padding:6px 10px;">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label>Type</label>
                    <select class="form-select ocr-type" data-ocr-idx="${idx}" style="font-size:13px;padding:6px 10px;">
                        <option value="credit" selected>Credit Card</option>
                        <option value="checking">Checking</option>
                        <option value="savings">Savings</option>
                        <option value="investment">Brokerage / Investment</option>
                        <option value="retirement">401(k) / Retirement</option>
                        <option value="property">Property</option>
                    </select>
                </div>
            </div>
        </div>
    `).join('');

    openModal(`${accounts.length} Account${accounts.length !== 1 ? 's' : ''} Found`, `
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">
            Review and edit the detected accounts below. Remove any that are incorrect.
        </div>
        <div id="ocr-cards-container">
            ${accountCards}
        </div>
        ${rawText ? `
        <details style="margin-top:8px;">
            <summary style="font-size:11px;color:var(--text-muted);cursor:pointer;">Show raw OCR text</summary>
            <pre style="font-size:10px;color:var(--text-muted);margin-top:8px;white-space:pre-wrap;max-height:120px;overflow-y:auto;background:var(--bg-input);padding:8px;border-radius:4px;">${escapeHtml(rawText)}</pre>
        </details>
        ` : ''}
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="ocr-save-all">Save All (<span id="ocr-count">${accounts.length}</span> accounts)</button>
        </div>
    `);

    // Remove buttons
    document.querySelectorAll('.ocr-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = document.getElementById(`ocr-card-${btn.dataset.ocrRemove}`);
            if (card) {
                card.remove();
                const remaining = document.querySelectorAll('.ocr-account-card').length;
                const countEl = document.getElementById('ocr-count');
                if (countEl) countEl.textContent = remaining;
                if (remaining === 0) {
                    document.getElementById('ocr-save-all').disabled = true;
                    document.getElementById('ocr-save-all').style.opacity = '0.4';
                }
            }
        });
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    document.getElementById('ocr-save-all').addEventListener('click', () => {
        const cards = document.querySelectorAll('.ocr-account-card');
        let added = 0;
        cards.forEach(card => {
            const idx = card.dataset.ocrIdx;
            const name = card.querySelector('.ocr-name').value.trim();
            const balance = parseFloat(card.querySelector('.ocr-balance').value) || 0;
            const type = card.querySelector('.ocr-type').value;
            if (name) {
                store.addAccount({ name, type, balance });
                added++;
            }
        });
        closeModal();
        if (added > 0) {
            refreshPage();
        }
    });
}
