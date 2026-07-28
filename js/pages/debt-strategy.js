/**
 * Debt Repayment Strategy — an interactive payoff planner living under the
 * Debts section (#debts/strategy). Avalanche + scheduled lump sums with a
 * live chart, plus the Avalanche-vs-Snowball comparison. All math comes from
 * js/services/debt-strategy-service.js (unit-tested against the reference).
 */
import { formatCurrency, escapeHtml } from '../utils.js';
import { navigate, refreshPage } from '../app.js';
import { openModal, closeModal } from '../services/modal-manager.js';
import { showToast } from '../services/modal-manager.js';
import {
    prepareStrategyDebts, simulate, balanceSeries, allocateLumps, afterLumpsSummary,
    annualInterest, calculatePayoffStrategy, formatMonths, getDebtFreeDate,
} from '../services/debt-strategy-service.js';

const RATE_SCENARIOS = [
    { v: 'current', label: "Today's rates" },
    { v: '8', label: 'HELOC', sub: '~8%' },
    { v: '15', label: 'Consolidation', sub: '15%' },
    { v: '0', label: '0% transfer', sub: '0%' },
];

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : 'l' + Date.now() + Math.floor(Math.random() * 1e6));
const monthLabel = (offset) => { const d = new Date(); d.setMonth(d.getMonth() + offset); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };

// ── Chart: total balance over time with lump "cliffs" + debt-free dot ──────
function buildChartSVG(series) {
    const { points: pts, marks, payoffMonth, maxV } = series;
    if (!pts.length || maxV <= 0) return '';
    const W = 620, H = 250, pL = 8, pR = 12, pT = 14, pB = 26;
    const maxM = Math.max(payoffMonth, 6);
    const X = (mm) => pL + (mm / maxM) * (W - pL - pR);
    const Yv = (v) => pT + (1 - v / maxV) * (H - pT - pB);
    const baseY = Yv(0);
    let g = '';
    const step = maxV > 200000 ? 100000 : maxV > 120000 ? 50000 : maxV > 60000 ? 25000 : maxV > 20000 ? 10000 : 5000;
    for (let v = step; v < maxV; v += step) {
        const y = Yv(v).toFixed(1);
        g += `<line class="ds-chart-grid" x1="${pL}" y1="${y}" x2="${W - pR}" y2="${y}"/><text class="ds-chart-glbl" x="${pL + 2}" y="${(Yv(v) - 3).toFixed(1)}">$${Math.round(v / 1000)}k</text>`;
    }
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.m).toFixed(1)},${Yv(p.v).toFixed(1)}`).join(' ');
    const area = `M${X(0).toFixed(1)},${baseY.toFixed(1)} ` + pts.map((p) => `L${X(p.m).toFixed(1)},${Yv(p.v).toFixed(1)}`).join(' ') + ` L${X(payoffMonth).toFixed(1)},${baseY.toFixed(1)} Z`;
    g += `<path class="ds-chart-area" d="${area}"/><path class="ds-chart-line" d="${line}"/>`;
    marks.forEach((mk) => {
        const x = X(mk.m).toFixed(1);
        g += `<line class="ds-chart-lump" x1="${x}" y1="${pT}" x2="${x}" y2="${baseY.toFixed(1)}"/><text class="ds-chart-llbl" x="${(+x + 2).toFixed(1)}" y="${pT + 9}">${mk.l}</text>`;
    });
    const px = X(payoffMonth), py = baseY;
    g += `<circle class="ds-chart-po" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4"/>`;
    const la = px > W - 100 ? `text-anchor="end" x="${(px - 7).toFixed(1)}"` : `x="${(px + 7).toFixed(1)}"`;
    g += `<text class="ds-chart-polbl" ${la} y="${(py - 7).toFixed(1)}">debt-free ${monthLabel(payoffMonth)}</text>`;
    [0, Math.round(maxM / 2), maxM].forEach((mm, i) => {
        const d2 = new Date(); d2.setMonth(d2.getMonth() + mm);
        const lbl = d2.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        const an = i === 0 ? 'start' : (i === 2 ? 'end' : 'middle');
        g += `<text class="ds-chart-xlbl" text-anchor="${an}" x="${X(mm).toFixed(1)}" y="${H - 8}">${lbl}</text>`;
    });
    return g;
}

