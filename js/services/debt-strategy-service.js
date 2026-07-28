/**
 * Debt Repayment Strategy — pure payoff math.
 *
 * Ported verbatim from the standalone calculator reference: an avalanche
 * (highest-APR-first) simulation with scheduled one-time lump sums plus an
 * ongoing monthly payment. All functions are pure and side-effect free so the
 * page and the tests can share them.
 *
 * A "calc debt" is { id, name, bal, apr, joint?, floor? } where:
 *   - bal   = current balance
 *   - apr   = annual rate as a percent (e.g. 29.99)
 *   - floor = a refundable portion lump sums must not pay below (e.g. a
 *             lawyer retainer that will be returned); defaults to 0.
 * A "lump" is { m, amt } where m is the whole-month offset from today.
 */

// Indices of live balances, highest APR first (ties: smaller balance first).
export function avalancheOrder(bals) {
    return bals.map((b, i) => i)
        .filter((i) => bals[i].bal > 0.01)
        .sort((a, b) => bals[b].apr - bals[a].apr || bals[a].bal - bals[b].bal);
}

// Apply a lump across balances in avalanche order. Never pays a balance below
// its refundable floor. Mutates `bals`; returns any leftover amount.
export function applyLumpTo(bals, amt) {
    for (const i of avalancheOrder(bals)) {
        if (amt <= 0) break;
        const floor = bals[i].floor || 0;
        const payable = Math.max(0, bals[i].bal - floor);
        const p = Math.min(amt, payable);
        bals[i].bal -= p;
        amt -= p;
    }
    return amt;
}

// Advance one month: accrue interest, pay the minimum on each debt, then throw
// the rest of the monthly budget at the highest-APR balance, overflowing down.
// Mutates `bals`; returns the interest accrued that month. (Verbatim logic.)
export function stepMonth(bals, pay) {
    const live = bals.filter((b) => b.bal > 0.01);
    if (!live.length) return 0;
    let mInt = 0;
    live.forEach((b) => { const i = b.bal * b.apr / 1200; b.bal += i; mInt += i; });
    let budget = pay;
    const mins = live.map((b) => Math.min(b.bal, Math.max(25, b.bal * 0.01)));
    const minSum = mins.reduce((s, x) => s + x, 0);
    if (budget >= minSum) {
        live.forEach((b, idx) => { b.bal -= mins[idx]; });
        budget -= minSum;
        live.sort((a, b) => b.apr - a.apr);
        for (const b of live) { if (budget <= 0) break; const p = Math.min(budget, b.bal); b.bal -= p; budget -= p; }
    } else {
        live.forEach((b, idx) => { b.bal -= budget * (mins[idx] / minSum); });
    }
    return mInt;
}

// Fresh working balances, with every APR replaced by a uniform rate unless the
// scenario is 'current' (preview a refinance / HELOC / 0% transfer).
function ratedBals(debts, rateScenario) {
    const uniform = rateScenario === 'current' ? null : Number(rateScenario);
    return debts.map((d) => ({
        bal: d.bal,
        apr: uniform == null ? d.apr : uniform,
        floor: d.floor || 0,
    }));
}

const MAX_MONTHS = 900;

// Simulate to debt-free. Returns months, total interest from now, and total
// out of pocket (lumps actually applied + monthly principal+interest paid).
// months === MAX_MONTHS means it never converges at this payment/rate.
export function simulate(debts, lumps, pay, rateScenario) {
    const bals = ratedBals(debts, rateScenario);
    const sum = () => bals.reduce((s, b) => s + b.bal, 0);
    const live = () => bals.reduce((s, b) => s + Math.max(0, b.bal), 0);
    let months = 0, interest = 0, paidMonthly = 0, lumpsApplied = 0;
    while (months < MAX_MONTHS) {
        lumps.forEach((l) => {
            if (l.m === months) { const pre = sum(); applyLumpTo(bals, l.amt); lumpsApplied += pre - sum(); }
        });
        if (live() < 0.5) break;
        const before = sum();
        const mInt = stepMonth(bals, pay);
        interest += mInt;
        paidMonthly += (before + mInt - sum());
        months++;
        if (live() < 0.5) break;
    }
    return { months, interest, outOfPocket: lumpsApplied + paidMonthly, converged: months < MAX_MONTHS };
}

