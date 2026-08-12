/**
 * Trial-nudge pure helpers: milestone selection + email copy.
 *
 * Deliberately dependency-free (no firebase-functions import) so the unit
 * tests can require this file without functions/node_modules installed —
 * same rule as functions/shared/*.cjs. Used by scheduled.js's trialNudge cron.
 */

// Which trial-reminder email (if any) a user should get today, from days left
// and which milestones already went out. Returns 'd7' | 'd2' | 'd0' | null.
function pickTrialMilestone(daysLeft, nudges) {
    const sent = nudges || {};
    if (daysLeft <= 0 && !sent.d0) return 'd0';
    if (daysLeft >= 1 && daysLeft <= 2 && !sent.d2) return 'd2';
    if (daysLeft >= 3 && daysLeft <= 7 && !sent.d7) return 'd7';
    return null;
}

// Subject + HTML body for a trial-reminder email at a given milestone.
function trialEmailContent(name, daysLeft, milestone) {
    const first = name ? String(name).trim().split(/\s+/)[0] : '';
    const hi = first ? `Hi ${first},` : 'Hi there,';
    let subject, lead;
    if (milestone === 'd0') {
        subject = 'Your PennyHelm free trial has ended';
        lead = "Your free trial has ended. Subscribe to keep your bills, budgets, debts, and everything you've set up — your data is still here, waiting.";
    } else if (milestone === 'd2') {
        subject = `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your PennyHelm trial`;
        lead = `Your free trial ends in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>. Subscribe now so you don't lose access to your finances.`;
    } else {
        subject = `Your PennyHelm trial ends in ${daysLeft} days`;
        lead = `Your free trial ends in <strong>${daysLeft} days</strong>. Lock in everything you've set up with a subscription.`;
    }
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1a1d27;">
        <h2 style="margin:0 0 12px;">${hi}</h2>
        <p style="font-size:15px;line-height:1.5;color:#3a3f4b;">${lead}</p>
        <p style="text-align:center;margin:28px 0;">
            <a href="https://pennyhelm.com/app#subscription-needed" style="display:inline-block;background:#0e9f6e;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;">Subscribe &mdash; plans from $6.49/mo</a>
        </p>
        <p style="font-size:13px;color:#6b7280;line-height:1.5;">Annual $77.88/yr ($6.49/mo) &middot; Monthly $7.99/mo &middot; cancel anytime.</p>
        <p style="font-size:12px;color:#9ca3af;margin-top:22px;">You're receiving this because you started a PennyHelm free trial — it's a one-time reminder as your trial ends.</p>
    </div>`;
    return { subject, html };
}

module.exports = { pickTrialMilestone, trialEmailContent };
