/**
 * Transaction rules engine — pure functions for matching and mutating expenses.
 *
 * A rule has this shape:
 *   {
 *     id: string,
 *     name: string,
 *     enabled: boolean,
 *     priority: number,              // lower = higher priority (0 runs first)
 *     match: {
 *       field: 'name' | 'vendor' | 'amount' | 'category',
 *       op:    'contains' | 'equals' | 'regex' | 'gt' | 'lt' | 'gte' | 'lte',
 *       value: string | number
 *     },
 *     actions: {
 *       category?: string,        // set category
 *       addTags?: string[],       // append to tags (deduped)
 *       rename?: string,          // replace name
 *       ignore?: boolean,         // mark as ignored (excluded from reports)
 *       expenseType?: 'personal' | 'business',  // tag as personal or business
 *       businessName?: string     // assign to a specific business (implies expenseType=business)
 *     }
 *   }
 *
 * Rules run in priority order, lowest first. Every matching enabled rule
 * applies its actions in sequence — this means later rules can override
 * earlier ones (by design — lets you have a general rule like "groceries"
 * and a specific override like "wholesale clubs").
 */

export function matchesRule(rule, expense) {
    if (!rule || !rule.enabled) return false;
    const m = rule.match;
    if (!m || !m.field || !m.op) return false;

    const raw = expense[m.field];
    const target = m.value;

    switch (m.op) {
        case 'contains': {
            if (raw == null || target == null) return false;
            return String(raw).toLowerCase().includes(String(target).toLowerCase());
        }
        case 'equals': {
            if (raw == null || target == null) return false;
            // Case-insensitive for strings, strict for numbers.
            if (typeof target === 'number' || m.field === 'amount') {
                return Number(raw) === Number(target);
            }
            return String(raw).toLowerCase() === String(target).toLowerCase();
        }
        case 'regex': {
            if (raw == null || target == null) return false;
            try {
                return new RegExp(String(target), 'i').test(String(raw));
            } catch {
                return false; // invalid regex — fail closed
            }
        }
        case 'gt':  return Number(raw) >  Number(target);
        case 'gte': return Number(raw) >= Number(target);
        case 'lt':  return Number(raw) <  Number(target);
        case 'lte': return Number(raw) <= Number(target);
        default:    return false;
    }
}

export function applyActions(actions, expense) {
    if (!actions) return expense;
    const next = { ...expense };

    if (actions.category) {
        next.category = actions.category;
    }
    if (actions.rename) {
        next.name = actions.rename;
    }
    if (actions.ignore === true || actions.ignore === false) {
        next.ignored = !!actions.ignore;
    }
    if (Array.isArray(actions.addTags) && actions.addTags.length > 0) {
        const existing = Array.isArray(next.tags) ? next.tags : [];
        const merged = new Set(existing.map(t => String(t).trim()).filter(Boolean));
        for (const t of actions.addTags) {
            const clean = String(t).trim();
            if (clean) merged.add(clean);
        }
        next.tags = [...merged];
    }

    // Expense type — "personal" clears any lingering businessName so the row
    // renders cleanly. "business" stands on its own; a separate businessName
    // action can also pin the expense to a specific company.
    if (actions.expenseType === 'personal') {
        next.expenseType = 'personal';
        next.businessName = null;
    } else if (actions.expenseType === 'business') {
        next.expenseType = 'business';
    }

    // Setting a businessName implies the expense is business — promote if
    // the user didn't set expenseType explicitly. An empty string means
    // "no specific business" and leaves expenseType alone (so a rule can
    // clear a stale businessName without changing type).
    if (actions.businessName !== undefined && actions.businessName !== null) {
        const bn = String(actions.businessName).trim();
        next.businessName = bn || null;
        if (bn && actions.expenseType !== 'personal') {
            next.expenseType = 'business';
        }
    }

    return next;
}

/**
 * Apply an ordered rule list to a single expense. Returns a new expense
 * object (pure function — does not mutate the input).
 */
export function applyRulesToExpense(rules, expense) {
    if (!Array.isArray(rules) || rules.length === 0) return expense;

    // Stable sort by priority ascending.
    const sorted = [...rules].sort((a, b) =>
        (a.priority ?? 0) - (b.priority ?? 0)
    );

    let current = expense;
    for (const rule of sorted) {
        if (matchesRule(rule, current)) {
            current = applyActions(rule.actions, current);
        }
    }
    return current;
}

/**
 * Apply rules across a list of expenses. Returns a fresh array.
 */
export function applyRulesToExpenses(rules, expenses) {
    if (!Array.isArray(expenses)) return [];
    return expenses.map(e => applyRulesToExpense(rules, e));
}

/**
 * Validate a rule shape before persisting. Returns null if valid,
 * an error string if not.
 */
export function validateRule(rule) {
    if (!rule || typeof rule !== 'object') return 'Rule must be an object';
    if (!rule.name || String(rule.name).trim() === '') return 'Rule name is required';
    if (!rule.match || !rule.match.field) return 'Match field is required';
    if (!['name', 'vendor', 'amount', 'category'].includes(rule.match.field)) {
        return `Invalid match field: ${rule.match.field}`;
    }
    if (!['contains', 'equals', 'regex', 'gt', 'gte', 'lt', 'lte'].includes(rule.match.op)) {
        return `Invalid match operator: ${rule.match.op}`;
    }
    if (rule.match.value == null || rule.match.value === '') {
        return 'Match value is required';
    }
    if (['gt', 'gte', 'lt', 'lte'].includes(rule.match.op)) {
        if (isNaN(Number(rule.match.value))) {
            return `Operator ${rule.match.op} requires a numeric value`;
        }
    }
    if (!rule.actions || typeof rule.actions !== 'object') {
        return 'At least one action is required';
    }
    const hasAction = rule.actions.category
        || rule.actions.rename
        || (Array.isArray(rule.actions.addTags) && rule.actions.addTags.length > 0)
        || rule.actions.ignore === true
        || rule.actions.ignore === false
        || rule.actions.expenseType === 'personal'
        || rule.actions.expenseType === 'business'
        || (typeof rule.actions.businessName === 'string' && rule.actions.businessName.trim() !== '');
    if (!hasAction) return 'At least one action is required';
    if (rule.actions.expenseType && !['personal', 'business'].includes(rule.actions.expenseType)) {
        return `Invalid expenseType: ${rule.actions.expenseType}`;
    }
    return null;
}
