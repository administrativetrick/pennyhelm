// Comprehensive bill categories with grouping and color assignments
// This file is the source of truth for default categories

export const DEFAULT_CATEGORIES = [
    // Housing & Home
    { name: 'Housing', group: 'Housing', color: 'green' },
    { name: 'Rent', group: 'Housing', color: 'green' },
    { name: 'Mortgage', group: 'Housing', color: 'green' },
    { name: 'Home Maintenance', group: 'Housing', color: 'green' },
    { name: 'HOA', group: 'Housing', color: 'green' },

    // Utilities
    { name: 'Utilities', group: 'Utilities', color: 'yellow' },
    { name: 'Electric', group: 'Utilities', color: 'yellow' },
    { name: 'Gas', group: 'Utilities', color: 'yellow' },
    { name: 'Water', group: 'Utilities', color: 'yellow' },
    { name: 'Trash', group: 'Utilities', color: 'yellow' },
    { name: 'Internet', group: 'Utilities', color: 'blue' },
    { name: 'Phone', group: 'Utilities', color: 'blue' },
    { name: 'Cable/TV', group: 'Utilities', color: 'blue' },

    // Transportation
    { name: 'Car', group: 'Transportation', color: 'orange' },
    { name: 'Auto Loan', group: 'Transportation', color: 'orange' },
    { name: 'Car Insurance', group: 'Transportation', color: 'orange' },
    { name: 'Gas/Fuel', group: 'Transportation', color: 'orange' },
    { name: 'Public Transit', group: 'Transportation', color: 'orange' },
    { name: 'Parking', group: 'Transportation', color: 'orange' },

    // Food
    { name: 'Groceries', group: 'Food', color: 'green' },
    { name: 'Dining Out', group: 'Food', color: 'purple' },
    { name: 'Food Delivery', group: 'Food', color: 'purple' },

    // Entertainment & Subscriptions
    { name: 'Entertainment', group: 'Entertainment', color: 'purple' },
    { name: 'Streaming', group: 'Entertainment', color: 'blue' },
    { name: 'Subscription', group: 'Entertainment', color: 'blue' },
    { name: 'Gaming', group: 'Entertainment', color: 'purple' },
    { name: 'Music', group: 'Entertainment', color: 'purple' },

    // Insurance
    { name: 'Insurance', group: 'Insurance', color: 'pink' },
    { name: 'Health Insurance', group: 'Insurance', color: 'pink' },
    { name: 'Life Insurance', group: 'Insurance', color: 'pink' },
    { name: 'Home Insurance', group: 'Insurance', color: 'pink' },
    { name: 'Renters Insurance', group: 'Insurance', color: 'pink' },

    // Healthcare
    { name: 'Medical', group: 'Healthcare', color: 'red' },
    { name: 'Healthcare', group: 'Healthcare', color: 'red' },
    { name: 'Dental', group: 'Healthcare', color: 'red' },
    { name: 'Vision', group: 'Healthcare', color: 'red' },
    { name: 'Pharmacy', group: 'Healthcare', color: 'red' },

    // Debt & Credit
    { name: 'Credit Card', group: 'Debt', color: 'red' },
    { name: 'Loan', group: 'Debt', color: 'red' },
    { name: 'Student Loan', group: 'Debt', color: 'red' },
    { name: 'Personal Loan', group: 'Debt', color: 'red' },
    { name: 'Debt Payment', group: 'Debt', color: 'red' },

    // Family
    { name: 'Childcare', group: 'Family', color: 'purple' },
    { name: 'Education', group: 'Family', color: 'blue' },
    { name: 'Pet', group: 'Family', color: 'cyan' },
    { name: 'Child Support', group: 'Family', color: 'purple' },
    { name: 'Alimony', group: 'Family', color: 'purple' },

    // Lifestyle
    { name: 'Travel', group: 'Lifestyle', color: 'cyan' },
    { name: 'Fitness', group: 'Lifestyle', color: 'green' },
    { name: 'Gym', group: 'Lifestyle', color: 'green' },
    { name: 'Shopping', group: 'Lifestyle', color: 'purple' },
    { name: 'Clothing', group: 'Lifestyle', color: 'purple' },
    { name: 'Beauty', group: 'Lifestyle', color: 'pink' },

    // Financial
    { name: 'Savings', group: 'Financial', color: 'green' },
    { name: 'Investments', group: 'Financial', color: 'green' },
    { name: 'Retirement', group: 'Financial', color: 'green' },
    { name: 'Taxes', group: 'Financial', color: 'yellow' },
    { name: 'Bank Fees', group: 'Financial', color: 'yellow' },

    // Other
    { name: 'Charity', group: 'Other', color: 'pink' },
    { name: 'Gifts', group: 'Other', color: 'purple' },
    { name: 'Storage', group: 'Other', color: 'cyan' },
    { name: 'Necessity', group: 'Other', color: 'purple' },
    { name: 'Miscellaneous', group: 'Other', color: 'purple' },
];

export const CATEGORY_GROUPS = [
    'Housing', 'Utilities', 'Transportation', 'Food',
    'Entertainment', 'Insurance', 'Healthcare', 'Debt',
    'Family', 'Lifestyle', 'Financial', 'Other'
];

export const CATEGORY_COLORS = [
    { name: 'green', label: 'Green', hex: '#34d399' },
    { name: 'blue', label: 'Blue', hex: '#4f8cff' },
    { name: 'purple', label: 'Purple', hex: '#a78bfa' },
    { name: 'orange', label: 'Orange', hex: '#fb923c' },
    { name: 'yellow', label: 'Yellow', hex: '#facc15' },
    { name: 'red', label: 'Red', hex: '#f87171' },
    { name: 'pink', label: 'Pink', hex: '#ec4899' },
    { name: 'cyan', label: 'Cyan', hex: '#22d3ee' },
];

// Helper to get a category's color by name
export function getCategoryColor(categoryName, customCategories = []) {
    // Check custom categories first
    const custom = customCategories.find(c =>
        c.name.toLowerCase() === categoryName?.toLowerCase()
    );
    if (custom?.color) {
        const colorDef = CATEGORY_COLORS.find(c => c.name === custom.color);
        return colorDef?.hex || '#a78bfa';
    }

    // Check default categories
    const defaultCat = DEFAULT_CATEGORIES.find(c =>
        c.name.toLowerCase() === categoryName?.toLowerCase()
    );
    if (defaultCat?.color) {
        const colorDef = CATEGORY_COLORS.find(c => c.name === defaultCat.color);
        return colorDef?.hex || '#a78bfa';
    }

    return '#a78bfa'; // Default purple
}

// Get all category names as flat array (for backwards compatibility)
export function getAllCategoryNames(customCategories = []) {
    const defaultNames = DEFAULT_CATEGORIES.map(c => c.name);
    const customNames = customCategories.map(c => c.name);
    return [...new Set([...defaultNames, ...customNames])];
}

// Get categories grouped by their group property
export function getCategoriesByGroup(customCategories = []) {
    const grouped = {};

    // Add defaults
    DEFAULT_CATEGORIES.forEach(cat => {
        if (!grouped[cat.group]) grouped[cat.group] = [];
        grouped[cat.group].push(cat);
    });

    // Add custom categories to "Custom" group
    if (customCategories.length > 0) {
        grouped['Custom'] = customCategories.map(c => ({
            name: c.name,
            group: 'Custom',
            color: c.color || 'purple'
        }));
    }

    return grouped;
}
