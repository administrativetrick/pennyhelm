/**
 * Single source of truth for the Gemini model used across Cloud Functions, plus
 * pure + networked helpers to verify that model is still available on the API.
 *
 * Why this exists: Google retires models on its own schedule (gemini-2.0-flash
 * was removed in Jun 2026, which threw a 404 only at generation time — after a
 * user clicked "generate"). Centralizing the model name here means chatbot.js,
 * internal-jobs.js, and the ai-health monitor all agree on one value, and the
 * scheduled `verifyGeminiModel` check can confirm it's live *before* anyone hits
 * it. See tests/gemini-config.test.js and functions/ai-health.js.
 *
 * @module gemini-config
 */

// The model every Gemini-backed function uses. Change it in ONE place.
const GEMINI_MODEL = "gemini-2.5-flash";

const LIST_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Pure: extract the generateContent-capable model ids from a ListModels payload.
 * Tolerant of missing/empty input. Strips the "models/" prefix.
 */
function generateContentModels(listJson) {
    const models = (listJson && Array.isArray(listJson.models)) ? listJson.models : [];
    return models
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => String(m.name || "").replace(/^models\//, ""))
        .filter(Boolean);
}

/**
 * Network: list the generateContent models available to this API key.
 * `fetchImpl` is injectable so the logic is unit-testable without a network.
 */
async function fetchAvailableModels(apiKey, fetchImpl = fetch) {
    const url = `${LIST_MODELS_URL}?key=${encodeURIComponent(String(apiKey || "").trim())}`;
    const res = await fetchImpl(url);
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`ListModels failed: ${res.status} ${String(body).slice(0, 300)}`);
    }
    return generateContentModels(await res.json());
}

/**
 * Compose: is `model` present (and generateContent-capable) for this key?
 * Returns { model, available, models }.
 */
async function checkModelAvailable(apiKey, model = GEMINI_MODEL, fetchImpl = fetch) {
    const models = await fetchAvailableModels(apiKey, fetchImpl);
    return { model, available: models.includes(model), models };
}

module.exports = {
    GEMINI_MODEL,
    LIST_MODELS_URL,
    generateContentModels,
    fetchAvailableModels,
    checkModelAvailable,
};
