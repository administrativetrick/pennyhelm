/**
 * Tests for js/firebase-sdk-loader.js — the lazy Firebase compat SDK loader
 * that keeps firestore/functions/app-check off the critical path of
 * /login. If this file's contract breaks, the mobile signup funnel goes
 * back to a 7-second blank screen, so it matters.
 *
 * Covered:
 *   • Script tag injection URL + attributes
 *   • Memoization (repeat ensureX() calls don't refetch)
 *   • Ordering: App Check activates BEFORE firestore/functions load
 *   • Empty site key short-circuits App Check (selfhost path)
 *   • Load failures surface as rejected promises
 *   • activateAppCheck is called exactly once with the right args
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFirebaseSdkLoader, DEFAULT_SDK_CDN } from '../js/firebase-sdk-loader.js';

// ─── Fake DOM ─────────────────────────────────────────────────────────
// Just enough to stand up the loader: a `document.createElement('script')`
// that returns a plain object, and a `document.head.appendChild(s)` that
// fires `s.onload()` on a microtask. Tests can flip a knob to make specific
// scripts fail, or inspect the `injected` array to see what was appended.

function makeFakeDom({ failFor = [] } = {}) {
    const injected = [];
    const doc = {
        createElement(tag) {
            if (tag !== 'script') throw new Error('unexpected createElement: ' + tag);
            return { tag: 'script', src: null, async: false, onload: null, onerror: null };
        },
        head: {
            appendChild(s) {
                injected.push(s);
                // Resolve on a microtask so awaits upstream yield properly.
                queueMicrotask(() => {
                    const name = (s.src || '').split('/').pop().replace('.js', '');
                    if (failFor.includes(name)) {
                        if (s.onerror) s.onerror(new Error('boom'));
                    } else {
                        if (s.onload) s.onload();
                    }
                });
            },
        },
    };
    return { doc, injected };
}

// ─── Script-tag injection ─────────────────────────────────────────────

describe('_loadSdkScript', () => {
    test('creates a <script> tag with the right URL and async flag', async () => {
        const { doc, injected } = makeFakeDom();
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'abc',
            activateAppCheck: () => {},
            firebaseGlobal: {},
            documentRef: doc,
        });
        await loader._loadSdkScript('firebase-firestore-compat');
        assert.equal(injected.length, 1);
        assert.equal(injected[0].src, DEFAULT_SDK_CDN + 'firebase-firestore-compat.js');
        assert.equal(injected[0].async, true);
    });

    test('memoizes by name — repeat loads return the same promise', async () => {
        const { doc, injected } = makeFakeDom();
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'abc',
            activateAppCheck: () => {},
            firebaseGlobal: {},
            documentRef: doc,
        });
        const p1 = loader._loadSdkScript('firebase-firestore-compat');
        const p2 = loader._loadSdkScript('firebase-firestore-compat');
        assert.equal(p1, p2, 'expected the same promise instance');
        await p1;
        assert.equal(injected.length, 1, 'expected only one script tag injected');
    });

    test('rejects if the script fails to load', async () => {
        const { doc } = makeFakeDom({ failFor: ['firebase-firestore-compat'] });
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'abc',
            activateAppCheck: () => {},
            firebaseGlobal: {},
            documentRef: doc,
        });
        await assert.rejects(
            () => loader._loadSdkScript('firebase-firestore-compat'),
            /Failed to load firebase-firestore-compat/,
        );
    });

    test('respects a custom cdnBase', async () => {
        const { doc, injected } = makeFakeDom();
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'abc',
            activateAppCheck: () => {},
            firebaseGlobal: {},
            documentRef: doc,
            cdnBase: 'https://cdn.example.test/v11/',
        });
        await loader._loadSdkScript('firebase-firestore-compat');
        assert.equal(
            injected[0].src,
            'https://cdn.example.test/v11/firebase-firestore-compat.js',
        );
    });
});

// ─── App Check ────────────────────────────────────────────────────────

describe('ensureAppCheckReady', () => {
    test('with a site key, loads app-check-compat then calls activateAppCheck once', async () => {
        const { doc, injected } = makeFakeDom();
        const fakeFb = { tag: 'firebase' };
        const activateCalls = [];
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'site-key-xyz',
            activateAppCheck: (fb, key) => activateCalls.push({ fb, key }),
            firebaseGlobal: fakeFb,
            documentRef: doc,
        });

        await loader.ensureAppCheckReady();

        assert.equal(injected.length, 1);
        assert.ok(injected[0].src.endsWith('firebase-app-check-compat.js'));
        assert.deepEqual(activateCalls, [{ fb: fakeFb, key: 'site-key-xyz' }]);
    });

    test('repeat calls return the same promise and do not re-inject or re-activate', async () => {
        const { doc, injected } = makeFakeDom();
        let activateCount = 0;
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'site-key-xyz',
            activateAppCheck: () => { activateCount += 1; },
            firebaseGlobal: {},
            documentRef: doc,
        });

        const p1 = loader.ensureAppCheckReady();
        const p2 = loader.ensureAppCheckReady();
        assert.equal(p1, p2);
        await Promise.all([p1, p2]);
        assert.equal(injected.length, 1);
        assert.equal(activateCount, 1);
    });

    test('with an empty site key, short-circuits to a resolved promise — no network, no activate', async () => {
        const { doc, injected } = makeFakeDom();
        let activateCount = 0;
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: '',
            activateAppCheck: () => { activateCount += 1; },
            firebaseGlobal: {},
            documentRef: doc,
        });

        await loader.ensureAppCheckReady();

        assert.equal(injected.length, 0, 'expected no script injected for selfhost mode');
        assert.equal(activateCount, 0, 'expected activateAppCheck never called');
    });
});

// ─── Firestore + Functions ordering ───────────────────────────────────

describe('ensureFirestoreReady / ensureFunctionsReady', () => {
    test('firestore load is gated behind App Check activation', async () => {
        const { doc, injected } = makeFakeDom();
        const events = [];
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'k',
            activateAppCheck: () => events.push('activate'),
            firebaseGlobal: {},
            documentRef: doc,
        });

        // Capture the order that scripts are appended (they all resolve on
        // microtask, so the array order is observable).
        const origAppend = doc.head.appendChild;
        doc.head.appendChild = function (s) {
            events.push('append:' + s.src.split('/').pop());
            return origAppend.call(this, s);
        };

        await loader.ensureFirestoreReady();

        assert.deepEqual(events, [
            'append:firebase-app-check-compat.js',
            'activate',
            'append:firebase-firestore-compat.js',
        ]);
    });

    test('functions load is gated behind App Check activation', async () => {
        const { doc } = makeFakeDom();
        const events = [];
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'k',
            activateAppCheck: () => events.push('activate'),
            firebaseGlobal: {},
            documentRef: doc,
        });

        const origAppend = doc.head.appendChild;
        doc.head.appendChild = function (s) {
            events.push('append:' + s.src.split('/').pop());
            return origAppend.call(this, s);
        };

        await loader.ensureFunctionsReady();

        assert.deepEqual(events, [
            'append:firebase-app-check-compat.js',
            'activate',
            'append:firebase-functions-compat.js',
        ]);
    });

    test('concurrent firestore+functions calls share a single App Check activation', async () => {
        const { doc, injected } = makeFakeDom();
        let activateCount = 0;
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'k',
            activateAppCheck: () => { activateCount += 1; },
            firebaseGlobal: {},
            documentRef: doc,
        });

        await Promise.all([
            loader.ensureFirestoreReady(),
            loader.ensureFunctionsReady(),
            loader.ensureFirestoreReady(), // extra to verify memoization
        ]);

        assert.equal(activateCount, 1, 'App Check should activate exactly once');
        const names = injected.map(s => s.src.split('/').pop()).sort();
        assert.deepEqual(names, [
            'firebase-app-check-compat.js',
            'firebase-firestore-compat.js',
            'firebase-functions-compat.js',
        ]);
    });

    test('selfhost: firestore ready without ever loading app-check-compat', async () => {
        const { doc, injected } = makeFakeDom();
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: '',
            activateAppCheck: () => { throw new Error('should not be called'); },
            firebaseGlobal: {},
            documentRef: doc,
        });

        await loader.ensureFirestoreReady();

        const names = injected.map(s => s.src.split('/').pop());
        assert.deepEqual(names, ['firebase-firestore-compat.js']);
    });

    test('firestore load propagates script-load failure', async () => {
        const { doc } = makeFakeDom({ failFor: ['firebase-firestore-compat'] });
        const loader = createFirebaseSdkLoader({
            appCheckSiteKey: 'k',
            activateAppCheck: () => {},
            firebaseGlobal: {},
            documentRef: doc,
        });

        await assert.rejects(
            () => loader.ensureFirestoreReady(),
            /Failed to load firebase-firestore-compat/,
        );
    });
});

// ─── Input validation ─────────────────────────────────────────────────

describe('createFirebaseSdkLoader argument validation', () => {
    test('throws if no document is reachable', () => {
        assert.throws(
            () => createFirebaseSdkLoader({
                appCheckSiteKey: 'k',
                activateAppCheck: () => {},
                firebaseGlobal: {},
                // documentRef omitted and no global `document` in node
            }),
            /no document provided/,
        );
    });

    test('throws if no firebase global is reachable', () => {
        const { doc } = makeFakeDom();
        assert.throws(
            () => createFirebaseSdkLoader({
                appCheckSiteKey: 'k',
                activateAppCheck: () => {},
                documentRef: doc,
                // firebaseGlobal omitted and no global window.firebase in node
            }),
            /no firebase global/,
        );
    });

    test('throws if activateAppCheck is not a function', () => {
        const { doc } = makeFakeDom();
        assert.throws(
            () => createFirebaseSdkLoader({
                appCheckSiteKey: 'k',
                activateAppCheck: null,
                firebaseGlobal: {},
                documentRef: doc,
            }),
            /activateAppCheck function is required/,
        );
    });
});
