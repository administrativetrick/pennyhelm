import { openModal, closeModal, refreshPage } from '../app.js';
import { escapeHtml, formatCurrency } from '../utils.js';
import { auth } from '../auth.js';
import { capabilities } from '../mode/mode.js';
import { requireMFAForUpload } from '../mfa-guard.js';

// ===== IndexedDB Helper for Tax Document Blobs =====
const DB_NAME = 'personal_finances_taxdocs';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveBlob(docId, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(blob, docId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getBlob(docId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(docId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteBlob(docId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(docId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ===== Constants =====
const TAX_CATEGORIES = ['W-2', '1099', '1098', 'Tax Return', 'Receipt', 'Other'];

const DEDUCTION_CATEGORIES = [
    { key: 'charitable', label: 'Charitable Donations', color: 'var(--red)' },
    { key: 'medical', label: 'Medical & Dental', color: 'var(--blue)' },
    { key: 'home-office', label: 'Home Office', color: 'var(--orange)' },
    { key: 'mileage', label: 'Mileage', color: 'var(--green)' },
    { key: 'education', label: 'Education', color: 'var(--accent)' },
    { key: 'business', label: 'Business Expenses', color: 'var(--pink, #ec4899)' },
    { key: 'state-taxes', label: 'State/Local Taxes', color: 'var(--yellow, #eab308)' },
    { key: 'other', label: 'Other', color: 'var(--text-secondary)' }
];

// IRS Mileage Rates (2024)
const MILEAGE_RATES = {
    business: 0.67,
    medical: 0.21,
    charitable: 0.14
};

// Standard deduction amounts (2024)
const STANDARD_DEDUCTION = {
    single: 14600,
    married: 29200,
    headOfHousehold: 21900
};

const TAX_YEAR_STORAGE_KEY = 'personal_finances_selected_tax_year';

// Load persisted year from localStorage
function loadSelectedYear() {
    try {
        const saved = localStorage.getItem(TAX_YEAR_STORAGE_KEY);
        if (saved) return parseInt(saved);
    } catch (e) { /* ignore */ }
    return null;
}

// Save selected year to localStorage
function saveSelectedYear(year) {
    try {
        localStorage.setItem(TAX_YEAR_STORAGE_KEY, year.toString());
    } catch (e) { /* ignore */ }
}

let selectedYear = loadSelectedYear();
let activeCategory = 'all';
let activeTab = 'documents'; // 'documents' or 'deductions'
let activeOwner = 'user'; // 'user' or 'dependent' - for filtering docs by owner

// Exported state getters/setters for use by income.js
export function getSelectedYear() { return selectedYear; }
export function setSelectedYear(year) { selectedYear = year; saveSelectedYear(year); }
export function getActiveTab() { return activeTab; }
export function setActiveTab(tab) { activeTab = tab; }
export function setActiveCategory(cat) { activeCategory = cat; }
export function setActiveOwner(owner) { activeOwner = owner; }

// Export constants
export { TAX_CATEGORIES, DEDUCTION_CATEGORIES, STANDARD_DEDUCTION, MILEAGE_RATES };

// Check which doc IDs have blobs in IndexedDB
async function checkMissingBlobs(docIds) {
    const missing = new Set();
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const objStore = tx.objectStore(STORE_NAME);
        await Promise.all(docIds.map(id => new Promise((resolve) => {
            const req = objStore.count(id);
            req.onsuccess = () => {
                if (req.result === 0) missing.add(id);
                resolve();
            };
            req.onerror = () => { missing.add(id); resolve(); };
        })));
    } catch (e) {
        // If DB fails, mark all as missing
        docIds.forEach(id => missing.add(id));
    }
    return missing;
}

// ===== Helpers =====
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function getDocIcon(mimeType) {
    if (!mimeType) {
        return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
    if (mimeType === 'application/pdf') {
        return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--red)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    }
    if (mimeType.startsWith('image/')) {
        return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--green)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function getCategoryColor(category) {
    const colors = {
        'W-2': 'var(--green)',
        '1099': 'var(--orange)',
        '1098': 'var(--accent)',
        'Tax Return': 'var(--accent)',
        'Receipt': 'var(--text-secondary)',
        'Other': 'var(--text-muted)'
    };
    return colors[category] || 'var(--text-muted)';
}

// ===== Render =====
export function renderTaxes(container, store) {
    const allDocs = store.getTaxDocuments();
    const allDeductions = store.getTaxDeductions();
    const years = store.getTaxYears();
    const currentYear = new Date().getFullYear();

    if (!selectedYear || !years.includes(selectedYear)) {
        selectedYear = years.length > 0 ? years[0] : currentYear;
        saveSelectedYear(selectedYear);
    }

    // Page header with tab switcher
    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Income & Taxes</h2>
                <div style="font-size:13px;color:var(--text-secondary);">${selectedYear} Tax Year</div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary btn-sm" id="add-tax-year-btn">+ Tax Year</button>
                ${activeTab === 'documents'
                    ? '<button class="btn btn-primary btn-sm" id="upload-doc-btn">+ Upload Document</button>'
                    : '<button class="btn btn-primary btn-sm" id="add-deduction-btn">+ Add Deduction</button>'}
            </div>
        </div>

        <div class="filters mb-16">
            <button class="filter-chip" data-tab="income">Income</button>
            <button class="filter-chip ${activeTab === 'documents' ? 'active' : ''}" id="tab-documents">Documents</button>
            <button class="filter-chip ${activeTab === 'deductions' ? 'active' : ''}" id="tab-deductions">Deductions</button>
        </div>

        ${years.length > 0 ? `
        <div class="filters mb-16" id="year-tabs">
            ${years.map(y =>
                `<button class="filter-chip ${y === selectedYear ? 'active' : ''}" data-year="${y}">${y}</button>`
            ).join('')}
        </div>
        ` : ''}

        <div id="tax-content"></div>

        <input type="file" id="tax-file-input" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt" style="display:none;">
    `;

    // Tab click handlers
    const incomeTabBtn = container.querySelector('.filter-chip[data-tab="income"]');
    if (incomeTabBtn) {
        incomeTabBtn.addEventListener('click', () => {
            window.location.hash = 'income';
        });
    }
    container.querySelector('#tab-documents').addEventListener('click', () => {
        activeTab = 'documents';
        activeCategory = 'all';
        window.location.hash = 'income/documents';
    });
    container.querySelector('#tab-deductions').addEventListener('click', () => {
        activeTab = 'deductions';
        window.location.hash = 'income/deductions';
    });

    // Year tabs
    container.querySelectorAll('#year-tabs .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            selectedYear = parseInt(chip.dataset.year);
            saveSelectedYear(selectedYear);
            activeCategory = 'all';
            renderTaxes(container, store);
        });
    });

    // Add Tax Year
    container.querySelector('#add-tax-year-btn').addEventListener('click', () => {
        showAddYearModal(store);
    });

    // Render content based on active tab
    const contentContainer = container.querySelector('#tax-content');
    if (activeTab === 'documents') {
        renderDocumentsTab(contentContainer, store, allDocs, selectedYear);
    } else {
        renderDeductionsTab(contentContainer, store, allDeductions, selectedYear);
    }
}

// ===== Documents Tab =====
function renderDocumentsTab(container, store, allDocs, year) {
    const dependentEnabled = store.isDependentEnabled();
    const userName = store.getUserName();
    const dependentName = store.getDependentName();

    // Filter by year first
    let yearDocs = allDocs.filter(d => d.taxYear === year);

    // If dependent enabled, filter by owner
    if (dependentEnabled) {
        yearDocs = yearDocs.filter(d => (d.owner || 'user') === activeOwner);
    }

    const filteredDocs = activeCategory === 'all'
        ? yearDocs
        : yearDocs.filter(d => d.category === activeCategory);

    container.innerHTML = `
        ${dependentEnabled ? `
        <div class="filters" id="owner-filters" style="margin-bottom:12px;">
            <button class="filter-chip ${activeOwner === 'user' ? 'active' : ''}" data-owner="user">${escapeHtml(userName)}</button>
            <button class="filter-chip ${activeOwner === 'dependent' ? 'active' : ''}" data-owner="dependent">${escapeHtml(dependentName)}</button>
        </div>
        ` : ''}
        <div class="filters" id="category-filters" style="margin-bottom:20px;">
            <button class="filter-chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all">All</button>
            ${TAX_CATEGORIES.map(c =>
                `<button class="filter-chip ${activeCategory === c ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
            ).join('')}
        </div>

        <div id="tax-docs-list">
            ${filteredDocs.length > 0 ? renderDocumentCards(filteredDocs, null) : `
                <div style="text-align:center;padding:48px 20px;color:var(--text-muted);">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:8px;">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <p style="font-size:14px;margin-bottom:4px;">No documents${activeCategory !== 'all' ? ' in this category' : ''} for ${year}.</p>
                    <p style="font-size:12px;">Upload W-2s, 1099s, receipts, and other tax documents.</p>
                </div>
            `}
        </div>

        ${yearDocs.length > 0 ? `
        <div class="card" style="margin-top:16px;padding:12px 18px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <span style="font-size:13px;color:var(--text-secondary);">${year} Documents</span>
                <span style="font-weight:700;font-size:13px;">${yearDocs.length} file${yearDocs.length !== 1 ? 's' : ''} &middot; ${formatFileSize(yearDocs.reduce((s, d) => s + (d.size || 0), 0))}</span>
            </div>
        </div>
        ` : ''}
    `;

    attachDocumentTabEvents(container, store, yearDocs);

    // Async: check for missing blobs
    if (filteredDocs.length > 0) {
        checkMissingBlobs(filteredDocs.map(d => d.id)).then(missingBlobs => {
            if (missingBlobs.size > 0) {
                const docsList = container.querySelector('#tax-docs-list');
                if (docsList) {
                    docsList.innerHTML = renderDocumentCards(filteredDocs, missingBlobs);
                    attachDocEvents(container, store);
                }
            }
        });
    }
}

function attachDocumentTabEvents(container, store, yearDocs) {
    // Owner filters (when dependent enabled)
    container.querySelectorAll('#owner-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            activeOwner = chip.dataset.owner;
            activeCategory = 'all'; // reset category when switching owner
            const mainContainer = container.closest('#main-content');
            renderTaxes(mainContainer, store);
        });
    });

    // Category filters
    container.querySelectorAll('#category-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            activeCategory = chip.dataset.cat;
            const mainContainer = container.closest('#main-content');
            renderTaxes(mainContainer, store);
        });
    });

    // Upload button
    const uploadBtn = document.querySelector('#upload-doc-btn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            requireMFAForUpload(() => document.querySelector('#tax-file-input').click());
        });
    }

    // File input
    const fileInput = document.querySelector('#tax-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            if (capabilities().mfa && !auth.isMFAEnabled()) { e.target.value = ''; return; }
            if (files.length === 1) {
                showUploadModal(store, files[0], selectedYear);
            } else {
                showBulkUploadModal(store, files, selectedYear);
            }
            e.target.value = '';
        });
    }

    // Document actions
    attachDocEvents(container, store);
}

