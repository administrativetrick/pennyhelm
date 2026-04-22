/**
 * Static-assertion tests for login.html's script tags.
 *
 * login.html is the entry point for /login and is on the critical path of
 * every mobile signup. Shipping firestore/functions/app-check compat as
 * static <script> tags here re-introduces the ~375 KB mobile slowdown that
 * motivated the lazy loader. These assertions catch that regression at
 * test time rather than in a post-deploy Lighthouse run.
 *
 * The rule:
 *   • Exactly two Firebase compat SDKs may appear as static <script>:
 *       - firebase-app-compat
 *       - firebase-auth-compat
 *   • Both must have the `defer` attribute (so they don't block the HTML
 *     parser on mobile).
 *   • firestore / functions / app-check compat must NOT appear — they're
 *     loaded on demand by js/firebase-sdk-loader.js after first user action.
 *   • js/login.js must be loaded as a module.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGIN_HTML = readFileSync(
    resolve(__dirname, '../login.html'),
    'utf8',
);

// Grab every <script> tag (opening tag only — we only care about attrs/src).
function scriptTags(html) {
    const tags = [];
    const re = /<script\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        tags.push(m[0]);
    }
    return tags;
}

// Just the ones that load a Firebase compat SDK from gstatic.
function firebaseCompatTags(html) {
    return scriptTags(html).filter(t => /firebase-[a-z-]+-compat/.test(t));
}

describe('login.html critical-path <script> tags', () => {
    test('loads exactly firebase-app-compat and firebase-auth-compat (no firestore/functions/app-check)', () => {
        const tags = firebaseCompatTags(LOGIN_HTML);
        const names = tags
            .map(t => {
                const m = t.match(/firebase-([a-z-]+)-compat/);
                return m ? m[1] : null;
            })
            .filter(Boolean)
            .sort();
        assert.deepEqual(
            names,
            ['app', 'auth'],
            'login.html should only load app-compat + auth-compat on the critical path; ' +
            'firestore/functions/app-check are loaded on demand by firebase-sdk-loader.js',
        );
    });

    test('both Firebase compat script tags carry the `defer` attribute', () => {
        const tags = firebaseCompatTags(LOGIN_HTML);
        assert.ok(tags.length >= 2, 'expected at least the two critical-path firebase compat tags');
        for (const t of tags) {
            assert.match(
                t,
                /\bdefer\b/,
                `expected \`defer\` on critical-path firebase tag, got: ${t}`,
            );
        }
    });

    test('firestore-compat is NOT in a static <script> tag', () => {
        assert.doesNotMatch(
            LOGIN_HTML,
            /<script\b[^>]*firebase-firestore-compat/i,
            'firestore-compat must be lazy-loaded via js/firebase-sdk-loader.js — ' +
            'adding it back to login.html re-introduces the 344 KB mobile regression',
        );
    });

    test('functions-compat is NOT in a static <script> tag', () => {
        assert.doesNotMatch(
            LOGIN_HTML,
            /<script\b[^>]*firebase-functions-compat/i,
            'functions-compat must be lazy-loaded via js/firebase-sdk-loader.js',
        );
    });

    test('app-check-compat is NOT in a static <script> tag', () => {
        assert.doesNotMatch(
            LOGIN_HTML,
            /<script\b[^>]*firebase-app-check-compat/i,
            'app-check-compat must be lazy-loaded via js/firebase-sdk-loader.js',
        );
    });

    test('js/login.js is loaded as an ES module', () => {
        assert.match(
            LOGIN_HTML,
            /<script\b[^>]*type=["']module["'][^>]*src=["']js\/login\.js["']/,
            'js/login.js must be loaded with type="module" so it can import firebase-sdk-loader.js',
        );
    });

    test('gstatic Firebase URLs use the pinned v10 CDN path', () => {
        // Pinning matters: the lazy loader's DEFAULT_SDK_CDN has to match the
        // compat version loaded on the critical path, or you end up mixing SDK
        // majors at runtime (firebase-app v10 + firebase-firestore v11 =
        // undefined behavior).
        const tags = firebaseCompatTags(LOGIN_HTML);
        for (const t of tags) {
            assert.match(
                t,
                /gstatic\.com\/firebasejs\/10\./,
                `expected pinned v10 SDK on gstatic; mismatched major would diverge from ` +
                `DEFAULT_SDK_CDN in js/firebase-sdk-loader.js. Got: ${t}`,
            );
        }
    });
});
