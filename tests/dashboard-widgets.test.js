/**
 * Static-assertion tests for the dashboard widget wiring.
 *
 * The dashboard renders a user-customizable set of widgets. Three lists must
 * agree or widgets silently break:
 *   • store.js getDashboardLayout() defaultOrder — what shows by default
 *   • dashboard.js widgetRenderers               — id -> HTML builder
 *   • dashboard.js DASHBOARD_WIDGETS             — id -> label/icon for the
 *                                                  customize UI
 *
 * A widget in the default order with no renderer renders nothing (invisible
 * blank); one with no metadata shows a raw id in the customize panel. These
 * assertions catch both, and lock in that the redesign's cashflow-hero widget
 * is wired across all three.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE = readFileSync(resolve(__dirname, '../js/store.js'), 'utf8');
const DASH = readFileSync(resolve(__dirname, '../js/pages/dashboard.js'), 'utf8');

function ids(re, src, group = 1) {
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[group]);
    return out;
}

// defaultOrder = ['a', 'b', ...] inside getDashboardLayout()
const orderMatch = STORE.match(/const defaultOrder = \[([^\]]*)\]/);
assert.ok(orderMatch, 'could not find defaultOrder in store.js');
const defaultOrder = ids(/'([^']+)'/g, orderMatch[1]);

// widgetRenderers = { 'id': () => ..., ... }
const wrMatch = DASH.match(/const widgetRenderers = \{([\s\S]*?)\};/);
assert.ok(wrMatch, 'could not find widgetRenderers in dashboard.js');
const rendererKeys = ids(/'([^']+)'\s*:/g, wrMatch[1]);

// DASHBOARD_WIDGETS = [ { id: 'x', ... }, ... ]
const dwMatch = DASH.match(/const DASHBOARD_WIDGETS = \[([\s\S]*?)\];/);
assert.ok(dwMatch, 'could not find DASHBOARD_WIDGETS in dashboard.js');
const widgetMetaIds = ids(/id:\s*'([^']+)'/g, dwMatch[1]);

describe('dashboard widget wiring', () => {
    test('every default-order widget has a renderer', () => {
        for (const id of defaultOrder) {
            assert.ok(
                rendererKeys.includes(id),
                `default widget "${id}" has no entry in widgetRenderers — it would render blank`,
            );
        }
    });

    test('every default-order widget has customize-panel metadata', () => {
        for (const id of defaultOrder) {
            assert.ok(
                widgetMetaIds.includes(id),
                `default widget "${id}" is missing from DASHBOARD_WIDGETS (no label/icon)`,
            );
        }
    });

    test('the cashflow-hero widget is wired end-to-end', () => {
        assert.ok(defaultOrder.includes('cashflow-hero'), 'cashflow-hero not in defaultOrder');
        assert.ok(rendererKeys.includes('cashflow-hero'), 'cashflow-hero has no renderer');
        assert.ok(widgetMetaIds.includes('cashflow-hero'), 'cashflow-hero missing from DASHBOARD_WIDGETS');
        assert.match(DASH, /function buildCashflowHeroHtml\(/, 'buildCashflowHeroHtml is not defined');
    });

    test('cashflow-hero is the first widget in the default layout', () => {
        assert.equal(
            defaultOrder[0],
            'cashflow-hero',
            'the cashflow hero should lead the default dashboard layout',
        );
    });
});
