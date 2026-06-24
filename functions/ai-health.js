/**
 * AI model health monitor.
 *
 * Google retires Gemini models on its own schedule, and the failure only shows
 * up at call time (a 404 when a user/cron triggers generation). This module
 * checks proactively that the model the code is configured to use
 * (gemini-config.GEMINI_MODEL) is still available, so the problem surfaces in
 * monitoring *before* it breaks the Gemini-backed functions (the in-app
 * assistant and the scheduled jobs).
 *
 *   - verifyGeminiModel    (scheduled, daily 08:00 ET): lists the models for the
 *     project key and confirms the configured model is present. If it's gone, it
 *     logs an ERROR and throws so the run is marked failed (visible in the
 *     Functions health dashboard / any log-based alerting).
 *   - verifyGeminiModelNow (callable, admin-only): same check on demand.
 *
 * @module ai-health
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GEMINI_MODEL, checkModelAvailable } = require("./gemini-config");

module.exports = ({ secrets }) => {
    const { GEMINI_API_KEY } = secrets;

    async function runCheck() {
        const apiKey = GEMINI_API_KEY.value();
        const { model, available, models } = await checkModelAvailable(apiKey);

        if (available) {
            console.log(`[aiHealth] OK: configured model "${model}" is available (${models.length} generateContent models on this key).`);
        } else {
            console.error(`[aiHealth] ALERT: configured Gemini model "${model}" is NOT available. ` +
                `Update GEMINI_MODEL in functions/gemini-config.js and redeploy. ` +
                `Currently available: ${models.join(", ")}`);
        }

        return { model, available, availableCount: models.length, availableModels: models };
    }

    // Daily at 08:00 America/New_York — an hour before the first scheduled
    // Gemini job at 09:00, so a retired model is caught before anything hits it.
    const verifyGeminiModel = onSchedule(
        { schedule: "0 8 * * *", timeZone: "America/New_York", secrets: [GEMINI_API_KEY] },
        async () => {
            const r = await runCheck();
            if (!r.available) {
                throw new Error(`Gemini model "${r.model}" is no longer available — update functions/gemini-config.js and redeploy.`);
            }
        }
    );

    // On-demand admin check (handy from the admin panel or for manual verification).
    const verifyGeminiModelNow = onCall(
        { secrets: [GEMINI_API_KEY] },
        async (request) => {
            if (!request.auth || request.auth.token.admin !== true) {
                throw new HttpsError("permission-denied", "Admin access required.");
            }
            return await runCheck();
        }
    );

    return { verifyGeminiModel, verifyGeminiModelNow };
};
