/**
 * Canonical expense/budget category list.
 *
 * Categories are grouped for UI display and have a consistent color per group.
 * The key is the machine-readable slug stored in expenses, budgets, and bills.
 *
 * Users can create their own categories via store.addCustomExpenseCategory();
 * those are merged into the lookup at runtime via getAllExpenseCategories().
 */

// ─── Group colors ─────────────────────────────────

const G = {
    housing:       '#22c55e',
    utilities:     '#eab308',
    food:          '#f97316',
    transportation:'#0ea5e9',
    shopping:      '#ec4899',
    entertainment: '#a855f7',
    health:        '#ef4444',
    personal:      '#14b8a6',
    education:     '#3b82f6',
    travel:        '#06b6d4',
    finance:       '#6366f1',
    family:        '#d946ef',
    pets:          '#d97706',
    gifts:         '#f43f5e',
    business:      '#8b5cf6',
    subscriptions: '#64748b',
    income:        '#10b981',
    taxes:         '#78716c',
    other:         '#94a3b8',
};

// ─── Built-in categories ──────────────────────────

export const EXPENSE_CATEGORIES = {
    // ── Housing & Home ──
    'rent':              { label: 'Rent',                group: 'Housing',        color: G.housing },
    'mortgage':          { label: 'Mortgage',            group: 'Housing',        color: G.housing },
    'home-insurance':    { label: 'Home Insurance',      group: 'Housing',        color: G.housing },
    'property-tax':      { label: 'Property Tax',        group: 'Housing',        color: G.housing },
    'hoa':               { label: 'HOA Fees',            group: 'Housing',        color: G.housing },
    'home-repair':       { label: 'Home Repair',         group: 'Housing',        color: G.housing },
    'home-improvement':  { label: 'Home Improvement',    group: 'Housing',        color: G.housing },
    'home-furnishing':   { label: 'Furnishing',          group: 'Housing',        color: G.housing },
    'lawn-garden':       { label: 'Lawn & Garden',       group: 'Housing',        color: G.housing },
    'cleaning':          { label: 'Cleaning Supplies',   group: 'Housing',        color: G.housing },
    'home':              { label: 'Home (General)',       group: 'Housing',        color: G.housing },

    // ── Utilities ──
    'electric':          { label: 'Electric',            group: 'Utilities',      color: G.utilities },
    'gas-utility':       { label: 'Gas (Utility)',       group: 'Utilities',      color: G.utilities },
    'water':             { label: 'Water & Sewer',       group: 'Utilities',      color: G.utilities },
    'trash':             { label: 'Trash & Recycling',   group: 'Utilities',      color: G.utilities },
    'internet':          { label: 'Internet',            group: 'Utilities',      color: G.utilities },
    'phone':             { label: 'Phone / Mobile',      group: 'Utilities',      color: G.utilities },
    'cable-tv':          { label: 'Cable / TV',          group: 'Utilities',      color: G.utilities },
    'utilities':         { label: 'Utilities (General)', group: 'Utilities',      color: G.utilities },

    // ── Food & Drink ──
    'groceries':         { label: 'Groceries',           group: 'Food & Drink',   color: G.food },
    'dining':            { label: 'Dining Out',          group: 'Food & Drink',   color: G.food },
    'fast-food':         { label: 'Fast Food',           group: 'Food & Drink',   color: G.food },
    'coffee':            { label: 'Coffee & Tea',        group: 'Food & Drink',   color: G.food },
    'alcohol':           { label: 'Alcohol & Bars',      group: 'Food & Drink',   color: G.food },
    'food-delivery':     { label: 'Food Delivery',       group: 'Food & Drink',   color: G.food },
    'snacks':            { label: 'Snacks & Vending',    group: 'Food & Drink',   color: G.food },
    'meal-prep':         { label: 'Meal Prep / Kits',    group: 'Food & Drink',   color: G.food },

    // ── Transportation ──
    'gas':               { label: 'Gas / Fuel',          group: 'Transportation', color: G.transportation },
    'car-payment':       { label: 'Car Payment',         group: 'Transportation', color: G.transportation },
    'car-insurance':     { label: 'Car Insurance',       group: 'Transportation', color: G.transportation },
    'car-maintenance':   { label: 'Car Maintenance',     group: 'Transportation', color: G.transportation },
    'car-wash':          { label: 'Car Wash',            group: 'Transportation', color: G.transportation },
    'parking':           { label: 'Parking',             group: 'Transportation', color: G.transportation },
    'tolls':             { label: 'Tolls',               group: 'Transportation', color: G.transportation },
    'public-transit':    { label: 'Public Transit',      group: 'Transportation', color: G.transportation },
    'rideshare':         { label: 'Rideshare / Taxi',    group: 'Transportation', color: G.transportation },
    'ev-charging':       { label: 'EV Charging',         group: 'Transportation', color: G.transportation },
    'registration':      { label: 'Registration / DMV',  group: 'Transportation', color: G.transportation },
    'transportation':    { label: 'Transport (General)', group: 'Transportation', color: G.transportation },

    // ── Shopping ──
    'clothing':          { label: 'Clothing',            group: 'Shopping',       color: G.shopping },
    'shoes':             { label: 'Shoes',               group: 'Shopping',       color: G.shopping },
    'electronics':       { label: 'Electronics',         group: 'Shopping',       color: G.shopping },
    'home-goods':        { label: 'Home Goods',          group: 'Shopping',       color: G.shopping },
    'online-shopping':   { label: 'Online Shopping',     group: 'Shopping',       color: G.shopping },
    'sporting-goods':    { label: 'Sporting Goods',      group: 'Shopping',       color: G.shopping },
    'beauty-products':   { label: 'Beauty Products',     group: 'Shopping',       color: G.shopping },
    'books':             { label: 'Books',               group: 'Shopping',       color: G.shopping },
    'office-supplies':   { label: 'Office Supplies',     group: 'Shopping',       color: G.shopping },
    'shopping':          { label: 'Shopping (General)',   group: 'Shopping',       color: G.shopping },

    // ── Entertainment ──
    'movies':            { label: 'Movies / Cinema',     group: 'Entertainment',  color: G.entertainment },
    'concerts':          { label: 'Concerts / Events',   group: 'Entertainment',  color: G.entertainment },
    'streaming':         { label: 'Streaming Services',  group: 'Entertainment',  color: G.entertainment },
    'gaming':            { label: 'Gaming',              group: 'Entertainment',  color: G.entertainment },
    'hobbies':           { label: 'Hobbies',             group: 'Entertainment',  color: G.entertainment },
    'sports-tickets':    { label: 'Sports Tickets',      group: 'Entertainment',  color: G.entertainment },
    'music':             { label: 'Music',               group: 'Entertainment',  color: G.entertainment },
    'arts-crafts':       { label: 'Arts & Crafts',       group: 'Entertainment',  color: G.entertainment },
    'theme-parks':       { label: 'Theme Parks',         group: 'Entertainment',  color: G.entertainment },
    'entertainment':     { label: 'Entertainment (General)', group: 'Entertainment', color: G.entertainment },

    // ── Health & Wellness ──
    'healthcare':        { label: 'Healthcare',          group: 'Health',         color: G.health },
    'doctor':            { label: 'Doctor / Copay',      group: 'Health',         color: G.health },
    'dentist':           { label: 'Dentist',             group: 'Health',         color: G.health },
    'vision':            { label: 'Vision / Eye Care',   group: 'Health',         color: G.health },
    'pharmacy':          { label: 'Pharmacy',            group: 'Health',         color: G.health },
    'health-insurance':  { label: 'Health Insurance',    group: 'Health',         color: G.health },
    'gym':               { label: 'Gym / Fitness',       group: 'Health',         color: G.health },
    'therapy':           { label: 'Therapy / Counseling',group: 'Health',         color: G.health },
    'vitamins':          { label: 'Vitamins & Supplements',group: 'Health',       color: G.health },
    'mental-health':     { label: 'Mental Health',       group: 'Health',         color: G.health },
    'medical-devices':   { label: 'Medical Devices',     group: 'Health',         color: G.health },

    // ── Personal Care ──
    'haircut':           { label: 'Haircut / Salon',     group: 'Personal Care',  color: G.personal },
    'spa':               { label: 'Spa / Massage',       group: 'Personal Care',  color: G.personal },
    'cosmetics':         { label: 'Cosmetics / Makeup',  group: 'Personal Care',  color: G.personal },
    'skincare':          { label: 'Skincare',            group: 'Personal Care',  color: G.personal },
    'laundry':           { label: 'Laundry / Dry Cleaning',group: 'Personal Care',color: G.personal },
    'personal-care':     { label: 'Personal Care (General)',group: 'Personal Care',color: G.personal },

    // ── Education ──
    'tuition':           { label: 'Tuition',             group: 'Education',      color: G.education },
    'student-loans':     { label: 'Student Loans',       group: 'Education',      color: G.education },
    'textbooks':         { label: 'Textbooks',           group: 'Education',      color: G.education },
    'courses':           { label: 'Online Courses',      group: 'Education',      color: G.education },
    'tutoring':          { label: 'Tutoring',            group: 'Education',      color: G.education },
    'school-supplies':   { label: 'School Supplies',     group: 'Education',      color: G.education },
    'education':         { label: 'Education (General)', group: 'Education',      color: G.education },

    // ── Travel ──
    'flights':           { label: 'Flights',             group: 'Travel',         color: G.travel },
    'hotels':            { label: 'Hotels / Lodging',    group: 'Travel',         color: G.travel },
    'car-rental':        { label: 'Car Rental',          group: 'Travel',         color: G.travel },
    'vacation':          { label: 'Vacation',            group: 'Travel',         color: G.travel },
    'luggage':           { label: 'Luggage / Travel Gear',group: 'Travel',        color: G.travel },
    'travel-insurance':  { label: 'Travel Insurance',    group: 'Travel',         color: G.travel },
    'travel':            { label: 'Travel (General)',     group: 'Travel',         color: G.travel },

    // ── Finance & Banking ──
    'bank-fees':         { label: 'Bank Fees',           group: 'Finance',        color: G.finance },
    'atm-fees':          { label: 'ATM Fees',            group: 'Finance',        color: G.finance },
    'interest':          { label: 'Interest Charges',    group: 'Finance',        color: G.finance },
    'late-fees':         { label: 'Late Fees',           group: 'Finance',        color: G.finance },
    'investment':        { label: 'Investments',         group: 'Finance',        color: G.finance },
    'savings':           { label: 'Savings / Transfer',  group: 'Finance',        color: G.finance },
    'financial-advisor': { label: 'Financial Advisor',   group: 'Finance',        color: G.finance },
    'loan-payment':      { label: 'Loan Payment',        group: 'Finance',        color: G.finance },
    'credit-card-payment':{ label: 'Credit Card Payment',group: 'Finance',        color: G.finance },

    // ── Family & Kids ──
    'childcare':         { label: 'Childcare / Daycare', group: 'Family',         color: G.family },
    'babysitter':        { label: 'Babysitter',          group: 'Family',         color: G.family },
    'kids-activities':   { label: 'Kids Activities',     group: 'Family',         color: G.family },
    'kids-clothing':     { label: 'Kids Clothing',       group: 'Family',         color: G.family },
    'diapers':           { label: 'Diapers & Baby',      group: 'Family',         color: G.family },
    'school-fees':       { label: 'School Fees',         group: 'Family',         color: G.family },
    'allowance':         { label: 'Allowance',           group: 'Family',         color: G.family },
    'child-support':     { label: 'Child Support',       group: 'Family',         color: G.family },
    'elder-care':        { label: 'Elder Care',          group: 'Family',         color: G.family },
    'family':            { label: 'Family (General)',     group: 'Family',         color: G.family },

    // ── Pets ──
    'pet-food':          { label: 'Pet Food',            group: 'Pets',           color: G.pets },
    'vet':               { label: 'Vet / Veterinary',    group: 'Pets',           color: G.pets },
    'pet-grooming':      { label: 'Pet Grooming',        group: 'Pets',           color: G.pets },
    'pet-supplies':      { label: 'Pet Supplies',        group: 'Pets',           color: G.pets },
    'pet-insurance':     { label: 'Pet Insurance',       group: 'Pets',           color: G.pets },
    'pet-boarding':      { label: 'Boarding / Pet Sitting',group: 'Pets',         color: G.pets },
    'pets':              { label: 'Pets (General)',       group: 'Pets',           color: G.pets },

    // ── Gifts & Charity ──
    'gifts':             { label: 'Gifts',               group: 'Gifts & Charity',color: G.gifts },
    'charity':           { label: 'Charity / Donations', group: 'Gifts & Charity',color: G.gifts },
    'tithe':             { label: 'Tithe / Church',      group: 'Gifts & Charity',color: G.gifts },
    'holiday-gifts':     { label: 'Holiday Gifts',       group: 'Gifts & Charity',color: G.gifts },
    'birthday-gifts':    { label: 'Birthday Gifts',      group: 'Gifts & Charity',color: G.gifts },
    'wedding-gifts':     { label: 'Wedding Gifts',       group: 'Gifts & Charity',color: G.gifts },

    // ── Subscriptions & Memberships ──
    'subscriptions':     { label: 'Subscriptions (General)',group: 'Subscriptions',color: G.subscriptions },
    'software':          { label: 'Software / Apps',     group: 'Subscriptions',  color: G.subscriptions },
    'cloud-storage':     { label: 'Cloud Storage',       group: 'Subscriptions',  color: G.subscriptions },
    'news-magazines':    { label: 'News / Magazines',    group: 'Subscriptions',  color: G.subscriptions },
    'membership':        { label: 'Membership Fees',     group: 'Subscriptions',  color: G.subscriptions },
    'union-dues':        { label: 'Union Dues',          group: 'Subscriptions',  color: G.subscriptions },

    // ── Business ──
    'business-expense':  { label: 'Business Expense',    group: 'Business',       color: G.business },
    'business-travel':   { label: 'Business Travel',     group: 'Business',       color: G.business },
    'business-meals':    { label: 'Business Meals',      group: 'Business',       color: G.business },
    'business-supplies': { label: 'Business Supplies',   group: 'Business',       color: G.business },
    'professional-dev':  { label: 'Professional Development',group: 'Business',   color: G.business },
    'licensing':         { label: 'Licensing / Permits',  group: 'Business',      color: G.business },
    'business-insurance':{ label: 'Business Insurance',   group: 'Business',      color: G.business },

    // ── Taxes & Government ──
    'federal-tax':       { label: 'Federal Tax',         group: 'Taxes',          color: G.taxes },
    'state-tax':         { label: 'State Tax',           group: 'Taxes',          color: G.taxes },
    'tax-preparation':   { label: 'Tax Preparation',     group: 'Taxes',          color: G.taxes },
    'tax-payment':       { label: 'Tax Payment',         group: 'Taxes',          color: G.taxes },
    'government-fees':   { label: 'Government Fees',     group: 'Taxes',          color: G.taxes },
    'fines':             { label: 'Fines / Tickets',     group: 'Taxes',          color: G.taxes },

    // ── Income (for tracking inflows) ──
    'salary':            { label: 'Salary',              group: 'Income',         color: G.income },
    'freelance':         { label: 'Freelance',           group: 'Income',         color: G.income },
    'side-hustle':       { label: 'Side Hustle',         group: 'Income',         color: G.income },
    'refund':            { label: 'Refund',              group: 'Income',         color: G.income },
    'reimbursement':     { label: 'Reimbursement',       group: 'Income',         color: G.income },
    'rental-income':     { label: 'Rental Income',       group: 'Income',         color: G.income },
    'dividends':         { label: 'Dividends',           group: 'Income',         color: G.income },
    'cash-back':         { label: 'Cash Back / Rewards', group: 'Income',         color: G.income },

    // ── Miscellaneous ──
    'legal':             { label: 'Legal Fees',          group: 'Other',          color: G.other },
    'moving':            { label: 'Moving Expenses',     group: 'Other',          color: G.other },
    'storage':           { label: 'Storage Unit',        group: 'Other',          color: G.other },
    'postage':           { label: 'Postage / Shipping',  group: 'Other',          color: G.other },
    'miscellaneous':     { label: 'Miscellaneous',       group: 'Other',          color: G.other },
    'uncategorized':     { label: 'Uncategorized',       group: 'Other',          color: G.other },
    'other':             { label: 'Other',               group: 'Other',          color: G.other },
};

