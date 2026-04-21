/**
 * Investments — portfolio view across all linked investment/retirement accounts.
 *
 * The heavy lifting already happens on the server: on every Plaid link +
 * balance refresh, `functions/plaid.js` calls `investmentsHoldingsGet` and
 * attaches each holding (with security metadata — name, ticker, type, price,
 * quantity, value, cost basis) to the account document under `account.holdings`.
 *
 * This page aggregates those holdings three ways:
 *   1. Portfolio summary (total value, total cost basis, unrealized gain/loss)
 *   2. Asset allocation by security type (equity / etf / mutual fund / bond /
 *      cash / other) — shown as stacked percentage bars
 *   3. A ticker-level table that sums positions across accounts (if you hold
 *      AAPL in a 401k AND a taxable brokerage, you see one row with the combined
 *      share count), plus a per-account breakdown below it.
 *
 * Empty state when no account has holdings points the user at Accounts to
 * connect a brokerage.
 */

import { formatCurrency, escapeHtml } from '../utils.js';
import { refreshPage } from '../app.js';
import { capabilities } from '../mode/mode.js';
import { hasPlaidConnections } from '../plaid.js';

// Security-type buckets for the allocation chart. Plaid's security `type`
// values map roughly onto these — anything unmatched falls into "Other".
const TYPE_BUCKETS = [
    { key: 'equity',       label: 'Stocks',        color: '#22c55e', match: ['equity'] },
    { key: 'etf',          label: 'ETFs',          color: '#3b82f6', match: ['etf'] },
    { key: 'mutual fund',  label: 'Mutual Funds',  color: '#8b5cf6', match: ['mutual fund', 'mutual_fund'] },
    { key: 'fixed income', label: 'Bonds',         color: '#f59e0b', match: ['fixed income', 'fixed_income', 'bond'] },
    { key: 'cash',         label: 'Cash',          color: '#64748b', match: ['cash'] },
    { key: 'derivative',   label: 'Derivatives',   color: '#ec4899', match: ['derivative'] },
    { key: 'other',        label: 'Other',         color: '#94a3b8', match: [] }, // catch-all
];

function bucketForType(rawType) {
    const t = (rawType || '').toLowerCase();
    for (const b of TYPE_BUCKETS) {
        if (b.match.some(m => t === m)) return b;
    }
    return TYPE_BUCKETS[TYPE_BUCKETS.length - 1]; // "Other"
}

/**
 * Collect every holding across every investment/retirement account,
 * carrying the parent account forward so per-account breakdowns work.
 */
function collectHoldings(accounts) {
    const out = [];
    for (const a of accounts) {
        if (a.type !== 'investment' && a.type !== 'retirement') continue;
        if (!Array.isArray(a.holdings)) continue;
        for (const h of a.holdings) {
            out.push({ ...h, _accountId: a.id, _accountName: a.name });
        }
    }
    return out;
}

/**
 * Group holdings by ticker (or securityId when the security has no ticker,
 * e.g. collective-investment funds inside a 401k). Sums quantities, values,
 * and cost basis across accounts.
 */
function aggregateByTicker(holdings) {
    const map = new Map();
    for (const h of holdings) {
        const key = h.ticker || `sec:${h.securityId}`;
        const entry = map.get(key) || {
            key,
            ticker: h.ticker || null,
            name: h.name,
            type: h.type,
            quantity: 0,
            value: 0,
            costBasis: 0,
            costBasisKnown: false, // Plaid returns null for some securities
            accounts: new Set(),
            // Take the most recent price we see; they should all match for the
            // same security, but defensively pick any non-null.
            price: null,
            priceDate: null,
        };
        entry.quantity += Number(h.quantity) || 0;
        entry.value += Number(h.value) || 0;
        if (h.costBasis != null) {
            entry.costBasis += Number(h.costBasis) || 0;
            entry.costBasisKnown = true;
        }
        if (h.price != null && entry.price == null) {
            entry.price = h.price;
            entry.priceDate = h.priceDate;
        }
        entry.accounts.add(h._accountName);
        map.set(key, entry);
    }
    return Array.from(map.values()).map(e => ({
        ...e,
        accounts: Array.from(e.accounts),
        gain: e.costBasisKnown ? e.value - e.costBasis : null,
        gainPct: e.costBasisKnown && e.costBasis > 0 ? ((e.value - e.costBasis) / e.costBasis) * 100 : null,
    }));
}