// ===== Deductions Tab =====
function renderDeductionsTab(container, store, allDeductions, year) {
    const yearDeductions = allDeductions.filter(d => d.taxYear === year);
    const totalDeductions = yearDeductions.reduce((sum, d) => sum + d.amount, 0);

    // Calculate category totals
    const categoryTotals = {};
    DEDUCTION_CATEGORIES.forEach(cat => { categoryTotals[cat.key] = 0; });
    yearDeductions.forEach(d => {
        if (categoryTotals[d.category] !== undefined) {
            categoryTotals[d.category] += d.amount;
        }
    });

    // Find top category
    let topCategory = null;
    let topAmount = 0;
    Object.entries(categoryTotals).forEach(([key, amount]) => {
        if (amount > topAmount) {
            topAmount = amount;
            topCategory = DEDUCTION_CATEGORIES.find(c => c.key === key);
        }
    });

    // Standard deduction comparison
    const standardAmount = STANDARD_DEDUCTION.single;
    const shouldItemize = totalDeductions > standardAmount;

    container.innerHTML = `
        <div class="stats-grid mb-24">
            <div class="stat-card">
                <div class="stat-label">Total Deductions</div>
                <div class="stat-value" style="color:var(--green);">${formatCurrency(totalDeductions)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label"># of Entries</div>
                <div class="stat-value">${yearDeductions.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Top Category</div>
                <div class="stat-value" style="font-size:14px;">${topCategory ? topCategory.label : '-'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">vs Standard ($${standardAmount.toLocaleString()})</div>
                <div class="stat-value" style="font-size:14px;color:${shouldItemize ? 'var(--green)' : 'var(--text-muted)'};">
                    ${shouldItemize ? 'Itemize!' : `Need ${formatCurrency(standardAmount - totalDeductions)}`}
                </div>
            </div>
        </div>

        ${yearDeductions.length > 0 ? `
        <div class="card mb-24">
            <h3 class="mb-16">Category Breakdown</h3>
            <div style="display:grid;gap:12px;">
                ${DEDUCTION_CATEGORIES.filter(cat => categoryTotals[cat.key] > 0).map(cat => {
                    const amount = categoryTotals[cat.key];
                    const percent = totalDeductions > 0 ? (amount / totalDeductions) * 100 : 0;
                    return `
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="width:140px;font-size:13px;font-weight:500;">${cat.label}</div>
                            <div style="flex:1;height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden;">
                                <div style="width:${percent}%;height:100%;background:${cat.color};"></div>
                            </div>
                            <div style="min-width:90px;text-align:right;font-weight:600;font-size:13px;">${formatCurrency(amount)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}

        ${yearDeductions.length === 0 ? `
            <div class="card" style="text-align:center;padding:48px 24px;">
                <div style="font-size:48px;margin-bottom:16px;">&#128206;</div>
                <h3 class="mb-8">No deductions tracked</h3>
                <p style="color:var(--text-muted);margin-bottom:24px;">Track your tax-deductible expenses throughout the year</p>
                <button class="btn btn-primary" id="empty-add-deduction">+ Add Your First Deduction</button>
            </div>
        ` : `
            <div class="card">
                <h3 class="mb-16">Deductions List</h3>
                <div class="table-wrapper deductions-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Description</th>
                                <th>Category</th>
                                <th>Amount</th>
                                <th>Vendor</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="deductions-tbody">
                            ${yearDeductions.sort((a, b) => new Date(b.date) - new Date(a.date)).map(ded => {
                                const cat = DEDUCTION_CATEGORIES.find(c => c.key === ded.category) || DEDUCTION_CATEGORIES[DEDUCTION_CATEGORIES.length - 1];
                                const dateStr = new Date(ded.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                return `
                                    <tr>
                                        <td style="font-size:13px;">${dateStr}</td>
                                        <td>
                                            <div style="font-weight:600;">${escapeHtml(ded.description)}</div>
                                            ${ded.notes ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(ded.notes)}</div>` : ''}
                                        </td>
                                        <td><span class="badge" style="background:${cat.color}20;color:${cat.color};border:1px solid ${cat.color}40;">${cat.label}</span></td>
                                        <td class="font-bold">${formatCurrency(ded.amount)}</td>
                                        <td style="font-size:12px;color:var(--text-secondary);">${escapeHtml(ded.vendor || '-')}</td>
                                        <td>
                                            <div style="display:flex;gap:4px;">
                                                <button class="btn-icon edit-deduction" data-ded-id="${ded.id}" title="Edit">
                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                                </button>
                                                <button class="btn-icon delete-deduction" data-ded-id="${ded.id}" title="Delete" style="color:var(--red);">
                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `}
    `;

    attachDeductionTabEvents(container, store, yearDeductions);
}

function attachDeductionTabEvents(container, store, yearDeductions) {
    // Add deduction button (header)
    const addBtn = document.querySelector('#add-deduction-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => showDeductionModal(store, selectedYear));
    }

    // Empty state add button
    const emptyAddBtn = container.querySelector('#empty-add-deduction');
    if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => showDeductionModal(store, selectedYear));
    }

    // Edit buttons
    container.querySelectorAll('.edit-deduction').forEach(btn => {
        btn.addEventListener('click', () => {
            const ded = store.getTaxDeductions().find(d => d.id === btn.dataset.dedId);
            if (ded) showDeductionModal(store, selectedYear, ded);
        });
    });

    // Delete buttons
    container.querySelectorAll('.delete-deduction').forEach(btn => {
        btn.addEventListener('click', () => {
            const ded = store.getTaxDeductions().find(d => d.id === btn.dataset.dedId);
            if (!ded) return;
            openModal('Delete Deduction', `
                <div style="padding:8px 0;font-size:14px;">
                    Are you sure you want to delete <strong>${escapeHtml(ded.description)}</strong>? This cannot be undone.
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-confirm" style="background:var(--red);">Delete</button>
                </div>
            `);
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-confirm').addEventListener('click', () => {
                store.deleteTaxDeduction(ded.id);
                closeModal();
                refreshPage();
            });
        });
    });
}

// ===== Deduction Modal =====
function showDeductionModal(store, taxYear, existingDed = null) {
    const isEdit = !!existingDed;
    const ded = existingDed || {
        category: 'charitable',
        description: '',
        amount: 0,
        date: new Date().toISOString().slice(0, 10),
        vendor: '',
        notes: ''
    };

    const yearDocs = store.getTaxDocuments(taxYear);

    openModal(isEdit ? 'Edit Deduction' : 'Add Deduction', `
        <div class="form-row">
            <div class="form-group">
                <label>Date</label>
                <input type="date" class="form-input" id="ded-date" value="${ded.date}">
            </div>
            <div class="form-group">
                <label>Category</label>
                <select class="form-select" id="ded-category">
                    ${DEDUCTION_CATEGORIES.map(c =>
                        `<option value="${c.key}" ${ded.category === c.key ? 'selected' : ''}>${c.label}</option>`
                    ).join('')}
                </select>
            </div>
        </div>
        <div class="form-group">
            <label>Description</label>
            <input type="text" class="form-input" id="ded-description" value="${escapeHtml(ded.description)}" placeholder="e.g., Donation to Red Cross">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" class="form-input" id="ded-amount" step="0.01" value="${ded.amount}">
            </div>
            <div class="form-group">
                <label>Vendor (optional)</label>
                <input type="text" class="form-input" id="ded-vendor" value="${escapeHtml(ded.vendor || '')}" placeholder="e.g., Charity name">
            </div>
        </div>
        <div id="mileage-calc" style="display:none;margin-bottom:16px;padding:12px;background:var(--bg-secondary);border-radius:var(--radius-sm);">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Mileage Calculator</div>
            <div class="form-row" style="gap:8px;">
                <div class="form-group" style="margin-bottom:0;">
                    <label>Miles</label>
                    <input type="number" class="form-input" id="mileage-miles" step="0.1" placeholder="Enter miles">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label>Type</label>
                    <select class="form-select" id="mileage-type">
                        <option value="business">Business ($0.67/mi)</option>
                        <option value="medical">Medical ($0.21/mi)</option>
                        <option value="charitable">Charitable ($0.14/mi)</option>
                    </select>
                </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="calc-mileage" style="margin-top:8px;">Calculate</button>
        </div>
        ${yearDocs.length > 0 ? `
        <div class="form-group">
            <label>Link Receipt (optional)</label>
            <select class="form-select" id="ded-receipt">
                <option value="">None</option>
                ${yearDocs.map(doc => `<option value="${doc.id}" ${ded.receiptDocId === doc.id ? 'selected' : ''}>${escapeHtml(doc.filename)}</option>`).join('')}
            </select>
        </div>
        ` : ''}
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" class="form-input" id="ded-notes" value="${escapeHtml(ded.notes || '')}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'} Deduction</button>
        </div>
    `);

    const categorySelect = document.getElementById('ded-category');
    const mileageCalc = document.getElementById('mileage-calc');
    const amountInput = document.getElementById('ded-amount');

    // Show/hide mileage calculator
    function updateMileageVisibility() {
        mileageCalc.style.display = categorySelect.value === 'mileage' ? 'block' : 'none';
    }
    updateMileageVisibility();
    categorySelect.addEventListener('change', updateMileageVisibility);

    // Mileage calculation
    document.getElementById('calc-mileage').addEventListener('click', () => {
        const miles = parseFloat(document.getElementById('mileage-miles').value) || 0;
        const type = document.getElementById('mileage-type').value;
        const rate = MILEAGE_RATES[type] || 0.67;
        amountInput.value = (miles * rate).toFixed(2);
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const data = {
            taxYear: taxYear,
            category: categorySelect.value,
            description: document.getElementById('ded-description').value.trim(),
            amount: parseFloat(amountInput.value) || 0,
            date: document.getElementById('ded-date').value,
            vendor: document.getElementById('ded-vendor').value.trim(),
            receiptDocId: document.getElementById('ded-receipt')?.value || null,
            notes: document.getElementById('ded-notes').value.trim()
        };

        if (!data.description) {
            alert('Please enter a description');
            return;
        }

        if (isEdit) {
            store.updateTaxDeduction(existingDed.id, data);
        } else {
            store.addTaxDeduction(data);
        }

        closeModal();
        refreshPage();
    });
}

// ===== Document Cards =====
function renderDocumentCards(docs, missingBlobs) {
    return docs.map(doc => {
        const uploadDate = new Date(doc.uploadDate).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
        const icon = getDocIcon(doc.mimeType);
        const catColor = getCategoryColor(doc.category);
        const isMissing = missingBlobs && missingBlobs.has(doc.id);

        return `
        <div class="card mb-16" style="padding:14px 18px;${isMissing ? 'border-left:3px solid var(--orange);' : ''}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:200px;">
                    <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--bg-secondary);border-radius:var(--radius-sm);flex-shrink:0;">
                        ${icon}
                    </div>
                    <div>
                        <div style="font-weight:600;font-size:14px;">${escapeHtml(doc.filename)}</div>
                        <div style="font-size:12px;color:var(--text-secondary);">
                            <span style="color:${catColor};font-weight:600;">${escapeHtml(doc.category || 'Other')}</span>
                            &middot; ${formatFileSize(doc.size)} &middot; ${uploadDate}
                        </div>
                        ${doc.notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escapeHtml(doc.notes)}</div>` : ''}
                        ${isMissing ? `<div style="font-size:11px;color:var(--orange);margin-top:2px;font-weight:600;">File missing from browser storage</div>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:4px;">
                    ${isMissing ? `
                        <button class="btn btn-secondary btn-sm reupload-doc" data-doc-id="${doc.id}" data-mime="${escapeHtml(doc.mimeType || '')}" title="Re-upload file" style="padding:4px 8px;font-size:12px;color:var(--orange);font-weight:600;">Re-upload</button>
                    ` : `
                        <button class="btn btn-secondary btn-sm view-doc" data-doc-id="${doc.id}" title="View" style="padding:4px 8px;font-size:12px;">View</button>
                        <button class="btn btn-secondary btn-sm download-doc" data-doc-id="${doc.id}" data-filename="${escapeHtml(doc.filename)}" title="Download" style="padding:4px 8px;font-size:12px;">Download</button>
                    `}
                    <button class="btn btn-secondary btn-sm edit-doc" data-doc-id="${doc.id}" title="Edit" style="padding:4px 8px;font-size:12px;">Edit</button>
                    <button class="btn btn-secondary btn-sm delete-doc" data-doc-id="${doc.id}" title="Delete" style="padding:4px 8px;font-size:12px;color:var(--red);">Delete</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// ===== Events =====
function attachTaxEvents(container, store, yearDocs) {
    // Year tabs
    container.querySelectorAll('#year-tabs .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            selectedYear = parseInt(chip.dataset.year);
            saveSelectedYear(selectedYear);
            activeCategory = 'all';
            renderTaxes(container, store);
        });
    });

    // Category filters
    container.querySelectorAll('#category-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            activeCategory = chip.dataset.cat;
            renderTaxes(container, store);
        });
    });

    // Add Tax Year
    container.querySelector('#add-tax-year-btn').addEventListener('click', () => {
        showAddYearModal(store);
    });

    // Upload button
    container.querySelector('#upload-doc-btn').addEventListener('click', () => {
        requireMFAForUpload(() => container.querySelector('#tax-file-input').click());
    });

    // File input
    container.querySelector('#tax-file-input').addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        if (capabilities().mfa && !auth.isMFAEnabled()) { e.target.value = ''; return; }
        if (files.length === 1) {
            showUploadModal(store, files[0], selectedYear);
        } else {
            showBulkUploadModal(store, files, selectedYear);
        }
        e.target.value = '';
    });

    // Document actions
    attachDocEvents(container, store);
}

function attachDocEvents(container, store) {
    // Re-upload (for missing blobs)
    container.querySelectorAll('.reupload-doc').forEach(btn => {
        btn.addEventListener('click', () => {
            const doc = store.getTaxDocuments().find(d => d.id === btn.dataset.docId);
            if (doc) showReuploadModal(store, doc);
        });
    });

    // View
    container.querySelectorAll('.view-doc').forEach(btn => {
        btn.addEventListener('click', async () => {
            const docId = btn.dataset.docId;
            const doc = store.getTaxDocuments().find(d => d.id === docId);
            try {
                const blob = await getBlob(docId);
                if (!blob) {
                    openModal('File Not Found', `
                        <div style="padding:16px 0;font-size:14px;color:var(--text-secondary);">
                            The file data was not found in browser storage. It may have been cleared.
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-secondary" id="modal-cancel">Close</button>
                            <button class="btn btn-primary" id="modal-reupload">Re-upload File</button>
                        </div>
                    `);
                    document.getElementById('modal-cancel').addEventListener('click', closeModal);
                    document.getElementById('modal-reupload').addEventListener('click', () => {
                        closeModal();
                        if (doc) showReuploadModal(store, doc);
                    });
                    return;
                }
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (err) {
                console.error('View error:', err);
            }
        });
    });

    // Download
    container.querySelectorAll('.download-doc').forEach(btn => {
        btn.addEventListener('click', async () => {
            const docId = btn.dataset.docId;
            const filename = btn.dataset.filename;
            const doc = store.getTaxDocuments().find(d => d.id === docId);
            try {
                const blob = await getBlob(docId);
                if (!blob) {
                    openModal('File Not Found', `
                        <div style="padding:16px 0;font-size:14px;color:var(--text-secondary);">
                            The file data was not found in browser storage. It may have been cleared.
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-secondary" id="modal-cancel">Close</button>
                            <button class="btn btn-primary" id="modal-reupload">Re-upload File</button>
                        </div>
                    `);
                    document.getElementById('modal-cancel').addEventListener('click', closeModal);
                    document.getElementById('modal-reupload').addEventListener('click', () => {
                        closeModal();
                        if (doc) showReuploadModal(store, doc);
                    });
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Download error:', err);
            }
        });
    });

    // Edit
    container.querySelectorAll('.edit-doc').forEach(btn => {
        btn.addEventListener('click', () => {
            const doc = store.getTaxDocuments().find(d => d.id === btn.dataset.docId);
            if (doc) showEditDocModal(store, doc);
        });
    });

    // Delete
    container.querySelectorAll('.delete-doc').forEach(btn => {
        btn.addEventListener('click', () => {
            const doc = store.getTaxDocuments().find(d => d.id === btn.dataset.docId);
            if (!doc) return;
            openModal('Delete Document', `
                <div style="padding:8px 0;font-size:14px;">
                    Are you sure you want to delete <strong>${escapeHtml(doc.filename)}</strong>? This cannot be undone.
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-confirm" style="background:var(--red);">Delete</button>
                </div>
            `);
            document.getElementById('modal-cancel').addEventListener('click', closeModal);
            document.getElementById('modal-confirm').addEventListener('click', async () => {
                try { await deleteBlob(doc.id); } catch (e) { /* blob may be gone */ }
                store.deleteTaxDocument(doc.id);
                closeModal();
                refreshPage();
            });
        });
    });
}

// ===== Modals =====
function showAddYearModal(store) {
    const currentYear = new Date().getFullYear();
    openModal('Add Tax Year', `
        <div class="form-group">
            <label>Tax Year</label>
            <input type="number" class="form-input" id="tax-year-input" min="2000" max="2099" value="${currentYear}">
            <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
                Creates an empty year tab to organize documents under.
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">Create Year</button>
        </div>
    `);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const year = parseInt(document.getElementById('tax-year-input').value);
        if (year >= 2000 && year <= 2099) {
            store.addTaxYear(year);
            selectedYear = year;
            saveSelectedYear(selectedYear);
            activeCategory = 'all';
            closeModal();
            refreshPage();
        }
    });
}

function showUploadModal(store, file, taxYear) {
    const dependentEnabled = store.isDependentEnabled();
    const userName = store.getUserName();
    const dependentName = store.getDependentName();

    openModal('Upload Tax Document', `
        <div style="background:var(--bg-input);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px;">
            <div style="font-weight:600;font-size:14px;">${escapeHtml(file.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${formatFileSize(file.size)} &middot; ${file.type || 'unknown type'}</div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Tax Year</label>
                <input type="number" class="form-input" id="upload-year" value="${taxYear}" min="2000" max="2099">
            </div>
            <div class="form-group">
                <label>Category</label>
                <select class="form-select" id="upload-category">
                    ${TAX_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
            </div>
        </div>
        ${dependentEnabled ? `
        <div class="form-group">
            <label>Document Owner</label>
            <select class="form-select" id="upload-owner">
                <option value="user" ${activeOwner === 'user' ? 'selected' : ''}>${escapeHtml(userName)}</option>
                <option value="dependent" ${activeOwner === 'dependent' ? 'selected' : ''}>${escapeHtml(dependentName)}</option>
            </select>
        </div>
        ` : ''}
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" class="form-input" id="upload-notes" placeholder="e.g., Employer name, account details">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">Upload</button>
        </div>
    `);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', async () => {
        const year = parseInt(document.getElementById('upload-year').value);
        const category = document.getElementById('upload-category').value;
        const notes = document.getElementById('upload-notes').value.trim();
        const owner = dependentEnabled ? document.getElementById('upload-owner').value : 'user';

        if (!year || year < 2000 || year > 2099) return;

        const saveBtn = document.getElementById('modal-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        const doc = store.addTaxDocument({
            taxYear: year,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            category,
            notes,
            owner
        });

        try {
            await saveBlob(doc.id, file);
        } catch (err) {
            store.deleteTaxDocument(doc.id);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Upload';
            console.error('Failed to save blob:', err);
            return;
        }

        store.addTaxYear(year);
        selectedYear = year;
        saveSelectedYear(selectedYear);
        closeModal();
        refreshPage();
    });
}

function showBulkUploadModal(store, files, taxYear) {
    const dependentEnabled = store.isDependentEnabled();
    const userName = store.getUserName();
    const dependentName = store.getDependentName();

    openModal(`Upload ${files.length} Documents`, `
        <div class="form-row">
            <div class="form-group">
                <label>Tax Year (all files)</label>
                <input type="number" class="form-input" id="bulk-year" value="${taxYear}" min="2000" max="2099">
            </div>
            <div class="form-group">
                <label>Category (all files)</label>
                <select class="form-select" id="bulk-category">
                    ${TAX_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
            </div>
        </div>
        ${dependentEnabled ? `
        <div class="form-group">
            <label>Document Owner (all files)</label>
            <select class="form-select" id="bulk-owner">
                <option value="user" ${activeOwner === 'user' ? 'selected' : ''}>${escapeHtml(userName)}</option>
                <option value="dependent" ${activeOwner === 'dependent' ? 'selected' : ''}>${escapeHtml(dependentName)}</option>
            </select>
        </div>
        ` : ''}
        <div style="margin-bottom:12px;max-height:150px;overflow-y:auto;">
            ${files.map(f => `<div style="font-size:12px;color:var(--text-secondary);padding:4px 0;">${escapeHtml(f.name)} (${formatFileSize(f.size)})</div>`).join('')}
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">Upload All</button>
        </div>
    `);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', async () => {
        const year = parseInt(document.getElementById('bulk-year').value);
        const category = document.getElementById('bulk-category').value;
        const owner = dependentEnabled ? document.getElementById('bulk-owner').value : 'user';

        if (!year || year < 2000 || year > 2099) return;

        const saveBtn = document.getElementById('modal-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        for (const file of files) {
            const doc = store.addTaxDocument({
                taxYear: year,
                filename: file.name,
                mimeType: file.type,
                size: file.size,
                category,
                notes: '',
                owner
            });
            try {
                await saveBlob(doc.id, file);
            } catch (err) {
                store.deleteTaxDocument(doc.id);
                console.error('Failed to save blob:', err);
            }
        }

        store.addTaxYear(year);
        selectedYear = year;
        saveSelectedYear(selectedYear);
        closeModal();
        refreshPage();
    });
}

function showReuploadModal(store, doc) {
    openModal('Re-upload File', `
        <div style="padding:8px 0 16px;font-size:14px;">
            <p class="mb-8">The file <strong>${escapeHtml(doc.filename)}</strong> is missing from browser storage.</p>
            <p style="font-size:13px;color:var(--text-secondary);">Select the file from your computer to restore it.</p>
        </div>
        <div class="form-group">
            <label>Select File</label>
            <input type="file" class="form-input" id="reupload-file-input" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt" style="padding:8px;">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save" disabled>Re-upload</button>
        </div>
    `);

    const fileInput = document.getElementById('reupload-file-input');
    const saveBtn = document.getElementById('modal-save');

    fileInput.addEventListener('change', () => {
        saveBtn.disabled = fileInput.files.length === 0;
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    saveBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            await saveBlob(doc.id, file);
            // Update metadata if file size/type changed
            store.updateTaxDocument(doc.id, {
                size: file.size,
                mimeType: file.type
            });
            closeModal();
            refreshPage();
        } catch (err) {
            console.error('Re-upload failed:', err);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Re-upload';
        }
    });
}

function showEditDocModal(store, doc) {
    const dependentEnabled = store.isDependentEnabled();
    const userName = store.getUserName();
    const dependentName = store.getDependentName();
    const currentOwner = doc.owner || 'user';

    openModal('Edit Document', `
        <div style="font-weight:600;margin-bottom:12px;">${escapeHtml(doc.filename)}</div>
        <div class="form-row">
            <div class="form-group">
                <label>Tax Year</label>
                <input type="number" class="form-input" id="edit-doc-year" value="${doc.taxYear}" min="2000" max="2099">
            </div>
            <div class="form-group">
                <label>Category</label>
                <select class="form-select" id="edit-doc-category">
                    ${TAX_CATEGORIES.map(c => `<option value="${c}" ${doc.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
        </div>
        ${dependentEnabled ? `
        <div class="form-group">
            <label>Document Owner</label>
            <select class="form-select" id="edit-doc-owner">
                <option value="user" ${currentOwner === 'user' ? 'selected' : ''}>${escapeHtml(userName)}</option>
                <option value="dependent" ${currentOwner === 'dependent' ? 'selected' : ''}>${escapeHtml(dependentName)}</option>
            </select>
        </div>
        ` : ''}
        <div class="form-group">
            <label>Notes</label>
            <input type="text" class="form-input" id="edit-doc-notes" value="${escapeHtml(doc.notes || '')}">
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">Save</button>
        </div>
    `);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', () => {
        const year = parseInt(document.getElementById('edit-doc-year').value);
        if (!year || year < 2000 || year > 2099) return;
        const updates = {
            taxYear: year,
            category: document.getElementById('edit-doc-category').value,
            notes: document.getElementById('edit-doc-notes').value.trim()
        };
        if (dependentEnabled) {
            updates.owner = document.getElementById('edit-doc-owner').value;
        }
        store.updateTaxDocument(doc.id, updates);
        store.addTaxYear(year);
        closeModal();
        refreshPage();
    });
}