// ─── Runtime helpers ──────────────────────────────

/**
 * Normalize any user-supplied category string to a canonical EXPENSE_CATEGORIES key.
 *
 * The app historically let bills, rules, and Plaid ingestion write whatever
 * casing or label the user typed (e.g. "Mortgage", "Groceries", "groceries"),
 * which broke the budget matcher because it compares by strict `===`. This
 * helper returns the canonical lowercase key whenever we can confidently
 * recognize the input; unknown/custom strings are passed through UNCHANGED so
 * we don't nuke a user's bespoke category.
 *
 * Accepts (in priority order):
 *   1. Exact key match (case-insensitive)             → that canonical key
 *   2. Exact label match (case-insensitive)           → that canonical key
 *   3. Slugified label match (lowercase, hyphenated)  → that canonical key
 *   4. Anything else                                  → input trimmed, unchanged
 *
 * Null / undefined / empty → null (callers decide the fallback).
 *
 * @param {string} input — the category string from a form, rule, or import
 * @param {object} [store] — optional; includes custom categories in the lookup
 * @returns {string|null}
 */
export function normalizeCategoryKey(input, store) {
    if (input == null) return null;
    const raw = String(input).trim();
    if (raw === '') return null;

    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    const needle = raw.toLowerCase();

    // 1. Exact key match (case-insensitive).
    for (const key of Object.keys(all)) {
        if (key.toLowerCase() === needle) return key;
    }

    // 2. Exact label match (case-insensitive).
    for (const [key, cat] of Object.entries(all)) {
        if ((cat.label || '').toLowerCase() === needle) return key;
    }

    // 3. Slugified label (e.g. "Credit Card Payment" → "credit-card-payment").
    //    Useful when a stored value happens to match a key after normalizing.
    const slug = needle.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug && all[slug]) return slug;

    // 4. Unknown → pass through (trimmed) so custom categories survive.
    return raw;
}

