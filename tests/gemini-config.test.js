/**
 * Tests for the Gemini model configuration + availability check.
 *
 * Background: gemini-2.0-flash was retired by Google and the only signal was a
 * 404 when a user triggered generation. These tests (plus the scheduled
 * verifyGeminiModel monitor) guard against that recurring.
 *
 * Two layers:
 *   1. Offline (always runs): the config is well-formed, the ListModels parser
 *      and availability logic behave correctly against fixtures + an injected
 *      fetch — no network required.
 *   2. Live (runs only when GEMINI_API_KEY is set): the *currently configured*
 *      model is actually available on the real API. Run it with:
 *         GEMINI_API_KEY="$(firebase functions:secrets:access GEMINI_API_KEY --project cashpilot-c58d5)" npm test
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import config from '../functions/gemini-config.js';
const { GEMINI_MODEL, generateContentModels, checkModelAvailable } = config;

// Fake fetch returning a canned ListModels response, for offline tests.
function fakeFetch(body, { ok = true, status = 200 } = {}) {
    return async () => ({
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
}

const SAMPLE_LIST = {
    models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/legacy-thing', supportedGenerationMethods: [] },
    ],
};

// ─── config shape ────────────────────────────────────────────────────

describe('GEMINI_MODEL', () => {
    test('is a non-empty gemini-* model id', () => {
        assert.equal(typeof GEMINI_MODEL, 'string');
        assert.ok(GEMINI_MODEL.length > 0);
        assert.match(GEMINI_MODEL, /^gemini-/);
    });

    test('is not a known-retired model', () => {
        // Cheap guard against accidentally reverting to a dead model name.
        const retired = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
        assert.ok(!retired.includes(GEMINI_MODEL), `${GEMINI_MODEL} is a retired model`);
    });
});

// ─── generateContentModels (pure) ────────────────────────────────────

describe('generateContentModels', () => {
    test('keeps only generateContent models and strips the models/ prefix', () => {
        assert.deepEqual(generateContentModels(SAMPLE_LIST), ['gemini-2.5-flash', 'gemini-2.5-pro']);
    });

    test('handles missing / empty payloads without throwing', () => {
        assert.deepEqual(generateContentModels(null), []);
        assert.deepEqual(generateContentModels(undefined), []);
        assert.deepEqual(generateContentModels({}), []);
        assert.deepEqual(generateContentModels({ models: [] }), []);
    });
});

// ─── checkModelAvailable (offline, injected fetch) ───────────────────

describe('checkModelAvailable', () => {
    test('reports available=true when the configured model is present', async () => {
        const r = await checkModelAvailable('fake-key', GEMINI_MODEL, fakeFetch(SAMPLE_LIST));
        assert.equal(r.available, true);
        assert.equal(r.model, GEMINI_MODEL);
        assert.ok(r.models.includes(GEMINI_MODEL));
    });

    test('reports available=false for a retired model', async () => {
        const r = await checkModelAvailable('fake-key', 'gemini-2.0-flash', fakeFetch(SAMPLE_LIST));
        assert.equal(r.available, false);
    });

    test('throws a clear error on a non-OK ListModels response', async () => {
        await assert.rejects(
            () => checkModelAvailable('fake-key', GEMINI_MODEL, fakeFetch({ error: 'forbidden' }, { ok: false, status: 403 })),
            /ListModels failed: 403/,
        );
    });
});

// ─── live availability (opt-in via GEMINI_API_KEY) ───────────────────

describe('live Gemini availability', () => {
    const key = process.env.GEMINI_API_KEY;

    test('the configured model is actually available on the live API', { skip: key ? false : 'set GEMINI_API_KEY to run this live check' }, async () => {
        const r = await checkModelAvailable(key, GEMINI_MODEL);
        assert.equal(r.available, true, `Configured model "${GEMINI_MODEL}" is NOT available. Available: ${r.models.join(', ')}`);
    });
});