// Total balance vs. month, plus a mark at each lump and the payoff month — the
// data behind the payoff-horizon chart. maxV is the starting total (chart top).
export function balanceSeries(debts, lumps, pay, rateScenario) {
    const bals = ratedBals(debts, rateScenario);
    const total = () => bals.reduce((s, b) => s + Math.max(0, b.bal), 0);
    const maxV = total();
    const pts = [{ m: 0, v: total() }];
    const marks = [];
    let months = 0;
    while (months < MAX_MONTHS) {
        lumps.forEach((l, i) => {
            if (l.m === months) { applyLumpTo(bals, l.amt); marks.push({ m: months, l: 'W' + (i + 1) }); pts.push({ m: months, v: total() }); }
        });
        if (total() < 0.5) break;
        stepMonth(bals, pay);
        months++;
        pts.push({ m: months, v: total() });
        if (total() < 0.5) break;
    }
    return { points: pts, marks, payoffMonth: months, maxV };
}

// Per-lump allocation: which debts each lump pays, how much, and whether that
// debt is fully cleared or partially paid. No interest — pure principal split,
// so it reads as "where the money goes". Returns waves + the remaining tail.
export function allocateLumps(debts, lumps) {
    const pool = debts.map((d) => ({ ...d }));
    const waves = lumps.map((w) => {
        let amt = w.amt;
        const rows = [];
        for (const i of avalancheOrder(pool)) {
            if (amt <= 0.01) break;
            const floor = pool[i].floor || 0;
            const payable = Math.max(0, pool[i].bal - floor);
            const pay = Math.min(amt, payable);
            if (pay <= 0.01) continue;
            pool[i].bal -= pay;
            amt -= pay;
            rows.push({ name: pool[i].name, joint: !!pool[i].joint, amount: pay, paidOff: pool[i].bal < 0.5 });
        }
        return { label: w.label, month: w.m, amount: w.amt, rows, leftover: amt };
    });
    const remaining = pool.filter((b) => b.bal > 0.5).sort((a, b) => b.apr - a.apr || a.bal - b.bal);
    const remainingTotal = remaining.reduce((s, b) => s + b.bal, 0);
    return { waves, remaining, remainingTotal };
}

// One-pass "after all lumps" summary used for the headline tiles: pool every
// lump dollar and pour it down the avalanche once. Returns the balance left and
// the annual interest that principal was accruing (interest "killed" per year).
export function afterLumpsSummary(debts, lumps) {
    const pool = debts.map((d) => ({ ...d }));
    let amt = lumps.reduce((s, l) => s + l.amt, 0);
    let killed = 0;
    for (const i of avalancheOrder(pool)) {
        if (amt <= 0) break;
        const floor = pool[i].floor || 0;
        const payable = Math.max(0, pool[i].bal - floor);
        const p = Math.min(amt, payable);
        pool[i].bal -= p;
        amt -= p;
        killed += p * pool[i].apr / 100;
    }
    return {
        afterLumps: pool.reduce((s, x) => s + x.bal, 0),
        interestKilled: killed,
    };
}

// Annual interest the whole set is accruing right now (headline "~$X/yr").
export function annualInterest(debts) {
    return debts.reduce((s, d) => s + d.bal * d.apr / 100, 0);
}

