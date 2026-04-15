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
 *   invites.js   — Sharing invites, registration codes, waitlist
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

function getEmailTransporter() {
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
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
    STRIPE_ANNUAL_PRICE_ID, STRIPE_MONTHLY_PRICE_ID,
    MFA_ENCRYPTION_KEY,
    GEMINI_API_KEY,
};

// ─── Load Domain Modules ─────────────────────────────────────

const shared = { admin, db, getPlaidClient, getEmailTransporter, generateSecurePassword, hashPassword, secrets };

const authFns      = require("./auth")(shared);
const plaidFns     = require("./plaid")(shared);
const stripeFns    = require("./stripe")(shared);
const mfaFns       = require("./mfa")(shared);
const inviteFns    = require("./invites")(shared);
const scheduledFns = require("./scheduled")(shared);
const chatbotFns   = require("./chatbot")(shared);
const apiKeyFns    = require("./api-keys")(shared);
const apiFns       = require("./api")(shared, apiKeyFns._validateApiKey);

// ─── Re-export All Cloud Functions ───────────────────────────

// Remove internal helper before exporting
delete apiKeyFns._validateApiKey;

Object.assign(exports, authFns, plaidFns, stripeFns, mfaFns, inviteFns, scheduledFns, chatbotFns, apiKeyFns, apiFns);
