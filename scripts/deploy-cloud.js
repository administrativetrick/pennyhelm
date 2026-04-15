#!/usr/bin/env node
/**
 * Safe Firebase deploy.
 *
 *   1. Saves the current js/mode-config.js contents.
 *   2. Rewrites APP_MODE to 'cloud' (the source default is 'selfhost' so
 *      Docker and `npm start` work out of the box — this script exists
 *      solely to flip it for the upload).
 *   3. Runs `firebase deploy`, forwarding any extra CLI args.
 *   4. ALWAYS restores the original file, even if the deploy crashes.
 *
 * The Firebase predeploy hook (see firebase.json) double-checks that
 * APP_MODE is 'cloud' at upload time so a bare `firebase deploy` from
 * a fresh checkout can never ship selfhost to the hosted site.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MODE_FILE = path.join(__dirname, '..', 'js', 'mode-config.js');

const original = fs.readFileSync(MODE_FILE, 'utf8');
const match = original.match(/export const APP_MODE = ['"]([^'"]+)['"]/);

if (!match) {
    console.error('[deploy-cloud] ERROR: could not find APP_MODE declaration in js/mode-config.js');
    process.exit(1);
}

const currentMode = match[1];
let flipped = false;

if (currentMode !== 'cloud') {
    console.log(`[deploy-cloud] Flipping APP_MODE "${currentMode}" -> "cloud" for upload...`);
    const cloudContent = original.replace(
        /export const APP_MODE = ['"][^'"]+['"]/,
        "export const APP_MODE = 'cloud'"
    );
    fs.writeFileSync(MODE_FILE, cloudContent);
    flipped = true;
} else {
    console.log('[deploy-cloud] APP_MODE already "cloud", no flip needed.');
}

let exitCode = 1;
try {
    const extraArgs = process.argv.slice(2);
    const args = ['deploy', ...extraArgs];
    console.log(`[deploy-cloud] Running: firebase ${args.join(' ')}`);
    const res = spawnSync('firebase', args, { stdio: 'inherit', shell: true });
    exitCode = res.status ?? 1;
} finally {
    if (flipped) {
        console.log('[deploy-cloud] Restoring original js/mode-config.js...');
        fs.writeFileSync(MODE_FILE, original);
    }
}

process.exit(exitCode);