// ── Avalanche vs. Snowball comparison card (no lumps, at the monthly budget) ─
function comparisonHTML(includedStoreDebts, pay, cascade) {
    if (includedStoreDebts.length < 2) return '';
    const av = calculatePayoffStrategy(includedStoreDebts, pay, 'avalanche', cascade);
    const sn = calculatePayoffStrategy(includedStoreDebts, pay, 'snowball', cascade);
    if (av.monthsToPayoff === Infinity || sn.monthsToPayoff === Infinity) {
        return `<p class="ds-hint">At ${formatCurrency(pay)}/mo you can't cover every minimum — raise the monthly payment to compare avalanche vs snowball.</p>`;
    }
    const avSaves = sn.totalInterestPaid - av.totalInterestPaid;
    const card = (title, subtitle, res, active) => `
        <div class="ds-cmp-card${active ? ' active' : ''}">
            <div class="ds-cmp-head"><span class="ds-cmp-title">${title}</span>${active ? '<span class="ds-badge done">Active</span>' : ''}</div>
            <div class="ds-cmp-sub">${subtitle}</div>
            <div class="ds-cmp-row"><span>Time to payoff</span><b>${formatMonths(res.monthsToPayoff)}</b></div>
            <div class="ds-cmp-row"><span>Total interest</span><b class="ds-red">${formatCurrency(res.totalInterestPaid)}</b></div>
            <div class="ds-cmp-order">Payoff order<ol>${res.payoffOrder.slice(0, 8).map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ol></div>
        </div>`;
    return `
        <div class="ds-hint" style="margin-bottom:12px;">Comparing pure avalanche vs. snowball at your <b>${formatCurrency(pay)}/mo</b> payment (no lumps). ${avSaves > 0 ? `<span class="ds-green">Avalanche saves ${formatCurrency(avSaves)} in interest.</span>` : avSaves < 0 ? `<span class="ds-green">Snowball saves ${formatCurrency(-avSaves)} in interest.</span>` : 'Both cost the same in interest.'}</div>
        <div class="ds-cmp-grid">
            ${card('Avalanche', 'Pay highest interest first', av, true)}
            ${card('Snowball', 'Pay smallest balance first', sn, false)}
        </div>`;
}

