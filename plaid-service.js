/**
 * PennyHelm — Plaid service for selfhost mode.
 *
 * Exposes an Express router that mirrors the subset of Cloud Functions the
 * frontend actually calls:
 *   POST /api/plaid/createLinkToken
 *   POST /api/plaid/createUpdateLinkToken
 *   POST /api/plaid/exchangePublicToken
 *   POST /api/plaid/refreshBalances
 *   POST /api/plaid/syncTransactions
 * Plus config management:
 *   GET    /api/plaid/status     — whether Plaid is configured + env source
 *   POST   /api/plaid/config     — save client_id / secret / env to SQLite
 *   DELETE /api/plaid/config     — clear SQLite-stored config
 *
 * Configuration precedence:
 *   1. Environment variables (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV)
 *   2. SQLite settings table (written via the settings UI)
 *   3. Unconfigured — all endpoints return 409 until the user sets keys
 *
 * Env vars win so Docker users with PLAID_* set via `-e` get a read-only
 * settings page; env vars show "Configured via environment variables".
 */

const express = require('express');

const VALID_ENVS = new Set(['sandbox', 'development', 'production']);

module.exports = function createPlaidRouter(db) {
    const router = express.Router();

    // ── DB schema ─────────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS plaid_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            client_id TEXT NOT NULL,
            secret TEXT NOT NULL,
            environment TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS plaid_items (
            item_id TEXT PRIMARY KEY,
            access_token TEXT NOT NULL,
            institution_name TEXT NOT NULL,
            institution_id TEXT,
            cursor TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    const getConfigStmt = db.prepare('SELECT client_id, secret, environment FROM plaid_config WHERE id = 1');
    const upsertConfigStmt = db.prepare(`
        INSERT INTO plaid_config (id, client_id, secret, environment, updated_at)
        VALUES (1, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            client_id = excluded.client_id,
            secret = excluded.secret,
            environment = excluded.environment,
            updated_at = datetime('now')
    `);
    const clearConfigStmt = db.prepare('DELETE FROM plaid_config WHERE id = 1');

    const insertItemStmt = db.prepare(`
        INSERT OR REPLACE INTO plaid_items (item_id, access_token, institution_name, institution_id, cursor)
        VALUES (?, ?, ?, ?, NULL)
    `);
    const getItemStmt = db.prepare('SELECT * FROM plaid_items WHERE item_id = ?');
    const listItemsStmt = db.prepare('SELECT * FROM plaid_items');
    const updateCursorStmt = db.prepare('UPDATE plaid_items SET cursor = ? WHERE item_id = ?');

    // ── Config resolver ───────────────────────────────
    function resolveConfig() {
        const envId = process.env.PLAID_CLIENT_ID;
        const envSecret = process.env.PLAID_SECRET;
        const envEnv = process.env.PLAID_ENV;

        if (envId && envSecret && envEnv) {
            if (!VALID_ENVS.has(envEnv)) {
                return { ok: false, reason: `PLAID_ENV must be one of: ${[...VALID_ENVS].join(', ')}` };
            }
            return { ok: true, source: 'env', clientId: envId, secret: envSecret, environment: envEnv };
        }

        const row = getConfigStmt.get();
        if (row && row.client_id && row.secret && row.environment) {
            return { ok: true, source: 'db', clientId: row.client_id, secret: row.secret, environment: row.environment };
        }

        return { ok: false, reason: 'Plaid credentials not configured.' };
    }

    function maskId(s) {
        if (!s || s.length < 8) return '****';
        return s.slice(0, 4) + '…' + s.slice(-4);
    }

    // ── Lazy Plaid client ─────────────────────────────
    let _plaidModule = null;
    function getPlaidClient(cfg) {
        if (!_plaidModule) _plaidModule = require('plaid');
        const { Configuration, PlaidApi, PlaidEnvironments } = _plaidModule;
        const configuration = new Configuration({
            basePath: PlaidEnvironments[cfg.environment],
            baseOptions: {
                headers: {
                    'PLAID-CLIENT-ID': cfg.clientId,
                    'PLAID-SECRET': cfg.secret,
                },
            },
        });
        return new PlaidApi(configuration);
    }

    // Middleware that loads & validates config; rejects with 409 if unconfigured
    function withPlaid(handler) {
        return async (req, res) => {
            const cfg = resolveConfig();
            if (!cfg.ok) {
                return res.status(409).json({ error: cfg.reason, code: 'PLAID_NOT_CONFIGURED' });
            }
            try {
                await handler(req, res, getPlaidClient(cfg), cfg);
            } catch (err) {
                const plaidErr = err.response?.data;
                console.error('[plaid]', req.path, plaidErr || err.message);
                res.status(500).json({
                    error: plaidErr?.error_message || err.message || 'Plaid request failed',
                    code: plaidErr?.error_code || 'PLAID_ERROR',
                });
            }
        };
    }

    // ── Config endpoints ──────────────────────────────
    router.get('/status', (req, res) => {
        const cfg = resolveConfig();
        if (!cfg.ok) {
            const envPresent = !!(process.env.PLAID_CLIENT_ID || process.env.PLAID_SECRET || process.env.PLAID_ENV);
            return res.json({
                configured: false,
                source: null,
                env: null,
                clientIdMasked: null,
                hasDbConfig: false,
                envVarsPartial: envPresent,
                reason: cfg.reason,
            });
        }
        res.json({
            configured: true,
            source: cfg.source,            // 'env' | 'db'
            env: cfg.environment,
            clientIdMasked: maskId(cfg.clientId),
            hasDbConfig: !!getConfigStmt.get(),
            envVarsPartial: false,
        });
    });

    router.post('/config', express.json(), (req, res) => {
        if (process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.PLAID_ENV) {
            return res.status(409).json({
                error: 'Plaid is configured via environment variables; edit those instead.',
                code: 'ENV_LOCKED',
            });
        }
        const { client_id, secret, environment } = req.body || {};
        if (!client_id || !secret || !environment) {
            return res.status(400).json({ error: 'client_id, secret, and environment are all required.' });
        }
        if (!VALID_ENVS.has(environment)) {
            return res.status(400).json({ error: `environment must be one of: ${[...VALID_ENVS].join(', ')}` });
        }
        upsertConfigStmt.run(String(client_id), String(secret), String(environment));
        res.json({ ok: true });
    });

    router.delete('/config', (req, res) => {
        clearConfigStmt.run();
        res.json({ ok: true });
    });

    // ── Plaid flow endpoints ──────────────────────────
    router.post('/createLinkToken', express.json(), withPlaid(async (req, res, client) => {
        const linkConfig = {
            user: { client_user_id: 'local' },
            client_name: 'PennyHelm',
            products: ['transactions'],
            additional_consented_products: ['liabilities', 'investments'],
            country_codes: ['US'],
            language: 'en',
        };
        if (req.body?.redirect_uri) linkConfig.redirect_uri = req.body.redirect_uri;
        const response = await client.linkTokenCreate(linkConfig);
        res.json({ link_token: response.data.link_token });
    }));

    router.post('/createUpdateLinkToken', express.json(), withPlaid(async (req, res, client) => {
        const itemId = req.body?.item_id;
        if (!itemId) return res.status(400).json({ error: 'item_id required' });
        const item = getItemStmt.get(itemId);
        if (!item) return res.status(404).json({ error: 'Plaid item not found' });

        const linkConfig = {
            user: { client_user_id: 'local' },
            client_name: 'PennyHelm',
            access_token: item.access_token,
            additional_consented_products: ['liabilities', 'investments'],
            country_codes: ['US'],
            language: 'en',
        };
        if (req.body?.redirect_uri) linkConfig.redirect_uri = req.body.redirect_uri;
        const response = await client.linkTokenCreate(linkConfig);
        res.json({ link_token: response.data.link_token });
    }));

    router.post('/exchangePublicToken', express.json(), withPlaid(async (req, res, client) => {
        const { public_token, institution_name, institution_id } = req.body || {};
        if (!public_token) return res.status(400).json({ error: 'public_token required' });

        const exchange = await client.itemPublicTokenExchange({ public_token });
        const accessToken = exchange.data.access_token;
        const itemId = exchange.data.item_id;
        const instName = institution_name || 'Unknown Bank';

        insertItemStmt.run(itemId, accessToken, instName, institution_id || null);

        // Fetch accounts once for initial import (balances only for MVP)
        const accountsResp = await client.accountsGet({ access_token: accessToken });
        const accounts = accountsResp.data.accounts.map((a) => ({
            plaidAccountId: a.account_id,
            name: a.name,
            mask: a.mask,
            type: a.type,
            subtype: a.subtype,
            balanceCurrent: a.balances?.current ?? null,
            balanceAvailable: a.balances?.available ?? null,
            institutionName: instName,
        }));

        res.json({ itemId, institutionName: instName, accounts });
    }));

    router.post('/refreshBalances', express.json(), withPlaid(async (req, res, client) => {
        const requestedItemId = req.body?.item_id;
        const items = requestedItemId ? [getItemStmt.get(requestedItemId)].filter(Boolean) : listItemsStmt.all();
        if (items.length === 0) return res.json({ accounts: [] });

        const allAccounts = [];
        for (const item of items) {
            const resp = await client.accountsGet({ access_token: item.access_token });
            for (const a of resp.data.accounts) {
                allAccounts.push({
                    plaidAccountId: a.account_id,
                    plaidItemId: item.item_id,
                    name: a.name,
                    type: a.type,
                    subtype: a.subtype,
                    balanceCurrent: a.balances?.current ?? null,
                    balanceAvailable: a.balances?.available ?? null,
                    institutionName: item.institution_name,
                });
            }
        }
        res.json({ accounts: allAccounts });
    }));

    router.post('/syncTransactions', express.json(), withPlaid(async (req, res, client) => {
        // Cursor-based sync per Plaid's /transactions/sync. One pass over added
        // transactions; ignores modified/removed for MVP (covers >95% of cases).
        const items = listItemsStmt.all();
        const allTxns = [];
        for (const item of items) {
            let cursor = item.cursor || null;
            let hasMore = true;
            while (hasMore) {
                const resp = await client.transactionsSync({
                    access_token: item.access_token,
                    cursor: cursor || undefined,
                    count: 500,
                });
                const data = resp.data;
                for (const t of data.added || []) {
                    allTxns.push({
                        plaidTransactionId: t.transaction_id,
                        plaidAccountId: t.account_id,
                        plaidItemId: item.item_id,
                        date: t.date,
                        amount: t.amount,
                        name: t.name,
                        merchantName: t.merchant_name || null,
                        category: (t.personal_finance_category?.primary) || (t.category?.[0]) || null,
                        pending: !!t.pending,
                        institutionName: item.institution_name,
                    });
                }
                cursor = data.next_cursor;
                hasMore = !!data.has_more;
            }
            updateCursorStmt.run(cursor, item.item_id);
        }
        res.json({ transactions: allTxns });
    }));

    return router;
};