// ─── Avalanche vs. Snowball comparison (no lumps) ───────────────────────
// Shared with the Debts tab's "Strategy Comparison" card. Operates on the
// app's stored debt shape ({ currentBalance, interestRate, minimumPayment }).
// cascade=true rolls a cleared debt's minimum into the remaining budget.
export function calculatePayoffStrategy(debts, monthlyBudget, strategy, cascade = true) {
    if (debts.length === 0 || monthlyBudget <= 0) {
        return { monthsToPayoff: 0, totalInterestPaid: 0, timeline: [], payoffOrder: [] };
    }
    let balances = debts.map((d) => ({
        id: d.id, name: d.name, balance: d.currentBalance,
        rate: d.interestRate / 100 / 12, minPayment: d.minimumPayment,
    }));
    if (strategy === 'avalanche') balances.sort((a, b) => b.rate - a.rate);
    else balances.sort((a, b) => a.balance - b.balance);

    const totalMinimum = balances.reduce((s, d) => s + d.minPayment, 0);
    if (monthlyBudget < totalMinimum) {
        return { monthsToPayoff: Infinity, totalInterestPaid: Infinity, timeline: [], payoffOrder: [] };
    }
    let months = 0, totalInterest = 0;
    const timeline = [], payoffOrder = [];
    const maxMonths = 600;
    let currentBudget = monthlyBudget;
    while (balances.some((d) => d.balance > 0.01) && months < maxMonths) {
        months++;
        let extraPayment = currentBudget, monthInterest = 0;
        balances.forEach((d) => { if (d.balance > 0) { const i = d.balance * d.rate; d.balance += i; monthInterest += i; } });
        totalInterest += monthInterest;
        balances.forEach((d) => {
            if (d.balance > 0) {
                const payment = Math.min(d.minPayment, d.balance);
                d.balance -= payment; extraPayment -= payment;
                if (d.balance <= 0.01) { d.balance = 0; if (!payoffOrder.includes(d.name)) payoffOrder.push(d.name); if (!cascade) currentBudget -= d.minPayment; }
            }
        });
        for (const d of balances) {
            if (d.balance > 0 && extraPayment > 0) {
                const payment = Math.min(extraPayment, d.balance);
                d.balance -= payment; extraPayment -= payment;
                if (d.balance <= 0.01) { d.balance = 0; if (!payoffOrder.includes(d.name)) payoffOrder.push(d.name); if (!cascade) currentBudget -= d.minPayment; }
                break;
            }
        }
        if (months <= 12) timeline.push({ month: months, totalRemaining: balances.reduce((s, d) => s + d.balance, 0) });
    }
    return { monthsToPayoff: months >= maxMonths ? Infinity : months, totalInterestPaid: totalInterest, timeline, payoffOrder };
}

export function formatMonths(months) {
    if (months === Infinity || months >= 600) return 'Never';
    if (months === 0) return 'Paid off';
    const years = Math.floor(months / 12), remaining = months % 12;
    if (years === 0) return `${months} months`;
    if (remaining === 0) return `${years} year${years > 1 ? 's' : ''}`;
    return `${years}y ${remaining}m`;
}

export function getDebtFreeDate(months) {
    if (months === Infinity || months >= 600) return 'Never';
    if (months === 0) return 'Today';
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Map the app's stored debts into calc debts, honoring per-debt strategy flags.
// Inclusion resolves as: an explicit per-debt `included` flag wins; otherwise a
// debt is in the plan when its TYPE is selected. `includeTypes` is an array of
// debt types the user chose (e.g. ['credit-card','auto-loan']); an empty array
// means "no type auto-included" and null/undefined defaults to credit cards.
export function prepareStrategyDebts(storeDebts, perDebt = {}, includeTypes = null) {
    const typeIncluded = (type) => (Array.isArray(includeTypes) ? includeTypes.includes(type) : type === 'credit-card');
    return (storeDebts || [])
        .map((d) => {
            const flags = perDebt[d.id] || {};
            const included = flags.included == null ? typeIncluded(d.type) : !!flags.included;
            return {
                id: d.id,
                name: d.name,
                bal: Number(d.currentBalance) || 0,
                apr: Number(d.interestRate) || 0,
                minPayment: Number(d.minimumPayment) || 0,
                joint: !!flags.joint,
                floor: Math.max(0, Number(flags.refundableAmount) || 0),
                included,
                type: d.type,
            };
        })
        .filter((d) => d.included && d.bal > 0);
}
