/**
 * PennyHelm Cloud Functions — Entry Point
 *
 * This file wires up shared dependencies and re-exports all cloud functions
 * from domain-specific modules. Each module is a factory that receives
 * shared services (admin, db, helpers, secrets) and returns its exports.
 *
 * Domain modules:
 *   auth.js      — Mobile credential setup & password management
 *   plaid.js     — Plaid Link, token exchange, balance refresh
 *   stripe.js    — Checkout, portal, webhook for subscriptions
 *   mfa.js       — TOTP two-factor authentication
 *   invites.js   — Sharing invites, referral tracking
 *   scheduled.js — Cron jobs, admin utilities, transaction sync
 *   chatbot.js   — AI financial assistant (Gemini)
 *   api-keys.js  — API key management (create, list, revoke)
 *   api.js       — Public REST API (authenticated via API key)
 */

const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

// ─── Secret Definitions ──────────────────────────────────────

const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const PLAID_ENV = defineSecret("PLAID_ENV");

const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_PORT = defineSecret("SMTP_PORT");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const SMTP_FROM = defineSecret("SMTP_FROM");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const STRIPE_ANNUAL_PRICE_ID = defineSecret("STRIPE_ANNUAL_PRICE_ID");
const STRIPE_MONTHLY_PRICE_ID = defineSecret("STRIPE_MONTHLY_PRICE_ID");
const MFA_ENCRYPTION_KEY = defineSecret("MFA_ENCRYPTION_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ─── Shared Helpers ──────────────────────────────────────────

function getPlaidClient(clientId, secret, env) {
    const cleanId = clientId.trim();
    const cleanSecret = secret.trim();
    const cleanEnv = env.trim();
    const configuration = new Configuration({
        basePath: PlaidEnvironments[cleanEnv] || PlaidEnvironments.production,
        baseOptions: {
            headers: {
                "PLAID-CLIENT-ID": cleanId,
                "PLAID-SECRET": cleanSecret,
            },
        },
    });
    return new PlaidApi(configuration);
}

// Email is sent via the Resend HTTP API when RESEND_API_KEY is attached to the
// calling function, with classic SMTP as the fallback. (Office 365 retired
// Basic SMTP AUTH in 2026, which silently killed every SMTP send — see the
// 2026-08-12 outage.) Returns a nodemailer-compatible { sendMail } object so
// no call site has to change.
function getEmailTransporter() {
    let resendKey = null;
    try { resendKey = RESEND_API_KEY.value(); } catch { resendKey = null; }
    if (resendKey) {
        return {
            sendMail: async (msg) => {
                const payload = {
                    from: msg.from,
                    to: Array.isArray(msg.to) ? msg.to : [msg.to],
                    subject: msg.subject,
                    html: msg.html,
                    text: msg.text,
                };
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
                }
                return res.json();
            },
        };
    }
    return nodemailer.createTransport({
        host: SMTP_HOST.value(),
        port: parseInt(SMTP_PORT.value()) || 587,
        secure: parseInt(SMTP_PORT.value()) === 465,
        auth: {
            user: SMTP_USER.value(),
            pass: SMTP_PASS.value(),
        },
    });
}

function generateSecurePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    const randomBytes = crypto.randomBytes(12);
    for (let i = 0; i < 12; i++) {
        password += chars[randomBytes[i] % chars.length];
    }
    return password;
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// ─── Bundle All Secrets ──────────────────────────────────────

const secrets = {
    PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV,
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, RESEND_API_KEY,
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
    STRIPE_ANNUAL_PRICE_ID, STRIPE_MONTHLY_PRICE_ID,
    MFA_ENCRYPTION_KEY,
    GEMINI_API_KEY,
};

// ─── Load Domain Modules ─────────────────────────────────────

const { enforceRateLimit } = require("./rate-limit");

const shared = { admin, db, getPlaidClient, getEmailTransporter, generateSecurePassword, hashPassword, secrets, enforceRateLimit };

const authFns      = require("./auth")(shared);
const plaidFns     = require("./plaid")(shared);
const stripeFns    = require("./stripe")(shared);
const mfaFns       = require("./mfa")(shared);
const inviteFns    = require("./invites")(shared);
const sharedAccessFns = require("./shared-access")(shared);
const scheduledFns = require("./scheduled")(shared);
const chatbotFns   = require("./chatbot")(shared);
// api-keys gets the TOTP verifier so it can gate write-key creation behind 2FA.
const apiKeyFns    = require("./api-keys")(shared, mfaFns._verifyUserTotp);
const apiFns       = require("./api")(shared, apiKeyFns._validateApiKey);
const adEventFns   = require("./ad-events")(shared);
const activeUserFns = require("./active-users")(shared);
const blogSiteFns  = require("./blog-site")(shared);
const aiHealthFns  = require("./ai-health")(shared);

// Marketing auto-poster — kept out of the public/self-host repo (.gitignore).
// Load it only if present so open-source checkouts deploy fine without it.
let socialFns = {};
try {
    socialFns = require("./social")(shared);
} catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND" && /social/.test(err.message)) {
        console.log("[index] Optional ./social module not present — skipping marketing poster.");
    } else {
        throw err; // a real error inside social.js should not be swallowed
    }
}

// Optional private module — cloud-only, kept out of the public/self-host repo
// (.gitignore). Loaded only if present so open-source checkouts deploy fine.
let blgFns = {};
try {
    blgFns = require("./blg")(shared);
} catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND" && /blg/.test(err.message)) {
        console.log("[index] Optional ./blg module not present — skipping.");
    } else {
        throw err; // a real error inside the module should not be swallowed
    }
}

// Optional private module — cloud-only, kept out of the public/self-host repo
// (.gitignore). Loaded only if present so open-source checkouts deploy fine.
let internalJobsFns = {};
try {
    internalJobsFns = require("./internal-jobs")(shared);
} catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND" && /internal-jobs/.test(err.message)) {
        console.log("[index] Optional ./internal-jobs module not present — skipping.");
    } else {
        throw err; // a real error inside the module should not be swallowed
    }
}

// Optional private module — cloud-only, kept out of the public/self-host repo
// (.gitignore). Loaded only if present so open-source checkouts deploy fine.
let internalSvcFns = {};
try {
    internalSvcFns = require("./internal-svc")(shared);
} catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND" && /internal-svc/.test(err.message)) {
        console.log("[index] Optional ./internal-svc module not present — skipping.");
    } else {
        throw err; // a real error inside the module should not be swallowed
    }
}

// ─── Re-export All Cloud Functions ───────────────────────────

// Remove internal helpers before exporting (these are plain functions,
// not onCall/onRequest — they'd crash if Firebase tried to deploy them)
delete apiKeyFns._validateApiKey;
delete mfaFns._verifyUserTotp;
delete inviteFns.trackPaidReferral;

Object.assign(exports, authFns, plaidFns, stripeFns, mfaFns, inviteFns, sharedAccessFns, scheduledFns, chatbotFns, apiKeyFns, apiFns, adEventFns, activeUserFns, blogSiteFns, aiHealthFns, socialFns, blgFns, internalJobsFns, internalSvcFns);
