export function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

export function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
}

export function getMonthName(monthIndex) {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[monthIndex];
}

export function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
}

export function isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
}

export function getCategoryBadgeClass(category) {
    const map = {
        'Housing': 'badge-housing',
        'HOUSING': 'badge-housing',
        'Mortgage': 'badge-housing',
        'Car': 'badge-car',
        'Subscription': 'badge-subscription',
        'Necessity': 'badge-necessity',
        'Credit Card': 'badge-credit-card',
        'UTILITIES': 'badge-utilities',
        'Utilities': 'badge-utilities',
        'Storage': 'badge-storage',
        'INTERNET': 'badge-subscription',
        'Insurance': 'badge-insurance'
    };
    return map[category] || 'badge-necessity';
}

export function getUpcomingBills(bills, store, daysAhead = 7) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const currentDay = today.getDate();

    return bills
        .filter(bill => !bill.frozen)
        .map(bill => {
            const dueDay = bill.dueDay;
            let daysUntil = dueDay - currentDay;
            if (daysUntil < -5) daysUntil += getDaysInMonth(year, month);

            return {
                ...bill,
                daysUntil,
                isPaid: store.isBillPaid(bill.id, year, month),
                isOverdue: daysUntil < 0 && !store.isBillPaid(bill.id, year, month),
                isDueSoon: daysUntil >= 0 && daysUntil <= 3
            };
        })
        .filter(bill => bill.daysUntil >= -5 && bill.daysUntil <= daysAhead && !bill.isPaid)
        .sort((a, b) => a.daysUntil - b.daysUntil);
}

// Biweekly pay date calculator
export function getPayDatesInMonth(year, month, startDate) {
    const dates = [];
    const start = new Date(startDate);
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    // Walk forward from start date in 14-day increments
    let current = new Date(start);
    // Go back enough to find dates before our target month
    while (current > monthStart) {
        current = new Date(current.getTime() - 14 * 24 * 60 * 60 * 1000);
    }

    // Now walk forward and collect dates in our month
    while (current <= monthEnd) {
        if (current >= monthStart && current <= monthEnd) {
            dates.push(new Date(current));
        }
        current = new Date(current.getTime() + 14 * 24 * 60 * 60 * 1000);
    }

    return dates;
}

// Credit Score helpers (FICO model, 300-850)
export function getScoreRating(score) {
    if (score >= 800) return { label: 'Exceptional', color: 'var(--green)' };
    if (score >= 740) return { label: 'Very Good', color: 'var(--green)' };
    if (score >= 670) return { label: 'Good', color: 'var(--accent)' };
    if (score >= 580) return { label: 'Fair', color: 'var(--orange)' };
    return { label: 'Poor', color: 'var(--red)' };
}

export function estimateScoreImpact(currentScore, debtChange, totalCreditLimit) {
    if (!currentScore || !totalCreditLimit || totalCreditLimit <= 0) {
        return { newScore: currentScore, pointChange: 0 };
    }
    // Utilization-based estimate: ~30% of FICO weight
    // Each 1% utilization change ≈ 1-3 points (we use 1.5 avg)
    const utilizationChangePct = (debtChange / totalCreditLimit) * 100;
    let pointChange = Math.round(utilizationChangePct * -1.5);
    // Cap at reasonable bounds
    pointChange = Math.max(-50, Math.min(50, pointChange));
    const newScore = Math.max(300, Math.min(850, currentScore + pointChange));
    return { newScore, pointChange: newScore - currentScore };
}

export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
