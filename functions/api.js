const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { spendingExpenses } = require("./shared/financial-service.cjs");
const { normalizeCategoryKey } = require("./shared/category-service.cjs");
const { validateBudget } = require("./shared/budget-service.cjs");
const { validateRule } = require("./shared/transaction-rules.cjs");

const BILL_FREQUENCIES = ["monthly", "weekly", "biweekly", "twice-monthly", "yearly", "semi-annual", "per-paycheck", "every-4-weeks", "every-2-months"];
const DEBT_TYPES = ["credit-card", "auto-loan", "student-loan", "personal-loan", "mortgage", "medical", "equipment-loan", "other"];

// Thrown inside a userData transaction to surface a specific HTTP status.
class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

/**
 * Public REST API — authenticated via API key (Bearer token).
 *
 * All endpoints live under /api/v1/* and require:
 *   Authorization: Bearer ph_live_<key>
 *
 * Read endpoints (any key):
 *   GET  /api/v1/bills       — List all bills
 *   GET  /api/v1/accounts    — List all accounts
 *   GET  /api/v1/debts       — List all debts
 *   GET  /api/v1/expenses    — List all expenses
 *   GET  /api/v1/summary     — Financial summary (totals, upcoming)
 *
 * Write endpoints (read_write-scoped keys only) — each adds one record:
 *   POST /api/v1/expenses    — { name, amount, category?, date?, vendor?, notes? }
 *   POST /api/v1/bills       — { name, amount, frequency, dueDay, category?, dueMonth?, paymentSource?, owner?, autoPay?, expenseCategory? }
 *   POST /api/v1/debts       — { name, type, currentBalance, originalBalance?, interestRate?, minimumPayment?, notes? }
 *   POST /api/v1/budgets     — { monthlyAmount, category | tag, startMonth?, rollover?, notes? }
 *   POST /api/v1/rules       — { name, match:{mode,conditions:[{field,op,value}]}, actions:{category?,rename?,addTags?,ignore?} }
 */

