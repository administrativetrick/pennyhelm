/**
 * Savings-goal categories — the small icon/label set shared by the dashboard
 * savings widget and the report/export module. Kept in one place so both
 * consumers agree.
 */

export const GOAL_CATEGORIES = [
    { value: 'emergency', label: 'Emergency Fund', icon: '🛡️' },
    { value: 'vacation', label: 'Vacation', icon: '✈️' },
    { value: 'car', label: 'Vehicle', icon: '🚗' },
    { value: 'home', label: 'Home', icon: '🏠' },
    { value: 'education', label: 'Education', icon: '📚' },
    { value: 'retirement', label: 'Retirement', icon: '🏖️' },
    { value: 'other', label: 'Other', icon: '🎯' },
];

export function getGoalCategoryInfo(category) {
    const found = GOAL_CATEGORIES.find(c => c.value === category);
    return found || GOAL_CATEGORIES[6]; // Default to 'other'
}
