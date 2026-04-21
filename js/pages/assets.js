import { formatCurrency, escapeHtml } from '../utils.js';
import { openModal, closeModal, refreshPage } from '../app.js';
import { showAccountForm } from './accounts.js';

// Asset type categories — maps account types to grouped categories
const ASSET_CATEGORIES = [
    { key: 'real-estate', label: 'Real Estate', icon: '🏠', types: ['property'] },
    { key: 'vehicles', label: 'Vehicles', icon: '🚗', types: ['vehicle'] },
    { key: 'investments', label: 'Investments & Retirement', icon: '📈', types: ['investment', 'retirement'] },
    { key: 'credit', label: 'Credit Cards', icon: '💳', types: ['credit'] },
    { key: 'equipment', label: 'Equipment', icon: '🔧', types: ['equipment'] },
    { key: 'other-assets', label: 'Other Assets', icon: '📦', types: ['other-asset'] },
];

// Asset-eligible account types (excludes cash accounts — checking/savings)
const ASSET_TYPES = ['property', 'vehicle', 'investment', 'retirement', 'credit', 'equipment', 'other-asset'];

const TYPE_LABELS = {
    property: 'Property',
    vehicle: 'Vehicle',
    investment: 'Brokerage/Investment',
    retirement: '401(k) / Retirement',
    credit: 'Credit Card',
    equipment: 'Equipment',
    'other-asset': 'Other Asset'
};