/** All unique group names in display order. */
export function getCategoryGroups() {
    const seen = new Set();
    const groups = [];
    for (const cat of Object.values(EXPENSE_CATEGORIES)) {
        if (!seen.has(cat.group)) {
            seen.add(cat.group);
            groups.push(cat.group);
        }
    }
    return groups;
}

/**
 * Build a merged map: built-in categories + user-created custom categories.
 * Custom categories appear under the group "Custom" and use user-picked colors.
 */
export function getAllExpenseCategories(store) {
    const merged = { ...EXPENSE_CATEGORIES };
    if (!store) return merged;
    const customs = store.getCustomExpenseCategories ? store.getCustomExpenseCategories() : [];
    for (const c of customs) {
        const key = c.key || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (!merged[key]) {
            merged[key] = { label: c.name, group: 'Custom', color: c.color || '#94a3b8' };
        }
    }
    return merged;
}

export function getCategoryLabel(key, store) {
    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    return (all[key] || all['other']).label;
}

export function getCategoryColor(key, store) {
    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    return (all[key] || all['other']).color;
}

export function getExpenseCategoryBadge(category, store) {
    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    const cat = all[category] || all['other'];
    return `<span class="badge" style="background:${cat.color}20;color:${cat.color};border:1px solid ${cat.color}40;">${cat.label}</span>`;
}

