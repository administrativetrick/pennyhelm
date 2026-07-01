/**
 * Static-assertion tests for the design-token / theme system in css/styles.css.
 *
 * The app themes itself entirely through CSS custom properties. Light-mode
 * values are declared in TWO places that must stay in sync:
 *   • [data-theme="light"]                     — explicit user toggle
 *   • @media (prefers-color-scheme: light) :root:not([data-theme]) — OS default
 *
 * Hand-editing one and forgetting the other is a classic footgun that silently
 * breaks light mode for half the users. These assertions catch that drift at
 * test time, and lock in that the (dark) :root brand accent is the intended
 * green so an accidental revert to the old blue is caught too.
 *
 * app.html assertions guard that the brand fonts and stylesheet are wired up.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(__dirname, '../css/styles.css'), 'utf8');
const APP_HTML = readFileSync(resolve(__dirname, '../app.html'), 'utf8');

/**
 * Extract the body of a CSS rule given its selector (no trailing `{`).
 * Returns the raw text between that rule's `{` and its matching `}` (assumes
 * no nested braces, which holds for these flat token blocks).
 */
function ruleBody(css, selector) {
    const start = css.indexOf(selector);
    assert.notEqual(start, -1, `could not find CSS block: ${selector}`);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    assert.ok(open !== -1 && close !== -1, `malformed CSS block: ${selector}`);
    return css.slice(open + 1, close);
}

/** Parse `--name: value;` pairs from a rule body into a plain object. */
function tokens(body) {
    const out = {};
    const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        out[m[1]] = m[2].trim();
    }
    return out;
}

const root = tokens(ruleBody(CSS, ':root'));
const lightAttr = tokens(ruleBody(CSS, '[data-theme="light"]'));
const lightMedia = tokens(ruleBody(CSS, ':root:not([data-theme])'));

describe('css/styles.css design tokens', () => {
    test(':root defines the green brand accent (rebrand landed, not reverted)', () => {
        assert.equal(
            (root['--accent'] || '').toLowerCase(),
            '#56d2a0',
            'the dark-theme --accent should be the PennyHelm green #56d2a0',
        );
    });

    test('brand type + radius tokens are defined on :root', () => {
        for (const key of ['--font-sans', '--font-num', '--radius', '--radius-lg']) {
            assert.ok(root[key], `:root is missing ${key}`);
        }
        assert.match(root['--font-sans'], /Hanken Grotesk/, '--font-sans should lead with Hanken Grotesk');
    });

    test('the two light-mode blocks define identical tokens (no drift)', () => {
        assert.deepEqual(
            lightMedia,
            lightAttr,
            'the [data-theme="light"] block and the prefers-color-scheme:light block ' +
            'must define the exact same tokens and values — one was edited without the other',
        );
    });

    test('every light-mode token also exists on :root (no orphan / typo)', () => {
        for (const key of Object.keys(lightAttr)) {
            assert.ok(
                key in root,
                `light theme defines ${key} but :root does not — likely a typo or a stale token`,
            );
        }
    });

    test('light mode overrides the accent with its own value', () => {
        assert.ok(lightAttr['--accent'], 'light theme must define --accent');
        assert.notEqual(
            lightAttr['--accent'].toLowerCase(),
            root['--accent'].toLowerCase(),
            'light --accent should be tuned for white backgrounds, not reuse the dark green',
        );
    });
});

describe('app.html brand assets', () => {
    test('loads the Hanken Grotesk / IBM Plex Mono webfonts', () => {
        assert.match(
            APP_HTML,
            /fonts\.googleapis\.com\/css2\?family=Hanken\+Grotesk/,
            'app.html should load the Hanken Grotesk webfont used by --font-sans',
        );
    });

    test('still links the main stylesheet', () => {
        assert.match(
            APP_HTML,
            /<link\b[^>]*href=["']css\/styles\.css["']/,
            'app.html must link css/styles.css',
        );
    });
});
