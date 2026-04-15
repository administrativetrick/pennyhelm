/**
 * Canonical expense category list.
 *
 * Single source of truth shared by the Expenses tab on the Debts page,
 * the Budgets page, and any future surface that needs the list.
 */

export const EXPENSE_CATEGORIES = {
    'groceries':     { label: 'Groceries',     color: '#22c55e' },
    'dining':        { label: 'Dining',        color: '#f97316' },
    'gas':           { label: 'Gas',           color: '#6366f1' },
    'transportation':{ label: 'Transport',     color: '#0ea5e9' },
    'shopping':      { label: 'Shopping',      color: '#ec4899' },
    'entertainment': { label: 'Entertainment', color: '#a855f7' },
    'healthcare':    { label: 'Healthcare',    color: '#ef4444' },
    'personal-care': { label: 'Personal Care', color: '#14b8a6' },
    'home':          { label: 'Home',          color: '#8b5cf6' },
    'utilities':     { label: 'Utilities',     color: '#eab308' },
    'education':     { label: 'Education',     color: '#3b82f6' },
    'travel':        { label: 'Travel',        color: '#06b6d4' },
    'gifts':         { label: 'Gifts',         color: '#f43f5e' },
    'subscriptions': { label: 'Subscriptions', color: '#64748b' },
    'pets':          { label: 'Pets',          color: '#d97706' },
    'other':         { label: 'Other',         color: '#94a3b8' },
};

export function getCategoryLabel(key) {
    return (EXPENSE_CATEGORIES[key] || EXPENSE_CATEGORIES['other']).label;
}

export function getCategoryColor(key) {
    return (EXPENSE_CATEGORIES[key] || EXPENSE_CATEGORIES['other']).color;
}

export function getExpenseCategoryBadge(category) {
    const cat = EXPENSE_CATEGORIES[category] || EXPENSE_CATEGORIES['other'];
    return `<span class="badge" style="background:${cat.color}20;color:${cat.color};border:1px solid ${cat.color}40;">${cat.label}</span>`;
}
