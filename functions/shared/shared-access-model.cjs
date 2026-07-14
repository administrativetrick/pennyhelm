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
            budgetIds: Array.isArray(s.budgetIds) ? s.budgetIds : null,
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

function billSpendForMonth(data, category, mKey, monthExpenses = []) {
    if (!category || !mKey) return 0;
    const [y, m] = mKey.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
    const month = m - 1;

    const needle = String(category || '').toLowerCase();
    // Unified default with reconciliation — mirrors store._billSpendForMonth
    // (keep the three copies in agreement: web store, this file, mobile
    // BudgetsScreen). Forecast counts until a matching transaction lands.
    const budgetCatOf = (b) => b.expenseCategory === 'none' ? '' : (b.expenseCategory || b.category || '');
    const bills = (data.bills || []).filter(b =>
        !b.frozen && String(budgetCatOf(b)).toLowerCase() === needle
    );
    if (bills.length === 0) return 0;

    const monthStart = new Date(y, month, 1);
    const monthEnd = new Date(y, month + 1, 0);
    const payDates = financialService.generatePayDates(
        data.paySchedule,
        monthStart.toISOString().slice(0, 10),
        monthEnd.toISOString().slice(0, 10)
    );
    return financialService.reconciledBillSpendForMonth(bills, y, month, payDates, monthExpenses);
}

// The store persists budgets under `categoryBudgets` (legacy name predating
// tag budgets); `budgets` is accepted as a fallback for older fixtures.
function budgetsOf(data) {
    return data.categoryBudgets || data.budgets || [];
}

function computeBudgetAggregates(data, now = new Date()) {
    const asOf = budgetService.monthKey(now);
    const statuses = budgetService.computeAllBudgetStatuses(
        budgetsOf(data),
        // Transfers/card payments excluded, interest remapped — mirrors
        // store.getBudgetStatuses on the web client.
        financialService.spendingExpenses(data.expenses || []),
        asOf,
        (category, mKey, monthExpenses) => billSpendForMonth(data, category, mKey, monthExpenses)
    ).map(s => ({
        // Only the numbers — no payees, no transactions.
        category: s.category,
        tag: s.tag || null,
        month: s.month,
        monthlyAmount: s.monthlyAmount,
        unlimited: s.unlimited === true,
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

// Budget allowlist: null means "all budgets, including ones created later"
// (the default); an array restricts visibility to those budget ids. Only
// enforceable for gateway-served roles (companion/advisor) — full-view roles
// read the whole document by design.
function allowedBudgets(budgets, grant) {
    if (!grant || !Array.isArray(grant.budgetIds)) return budgets || [];
    const allow = new Set(grant.budgetIds);
    return (budgets || []).filter(b => allow.has(b.id));
}

// Merge a shared editor's budget update into the owner's full budget list:
// only budgets the grant can SEE may change, hidden budgets pass through
// untouched, and adding or deleting budgets is not allowed. Returns
// { budgets } or { error }.
function mergeSharedBudgetUpdate(existingBudgets, incomingBudgets, grant) {
    const existing = existingBudgets || [];
    const visibleIds = new Set(allowedBudgets(existing, grant).map(b => b.id));
    const incomingById = new Map();
    for (const b of incomingBudgets || []) {
        if (!b || !b.id) return { error: 'Every budget update needs an id.' };
        if (!visibleIds.has(b.id)) return { error: 'You can only change budgets shared with you.' };
        incomingById.set(b.id, b);
    }
    return {
        budgets: existing.map(b => incomingById.has(b.id) ? { ...b, ...incomingById.get(b.id), id: b.id } : b),
    };
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

    // Budget visibility: partial roles may be granted a subset of budgets.
    const visibleBudgets = allowedBudgets(budgetsOf(data), grant);

    const snapshot = {
        _shared: {
            role,
            canEditBudgets: canEditBudgets(grant),
            ownerName: data.userName || 'Owner',
            generatedAt: now.toISOString(),
        },
        budgets: computeBudgetAggregates({ ...data, categoryBudgets: visibleBudgets, budgets: undefined }, now),
        accounts: filterAccounts(data, grant),
    };

    // Editing budgets requires the raw configs (id/startMonth/rollover) so
    // the client can send valid updates. Notes stay private.
    if (canEditBudgets(grant)) {
        snapshot.budgetConfigs = visibleBudgets.map(b => ({
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
    allowedBudgets,
    mergeSharedBudgetUpdate,
    filterDataForRole,
};