export function renderDebtStrategy(container, store) {
    const cfg = store.getDebtStrategy();
    const allDebts = store.getDebts();
    const includeTypes = cfg.includeTypes; // null → default (credit cards) on first run
    const prep = prepareStrategyDebts(allDebts, cfg.perDebt, includeTypes);
    const includedStoreDebts = allDebts.filter((d) => prep.some((p) => p.id === d.id));
    const cascade = store.getDebtBudget().cascadeEnabled !== false;

    const total = prep.reduce((s, d) => s + d.bal, 0);
    const sumMin = prep.reduce((s, d) => s + d.minPayment, 0);
    const weightedApr = total > 0 ? prep.reduce((s, d) => s + d.apr * d.bal, 0) / total : 0;

    // Monthly payment: stored, else default to the sum of minimums.
    const defaultPay = Math.max(100, Math.round(sumMin) || Math.round(total * 0.02) || 200);
    let pay = cfg.monthlyPayment == null ? defaultPay : Number(cfg.monthlyPayment);
    const sliderMin = Math.max(50, Math.floor(Math.min(pay, sumMin || pay) / 50) * 50);
    const sliderMax = Math.max(6000, Math.ceil((pay * 2) / 500) * 500, Math.ceil((sumMin * 2) / 500) * 500);
    pay = Math.min(Math.max(pay, sliderMin), sliderMax);

    const lumps = cfg.lumps.slice()
        .map((l) => ({ id: l.id || uid(), m: Math.max(0, Math.trunc(Number(l.m) || 0)), amt: Math.max(0, Number(l.amt) || 0), label: l.label || '' }))
        .sort((a, b) => a.m - b.m);

    const rateScenario = cfg.rateScenario || 'current';
    const notes = cfg.notes || [];

    // ── Tab chips (shared with the Debts tab structure) ──
    const tabs = `
        <div class="filter-chips" style="margin-bottom:20px;">
            <button class="filter-chip" data-tab="debts">Debts</button>
            <button class="filter-chip" data-tab="expenses">Expenses</button>
            <button class="filter-chip active" data-tab="strategy">Repayment Strategy</button>
        </div>`;

    const STYLE = strategyStyles();

    if (prep.length === 0) {
        container.innerHTML = `<div class="debt-strategy">${STYLE}
            <div class="page-header"><div><h2>Debt Repayment Strategy</h2><div class="subtitle">Plan lump sums + monthly payments to clear your debt fastest</div></div></div>
            ${tabs}
            <div class="card"><p class="ds-lbl">No debts in the plan yet</p>
            <p style="color:var(--text-secondary);font-size:14px;">By default this plans your <b>credit cards</b>. Add a debt on the Debts tab, or include existing ones below.</p>
            ${debtsInPlanHTML(allDebts, cfg.perDebt, includeTypes)}
            </div></div>`;
        wireTabs(container);
        wireDebtsInPlan(container, store);
        return;
    }

    // ── Compute ──
    const ann = annualInterest(prep);
    const afterL = afterLumpsSummary(prep, lumps);
    const alloc = allocateLumps(prep, lumps);
    const cardsCleared = prep.length - alloc.remaining.length;

    container.innerHTML = `<div class="debt-strategy">${STYLE}
        <div class="page-header">
            <div><h2>Debt Repayment Strategy</h2>
            <div class="subtitle" id="ds-summary">${dsSummary(total, prep.length, ann, lumps.length, cardsCleared)}</div></div>
        </div>
        ${tabs}

        <div class="card">
            <p class="ds-lbl">Lump sums applied (avalanche — highest APR first)</p>
            <div class="ds-lumps" id="ds-lumpCards">${lumpCardsHTML(lumps)}</div>
            <div class="ds-results">
                <div class="ds-stat debt"><div class="k">Total debt</div><div class="v">${formatCurrency(total)}</div></div>
                <div class="ds-stat good"><div class="k">After all ${lumps.length || ''} lump${lumps.length === 1 ? '' : 's'}</div><div class="v">${formatCurrency(afterL.afterLumps)}</div></div>
                <div class="ds-stat"><div class="k">Interest killed/yr by lumps</div><div class="v">~${formatCurrency(afterL.interestKilled)}</div></div>
            </div>
        </div>

        <div class="card">
            <p class="ds-lbl">1 · Monthly payment (runs the whole time, alongside the lumps)</p>
            <div class="ds-ctrl-row"><span>Monthly payment</span><span class="ds-val" id="ds-payVal">${formatCurrency(pay)}</span></div>
            <input type="range" id="ds-pay" min="${sliderMin}" max="${sliderMax}" step="50" value="${pay}">
            <p class="ds-hint">${sumMin > 0 ? `~${formatCurrency(Math.round(sumMin))} is roughly your current card minimums — no new money needed.` : 'Set what you can put toward debt each month.'}</p>
            <p class="ds-lbl" style="margin-top:20px">2 · Interest rate while the lumps arrive</p>
            <div class="ds-seg" id="ds-rateSeg">
                ${RATE_SCENARIOS.map((r) => `<button data-rate="${r.v}" aria-pressed="${rateScenario === r.v}">${r.label}<span class="r">${r.v === 'current' ? `~${weightedApr.toFixed(0)}% avg` : r.sub}</span></button>`).join('')}
            </div>
            <p class="ds-hint" style="margin-top:9px">Preview a refinance: replacing every APR with a HELOC/consolidation/0% rate shows the interest you'd dodge while the lumps trickle in. <b>Balance-transfer &amp; consolidation rates need a healed credit score — treat them as Phase 2.</b></p>
        </div>

        <div class="card">
            <p class="ds-lbl">Your result — from today to debt-free</p>
            <div class="ds-results">
                <div class="ds-stat"><div class="k">Debt-free in</div><div class="v" id="ds-rMonths">–</div></div>
                <div class="ds-stat"><div class="k">Debt-free date</div><div class="v" id="ds-rDate">–</div></div>
                <div class="ds-stat debt"><div class="k">Interest from here</div><div class="v" id="ds-rInt">–</div></div>
                <div class="ds-stat"><div class="k">Total out of pocket</div><div class="v" id="ds-rTot">–</div></div>
            </div>
            <div id="ds-msg"></div>
        </div>

        <div class="card">
            <p class="ds-lbl">Payoff horizon — monthly payments + the lump cliffs</p>
            <div style="overflow-x:auto"><svg id="ds-chart" viewBox="0 0 620 250" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block"></svg></div>
            <p class="ds-hint" id="ds-chartCap"></p>
        </div>

        ${lumps.length ? `<div class="card"><p class="ds-lbl">Where each lump goes</p><div id="ds-allocMap">${allocMapHTML(alloc)}</div></div>` : ''}

        <div class="card">
            <p class="ds-lbl">Payoff order — highest APR first ${lumps.length ? '(struck-through = cleared by lumps)' : ''}</p>
            <div style="overflow-x:auto"><table class="ds-table">
                <thead><tr><th>Debt</th><th>Balance</th><th>APR</th></tr></thead>
                <tbody>${payoffTableHTML(prep, lumps)}</tbody>
                <tfoot><tr><th>Total</th><th>${formatCurrency(total)}</th><th></th></tr></tfoot>
            </table></div>
        </div>

        <div class="card">
            <p class="ds-lbl">Avalanche vs. Snowball</p>
            <div id="ds-comparison">${comparisonHTML(includedStoreDebts, pay, cascade)}</div>
        </div>

        <div class="card">
            <p class="ds-lbl">Debts in this plan</p>
            ${debtsInPlanHTML(allDebts, cfg.perDebt, includeTypes)}
        </div>

        <div class="card">
            <p class="ds-lbl">Plan notes</p>
            <div id="ds-notes">${notesHTML(notes)}</div>
            <button class="btn btn-secondary btn-sm" id="ds-add-note" style="margin-top:10px;">+ Add note</button>
        </div>

        <p class="ds-foot">Estimates from your live PennyHelm debt balances · avalanche (highest-APR-first) + monthly minimums of max($25, 1% of balance) · not licensed financial advice.</p>
    </div>`;

    // ── Live recompute (slider) ──
    function recompute(curPay, persist) {
        const sel = simulate(prep, lumps, curPay, rateScenario);
        const base = simulate(prep, lumps, curPay, 'current');
        const series = balanceSeries(prep, lumps, curPay, rateScenario);
        const $ = (id) => container.querySelector('#' + id);
        $('ds-payVal').textContent = formatCurrency(curPay);
        if (!sel.converged) {
            ['ds-rMonths', 'ds-rDate', 'ds-rInt', 'ds-rTot'].forEach((id) => { $(id).textContent = '—'; });
            $('ds-msg').innerHTML = `<div class="ds-warn">At ${formatCurrency(curPay)}/mo the payments don't outrun interest on what's left after the lumps. <b>Raise the monthly payment.</b></div>`;
            $('ds-chart').innerHTML = '';
            $('ds-chartCap').textContent = '';
        } else {
            const yrs = Math.floor(sel.months / 12), mo = sel.months % 12;
            $('ds-rMonths').textContent = (yrs ? yrs + 'y ' : '') + mo + 'm';
            $('ds-rDate').textContent = getDebtFreeDate(sel.months);
            $('ds-rInt').textContent = formatCurrency(sel.interest);
            $('ds-rTot').textContent = formatCurrency(sel.outOfPocket);
            if (rateScenario !== 'current') {
                const saved = base.interest - sel.interest, faster = base.months - sel.months;
                $('ds-msg').innerHTML = `<div class="ds-save">vs. today's rates: <b>save ${formatCurrency(saved)}</b> in interest${faster > 0 ? `, <b>${faster} mo</b> sooner` : ''}. That's the high-rate interest you dodge while the lumps arrive.</div>`;
            } else {
                $('ds-msg').innerHTML = `<div class="ds-warn">You'll pay <b>${formatCurrency(sel.interest)}</b> in interest as the lumps arrive. Flip to a HELOC/0% scenario above to see how much a lower rate saves.</div>`;
            }
            $('ds-chart').innerHTML = buildChartSVG(series);
            const yy = Math.floor(sel.months / 12), mm2 = sel.months % 12;
            $('ds-chartCap').textContent = `The line drops every month from your payments; the dashed cliffs (W1…) are the lumps. Debt-free in ${(yy ? yy + 'y ' : '') + mm2 + 'm'}.`;
        }
        const cmp = container.querySelector('#ds-comparison');
        if (cmp) cmp.innerHTML = comparisonHTML(includedStoreDebts, curPay, cascade);
        if (persist) store.updateDebtStrategy({ monthlyPayment: curPay });
    }
    recompute(pay, false);

    // ── Wiring ──
    wireTabs(container);
    const slider = container.querySelector('#ds-pay');
    slider.addEventListener('input', () => recompute(Number(slider.value), false));
    slider.addEventListener('change', () => recompute(Number(slider.value), true));

    container.querySelector('#ds-rateSeg').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        store.updateDebtStrategy({ rateScenario: b.dataset.rate });
        refreshPage();
    });

    container.querySelector('#ds-lumpCards').addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-lump-edit]');
        const delBtn = e.target.closest('[data-lump-del]');
        const addBtn = e.target.closest('#ds-add-lump');
        if (addBtn) return lumpModal(store, null);
        if (editBtn) return lumpModal(store, lumps.find((l) => l.id === editBtn.dataset.lumpEdit));
        if (delBtn) {
            store.updateDebtStrategy({ lumps: lumps.filter((l) => l.id !== delBtn.dataset.lumpDel) });
            refreshPage();
        }
    });

    wireDebtsInPlan(container, store);
    wireNotes(container, store, notes);
}

