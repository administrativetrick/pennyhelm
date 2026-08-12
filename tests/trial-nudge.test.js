/**
 * Trial-nudge cron pure helpers: which reminder fires on a given day, and the
 * email copy. No Firestore/SMTP — just the decision logic + templating.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { pickTrialMilestone, trialEmailContent } = require('../functions/trial-nudge-content.js');

describe('pickTrialMilestone', () => {
    test('too early → no email', () => {
        assert.equal(pickTrialMilestone(30, {}), null);
        assert.equal(pickTrialMilestone(8, {}), null);
    });
    test('final week → d7 (once)', () => {
        assert.equal(pickTrialMilestone(7, {}), 'd7');
        assert.equal(pickTrialMilestone(3, {}), 'd7');
        assert.equal(pickTrialMilestone(5, { d7: true }), null); // already sent
    });
    test('final days → d2 (once), even if d7 already went out', () => {
        assert.equal(pickTrialMilestone(2, {}), 'd2');
        assert.equal(pickTrialMilestone(1, { d7: true }), 'd2');
        assert.equal(pickTrialMilestone(2, { d2: true }), null);
    });
    test('expiry → d0 (once), independent of earlier ones', () => {
        assert.equal(pickTrialMilestone(0, {}), 'd0');
        assert.equal(pickTrialMilestone(0, { d7: true, d2: true }), 'd0');
        assert.equal(pickTrialMilestone(0, { d0: true }), null);
    });
    test('at most one milestone can be selected in a run', () => {
        // whatever daysLeft, the return is a single key or null
        for (let d = -1; d <= 10; d++) {
            const m = pickTrialMilestone(d, {});
            assert.ok(m === null || ['d7', 'd2', 'd0'].includes(m));
        }
    });
});

describe('trialEmailContent', () => {
    test('greets by first name and links to subscribe', () => {
        const { subject, html } = trialEmailContent('Jane Doe', 5, 'd7');
        assert.match(html, /Hi Jane,/);
        assert.match(subject, /5 days/);
        assert.match(html, /subscription-needed/);
        assert.match(html, /Subscribe/);
    });
    test('falls back to a generic greeting with no name', () => {
        assert.match(trialEmailContent('', 2, 'd2').html, /Hi there,/);
    });
    test('d2 singular vs plural', () => {
        assert.match(trialEmailContent('A', 1, 'd2').subject, /1 day left/);
        assert.match(trialEmailContent('A', 2, 'd2').subject, /2 days left/);
    });
    test('d0 reads as ended', () => {
        assert.match(trialEmailContent('A', 0, 'd0').subject, /has ended/i);
    });
});
