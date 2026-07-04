/**
 * Shared-access role model (RBAC) — pure, unit-tested logic used by the
 * Cloud Functions gateway (getSharedSnapshot / sharedUpdateBudget) and by
 * invite validation.
 *
 * The ladder is additive — every role includes everything below it:
 *
 *   companion < advisor < viewer < partner < full
 *
 *   companion — balances of allowlisted accounts + budget aggregates
 *               (limit / spent / remaining). Optional canEditBudgets.
 *   advisor   — + all accounts, debts, investments, income, savings,
 *               net-worth history, tax deductions. Read-only.
 *   viewer    — + bills, calendar, rules, expenses. Read-only everything.
 *   partner   — + edit day-to-day (bills, budgets, savings, rules, expenses).
 *   full      — + edit structure (accounts, debts, investments, income).
 *
 * Always owner-only regardless of role: sharing management, data
 * import/export/delete, bank connections, API keys, subscription.
 *
 * Grant shape (stored on each sharedWith entry and mirrored into the
 * root-level `sharedRoles` map that Firestore rules read):
 *   { role, accountIds?: string[], canEditBudgets?: boolean }
 */

const budgetService = require('./budget-service.cjs');
const financialService = require('./financial-service.cjs');

const ROLES = ['companion', 'advisor', 'viewer', 'partner', 'full'];

const ROLE_RANK = { companion: 1, advisor: 2, viewer: 3, partner: 4, full: 5 };

// Roles allowed to read the owner's userData doc DIRECTLY via Firestore
// rules (they may see everything anyway). Partial-view roles below this set
// must go through the getSharedSnapshot gateway.
const FULL_VIEW_ROLES = ['viewer', 'partner', 'full'];

// Domains a role may EDIT (each rank inherits the previous). Used by the
// sharedWrite gateway; budgets-edit for companion/advisor is governed by the
// canEditBudgets flag instead.
const EDIT_DOMAINS = {
    partner: ['bills', 'paidHistory', 'budgets', 'savingsGoals', 'transactionRules', 'expenses', 'customCategories', 'customExpenseCategories'],
    full: ['accounts', 'debts', 'investments', 'income', 'otherIncome', 'taxDeductions'],
};

function isValidRole(role) {
    return ROLES.includes(role);
}

function roleAtLeast(role, floor) {
    return (ROLE_RANK[role] || 0) >= (ROLE_RANK[floor] || Infinity);
}

function canEditBudgets(grant) {
    if (!grant || !isValidRole(grant.role)) return false;
    if (roleAtLeast(grant.role, 'partner')) return true;
    return grant.canEditBudgets === true;
}

function editableDomains(role) {
    if (!isValidRole(role)) return [];
    let domains = [];
    if (roleAtLeast(role, 'partner')) domains = domains.concat(EDIT_DOMAINS.partner);
    if (roleAtLeast(role, 'full')) domains = domains.concat(EDIT_DOMAINS.full);
    return domains;
}

// Derive the root-level sharedRoles map (read by Firestore rules) from the
// JSON blob's sharedWith entries. Entries without a role are legacy shares:
// view -> viewer, edit -> partner.
function deriveSharedRoles(sharedWith) {
    const map = {};
    for (const s of sharedWith || []) {
        if (!s || !s.uid) continue;
        const role = isValidRole(s.role)
            ? s.role
            : (s.permissions === 'edit' ? 'partner' : 'viewer');
        map[s.uid] = {
            role,
            accountIds: Array.isArray(s.accountIds) ? s.accountIds : null,
            canEditBudgets: s.canEditBudgets === true,
        };
    }
    return map;
}

// ─── Server-side aggregates ──────────────────────────────────────────
//
// Budget spent/remaining are DERIVED from bills + expenses. Partial-view
// roles must never receive those raw records, so the aggregation runs here
// (mirroring store._billSpendForMonth + budget-service) and only the
// resulting numbers ship.

function billSpendForMonth(data, category, mKey) {
    if (!category || !mKey) return 0;
    const [y, m] = mKey.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
    const month = m - 1;

    const needle = String(category || '').toLowerCase();
    const bills = (data.bills || []).filter(b =>
        !b.frozen && String(b.expenseCategory || '').toLowerCase() === needle
    );
    if (bills.length === 0) return 0;

    const monthStart = new Date(y, month, 1);
    const monthEnd = new Date(y, month + 1, 0);
    const payDates = financialService.generatePayDates(
        data.paySchedule,
        monthStart.toISOString().slice(0, 10),
        monthEnd.toISOString().slice(0, 10)
    );

    let total = 0;
    for (const bill of bills) {
        const amt = Number(bill.amount) || 0;
        if (amt === 0) continue;
        if (bill.frequency === 'yearly') {
            if (bill.dueMonth === month) total += amt;
        } else if (bill.frequency === 'semi-annual') {
            const second = (bill.dueMonth + 6) % 12;
            if (bill.dueMonth === month || second === month) total += amt;
        } else if (bill.frequency === 'monthly' || !bill.frequency) {
            total += amt;
        } else {
            const occ = financialService.expandBillOccurrences(bill, monthStart, monthEnd, payDates);
            total += (occ ? occ.length : 0) * amt;
        }
    }
    return total;
}

