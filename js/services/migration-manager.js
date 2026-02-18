/**
 * MigrationManager — handles data format migrations for legacy compatibility.
 *
 * Extracted from Store so migration logic is isolated and testable.
 * All functions are pure — they mutate the data object and return whether changes were made.
 */

/**
 * Migrate legacy key names (e.g., hardcoded user names → generic user/dependent).
 * @param {object} data - The full data object
 * @returns {boolean} Whether any changes were made
 */
export function migrateKeyNames(data) {
    let changed = false;

    // Migrate legacy income keys to generic user/dependent
    const legacyUserKeys = ['curtis'];
    const legacyDepKeys = ['ivy'];

    legacyUserKeys.forEach(key => {
        if (data.income && data.income[key] && !data.income.user) {
            data.income.user = data.income[key];
            delete data.income[key];
            changed = true;
        }
        if (data.creditScores && data.creditScores[key] && !data.creditScores.user) {
            data.creditScores.user = data.creditScores[key];
            delete data.creditScores[key];
            changed = true;
        }
    });

    legacyDepKeys.forEach(key => {
        if (data.income && data.income[key] && !data.income.dependent) {
            data.income.dependent = data.income[key];
            delete data.income[key];
            changed = true;
        }
        if (data.creditScores && data.creditScores[key] && !data.creditScores.dependent) {
            data.creditScores.dependent = data.creditScores[key];
            delete data.creditScores[key];
            changed = true;
        }
    });

    // Migrate legacy dependent bills array name
    const legacyBillArrays = ['ivyBills'];
    legacyBillArrays.forEach(key => {
        if (data[key] && !data.dependentBills) {
            data.dependentBills = data[key];
            delete data[key];
            changed = true;
        }
    });

    // Migrate legacy covering field on dependent bills
    const depBills = data.dependentBills || [];
    const legacyCoveringKeys = ['curtisCovering'];
    depBills.forEach(bill => {
        legacyCoveringKeys.forEach(key => {
            if (key in bill) {
                bill.userCovering = bill[key];
                delete bill[key];
                changed = true;
            }
        });
    });

    // Migrate dependent bills into main bills array with owner field
    if (data.dependentBills && data.dependentBills.length > 0) {
        data.dependentBills.forEach(depBill => {
            if (!data.bills.find(b => b.id === depBill.id)) {
                data.bills.push({
                    ...depBill,
                    owner: 'dependent',
                    category: depBill.category || 'Dependent Bill',
                    frequency: depBill.frequency || 'monthly',
                    paymentSource: depBill.paymentSource || ''
                });
            }
        });
        data.dependentBills = [];
        changed = true;
    }

    // Ensure all bills have an owner field
    data.bills.forEach(bill => {
        if (!bill.owner) {
            bill.owner = 'user';
            changed = true;
        }
    });

    return changed;
}

/**
 * Migrate old monthly balance history entries to daily format.
 * @param {Array} balanceHistory - The balance history array
 * @returns {boolean} Whether any changes were made
 */
export function migrateBalanceHistory(balanceHistory) {
    if (!balanceHistory) return false;
    let changed = false;

    for (const h of balanceHistory) {
        if (h.month && !h.date) {
            h.date = h.month + '-01';
            delete h.month;
            delete h.snapshotDate;
            changed = true;
        }
    }

    return changed;
}
