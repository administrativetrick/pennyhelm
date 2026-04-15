#!/usr/bin/env node
/**
 * Firebase predeploy guard.
 *
 * Fails loudly if js/mode-config.js does not declare APP_MODE = 'cloud'.
 * Prevents a bare `firebase deploy` from shipping selfhost mode to the
 * hosted site, which would break every existing cloud user.
 *
 * The normal deploy flow goes through `npm run deploy:cloud`, which flips
 * the flag to cloud just long enough for the upload and then restores the
 * selfhost default.
 */

const fs = require('fs');
const path = require('path');

const MODE_FILE = path.join(__dirname, '..', 'js', 'mode-config.js');

const src = fs.readFileSync(MODE_FILE, 'utf8');
const match = src.match(/export const APP_MODE = ['"]([^'"]+)['"]/);

if (!match) {
    console.error('[verify-cloud-mode] ERROR: could not find APP_MODE declaration in js/mode-config.js');
    process.exit(1);
}

if (match[1] !== 'cloud') {
    console.error('');
    console.error('┌──────────────────────────────────────────────────────────────┐');
    console.error('│  REFUSING TO DEPLOY — APP_MODE is "' + match[1] + '", not "cloud"        │');
    console.error('├──────────────────────────────────────────────────────────────┤');
    console.error('│  The Firebase site must always run in cloud mode. Deploying  │');
    console.error('│  selfhost would break every existing user.                   │');
    console.error('│                                                              │');
    console.error('│  Use  npm run deploy:cloud  instead of bare firebase deploy. │');
    console.error('│  That script flips the mode for the duration of the upload  │');
    console.error('│  and restores the selfhost default afterward.                │');
    console.error('└──────────────────────────────────────────────────────────────┘');
    console.error('');
    process.exit(1);
}

console.log('[verify-cloud-mode] OK: APP_MODE is "cloud"');