export function renderAssetsTab(container, store) {
    const allAccounts = store.getAccounts();
    const debts = store.getDebts();
    const assets = allAccounts.filter(a => ASSET_TYPES.includes(a.type));

    // Summary stats
    const totalValue = assets.reduce((s, a) => {
        if (a.type === 'credit') return s; // credit balance is owed, not value
        return s + (a.balance || 0);
    }, 0);
    const totalOwed = assets.reduce((s, a) => {
        if (a.type === 'credit') return s + (a.balance || 0);
        return s + (a.amountOwed || 0);
    }, 0);
    const totalEquity = totalValue - totalOwed;

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h2>Assets</h2>
                <div class="subtitle">${assets.length} asset${assets.length !== 1 ? 's' : ''} &middot; Equity: ${formatCurrency(totalEquity)}</div>
            </div>
            <button class="btn btn-primary btn-sm" id="add-asset-btn">+ Add Asset</button>
        </div>

        <div class="filters" style="margin-bottom:20px;">
            <button class="filter-chip" data-tab="income">Income</button>
            <button class="filter-chip" data-tab="documents">Documents</button>
            <button class="filter-chip" data-tab="deductions">Deductions</button>
            <button class="filter-chip active" data-tab="assets">Assets</button>
        </div>

        ${assets.length > 0 ? `
        <!-- Summary Cards -->
        <div class="stats-grid">
            <div class="stat-card green">
                <div class="stat-label">Total Asset Value</div>
                <div class="stat-value">${formatCurrency(totalValue)}</div>
                <div class="stat-sub">Across ${assets.filter(a => a.type !== 'credit').length} asset${assets.filter(a => a.type !== 'credit').length !== 1 ? 's' : ''}</div>
            </div>
            <div class="stat-card red">
                <div class="stat-label">Total Owed</div>
                <div class="stat-value">${formatCurrency(totalOwed)}</div>
                <div class="stat-sub">Mortgages, loans & credit</div>
            </div>
            <div class="stat-card ${totalEquity >= 0 ? 'blue' : 'red'}">
                <div class="stat-label">Total Equity</div>
                <div class="stat-value">${formatCurrency(totalEquity)}</div>
                <div class="stat-sub">Value minus owed</div>
            </div>
        </div>

        <!-- Grouped Asset List -->
        ${ASSET_CATEGORIES.map(cat => {
            const catAssets = assets.filter(a => cat.types.includes(a.type));
            if (catAssets.length === 0) return '';

            const catValue = catAssets.reduce((s, a) => {
                if (a.type === 'credit') return s;
                return s + (a.balance || 0);
            }, 0);
            const catOwed = catAssets.reduce((s, a) => {
                if (a.type === 'credit') return s + (a.balance || 0);
                return s + (a.amountOwed || 0);
            }, 0);
            const catEquity = catValue - catOwed;
            const isCredit = cat.key === 'credit';

            return `
            <div class="card mb-24 mt-16">
                <div class="settings-section">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h3 style="margin:0;">${cat.icon} ${cat.label}</h3>
                        <span style="font-size:13px;font-weight:600;color:${catEquity >= 0 ? 'var(--green)' : 'var(--red)'};">
                            ${isCredit ? formatCurrency(catOwed) + ' owed' : formatCurrency(catEquity) + ' equity'}
                        </span>
                    </div>
                    ${catAssets.map(a => {
                        const linkedDebt = a.linkedDebtId ? debts.find(d => d.id === a.linkedDebtId) : null;
                        const isLinked = !!a.linkedDebtId;
                        const owed = a.type === 'credit' ? a.balance : (a.amountOwed || 0);
                        const equity = a.type === 'credit' ? 0 : (a.balance - owed);
                        const updated = a.lastUpdated ? new Date(a.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                        const typeLabel = TYPE_LABELS[a.type] || a.type;

                        return `
                        <div class="settings-row" style="flex-wrap:wrap;">
                            <div style="flex:1;min-width:150px;">
                                <div class="setting-label">
                                    ${escapeHtml(a.name)}
                                    ${isLinked ? '<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)40;border-radius:4px;vertical-align:middle;">&#128279; Linked</span>' : ''}
                                    ${a.plaidAccountId ? '<span style="display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;background:var(--green-bg);color:var(--green);border:1px solid var(--green);border-radius:4px;vertical-align:middle;">&#127974;</span>' : ''}
                                </div>
                                <div class="setting-desc">
                                    ${typeLabel}${updated ? ' &middot; Updated ' + updated : ''}${linkedDebt ? ' &middot; ' + linkedDebt.interestRate.toFixed(1) + '% APR' : ''}${linkedDebt && linkedDebt.minimumPayment > 0 ? ' &middot; ' + formatCurrency(linkedDebt.minimumPayment) + ' min' : ''}
                                </div>
                            </div>
                            <div class="flex-align-center gap-8">
                                ${a.type === 'credit' ? `
                                    <span class="text-red" style="font-size:16px;font-weight:700;">-${formatCurrency(a.balance)}</span>
                                ` : `
                                    <div style="text-align:right;">
                                        <div class="text-green" style="font-size:15px;font-weight:700;">${formatCurrency(a.balance)}</div>
                                        ${owed > 0 ? `<div class="text-red" style="font-size:11px;">Owed: ${formatCurrency(owed)}</div>` : ''}
                                        ${owed > 0 || a.type !== 'investment' && a.type !== 'retirement' ? `<div class="${equity >= 0 ? 'text-green' : 'text-red'}" style="font-size:12px;font-weight:600;">Equity: ${formatCurrency(equity)}</div>` : ''}
                                    </div>
                                `}
                                <button class="btn-icon edit-asset-btn" data-account-id="${a.id}" title="Edit">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button class="btn-icon delete-asset-btn" data-account-id="${a.id}" title="Delete" style="color:var(--red);">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
            `;
        }).join('')}

        ` : `
        <div class="card" style="text-align:center;padding:48px 24px;margin-top:24px;">
            <div style="font-size:48px;margin-bottom:16px;">🏦</div>
            <h3 class="mb-8">No assets tracked yet</h3>
            <p style="color:var(--text-muted);margin-bottom:24px;">Add your property, vehicles, equipment, investments, and credit cards to see your full asset picture.</p>
            <button class="btn btn-primary" id="empty-add-asset">+ Add Asset</button>
        </div>
        `}
    `;

    // === Event Handlers ===

    // Tab switching
    container.querySelectorAll('.filters .filter-chip[data-tab]').forEach(chip => {
        chip.addEventListener('click', () => {
            const tab = chip.dataset.tab;
            if (tab === 'assets') {
                window.location.hash = 'income/assets';
            } else if (tab === 'income') {
                window.location.hash = 'income';
            } else {
                window.location.hash = `income/${tab}`;
            }
        });
    });

    // Add asset button (header)
    const addAssetBtn = container.querySelector('#add-asset-btn');
    if (addAssetBtn) {
        addAssetBtn.addEventListener('click', () => {
            showAssetForm(store);
        });
    }

    // Add asset button (empty state)
    const emptyAddAsset = container.querySelector('#empty-add-asset');
    if (emptyAddAsset) {
        emptyAddAsset.addEventListener('click', () => {
            showAssetForm(store);
        });
    }

    // Edit asset
    container.querySelectorAll('.edit-asset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = allAccounts.find(a => a.id === btn.dataset.accountId);
            if (account) showAccountForm(store, account);
        });
    });

    // Delete asset
    container.querySelectorAll('.delete-asset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const account = allAccounts.find(a => a.id === btn.dataset.accountId);
            const hasLink = account && account.linkedDebtId;
            const msg = hasLink
                ? 'Delete this asset? This will also remove the linked debt and its payment bill.'
                : 'Delete this asset?';
            if (confirm(msg)) {
                store.deleteAccount(btn.dataset.accountId);
                refreshPage();
            }
        });
    });
}

// Show asset form — wraps showAccountForm with pre-filtered asset types
function showAssetForm(store) {
    // Use the accounts showAccountForm but default to 'property' type
    showAccountForm(store, null);
}