/**
 * Render a grouped <optgroup> dropdown with a "Create new..." option at the bottom.
 * Returns the inner HTML for a <select> element.
 */
export function renderCategoryOptions(selectedKey, store) {
    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    const groups = {};
    for (const [key, cat] of Object.entries(all)) {
        const g = cat.group || 'Other';
        if (!groups[g]) groups[g] = [];
        groups[g].push({ key, ...cat });
    }

    let html = '<option value="">— select a category —</option>';
    for (const [groupName, cats] of Object.entries(groups)) {
        html += `<optgroup label="${groupName}">`;
        for (const c of cats) {
            html += `<option value="${c.key}" ${c.key === selectedKey ? 'selected' : ''}>${c.label}</option>`;
        }
        html += '</optgroup>';
    }
    html += '<optgroup label="───────────"><option value="__create_new__">+ Create new category...</option></optgroup>';
    return html;
}

// ─── Searchable category picker ───────────────────

/**
 * Replace a plain <select> with a searchable text input + dropdown.
 * The hidden <select> retains the selected value for form reads.
 *
 * @param {HTMLSelectElement} selectEl — the <select> to enhance
 * @param {object} store — for custom categories
 * @param {object} [opts]
 * @param {Function} [opts.onCreateNew] — called when user picks "+ Create new"
 */
