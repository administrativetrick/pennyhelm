import { store } from './store.js';

// Sample data for demo purposes — all names, amounts, and details are fictional
export function seedSampleData() {
    // 1. Add bank accounts first (checking/savings) so sync engine can reference them
    store.addAccount({
        name: 'Main Checking',
        type: 'checking',
        balance: 3200
    });

    store.addAccount({
        name: 'Emergency Fund',
        type: 'savings',
        balance: 5000
    });

    // 2. Add debts — sync engine auto-creates linked credit accounts + payment bills
    store.addDebt({
        name: 'Visa Card',
        type: 'credit-card',
        currentBalance: 4200,
        originalBalance: 6000,
        interestRate: 22.99,
        minimumPayment: 200,
        notes: 'Rewards card'
    });

    store.addDebt({
        name: 'Mastercard',
        type: 'credit-card',
        currentBalance: 1500,
        originalBalance: 3000,
        interestRate: 19.99,
        minimumPayment: 150,
        notes: ''
    });

    store.addDebt({
        name: 'Student Loans',
        type: 'student-loan',
        currentBalance: 18000,
        originalBalance: 28000,
        interestRate: 5.5,
        minimumPayment: 250,
        notes: 'Federal loans'
    });

    store.addDebt({
        name: 'Auto Loan',
        type: 'auto-loan',
        currentBalance: 15000,
        originalBalance: 25000,
        interestRate: 6.5,
        minimumPayment: 450,
        notes: 'Ends March 2029'
    });

    // 3. Add non-debt bills (rent, utilities, subscriptions, etc.)
    //    Credit card payment bills and auto loan bill are auto-created by sync above
    const sampleBills = [
        {
            name: 'Rent',
            amount: 1800,
            category: 'Housing',
            dueDay: 1,
            frequency: 'monthly',
            paymentSource: 'Main Checking',
            frozen: false,
            autoPay: false,
            notes: 'Due 1st of each month'
        },
        {
            name: 'Electric (PG&E)',
            amount: 150,
            category: 'Utilities',
            dueDay: 15,
            frequency: 'monthly',
            paymentSource: 'Main Checking',
            frozen: false,
            autoPay: true,
            notes: ''
        },
        {
            name: 'Internet',
            amount: 65,
            category: 'Internet',
            dueDay: 20,
            frequency: 'monthly',
            paymentSource: 'Main Checking',
            frozen: false,
            autoPay: true,
            notes: ''
        },
        {
            name: 'Cell Phone',
            amount: 85,
            category: 'Necessity',
            dueDay: 5,
            frequency: 'monthly',
            paymentSource: 'Visa Card',
            frozen: false,
            autoPay: true,
            notes: ''
        },
        {
            name: 'Car Insurance',
            amount: 180,
            category: 'Insurance',
            dueDay: 22,
            frequency: 'monthly',
            paymentSource: 'Main Checking',
            frozen: false,
            autoPay: true,
            notes: ''
        },
        {
            name: 'Netflix',
            amount: 23,
            category: 'Subscription',
            dueDay: 12,
            frequency: 'monthly',
            paymentSource: 'Visa Card',
            frozen: false,
            autoPay: true,
            notes: ''
        },
        {
            name: 'Spotify',
            amount: 12,
            category: 'Subscription',
            dueDay: 18,
            frequency: 'monthly',
            paymentSource: 'Mastercard',
            frozen: false,
            autoPay: true,
            notes: ''
        },
        {
            name: 'Gym Membership',
            amount: 50,
            category: 'Subscription',
            dueDay: 1,
            frequency: 'monthly',
            paymentSource: 'Visa Card',
            frozen: false,
            autoPay: true,
            notes: ''
        },
        {
            name: 'Groceries',
            amount: 600,
            category: 'Necessity',
            dueDay: 1,
            frequency: 'monthly',
            paymentSource: 'Visa Card',
            frozen: false,
            autoPay: false,
            notes: 'Estimated monthly budget'
        }
    ];

    sampleBills.forEach(bill => store.addBill(bill));

    // 4. Add dependent bills
    const sampleDependentBills = [
        { name: 'Car Payment', amount: 280, dueDay: 5, frequency: 'monthly', userCovering: false, notes: '' },
        { name: 'Car Insurance', amount: 120, dueDay: 10, frequency: 'monthly', userCovering: false, notes: '' },
        { name: 'Phone Plan', amount: 55, dueDay: 15, frequency: 'monthly', userCovering: true, notes: '' },
        { name: 'Subscriptions', amount: 30, dueDay: 20, frequency: 'monthly', userCovering: false, notes: '' },
        { name: 'Groceries', amount: 400, dueDay: 1, frequency: 'monthly', userCovering: true, notes: 'Variable amount' }
    ];

    sampleDependentBills.forEach(bill => store.addDependentBill(bill));

    // 5. Set initial debt budget
    store.updateDebtBudget({
        totalMonthlyBudget: 1000,
        strategy: 'avalanche'
    });

    // 6. Add sample tax deductions
    const currentYear = new Date().getFullYear();
    const sampleDeductions = [
        {
            taxYear: currentYear - 1,
            category: 'charitable',
            description: 'Clothing Donation',
            amount: 200,
            date: `${currentYear - 1}-03-15`,
            vendor: 'Goodwill',
            receiptDocId: null,
            notes: 'Spring donation'
        },
        {
            taxYear: currentYear - 1,
            category: 'medical',
            description: 'Eye Exam & Glasses',
            amount: 450,
            date: `${currentYear - 1}-06-10`,
            vendor: 'Eye Care Center',
            receiptDocId: null,
            notes: 'Annual vision care'
        },
        {
            taxYear: currentYear - 1,
            category: 'education',
            description: 'Online Course',
            amount: 250,
            date: `${currentYear - 1}-09-01`,
            vendor: 'Coursera',
            receiptDocId: null,
            notes: 'Professional development'
        }
    ];

    sampleDeductions.forEach(ded => store.addTaxDeduction(ded));
    store.addTaxYear(currentYear - 1);
}
