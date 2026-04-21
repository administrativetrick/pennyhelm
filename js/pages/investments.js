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
import { openModal, closeModal, showToast } from '../services/modal-manager.js';
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

// Pattern for cash holdings that Plaid reports with positive values but which
// semantically represent a liability (margin debit balance, cash loan, etc.).
// ETrade's "Margin Debit" position is the canonical example. We use this to
// *suggest* the "Treat as liability" toggle in the override modal — we never
// auto-flip the sign without user confirmation.
const LIABILITY_CASH_NAME_RE = /\b(margin|debit|loan|borrow)\b/i;

function looksLikeLiabilityCash(holding) {
    const type = (holding.type || '').toLowerCase();
    if (type !== 'cash') return false;
    const name = (holding.name || '').toString();
    return LIABILITY_CASH_NAME_RE.test(name);
}

/**
 * Collect every holding across every investment/retirement account,
 * carrying the parent account forward so per-account breakdowns work.
 *
 * Applies two corrections that can be stacked (override wins over vested):
 *   1. If the holding has `vestedQuantity` (Plaid reports this for some
 *      RSU/grant-style positions), prefer it over the raw `quantity`. The raw
 *      quantity often reflects the full grant rather than the currently held
 *      shares after vesting + sales. `vestedValue` replaces value when present.
 *   2. If the user has set a per-holding override on the account
 *      (`account.holdingOverrides[securityId]`), apply it:
 *        - `excluded: true` removes the holding from totals entirely
 *        - `quantity: N` pins the share count; value + costBasis scale
 *          proportionally (preferring price * qty when price is known)
 *
 * Every adjusted holding gets `_adjusted: true` so the UI can badge it, and
 * every holding carries `_accountId` / `_securityId` / `_accountName` so rows
 * link back to the underlying Plaid record.
 */