// ── HTML fragments ──
function dsSummary(total, n, ann, lumpCount, cardsCleared) {
    let s = `<b class="ds-red">${formatCurrency(total)}</b> across ${n} debt${n === 1 ? '' : 's'} · ~<b class="ds-red">${formatCurrency(ann)}/yr</b> interest at today's rates.`;
    if (lumpCount > 0) s += ` ${lumpCount} lump${lumpCount === 1 ? '' : 's'} clear ${cardsCleared} of ${n}.`;
    return s;
}

function lumpCardsHTML(lumps) {
    const cards = lumps.map((l) => `
        <div class="ds-lump">
            <div class="ds-lump-actions"><button class="ds-icon" data-lump-edit="${l.id}" title="Edit">✎</button><button class="ds-icon" data-lump-del="${l.id}" title="Remove">✕</button></div>
            <div class="k">${escapeHtml(l.label || monthLabel(l.m))}</div>
            <div class="v">${formatCurrency(l.amt)}</div>
            <div class="n">${l.m === 0 ? 'Now' : 'in ' + l.m + ' mo'} · ${monthLabel(l.m)}</div>
        </div>`).join('');
    return cards + `<button class="ds-lump ds-lump-add" id="ds-add-lump">＋ Add lump sum</button>`;
}

function allocMapHTML(alloc) {
    let html = alloc.waves.map((w, wi) => {
        const rows = w.rows.map((r) => `
            <div class="ds-alloc-row"><span class="ds-adot ${r.paidOff ? 'done' : 'partial'}"></span>
            <span class="a-name">${escapeHtml(r.name)}${r.joint ? ' <span class="ds-tag j">JOINT</span>' : ''}</span>
            <span class="a-amt">${formatCurrency(r.amount)}</span>
            <span class="ds-badge ${r.paidOff ? 'done' : 'partial'}">${r.paidOff ? 'PAID OFF' : 'partial'}</span></div>`).join('') || '<div class="ds-hint">(nothing left to pay this wave)</div>';
        return `<div class="ds-wave"><div class="ds-wave-head"><span class="ds-wave-k">WAVE ${wi + 1} · ${escapeHtml(w.label || monthLabel(w.month))}</span><span class="ds-wave-amt">${formatCurrency(w.amount)}</span></div>${rows}</div>`;
    }).join('');
    if (alloc.remaining.length) {
        html += `<div class="ds-rem"><b>Left after all lumps — ${formatCurrency(alloc.remainingTotal)}:</b><br>${alloc.remaining.map((b) => `${escapeHtml(b.name)} ${formatCurrency(b.bal)} (${b.apr}%)`).join(' · ')}<br>→ cleared by your monthly payments.</div>`;
    } else {
        html += `<div class="ds-rem"><b>The lumps clear every debt in the plan.</b> 🎉</div>`;
    }
    return html;
}