function computeBudgetAggregates(data, now = new Date()) {
    const asOf = budgetService.monthKey(now);
    const statuses = budgetService.computeAllBudgetStatuses(
        data.budgets || [],
        data.expenses || [],
        asOf,
        (category, mKey) => billSpendForMonth(data, category, mKey)
    ).map(s => ({
        // Only the numbers — no payees, no transactions.
        category: s.category,
        tag: s.tag || null,
        month: s.month,
        monthlyAmount: s.monthlyAmount,
        rollover: s.rollover,
        rolledIn: s.rolledIn,
        available: s.available,
        spent: s.spent,
        remaining: s.remaining,
        pctUsed: s.pctUsed,
        notStarted: s.notStarted === true,
    }));
    const totals = budgetService.computeBudgetTotals(statuses);
    return { asOfMonth: asOf, statuses, totals };
}

function filterAccounts(data, grant) {
    const allow = Array.isArray(grant.accountIds) ? new Set(grant.accountIds) : null;
    return (data.accounts || [])
        .filter(a => allow === null ? roleAtLeast(grant.role, 'advisor') : allow.has(a.id))
        .map(a => ({ id: a.id, name: a.name, type: a.type, balance: a.balance }));
}

// ─── The snapshot filter ─────────────────────────────────────────────
//
// Returns exactly what a grant is allowed to see. For full-view roles the
// caller may bypass this (they have direct doc access), but the gateway
// serves them too for a uniform client path.
function filterDataForRole(data, grant, now = new Date()) {
    if (!grant || !isValidRole(grant.role)) return null;
    const role = grant.role;

    const snapshot = {
        _shared: {
            role,
            canEditBudgets: canEditBudgets(grant),
            ownerName: data.userName || 'Owner',
            generatedAt: now.toISOString(),
        },
        budgets: computeBudgetAggregates(data, now),
        accounts: filterAccounts(data, grant),
    };

    // Editing budgets requires the raw configs (id/startMonth/rollover) so
    // the client can send a valid replacement set. Notes stay private.
    if (canEditBudgets(grant)) {
        snapshot.budgetConfigs = (data.budgets || []).map(b => ({
            id: b.id,
            ...(b.tag ? { tag: b.tag } : { category: b.category }),
            monthlyAmount: b.monthlyAmount,
            rollover: b.rollover === true, startMonth: b.startMonth,
        }));
    }

    if (roleAtLeast(role, 'advisor')) {
        snapshot.debts = (data.debts || []).map(d => ({
            id: d.id, name: d.name, type: d.type,
            currentBalance: d.currentBalance, originalBalance: d.originalBalance,
            interestRate: d.interestRate, minimumPayment: d.minimumPayment,
        }));
        snapshot.investments = data.investments || [];
        snapshot.income = data.income || null;
        snapshot.otherIncome = data.otherIncome || [];
        snapshot.paySchedule = data.paySchedule || null;
        snapshot.savingsGoals = data.savingsGoals || [];
        snapshot.balanceHistory = data.balanceHistory || [];
        snapshot.taxDeductions = data.taxDeductions || [];
    }

    if (roleAtLeast(role, 'viewer')) {
        snapshot.bills = data.bills || [];
        snapshot.paidHistory = data.paidHistory || {};
        snapshot.expenses = data.expenses || [];
        snapshot.transactionRules = data.transactionRules || [];
        snapshot.customCategories = data.customCategories || [];
        snapshot.customExpenseCategories = data.customExpenseCategories || [];
        snapshot.paymentSources = data.paymentSources || [];
        snapshot.creditScores = data.creditScores || null;
        snapshot.dependentEnabled = data.dependentEnabled === true;
        snapshot.dependentName = data.dependentName || null;
    }

    // Never included for ANY shared role: sharedWith (ACLs), plaid config,
    // api keys, notification/settings internals, import/export payloads.
    return snapshot;
}

module.exports = {
    ROLES,
    ROLE_RANK,
    FULL_VIEW_ROLES,
    isValidRole,
    roleAtLeast,
    canEditBudgets,
    editableDomains,
    deriveSharedRoles,
    billSpendForMonth,
    computeBudgetAggregates,
    filterDataForRole,
};