module.exports = function ({ admin, db }, validateApiKey) {
    const exports = {};

    // ─── Helpers ──────────────────────────────────────────────────

    function corsHeaders(res) {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

    // ─── Write helper (read_write scope only) ────────────────────
    // Read-modify-writes the user's data blob in a transaction so a concurrent
    // app save can't be clobbered. `mutator(parsed)` mutates the parsed object
    // and returns the created record; it may throw ApiError for a specific
    // status (e.g. a duplicate). Returns { field, record } or sends an error.
    async function writeUserData(req, res, uid, field, responseKey, mutator) {
        const docRef = db.collection("userData").doc(uid);
        let created;
        try {
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(docRef);
                const raw = snap.exists ? snap.data().data : null;
                let parsed = {};
                if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = {}; } }
                if (!Array.isArray(parsed[field])) parsed[field] = [];
                created = mutator(parsed);
                tx.set(docRef, {
                    data: JSON.stringify(parsed),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            });
        } catch (e) {
            if (e instanceof ApiError) return jsonError(res, e.status, e.message);
            console.error(`API write ${field} error:`, e);
            return jsonError(res, 500, `Failed to save ${field}.`);
        }
        res.status(201).json({ success: true, [responseKey]: created });
    }

    const num = (v) => (typeof v === "number" ? v : Number(v));
    const money = (v) => Math.round(num(v) * 100) / 100;
    const str = (v) => (typeof v === "string" ? v.trim() : "");

    // POST /api/v1/expenses
    async function createExpense(req, res, uid) {
        const b = req.body || {};
        const name = str(b.name);
        const amount = num(b.amount);
        if (!name) return jsonError(res, 400, "Field 'name' is required.");
        if (!Number.isFinite(amount) || amount <= 0) return jsonError(res, 400, "Field 'amount' must be a positive number.");
        const date = /^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) ? str(b.date) : new Date().toISOString().slice(0, 10);
        const expense = {
            id: crypto.randomUUID(), name, amount: money(amount),
            category: str(b.category).toLowerCase() || "other", date,
            vendor: str(b.vendor), notes: str(b.notes),
            source: "api", expenseType: "personal", tags: [], ignored: false,
            createdDate: new Date().toISOString(),
        };
        await writeUserData(req, res, uid, "expenses", "expense", (d) => { d.expenses.push(expense); return expense; });
    }

    // POST /api/v1/bills
    async function createBill(req, res, uid) {
        const b = req.body || {};
        const name = str(b.name);
        const amount = num(b.amount);
        if (!name) return jsonError(res, 400, "Field 'name' is required.");
        if (!Number.isFinite(amount) || amount < 0) return jsonError(res, 400, "Field 'amount' must be zero or a positive number.");
        const frequency = str(b.frequency) || "monthly";
        if (!BILL_FREQUENCIES.includes(frequency)) return jsonError(res, 400, `Field 'frequency' must be one of: ${BILL_FREQUENCIES.join(", ")}.`);
        const dueDay = Math.trunc(num(b.dueDay));
        if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return jsonError(res, 400, "Field 'dueDay' must be a day of month (1-31).");
        const bill = {
            id: crypto.randomUUID(), name, amount: money(amount),
            category: str(b.category) || "other", dueDay, frequency,
            paymentSource: str(b.paymentSource), owner: b.owner === "dependent" ? "dependent" : "user",
            autoPay: b.autoPay === true, frozen: false,
            notes: str(b.notes), createdAt: new Date().toISOString(),
        };
        // Yearly / semi-annual bills need the month they're due in (0-11).
        if (frequency === "yearly" || frequency === "semi-annual") {
            const dm = Math.trunc(num(b.dueMonth));
            bill.dueMonth = (Number.isFinite(dm) && dm >= 0 && dm <= 11) ? dm : new Date().getMonth();
        }
        // Optional budget override (which budget this bill counts toward).
        if (b.expenseCategory != null) {
            bill.expenseCategory = b.expenseCategory === "none" ? "none" : normalizeCategoryKey(str(b.expenseCategory), null);
        }
        await writeUserData(req, res, uid, "bills", "bill", (d) => { d.bills.push(bill); return bill; });
    }

    // POST /api/v1/debts
    async function createDebt(req, res, uid) {
        const b = req.body || {};
        const name = str(b.name);
        const type = str(b.type);
        const currentBalance = num(b.currentBalance);
        if (!name) return jsonError(res, 400, "Field 'name' is required.");
        if (!DEBT_TYPES.includes(type)) return jsonError(res, 400, `Field 'type' must be one of: ${DEBT_TYPES.join(", ")}.`);
        if (!Number.isFinite(currentBalance) || currentBalance < 0) return jsonError(res, 400, "Field 'currentBalance' must be zero or a positive number.");
        const interestRate = Number.isFinite(num(b.interestRate)) ? num(b.interestRate) : 0;
        const minimumPayment = Number.isFinite(num(b.minimumPayment)) ? Math.max(0, num(b.minimumPayment)) : 0;
        const debt = {
            id: crypto.randomUUID(), name, type,
            currentBalance: money(currentBalance),
            originalBalance: Number.isFinite(num(b.originalBalance)) ? money(b.originalBalance) : money(currentBalance),
            interestRate, minimumPayment: money(minimumPayment),
            notes: str(b.notes), createdDate: new Date().toISOString(),
        };
        // Note: the app auto-creates a matching payment bill + linked account
        // for debts on its next load (migrateEntityLinks) — the API just adds
        // the raw debt record.
        await writeUserData(req, res, uid, "debts", "debt", (d) => { d.debts.push(debt); return debt; });
    }

    // POST /api/v1/budgets  (categoryBudgets[])
    async function createBudget(req, res, uid) {
        const b = req.body || {};
        const budget = {
            monthlyAmount: num(b.monthlyAmount),
            startMonth: /^\d{4}-\d{2}$/.test(str(b.startMonth)) ? str(b.startMonth) : new Date().toISOString().slice(0, 7),
            rollover: b.rollover === true,
            notes: str(b.notes),
        };
        if (b.tag != null && str(b.tag)) budget.tag = str(b.tag).replace(/^#/, "").toLowerCase();
        else if (b.category != null && str(b.category)) budget.category = normalizeCategoryKey(str(b.category), null);
        const err = validateBudget(budget);
        if (err) return jsonError(res, 400, err);
        budget.id = crypto.randomUUID();
        await writeUserData(req, res, uid, "categoryBudgets", "budget", (d) => {
            // One active budget per target (mirrors the app's dedupe).
            const dup = d.categoryBudgets.find((x) => budget.tag
                ? String(x.tag || "").toLowerCase() === budget.tag
                : (x.category === budget.category && !x.tag));
            if (dup) throw new ApiError(409, `A budget already exists for that ${budget.tag ? "tag" : "category"}.`);
            d.categoryBudgets.push(budget);
            return budget;
        });
    }

    // POST /api/v1/rules  (transactionRules[])
    async function createRule(req, res, uid) {
        const b = req.body || {};
        const rule = {
            name: str(b.name),
            match: b.match && typeof b.match === "object" ? b.match : null,
            actions: b.actions && typeof b.actions === "object" ? { ...b.actions } : null,
        };
        // Normalize a set-category action to a canonical key.
        if (rule.actions && rule.actions.category != null) {
            rule.actions.category = normalizeCategoryKey(str(rule.actions.category), null);
        }
        const err = validateRule(rule);
        if (err) return jsonError(res, 400, err);
        await writeUserData(req, res, uid, "transactionRules", "rule", (d) => {
            const record = { id: crypto.randomUUID(), enabled: true, priority: d.transactionRules.length, ...rule };
            d.transactionRules.push(record);
            return record;
        });
    }

    // ─── API Router ──────────────────────────────────────────────

    exports.api = onRequest({ cors: false }, async (req, res) => {
        corsHeaders(res);

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        if (req.method !== "GET" && req.method !== "POST") {
            jsonError(res, 405, "Only GET and POST requests are supported.");
            return;
        }

        // Authenticate
        const keyInfo = await authenticate(req, res);
        if (!keyInfo) return; // Response already sent

        // Parse path. Firebase Hosting rewrites /api/** to this function and
        // preserves the full request path, so req.path arrives as
        // /api/v1/<resource>. Hitting the function's direct URL instead gives
        // /v1/<resource>. Drop a leading "api" segment so both forms work.
        const path = req.path.replace(/^\/+|\/+$/g, ""); // trim slashes
        let segments = path.split("/");
        if (segments[0] === "api") segments = segments.slice(1);

        // Expect: v1/<resource>
        if (segments[0] !== "v1" || segments.length < 2) {
            jsonError(res, 404, "Not found. Available endpoints: /api/v1/bills, /api/v1/accounts, /api/v1/debts, /api/v1/expenses, /api/v1/summary");
            return;
        }

        const resource = segments[1];

        // ─── Writes (POST) — require a read_write-scoped key ───
        if (req.method === "POST") {
            if (keyInfo.scope !== "read_write") {
                jsonError(res, 403, "This API key is read-only. Create a write-enabled key to modify data.");
                return;
            }
            const writers = {
                expenses: createExpense,
                bills: createBill,
                debts: createDebt,
                budgets: createBudget,
                rules: createRule,
            };
            if (writers[resource]) {
                await writers[resource](req, res, keyInfo.uid);
                return;
            }
            jsonError(res, 404, "Not found. Writable endpoints: POST /api/v1/{expenses, bills, debts, budgets, rules}");
            return;
        }

        // ─── Reads (GET) ───
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
                        source: e.source || "manual",
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
                // Spending view only: transfers/card payments, ignored rows,
                // and split parents excluded — matches every in-app total.
                const monthlyExpenses = spendingExpenses(expenses)
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