function payoffTableHTML(prep, lumps) {
    const sorted = [...prep].sort((a, b) => b.apr - a.apr || a.bal - b.bal);
    // Post-lump balances to mark which are cleared.
    const post = sorted.map((d) => ({ ...d }));
    let amt = lumps.reduce((s, l) => s + l.amt, 0);
    // Pour lumps down avalanche order respecting floors.
    const order = post.map((d, i) => i).filter((i) => post[i].bal > 0.01).sort((a, b) => post[b].apr - post[a].apr || post[a].bal - post[b].bal);
    for (const i of order) { if (amt <= 0) break; const payable = Math.max(0, post[i].bal - (post[i].floor || 0)); const p = Math.min(amt, payable); post[i].bal -= p; amt -= p; }
    return sorted.map((d, i) => {
        const gone = post[i].bal < 0.5;
        const aprCls = d.apr >= 25 ? 'ds-red' : (d.apr <= 10 ? 'ds-green' : '');
        return `<tr class="${gone ? 'ds-paid' : ''}"><td><span class="ds-ord">${i + 1}</span>${escapeHtml(d.name)}${d.joint ? '<span class="ds-tag j">JOINT</span>' : ''}${gone ? '<span class="ds-tag done">paid by lumps</span>' : ''}</td><td>${formatCurrency(d.bal)}</td><td class="${aprCls}">${d.apr}%</td></tr>`;
    }).join('');
}

const TYPE_LABELS = {
    'credit-card': 'Credit cards', 'auto-loan': 'Auto loans', 'mortgage': 'Mortgages',
    'student-loan': 'Student loans', 'personal-loan': 'Personal loans', 'medical': 'Medical', 'other': 'Other',
};

// Debt-type selector: choose which TYPES the plan covers (first-run + editable).
function debtTypesHTML(allDebts, includeTypes) {
    const present = [...new Set(allDebts.map((d) => d.type || 'other'))];
    if (!present.length) return '';
    const isActive = (t) => (Array.isArray(includeTypes) ? includeTypes.includes(t) : t === 'credit-card');
    const firstRun = !Array.isArray(includeTypes);
    const chips = present.map((t) => `<button type="button" class="ds-type-chip${isActive(t) ? ' active' : ''}" data-type="${t}">${TYPE_LABELS[t] || t}</button>`).join('');
    return `
        ${firstRun ? `<div class="ds-firstrun">👋 First time here — pick which debt <b>types</b> this plan should cover. It's defaulting to <b>credit cards</b>; change it anytime.</div>` : ''}
        <div class="ds-lbl" style="margin:2px 0 8px;">Debt types in this plan</div>
        <div class="ds-type-chips" id="ds-type-chips">${chips}</div>
        <p class="ds-hint" style="margin:6px 0 14px;">Toggle whole categories in or out. Fine-tune individual debts below.</p>`;
}

function debtsInPlanHTML(allDebts, perDebt, includeTypes) {
    if (!allDebts.length) return '<p class="ds-hint">No debts yet — add one on the Debts tab.</p>';
    const typeIncluded = (t) => (Array.isArray(includeTypes) ? includeTypes.includes(t) : t === 'credit-card');
    return debtTypesHTML(allDebts, includeTypes) + `<div class="ds-plan-list">${allDebts.map((d) => {
        const f = perDebt[d.id] || {};
        // Checkbox mirrors the resolved inclusion: explicit per-debt flag wins,
        // else it follows whether this debt's type is selected above.
        const included = f.included == null ? typeIncluded(d.type) : !!f.included;
        return `<div class="ds-plan-row">
            <label class="ds-plan-inc"><input type="checkbox" data-debt-id="${d.id}" data-field="included" ${included ? 'checked' : ''}> <span>${escapeHtml(d.name)}</span> <span class="ds-hint">${formatCurrency(d.currentBalance)} · ${d.interestRate}%</span></label>
            <label class="ds-plan-flag"><input type="checkbox" data-debt-id="${d.id}" data-field="joint" ${f.joint ? 'checked' : ''}> Joint</label>
            <label class="ds-plan-flag">Refundable $<input type="number" min="0" step="1" class="ds-refund" data-debt-id="${d.id}" data-field="refundableAmount" value="${f.refundableAmount || ''}" placeholder="0"></label>
        </div>`;
    }).join('')}</div>
    <p class="ds-hint" style="margin-top:8px;">Refundable = a portion that will be returned (e.g. a retainer) — lumps won't pay it down. Joint marks community debt.</p>`;
}

function notesHTML(notes) {
    if (!notes.length) return '<p class="ds-hint">No notes yet. Add reminders — e.g. a HELOC option, a 0% transfer plan, or a settlement detail.</p>';
    return notes.map((n) => `
        <div class="ds-note" data-note-id="${n.id}">
            <input class="ds-note-title" data-note-id="${n.id}" value="${escapeHtml(n.title || '')}" placeholder="Title">
            <textarea class="ds-note-body" data-note-id="${n.id}" rows="2" placeholder="Details…">${escapeHtml(n.body || '')}</textarea>
            <div class="ds-note-actions"><button class="btn btn-secondary btn-sm" data-note-save="${n.id}">Save</button><button class="ds-icon" data-note-del="${n.id}" title="Delete">✕</button></div>
        </div>`).join('');
}

