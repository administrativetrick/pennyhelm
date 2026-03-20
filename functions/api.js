const { onRequest } = require("firebase-functions/v2/https");

/**
 * Public REST API — authenticated via API key (Bearer token).
 *
 * All endpoints live under /api/v1/* and require:
 *   Authorization: Bearer ph_live_<key>
 *
 * Available endpoints:
 *   GET  /api/v1/bills       — List all bills
 *   GET  /api/v1/accounts    — List all accounts
 *   GET  /api/v1/debts       — List all debts
 *   GET  /api/v1/expenses    — List all expenses
 *   GET  /api/v1/summary     — Financial summary (totals, upcoming)
 */

module.exports = function ({ admin, db }, validateApiKey) {
    const exports = {};

    // ─── Helpers ──────────────────────────────────────────────────

    function corsHeaders(res) {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.set("Access-Control-Max-Age", "3600");
    }

    function jsonError(res, status, message) {
        res.status(status).json({ error: { status, message } });
    }

    async function authenticate(req, res) {
        const authHeader = req.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            jsonError(res, 401, "Missing or invalid Authorization header. Use: Bearer <api_key>");
            return null;
        }

        const rawKey = authHeader.substring(7);
        const keyInfo = await validateApiKey(rawKey);

        if (!keyInfo) {
            jsonError(res, 401, "Invalid or revoked API key.");
            return null;
        }

        return keyInfo;
    }

    async function getUserData(uid) {
        const doc = await db.collection("userData").doc(uid).get();
        if (!doc.exists) return null;

        const raw = doc.data().data;
        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    // ─── API Router ──────────────────────────────────────────────

    exports.api = onRequest({ cors: false }, async (req, res) => {
        corsHeaders(res);

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        if (req.method !== "GET") {
            jsonError(res, 405, "Only GET requests are supported.");
            return;
        }

        // Authenticate
        const keyInfo = await authenticate(req, res);
        if (!keyInfo) return; // Response already sent

        // Parse path: req.path is relative to the function name
        // When deployed as "api", the path comes as /v1/bills etc.
        const path = req.path.replace(/^\/+|\/+$/g, ""); // trim slashes
        const segments = path.split("/");

        // Expect: v1/<resource>
        if (segments[0] !== "v1" || segments.length < 2) {
            jsonError(res, 404, "Not found. Available endpoints: /api/v1/bills, /api/v1/accounts, /api/v1/debts, /api/v1/expenses, /api/v1/summary");
            return;
        }

        const resource = segments[1];
        const data = await getUserData(keyInfo.uid);

        if (!data) {
            jsonError(res, 404, "No user data found.");
            return;
        }

        switch (resource) {
            case "bills":
                res.json({
                    bills: (data.bills || []).map((b) => ({
                        id: b.id,
                        name: b.name,
                        amount: b.amount,
                        dueDate: b.dueDate,
                        frequency: b.frequency,
                        category: b.category,
                        source: b.source,
                        owner: b.owner || "user",
                        autoPay: b.autoPay || false,
                    })),
                });
                break;

            case "accounts":
                res.json({
                    accounts: (data.accounts || []).map((a) => ({
                        id: a.id,
                        name: a.name,
                        type: a.type,
                        balance: a.balance,
                        amountOwed: a.amountOwed,
                        lastUpdated: a.lastUpdated,
                    })),
                });
                break;

            case "debts":
                res.json({
                    debts: (data.debts || []).map((d) => ({
                        id: d.id,
                        name: d.name,
                        type: d.type,
                        currentBalance: d.currentBalance,
                        originalBalance: d.originalBalance,
                        interestRate: d.interestRate,
                        minimumPayment: d.minimumPayment,
                    })),
                });
                break;

            case "expenses":
                res.json({
                    expenses: (data.expenses || []).map((e) => ({
                        id: e.id,
                        name: e.name,
                        amount: e.amount,
                        category: e.category,
                        date: e.date,
                        vendor: e.vendor,
                        expenseType: e.expenseType,
                    })),
                });
                break;

            case "summary": {
                const bills = data.bills || [];
                const accounts = data.accounts || [];
                const debts = data.debts || [];
                const expenses = data.expenses || [];

                const totalMonthlyBills = bills.reduce((sum, b) => {
                    const amt = b.amount || 0;
                    switch (b.frequency) {
                        case "weekly": return sum + amt * 4.33;
                        case "biweekly": return sum + amt * 2.17;
                        case "semimonthly": return sum + amt * 2;
                        case "monthly": return sum + amt;
                        case "quarterly": return sum + amt / 3;
                        case "semiannually": return sum + amt / 6;
                        case "annually": return sum + amt / 12;
                        default: return sum + amt;
                    }
                }, 0);

                const totalDebtBalance = debts.reduce((s, d) => s + (d.currentBalance || 0), 0);
                const totalAssets = accounts
                    .filter((a) => ["checking", "savings", "investment", "retirement", "property", "vehicle", "equipment", "other-asset"].includes(a.type))
                    .reduce((s, a) => s + (a.balance || 0), 0);

                const currentMonth = new Date().toISOString().slice(0, 7);
                const monthlyExpenses = expenses
                    .filter((e) => e.date && e.date.startsWith(currentMonth))
                    .reduce((s, e) => s + (e.amount || 0), 0);

                res.json({
                    summary: {
                        totalMonthlyBills: Math.round(totalMonthlyBills * 100) / 100,
                        totalDebtBalance: Math.round(totalDebtBalance * 100) / 100,
                        totalAssets: Math.round(totalAssets * 100) / 100,
                        netWorth: Math.round((totalAssets - totalDebtBalance) * 100) / 100,
                        currentMonthExpenses: Math.round(monthlyExpenses * 100) / 100,
                        billCount: bills.length,
                        accountCount: accounts.length,
                        debtCount: debts.length,
                    },
                });
                break;
            }

            default:
                jsonError(res, 404, `Unknown resource: ${resource}. Available: bills, accounts, debts, expenses, summary`);
        }
    });

    return exports;
};