export function mountSearchableCategoryPicker(selectEl, store, opts = {}) {
    if (!selectEl || selectEl.dataset.searchable === 'true') return; // already mounted
    selectEl.dataset.searchable = 'true';

    const all = store ? getAllExpenseCategories(store) : EXPENSE_CATEGORIES;
    const entries = Object.entries(all).map(([key, cat]) => ({
        key, label: cat.label, group: cat.group || 'Other', color: cat.color,
    }));

    // Build wrapper
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;';
    selectEl.parentNode.insertBefore(wrapper, selectEl);

    // Hidden select stays for value reads
    selectEl.style.display = 'none';
    wrapper.appendChild(selectEl);

    // Text input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.placeholder = 'Search categories...';
    input.autocomplete = 'off';
    input.style.cssText = 'width:100%;';
    // Pre-fill with current selection label
    const currentKey = selectEl.value;
    if (currentKey && all[currentKey]) {
        input.value = all[currentKey].label;
    }
    wrapper.appendChild(input);

    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;max-height:260px;overflow-y:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:0 0 6px 6px;z-index:100;display:none;box-shadow:0 8px 24px rgba(0,0,0,0.2);';
    wrapper.appendChild(dropdown);

    // Common categories shown at the top when no filter is active
    const COMMON_KEYS = [
        'groceries', 'dining', 'gas', 'rent', 'mortgage', 'utilities',
        'electric', 'internet', 'phone', 'streaming', 'subscriptions',
        'coffee', 'shopping', 'clothing', 'healthcare', 'pharmacy',
        'gym', 'car-insurance', 'car-payment', 'car-maintenance',
        'childcare', 'pet-food', 'gifts', 'entertainment',
    ];

    function renderDropdown(filter) {
        const q = (filter || '').toLowerCase();
        const groups = {};
        for (const e of entries) {
            if (q && !e.label.toLowerCase().includes(q) && !e.group.toLowerCase().includes(q) && !e.key.includes(q)) continue;
            if (!groups[e.group]) groups[e.group] = [];
            groups[e.group].push(e);
        }

        let html = '';

        // When no filter, show common categories first for quick selection
        if (!q) {
            const common = COMMON_KEYS
                .map(k => entries.find(e => e.key === k))
                .filter(Boolean);
            if (common.length > 0) {
                html += `<div style="padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);position:sticky;top:0;">Common</div>`;
                for (const c of common) {
                    html += `<div class="cat-pick-item" data-key="${c.key}" style="padding:7px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;" onmouseover="this.style.background='var(--bg-input)'" onmouseout="this.style.background=''">`;
                    html += `<span style="width:8px;height:8px;border-radius:2px;background:${c.color};flex-shrink:0;"></span>`;
                    html += `${c.label}</div>`;
                }
                html += `<div style="border-top:1px solid var(--border);margin:4px 0;"></div>`;
            }
        }

        for (const [groupName, cats] of Object.entries(groups)) {
            html += `<div style="padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);position:sticky;top:0;">${groupName}</div>`;
            for (const c of cats) {
                html += `<div class="cat-pick-item" data-key="${c.key}" style="padding:7px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;" onmouseover="this.style.background='var(--bg-input)'" onmouseout="this.style.background=''">`;
                html += `<span style="width:8px;height:8px;border-radius:2px;background:${c.color};flex-shrink:0;"></span>`;
                html += `${c.label}</div>`;
            }
        }
        // "Create new" always visible
        html += `<div style="border-top:1px solid var(--border);padding:4px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);background:var(--bg-input);">───</div>`;
        html += `<div class="cat-pick-item" data-key="__create_new__" style="padding:7px 12px;cursor:pointer;font-size:13px;color:var(--accent);font-weight:600;" onmouseover="this.style.background='var(--bg-input)'" onmouseout="this.style.background=''">+ Create new category...</div>`;

        if (!html.includes('cat-pick-item')) {
            html = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">No matches</div>' + html;
        }

        dropdown.innerHTML = html;

        dropdown.querySelectorAll('.cat-pick-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // prevent input blur
                const key = item.dataset.key;
                if (key === '__create_new__') {
                    dropdown.style.display = 'none';
                    if (opts.onCreateNew) {
                        opts.onCreateNew(input, selectEl);
                    } else {
                        const name = prompt('New category name:');
                        if (name && name.trim() && store && store.addCustomExpenseCategory) {
                            try {
                                const created = store.addCustomExpenseCategory({ name: name.trim(), color: '#94a3b8' });
                                selectEl.innerHTML = renderCategoryOptions(created.key, store);
                                selectEl.value = created.key;
                                input.value = created.name;
                            } catch (err) { alert(err.message); }
                        }
                    }
                } else {
                    selectEl.value = key;
                    input.value = item.textContent.trim();
                    dropdown.style.display = 'none';
                    selectEl.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    let userTyping = false;

    input.addEventListener('focus', () => {
        // On focus, show common categories (no filter) — user hasn't typed yet.
        // Select the text so typing immediately replaces the current label.
        userTyping = false;
        input.select();
        renderDropdown('');
        dropdown.style.display = '';
    });

    input.addEventListener('input', () => {
        userTyping = true;
        renderDropdown(input.value);
        dropdown.style.display = '';
    });

    input.addEventListener('blur', () => {
        // Small delay so mousedown on item fires first
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
    });

    // Clear input restores default
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdown.style.display = 'none';
            input.blur();
        }
    });
}