// ── Modals + wiring ──
function lumpModal(store, existing) {
    const cfg = store.getDebtStrategy();
    const isEdit = !!existing;
    openModal(isEdit ? 'Edit lump sum' : 'Add lump sum', `
        <div class="form-group"><label class="form-label">Label</label><input class="form-input" id="lm-label" value="${existing ? escapeHtml(existing.label || '') : ''}" placeholder="e.g. Bonus, Stock sale"></div>
        <div class="form-group"><label class="form-label">Amount</label><input class="form-input" id="lm-amt" type="number" min="0" step="1" value="${existing ? existing.amt : ''}" placeholder="20000"></div>
        <div class="form-group"><label class="form-label">When (months from now)</label><input class="form-input" id="lm-m" type="number" min="0" step="1" value="${existing ? existing.m : 0}"><div class="ds-hint" id="lm-when"></div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;"><button class="btn btn-secondary" id="lm-cancel">Cancel</button><button class="btn btn-primary" id="lm-save">${isEdit ? 'Save' : 'Add'}</button></div>
    `);
    const body = document.getElementById('modal-body');
    const whenEl = body.querySelector('#lm-when');
    const mEl = body.querySelector('#lm-m');
    const upWhen = () => { whenEl.textContent = '→ ' + monthLabel(Math.max(0, Math.trunc(Number(mEl.value) || 0))); };
    upWhen(); mEl.addEventListener('input', upWhen);
    body.querySelector('#lm-cancel').addEventListener('click', closeModal);
    body.querySelector('#lm-save').addEventListener('click', () => {
        const amt = Math.max(0, Number(body.querySelector('#lm-amt').value) || 0);
        const m = Math.max(0, Math.trunc(Number(mEl.value) || 0));
        const label = body.querySelector('#lm-label').value.trim();
        if (amt <= 0) { showToast('Enter an amount greater than 0.', 'error'); return; }
        let list = cfg.lumps.slice();
        if (isEdit) list = list.map((l) => (l.id === existing.id ? { ...l, amt, m, label } : l));
        else list.push({ id: uid(), amt, m, label });
        store.updateDebtStrategy({ lumps: list });
        closeModal();
        refreshPage();
    });
}

function wireTabs(container) {
    container.querySelectorAll('.filter-chip[data-tab]').forEach((chip) => {
        chip.addEventListener('click', () => {
            navigate(chip.dataset.tab === 'debts' ? 'debts' : 'debts/' + chip.dataset.tab);
        });
    });
}

function wireDebtsInPlan(container, store) {
    // Debt-type selector (first-run + editable): toggle whole categories.
    const typeChips = container.querySelector('#ds-type-chips');
    if (typeChips) {
        typeChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.ds-type-chip');
            if (!chip) return;
            const t = chip.dataset.type;
            const cur = store.getDebtStrategy().includeTypes;
            const set = Array.isArray(cur) ? cur.slice() : ['credit-card'];
            const i = set.indexOf(t);
            if (i >= 0) set.splice(i, 1); else set.push(t);
            store.updateDebtStrategy({ includeTypes: set });
            refreshPage();
        });
    }

    const list = container.querySelector('.ds-plan-list');
    if (!list) return;
    list.addEventListener('change', (e) => {
        const el = e.target;
        const id = el.dataset.debtId, field = el.dataset.field;
        if (!id || !field) return;
        const cfg = store.getDebtStrategy();
        const perDebt = { ...cfg.perDebt };
        const cur = { ...(perDebt[id] || {}) };
        if (field === 'refundableAmount') cur[field] = Math.max(0, Number(el.value) || 0);
        else cur[field] = el.checked;
        perDebt[id] = cur;
        store.updateDebtStrategy({ perDebt });
        // Included/joint change the plan set → full refresh; refundable input too.
        refreshPage();
    });
}

function wireNotes(container, store, notes) {
    const wrap = container.querySelector('#ds-notes');
    container.querySelector('#ds-add-note')?.addEventListener('click', () => {
        const list = (store.getDebtStrategy().notes || []).concat({ id: uid(), title: '', body: '' });
        store.updateDebtStrategy({ notes: list });
        refreshPage();
    });
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const save = e.target.closest('[data-note-save]');
        const del = e.target.closest('[data-note-del]');
        if (save) {
            const id = save.dataset.noteSave;
            const row = wrap.querySelector(`.ds-note[data-note-id="${id}"]`);
            const title = row.querySelector('.ds-note-title').value.trim();
            const bodyV = row.querySelector('.ds-note-body').value.trim();
            const list = (store.getDebtStrategy().notes || []).map((n) => (n.id === id ? { ...n, title, body: bodyV } : n));
            store.updateDebtStrategy({ notes: list });
            showToast('Note saved.', 'success');
        } else if (del) {
            const id = del.dataset.noteDel;
            store.updateDebtStrategy({ notes: (store.getDebtStrategy().notes || []).filter((n) => n.id !== id) });
            refreshPage();
        }
    });
}