/** Sum value by bucket for the allocation chart. */
function aggregateByBucket(holdings) {
    const sums = {};
    let total = 0;
    for (const h of holdings) {
        const bucket = bucketForType(h.type);
        sums[bucket.key] = (sums[bucket.key] || 0) + (Number(h.value) || 0);
        total += Number(h.value) || 0;
    }
    return TYPE_BUCKETS
        .map(b => ({ ...b, value: sums[b.key] || 0, pct: total > 0 ? ((sums[b.key] || 0) / total) * 100 : 0 }))
        .filter(b => b.value > 0);
}

function renderSummaryCards(totalValue, totalCostBasis, costBasisKnown, accountCount, holdingCount) {
    const gain = costBasisKnown ? totalValue - totalCostBasis : null;
    const gainPct = costBasisKnown && totalCostBasis > 0 ? (gain / totalCostBasis) * 100 : null;
    const gainColor = gain == null ? 'var(--text-secondary)' : gain >= 0 ? 'var(--green)' : 'var(--red)';
    const gainSign = gain == null ? '' : gain >= 0 ? '+' : '';

    return `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Portfolio Value</div>
                <div class="stat-value">${formatCurrency(totalValue)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                    ${accountCount} account${accountCount === 1 ? '' : 's'} &middot; ${holdingCount} position${holdingCount === 1 ? '' : 's'}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Cost Basis</div>
                <div class="stat-value">${costBasisKnown ? formatCurrency(totalCostBasis) : '—'}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                    ${costBasisKnown ? 'Total invested' : 'Not reported by institution'}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Unrealized Gain/Loss</div>
                <div class="stat-value" style="color:${gainColor};">
                    ${gain == null ? '—' : `${gainSign}${formatCurrency(gain)}`}
                </div>
                <div style="font-size:11px;color:${gainColor};margin-top:4px;">
                    ${gainPct == null ? '' : `${gainSign}${gainPct.toFixed(2)}%`}
                </div>
            </div>
        </div>
    `;
}

function renderAllocationChart(buckets, totalValue) {
    if (buckets.length === 0) return '';
    // Stacked horizontal bar: each bucket gets a segment proportional to its value.
    const segments = buckets
        .map(b => `<span style="display:inline-block;height:100%;width:${b.pct}%;background:${b.color};" title="${b.label} — ${b.pct.toFixed(1)}%"></span>`)
        .join('');
    const legend = buckets
        .map(b => `
            <div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 0;">
                <span style="width:10px;height:10px;border-radius:2px;background:${b.color};flex-shrink:0;"></span>
                <span style="flex:1;color:var(--text-primary);">${b.label}</span>
                <span style="color:var(--text-muted);font-variant-numeric:tabular-nums;">${b.pct.toFixed(1)}%</span>
                <span style="color:var(--text-secondary);font-variant-numeric:tabular-nums;min-width:80px;text-align:right;">${formatCurrency(b.value)}</span>
            </div>
        `)
        .join('');
    return `
        <div class="card mb-24">
            <h3 class="mb-16">Asset Allocation</h3>
            <div style="display:flex;height:14px;width:100%;border-radius:7px;overflow:hidden;background:var(--bg-input);">
                ${segments}
            </div>
            <div style="margin-top:14px;">${legend}</div>
        </div>
    `;
}

