/**
 * Drift guard for the MOBILE copies of the shared service modules.
 *
 * The canonical sources live in js/services/; scripts/sync-shared.mjs copies
 * them verbatim (below a generated header) into
 * ../PennyHelm-Mobile/src/shared/. Metro bundles ESM directly, so the copy
 * must end with the exact canonical text — any divergence means someone
 * edited a copy or forgot to run `npm run sync:shared`.
 *
 * Skips (with a note) when the mobile repo isn't checked out next to this
 * one, so CI environments without the sibling repo stay green.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileShared = path.join(root, '..', 'PennyHelm-Mobile', 'src', 'shared');
const SERVICES = ['financial-service', 'budget-service'];

const mobileRepoPresent = fs.existsSync(path.join(root, '..', 'PennyHelm-Mobile'));

describe('drift guards: mobile src/shared copies match js/services originals', () => {
    for (const name of SERVICES) {
        test(`${name}: mobile copy is byte-identical below the generated header`, (t) => {
            if (!mobileRepoPresent) {
                t.skip('PennyHelm-Mobile repo not checked out beside this one');
                return;
            }
            const mobilePath = path.join(mobileShared, `${name}.js`);
            assert.ok(
                fs.existsSync(mobilePath),
                `${mobilePath} missing — run \`npm run sync:shared\``
            );
            const original = fs.readFileSync(path.join(root, 'js', 'services', `${name}.js`), 'utf8');
            const copy = fs.readFileSync(mobilePath, 'utf8');
            assert.ok(
                copy.endsWith(original),
                `mobile src/shared/${name}.js has drifted from js/services/${name}.js — ` +
                'edit the canonical file and run `npm run sync:shared` (never edit the copy)'
            );
        });
    }
});