// ── Scoped styles (maps the reference's look onto PennyHelm's tokens) ──
function strategyStyles() {
    return `<style>
    .debt-strategy .ds-lbl{font-family:var(--font-num);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin:0 0 12px}
    .debt-strategy .ds-red{color:var(--red)} .debt-strategy .ds-green{color:var(--green)}
    .debt-strategy .ds-lumps{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
    .debt-strategy .ds-lump{position:relative;flex:1 1 150px;min-width:150px;background:color-mix(in oklab,var(--green) 12%,transparent);border:1px solid var(--green);border-radius:12px;padding:12px 14px}
    .debt-strategy .ds-lump .k{font-family:var(--font-num);font-size:10.5px;color:var(--green);letter-spacing:.05em}
    .debt-strategy .ds-lump .v{font-size:19px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;color:var(--text-primary)}
    .debt-strategy .ds-lump .n{font-size:11.5px;color:var(--text-secondary);margin-top:2px}
    .debt-strategy .ds-lump-actions{position:absolute;top:8px;right:8px;display:flex;gap:4px}
    .debt-strategy .ds-icon{background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:2px;line-height:1}
    .debt-strategy .ds-icon:hover{color:var(--text-primary)}
    .debt-strategy .ds-lump-add{display:flex;align-items:center;justify-content:center;background:transparent;border:1px dashed var(--border);color:var(--text-secondary);font-weight:600;cursor:pointer;font-size:13px}
    .debt-strategy .ds-lump-add:hover{border-color:var(--accent);color:var(--accent)}
    .debt-strategy .ds-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
    .debt-strategy .ds-stat{background:var(--bg-secondary);border:1px solid var(--border);border-radius:11px;padding:14px}
    .debt-strategy .ds-stat .k{font-family:var(--font-num);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
    .debt-strategy .ds-stat .v{font-size:22px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums;color:var(--text-primary)}
    .debt-strategy .ds-stat.debt .v{color:var(--red)} .debt-strategy .ds-stat.good .v{color:var(--green)}
    .debt-strategy .ds-ctrl-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
    .debt-strategy .ds-val{font-family:var(--font-num);font-size:22px;font-weight:700;color:var(--accent)}
    .debt-strategy input[type=range]{width:100%;accent-color:var(--accent);height:26px}
    .debt-strategy .ds-hint{font-size:12px;color:var(--text-muted);margin-top:2px} .debt-strategy .ds-hint b{color:var(--text-secondary)}
    .debt-strategy .ds-seg{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
    .debt-strategy .ds-seg button{flex:1 1 auto;min-width:118px;font-size:13px;font-weight:600;padding:10px 8px;border-radius:9px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer;transition:.12s}
    .debt-strategy .ds-seg button .r{display:block;font-family:var(--font-num);font-size:11px;color:var(--text-muted);font-weight:400;margin-top:2px}
    .debt-strategy .ds-seg button[aria-pressed=true]{background:color-mix(in oklab,var(--accent) 14%,transparent);border-color:var(--accent);color:var(--accent)}
    .debt-strategy .ds-seg button[aria-pressed=true] .r{color:var(--accent)}
    .debt-strategy .ds-save{margin-top:12px;padding:12px 14px;border-radius:10px;background:color-mix(in oklab,var(--green) 12%,transparent);border:1px solid var(--green);font-size:14px;color:var(--text-primary)} .debt-strategy .ds-save b{color:var(--green)}
    .debt-strategy .ds-warn{margin-top:12px;padding:12px 14px;border-radius:10px;background:color-mix(in oklab,var(--red) 10%,transparent);border:1px solid var(--red);font-size:14px;color:var(--text-primary)} .debt-strategy .ds-warn b{color:var(--red)}
    .debt-strategy .ds-table{width:100%;border-collapse:collapse;font-size:13.5px}
    .debt-strategy .ds-table th,.debt-strategy .ds-table td{text-align:right;padding:7px 6px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums}
    .debt-strategy .ds-table th{color:var(--text-muted);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
    .debt-strategy .ds-table td:first-child,.debt-strategy .ds-table th:first-child{text-align:left}
    .debt-strategy .ds-table .ds-red{color:var(--red);font-weight:600} .debt-strategy .ds-table .ds-green{color:var(--green);font-weight:600}
    .debt-strategy tr.ds-paid td{color:var(--text-muted);text-decoration:line-through} .debt-strategy tr.ds-paid td .ds-tag{text-decoration:none}
    .debt-strategy .ds-tag{display:inline-block;font-family:var(--font-num);font-size:9.5px;padding:1px 5px;border-radius:4px;margin-left:6px;vertical-align:1px}
    .debt-strategy .ds-tag.j{background:color-mix(in oklab,var(--orange) 16%,transparent);color:var(--orange);border:1px solid var(--orange)}
    .debt-strategy .ds-tag.done{background:color-mix(in oklab,var(--green) 14%,transparent);color:var(--green);border:1px solid var(--green)}
    .debt-strategy .ds-ord{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:color-mix(in oklab,var(--accent) 16%,transparent);color:var(--accent);font-family:var(--font-num);font-size:11px;margin-right:8px}
    .debt-strategy .ds-wave{border:1px solid var(--border);border-radius:11px;padding:12px 14px;margin-bottom:10px;background:var(--bg-secondary)}
    .debt-strategy .ds-wave-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)}
    .debt-strategy .ds-wave-k{font-family:var(--font-num);font-size:11px;letter-spacing:.08em;color:var(--green);font-weight:600}
    .debt-strategy .ds-wave-amt{font-family:var(--font-num);font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:var(--text-primary)}
    .debt-strategy .ds-alloc-row{display:flex;align-items:center;gap:9px;font-size:13.5px;padding:4px 0;color:var(--text-primary)}
    .debt-strategy .ds-alloc-row .a-name{flex:1} .debt-strategy .ds-alloc-row .a-amt{font-family:var(--font-num);font-variant-numeric:tabular-nums;color:var(--text-secondary)}
    .debt-strategy .ds-badge{font-family:var(--font-num);font-size:9.5px;padding:1px 6px;border-radius:4px;white-space:nowrap}
    .debt-strategy .ds-badge.done{background:color-mix(in oklab,var(--green) 14%,transparent);color:var(--green);border:1px solid var(--green)}
    .debt-strategy .ds-badge.partial{background:color-mix(in oklab,var(--orange) 14%,transparent);color:var(--orange);border:1px solid var(--orange)}
    .debt-strategy .ds-adot{width:8px;height:8px;border-radius:50%;flex:none} .debt-strategy .ds-adot.done{background:var(--green)} .debt-strategy .ds-adot.partial{background:var(--orange)}
    .debt-strategy .ds-rem{margin-top:12px;padding:11px 14px;border-radius:10px;background:color-mix(in oklab,var(--green) 12%,transparent);border:1px solid var(--green);font-size:13px;line-height:1.6;color:var(--text-primary)} .debt-strategy .ds-rem b{color:var(--green)}
    .debt-strategy .ds-cmp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
    .debt-strategy .ds-cmp-card{border:1px solid var(--border);border-radius:12px;padding:14px 16px;background:var(--bg-secondary)}
    .debt-strategy .ds-cmp-card.active{border-color:var(--green)}
    .debt-strategy .ds-cmp-head{display:flex;justify-content:space-between;align-items:center}
    .debt-strategy .ds-cmp-title{font-weight:700;font-size:15px;color:var(--text-primary)}
    .debt-strategy .ds-cmp-sub{color:var(--text-muted);font-size:12px;margin:2px 0 10px}
    .debt-strategy .ds-cmp-row{display:flex;justify-content:space-between;font-size:14px;padding:3px 0;color:var(--text-secondary)} .debt-strategy .ds-cmp-row b{color:var(--text-primary);font-variant-numeric:tabular-nums}
    .debt-strategy .ds-cmp-order{margin-top:8px;font-size:12px;color:var(--text-muted)} .debt-strategy .ds-cmp-order ol{margin:4px 0 0;padding-left:18px;color:var(--text-secondary)}
    .debt-strategy .ds-firstrun{padding:11px 14px;border-radius:10px;background:color-mix(in oklab,var(--accent) 12%,transparent);border:1px solid var(--accent);font-size:13px;color:var(--text-primary);margin-bottom:14px}
    .debt-strategy .ds-type-chips{display:flex;gap:8px;flex-wrap:wrap}
    .debt-strategy .ds-type-chip{font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer;transition:.12s}
    .debt-strategy .ds-type-chip:hover{border-color:var(--accent);color:var(--text-primary)}
    .debt-strategy .ds-type-chip.active{background:color-mix(in oklab,var(--accent) 16%,transparent);border-color:var(--accent);color:var(--accent)}
    .debt-strategy .ds-plan-list{display:flex;flex-direction:column;gap:8px}
    .debt-strategy .ds-plan-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:9px;background:var(--bg-secondary)}
    .debt-strategy .ds-plan-inc{display:flex;align-items:center;gap:8px;flex:1 1 220px;font-size:14px;color:var(--text-primary);cursor:pointer}
    .debt-strategy .ds-plan-flag{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary)}
    .debt-strategy .ds-refund{width:90px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-family:var(--font-num)}
    .debt-strategy .ds-note{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--border);border-radius:9px;margin-bottom:10px;background:var(--bg-secondary)}
    .debt-strategy .ds-note-title{font-weight:600;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary)}
    .debt-strategy .ds-note-body{padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-family:inherit;resize:vertical}
    .debt-strategy .ds-note-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
    .debt-strategy .ds-chart-area{fill:var(--accent);opacity:.13}
    .debt-strategy .ds-chart-line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round}
    .debt-strategy .ds-chart-grid{stroke:var(--border);stroke-width:1}
    .debt-strategy .ds-chart-glbl{fill:var(--text-muted);font-family:var(--font-num);font-size:10px}
    .debt-strategy .ds-chart-lump{stroke:var(--green);stroke-width:1.5;stroke-dasharray:3 3}
    .debt-strategy .ds-chart-llbl{fill:var(--green);font-family:var(--font-num);font-size:9.5px;font-weight:700}
    .debt-strategy .ds-chart-po{fill:var(--green)} .debt-strategy .ds-chart-polbl{fill:var(--green);font-family:var(--font-num);font-size:11px;font-weight:700}
    .debt-strategy .ds-chart-xlbl{fill:var(--text-muted);font-family:var(--font-num);font-size:9.5px}
    .debt-strategy .ds-foot{font-size:11.5px;color:var(--text-muted);margin-top:18px;font-family:var(--font-num)}
    </style>`;
}