function renderHoldingsTable(tickers, totalValue) {
    if (tickers.length === 0) return '';

    // Sort by value desc — biggest positions first.
    tickers.sort((a, b) => (b.value || 0) - (a.value || 0));

    const rows = tickers.map(t => {
        const pct = totalValue > 0 ? ((t.value || 0) / totalValue) * 100 : 0;
        const gainColor = t.gain == null ? 'var(--text-secondary)' : t.gain >= 0 ? 'var(--green)' : 'var(--red)';
        const gainSign = t.gain == null ? '' : t.gain >= 0 ? '+' : '';
        const bucket = bucketForType(t.type);
        const accountBadges = t.accounts.map(n =>
            `<span class="tag-pill" style="background:var(--bg-card);font-size:10px;">${escapeHtml(n)}</span>`
        ).join(' ');
        return `
            <tr>
                <td>
                    <div style="font-weight:600;">${t.ticker ? escapeHtml(t.ticker) : '—'}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escapeHtml(t.name || '')}</div>
                </td>
                <td><span class="badge" style="background:${bucket.color}20;color:${bucket.color};border:1px solid ${bucket.color}40;">${bucket.label}</span></td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${t.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${t.price != null ? formatCurrency(t.price) : '—'}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${formatCurrency(t.value)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted);">${pct.toFixed(1)}%</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${t.costBasisKnown ? formatCurrency(t.costBasis) : '—'}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;color:${gainColor};">
                    ${t.gain == null ? '—' : `${gainSign}${formatCurrency(t.gain)}`}
                    ${t.gainPct == null ? '' : `<div style="font-size:11px;">${gainSign}${t.gainPct.toFixed(2)}%</div>`}
                </td>
                <td style="white-space:nowrap;">${accountBadges}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card mb-24">
            <h3 class="mb-16">Holdings</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Symbol / Name</th>
                            <th>Type</th>
                            <th style="text-align:right;">Shares</th>
                            <th style="text-align:right;">Price</th>
                            <th style="text-align:right;">Value</th>
                            <th style="text-align:right;">% Portfolio</th>
                            <th style="text-align:right;">Cost Basis</th>
                            <th style="text-align:right;">Gain/Loss</th>
                            <th>Accounts</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function renderPerAccount(accounts) {
    const invAccounts = accounts.filter(a =>
        (a.type === 'investment' || a.type === 'retirement') && Array.isArray(a.holdings) && a.holdings.length > 0
    );
    if (invAccounts.length === 0) return '';

    const sections = invAccounts.map(a => {
        const accountValue = a.holdings.reduce((s, h) => s + (Number(h.value) || 0), 0);
        const rows = [...a.holdings]
            .sort((h1, h2) => (h2.value || 0) - (h1.value || 0))
            .map(h => {
                const gain = (h.value != null && h.costBasis != null) ? h.value - h.costBasis : null;
                const gainColor = gain == null ? 'var(--text-secondary)' : gain >= 0 ? 'var(--green)' : 'var(--red)';
                const gainSign = gain == null ? '' : gain >= 0 ? '+' : '';
                return `
                    <tr>
                        <td>
                            <div style="font-weight:600;">${h.ticker ? escapeHtml(h.ticker) : '—'}</div>
                            <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(h.name || '')}</div>
                        </td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;">${(Number(h.quantity) || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;">${h.price != null ? formatCurrency(h.price) : '—'}</td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${formatCurrency(h.value || 0)}</td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;color:${gainColor};">
                            ${gain == null ? '—' : `${gainSign}${formatCurrency(gain)}`}
                        </td>
                    </tr>
                `;
            }).join('');
        return `
            <div class="card mb-16">
                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px;">
                    <h3 style="margin:0;">${escapeHtml(a.name)}</h3>
                    <div style="font-size:14px;color:var(--text-secondary);">
                        <span style="font-weight:600;color:var(--text-primary);">${formatCurrency(accountValue)}</span>
                        &middot; ${a.holdings.length} position${a.holdings.length === 1 ? '' : 's'}
                        ${a.plaidInstitution ? ` &middot; ${escapeHtml(a.plaidInstitution)}` : ''}
                    </div>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Symbol / Name</th>
                                <th style="text-align:right;">Shares</th>
                                <th style="text-align:right;">Price</th>
                                <th style="text-align:right;">Value</th>
                                <th style="text-align:right;">Gain/Loss</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');

    return `
        <h3 class="mb-16" style="margin-top:32px;">By Account</h3>
        ${sections}
    `;
}

function renderEmptyState(canUsePlaid) {
    const plaidHint = canUsePlaid
        ? `<p style="color:var(--text-secondary);margin-bottom:24px;">Connect a brokerage, IRA, or 401(k) from the Accounts page and your holdings will appear here automatically.</p>
           <a href="#accounts" class="btn btn-primary">Go to Accounts</a>`
        : `<p style="color:var(--text-secondary);margin-bottom:24px;">Investment holdings are tracked automatically when you link a brokerage account via Plaid. Set up Plaid in Settings to get started.</p>
           <a href="#settings" class="btn btn-primary">Go to Settings</a>`;
    return `
        <div class="card" style="text-align:center;padding:48px 24px;">
            <div style="font-size:48px;margin-bottom:16px;">📈</div>
            <h3 class="mb-8">No investment holdings yet</h3>
            ${plaidHint}
        </div>
    `;
}

export function renderInvestments(container, store) {
    const accounts = store.getAccounts();
    const invAccounts = accounts.filter(a => a.type === 'investment' || a.type === 'retirement');
    const allHoldings = collectHoldings(accounts);
    const canUsePlaid = capabilities().plaid;
    const hasPlaid = hasPlaidConnections(store);

    const header = `
        <div class="page-header">
            <div>
                <h1 class="page-title">Investments</h1>
                <div class="subtitle">Holdings across every linked brokerage and retirement account</div>
            </div>
            ${hasPlaid ? `<button class="btn btn-secondary btn-sm" id="refresh-holdings-btn" title="Fetch latest prices and positions">Refresh</button>` : ''}
        </div>
    `;

    if (allHoldings.length === 0) {
        container.innerHTML = `
            ${header}
            ${renderEmptyState(canUsePlaid)}
        `;
        return;
    }

    const totalValue = allHoldings.reduce((s, h) => s + (Number(h.value) || 0), 0);
    const costBasisHoldings = allHoldings.filter(h => h.costBasis != null);
    const totalCostBasis = costBasisHoldings.reduce((s, h) => s + (Number(h.costBasis) || 0), 0);
    // Only claim a cost basis if the institution reported one for a meaningful
    // share of the portfolio. Under 10% coverage is useless and misleading.
    const costBasisCoverage = totalValue > 0
        ? costBasisHoldings.reduce((s, h) => s + (Number(h.value) || 0), 0) / totalValue
        : 0;
    const costBasisKnown = costBasisCoverage >= 0.10;

    const tickers = aggregateByTicker(allHoldings);
    const buckets = aggregateByBucket(allHoldings);

    container.innerHTML = `
        ${header}
        ${renderSummaryCards(totalValue, totalCostBasis, costBasisKnown, invAccounts.length, allHoldings.length)}
        ${renderAllocationChart(buckets, totalValue)}
        ${renderHoldingsTable(tickers, totalValue)}
        ${renderPerAccount(accounts)}
    `;

    const refreshBtn = container.querySelector('#refresh-holdings-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing…';
            try {
                // Dynamic import to avoid pulling the Plaid client module in
                // selfhost where the "Refresh" button never renders anyway.
                const { refreshPlaidBalances } = await import('../plaid.js');
                await refreshPlaidBalances(store);
                refreshPage();
            } catch (e) {
                console.error('Failed to refresh holdings:', e);
                refreshBtn.disabled = false;
                refreshBtn.textContent = 'Refresh';
                alert('Could not refresh. Please try again.');
            }
        });
    }
}