function collectHoldings(accounts) {
    const out = [];
    for (const a of accounts) {
        if (a.type !== 'investment' && a.type !== 'retirement') continue;
        if (!Array.isArray(a.holdings)) continue;
        const overrides = a.holdingOverrides || {};
        for (const h of a.holdings) {
            const override = overrides[h.securityId];

            // 1. Explicit exclude — drop entirely.
            if (override && override.excluded) continue;

            let quantity = Number(h.quantity) || 0;
            let value = Number(h.value) || 0;
            let costBasis = h.costBasis != null ? Number(h.costBasis) : null;
            let adjusted = false;
            let adjustmentReason = null;

            // 2. Prefer vested_quantity when Plaid reports it and it differs.
            if (h.vestedQuantity != null && Number(h.vestedQuantity) !== quantity) {
                const vQty = Number(h.vestedQuantity) || 0;
                // Scale value and cost basis proportionally.
                if (quantity > 0) {
                    if (costBasis != null) costBasis = (vQty / quantity) * costBasis;
                    value = h.vestedValue != null ? Number(h.vestedValue) : (vQty / quantity) * value;
                } else {
                    value = h.vestedValue != null ? Number(h.vestedValue) : 0;
                }
                quantity = vQty;
                adjusted = true;
                adjustmentReason = 'vested';
            }

            // 3. User override wins over everything.
            if (override && override.quantity != null) {
                const newQty = Number(override.quantity) || 0;
                const origQty = Number(h.quantity) || 0;
                const origValue = Number(h.value) || 0;
                const origCostBasis = h.costBasis != null ? Number(h.costBasis) : null;
                // Prefer price * qty when price is available — cleaner than
                // proportional scaling and reflects today's market value.
                if (h.price != null) {
                    value = newQty * Number(h.price);
                } else if (origQty > 0) {
                    value = (newQty / origQty) * origValue;
                } else {
                    value = 0;
                }
                if (origCostBasis != null && origQty > 0) {
                    costBasis = (newQty / origQty) * origCostBasis;
                }
                quantity = newQty;
                adjusted = true;
                adjustmentReason = 'override';
            }

            // 4. "Treat as liability" flips sign on positive values.
            //     Used for margin-debit cash positions that Plaid reports
            //     as positive numbers but which semantically represent debt.
            if (override && override.treatAsLiability) {
                if (value > 0) value = -value;
                if (quantity > 0) quantity = -quantity;
                if (costBasis != null && costBasis > 0) costBasis = -costBasis;
                adjusted = true;
                adjustmentReason = adjustmentReason || 'liability';
            }

            out.push({
                ...h,
                quantity,
                value,
                costBasis,
                _accountId: a.id,
                _accountName: a.name,
                _securityId: h.securityId,
                _origQuantity: Number(h.quantity) || 0,
                _adjusted: adjusted,
                _adjustmentReason: adjustmentReason, // 'vested' | 'override' | 'liability' | null
                _override: override || null,
            });
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
            adjusted: false, // true if any underlying holding was overridden/vested-adjusted
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
        if (h._adjusted) entry.adjusted = true;
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
        const adjBadge = t.adjusted
            ? `<span title="One or more positions adjusted — edit in the By Account section below" style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:10px;font-weight:600;color:var(--orange);background:var(--orange-bg,#fff7ed);border:1px solid var(--orange);border-radius:10px;vertical-align:middle;">Adjusted</span>`
            : '';
        return `
            <tr>
                <td>
                    <div style="font-weight:600;">${t.ticker ? escapeHtml(t.ticker) : '—'}${adjBadge}</div>
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

/**
 * Renders per-account breakdown. Each row gets a pencil button to edit/override
 * that specific (account, security) holding. Excluded holdings still appear here
 * dimmed so the user can un-exclude them — they're filtered out of totals but
 * kept visible here as a UX affordance.
 */
function renderPerAccount(accounts) {
    const invAccounts = accounts.filter(a =>
        (a.type === 'investment' || a.type === 'retirement') && Array.isArray(a.holdings) && a.holdings.length > 0
    );
    if (invAccounts.length === 0) return '';

    const sections = invAccounts.map(a => {
        const overrides = a.holdingOverrides || {};
        // Build per-row adjusted holdings (apply vested + overrides) but keep
        // excluded rows visible so they can be toggled back on.
        const adjustedRows = a.holdings.map(h => {
            const override = overrides[h.securityId];
            let quantity = Number(h.quantity) || 0;
            let value = Number(h.value) || 0;
            let costBasis = h.costBasis != null ? Number(h.costBasis) : null;
            let adjusted = false;

            if (h.vestedQuantity != null && Number(h.vestedQuantity) !== quantity) {
                const vQty = Number(h.vestedQuantity) || 0;
                if (quantity > 0) {
                    if (costBasis != null) costBasis = (vQty / quantity) * costBasis;
                    value = h.vestedValue != null ? Number(h.vestedValue) : (vQty / quantity) * value;
                } else {
                    value = h.vestedValue != null ? Number(h.vestedValue) : 0;
                }
                quantity = vQty;
                adjusted = true;
            }
            if (override && override.quantity != null) {
                const newQty = Number(override.quantity) || 0;
                const origQty = Number(h.quantity) || 0;
                const origValue = Number(h.value) || 0;
                const origCostBasis = h.costBasis != null ? Number(h.costBasis) : null;
                if (h.price != null) value = newQty * Number(h.price);
                else if (origQty > 0) value = (newQty / origQty) * origValue;
                else value = 0;
                if (origCostBasis != null && origQty > 0) costBasis = (newQty / origQty) * origCostBasis;
                quantity = newQty;
                adjusted = true;
            }
            // Flip sign for "treat as liability" positions (e.g. margin debit).
            if (override && override.treatAsLiability) {
                if (value > 0) value = -value;
                if (quantity > 0) quantity = -quantity;
                if (costBasis != null && costBasis > 0) costBasis = -costBasis;
                adjusted = true;
            }
            const excluded = !!(override && override.excluded);
            const isLiability = !!(override && override.treatAsLiability);
            return { h, quantity, value, costBasis, adjusted, excluded, isLiability, override };
        });

        // Total excludes "excluded" rows.
        const accountValue = adjustedRows
            .filter(r => !r.excluded)
            .reduce((s, r) => s + (Number(r.value) || 0), 0);
        const activeCount = adjustedRows.filter(r => !r.excluded).length;

        const rows = adjustedRows
            .sort((r1, r2) => {
                if (r1.excluded !== r2.excluded) return r1.excluded ? 1 : -1; // excluded last
                return (r2.value || 0) - (r1.value || 0);
            })
            .map(({ h, quantity, value, costBasis, adjusted, excluded, isLiability }) => {
                const gain = (value != null && costBasis != null) ? value - costBasis : null;
                const gainColor = gain == null ? 'var(--text-secondary)' : gain >= 0 ? 'var(--green)' : 'var(--red)';
                const gainSign = gain == null ? '' : gain >= 0 ? '+' : '';
                const rowStyle = excluded ? 'opacity:0.5;' : '';
                const adjBadge = excluded
                    ? `<span title="Excluded from totals" style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:10px;font-weight:600;color:var(--text-muted);background:var(--bg-input);border:1px solid var(--border);border-radius:10px;vertical-align:middle;">Excluded</span>`
                    : isLiability
                    ? `<span title="Treated as a liability — value shown as negative" style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:10px;font-weight:600;color:var(--red);background:var(--red-bg,#fef2f2);border:1px solid var(--red);border-radius:10px;vertical-align:middle;">Liability</span>`
                    : adjusted
                    ? `<span title="Quantity adjusted" style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:10px;font-weight:600;color:var(--orange);background:var(--orange-bg,#fff7ed);border:1px solid var(--orange);border-radius:10px;vertical-align:middle;">Adjusted</span>`
                    : '';
                return `
                    <tr style="${rowStyle}">
                        <td>
                            <div style="font-weight:600;">${h.ticker ? escapeHtml(h.ticker) : '—'}${adjBadge}</div>
                            <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(h.name || '')}</div>
                        </td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;">${quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;">${h.price != null ? formatCurrency(h.price) : '—'}</td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${excluded ? '—' : formatCurrency(value || 0)}</td>
                        <td style="text-align:right;font-variant-numeric:tabular-nums;color:${gainColor};">
                            ${excluded || gain == null ? '—' : `${gainSign}${formatCurrency(gain)}`}
                        </td>
                        <td style="text-align:right;">
                            <button class="btn-icon edit-holding-btn"
                                data-account-id="${escapeHtml(a.id)}"
                                data-security-id="${escapeHtml(h.securityId)}"
                                title="Adjust this holding"
                                style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;color:var(--text-secondary);font-size:12px;">
                                Edit
                            </button>
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
                        &middot; ${activeCount} position${activeCount === 1 ? '' : 's'}
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
                                <th style="text-align:right;"></th>
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
        <p style="font-size:12px;color:var(--text-muted);margin-top:-8px;margin-bottom:16px;">
            If an institution reports the wrong share count (common for RSU grants), click Edit to pin the correct quantity. Manual adjustments survive daily refreshes.
        </p>
        ${sections}
    `;
}

/**
 * Show the "Adjust Holding" modal for a single (account, security) pair.
 * Lets the user pin a new quantity, exclude the holding from totals, or reset
 * to the institution-reported number.
 */
function openHoldingOverrideModal(store, accountId, securityId) {
    const account = store.getAccounts().find(a => a.id === accountId);
    if (!account) return;
    const holding = (account.holdings || []).find(h => h.securityId === securityId);
    if (!holding) return;
    const override = (account.holdingOverrides || {})[securityId] || {};

    const reportedQty = Number(holding.quantity) || 0;
    const vestedQty = holding.vestedQuantity != null ? Number(holding.vestedQuantity) : null;
    const currentQty = override.quantity != null ? Number(override.quantity)
                     : vestedQty != null ? vestedQty
                     : reportedQty;
    const isExcluded = !!override.excluded;
    // Default to true if the user hasn't made a choice yet AND the holding
    // looks like a margin/debit-style cash position. Once they save anything,
    // their explicit choice wins forever.
    const hasMadeChoice = Object.prototype.hasOwnProperty.call(override, 'treatAsLiability');
    const suggestLiability = !hasMadeChoice && looksLikeLiabilityCash(holding);
    const isLiability = hasMadeChoice ? !!override.treatAsLiability : suggestLiability;
    const label = holding.ticker ? `${holding.ticker} — ${holding.name || ''}` : (holding.name || 'Holding');

    const vestedHint = vestedQty != null && vestedQty !== reportedQty
        ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
               Institution reports <strong>${reportedQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> granted,
               <strong>${vestedQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> vested.
           </div>`
        : `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
               Institution reports <strong>${reportedQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> ${(holding.type || '').toLowerCase() === 'cash' ? 'units' : 'shares'}.
           </div>`;

    const liabilitySuggestion = suggestLiability
        ? `<div style="font-size:11px;color:var(--orange);margin-top:4px;margin-left:24px;">
               Looks like a margin/debit position — we suggest treating this as a liability.
           </div>`
        : '';

    openModal('Adjust Holding', `
        <div style="margin-bottom:16px;">
            <div style="font-size:13px;color:var(--text-muted);margin-bottom:4px;">${escapeHtml(account.name)}</div>
            <div style="font-weight:600;font-size:15px;">${escapeHtml(label)}</div>
            ${vestedHint}
        </div>
        <div class="form-group">
            <label>${(holding.type || '').toLowerCase() === 'cash' ? 'Amount you hold' : 'Shares you actually hold'}</label>
            <input type="number" step="0.0001" min="0" class="form-input" id="override-qty-input"
                   value="${currentQty}" ${isExcluded ? 'disabled' : ''}>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                Leave as-is to accept the institution's number. Changes survive Plaid refreshes.
            </div>
        </div>
        <div class="form-group" style="margin-top:12px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="override-liability-input" ${isLiability ? 'checked' : ''}>
                <span>Treat as a liability (show value as negative)</span>
            </label>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;margin-left:24px;">
                Useful for margin debit balances and cash loans that brokerages report as positive amounts.
            </div>
            ${liabilitySuggestion}
        </div>
        <div class="form-group" style="margin-top:12px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="override-exclude-input" ${isExcluded ? 'checked' : ''}>
                <span>Exclude this holding from portfolio totals</span>
            </label>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;margin-left:24px;">
                Useful for unvested grants you don't want to count yet.
            </div>
        </div>
        <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">
            ${(override.quantity != null || override.excluded || override.treatAsLiability)
                ? `<button class="btn btn-secondary" id="override-reset-btn" style="margin-right:auto;">Reset to institution</button>`
                : ''}
            <button class="btn btn-secondary" id="override-cancel-btn">Cancel</button>
            <button class="btn btn-primary" id="override-save-btn">Save</button>
        </div>
    `);

    const qtyInput = document.getElementById('override-qty-input');
    const excludeInput = document.getElementById('override-exclude-input');
    const liabilityInput = document.getElementById('override-liability-input');
    excludeInput.addEventListener('change', () => {
        qtyInput.disabled = excludeInput.checked;
        if (excludeInput.checked && liabilityInput) liabilityInput.disabled = true;
        else if (liabilityInput) liabilityInput.disabled = false;
    });

    document.getElementById('override-cancel-btn').addEventListener('click', closeModal);

    const resetBtn = document.getElementById('override-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            store.clearHoldingOverride(accountId, securityId);
            closeModal();
            showToast('Reset to institution-reported values', 'info');
            refreshPage();
        });
    }

    document.getElementById('override-save-btn').addEventListener('click', () => {
        const excluded = excludeInput.checked;
        const treatAsLiability = !excluded && liabilityInput.checked;
        const qtyValue = parseFloat(qtyInput.value);
        const patch = { excluded, treatAsLiability };

        if (!excluded) {
            if (!Number.isFinite(qtyValue) || qtyValue < 0) {
                showToast('Enter a valid amount.', 'error');
                return;
            }
            // If the entered quantity matches the institution's AND no other
            // flag is set, treat it as "no override" and clear instead.
            const matchesReported = qtyValue === reportedQty && (vestedQty == null || vestedQty === reportedQty);
            if (matchesReported && !treatAsLiability) {
                store.clearHoldingOverride(accountId, securityId);
                closeModal();
                showToast('Override cleared', 'info');
                refreshPage();
                return;
            }
            // Only store quantity if it actually differs from the institution's
            // number — that way the liability flag can persist on its own.
            if (!matchesReported) patch.quantity = qtyValue;
        } else {
            // When excluding, preserve any quantity that was already set so
            // re-enabling brings it back.
            if (override.quantity != null) patch.quantity = override.quantity;
        }

        store.setHoldingOverride(accountId, securityId, patch);
        closeModal();
        showToast(treatAsLiability ? 'Marked as liability' : 'Holding adjusted', 'success');
        refreshPage();
    });
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

    // Edit pencil on per-account holding rows → open override modal.
    container.querySelectorAll('.edit-holding-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const accountId = btn.getAttribute('data-account-id');
            const securityId = btn.getAttribute('data-security-id');
            openHoldingOverrideModal(store, accountId, securityId);
        });
    });
}
