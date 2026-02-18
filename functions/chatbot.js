const { onCall, HttpsError } = require("firebase-functions/v2/https");

module.exports = function({ secrets }) {
    const { GEMINI_API_KEY } = secrets;
    const exports = {};

    function buildSystemPrompt(financialSummary) {
        return `You are PennyHelm's financial assistant, a helpful AI that answers questions about the user's personal finances. You have access to their current financial data below.

GUIDELINES:
- Be concise and direct. Keep responses under 200 words unless the user asks for detail.
- Use specific numbers from the user's data when answering.
- Format currency amounts with $ and two decimal places.
- If asked about something not in the data, say so honestly.
- Never give specific investment advice, tax advice, or recommend specific financial products. You can explain concepts and help with budgeting.
- Do not make up data. Only reference what is provided below.
- Be encouraging but realistic about the user's financial situation.
- When discussing debts, explain the impact of interest rates and the benefit of paying more than minimums.
- For bill-related questions, reference due dates and amounts from the data.
- You can do math: calculate savings rates, debt payoff timelines, budget percentages, etc.
- Do not mention that you are an AI or that you are reading a "summary." Speak as if you naturally know the user's finances because you are their financial assistant.
- Use bold (**text**) to highlight key numbers and section headers.

USER'S FINANCIAL DATA:
${financialSummary}`;
    }

    exports.askFinancialQuestion = onCall(
        { secrets: [GEMINI_API_KEY] },
        async (request) => {
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "Must be signed in.");
            }

            const { message, conversationHistory, financialSummary } = request.data;

            if (!message || typeof message !== "string" || message.trim().length === 0) {
                throw new HttpsError("invalid-argument", "Message is required.");
            }

            if (message.length > 2000) {
                throw new HttpsError("invalid-argument", "Message too long. Max 2000 characters.");
            }

            const systemPrompt = buildSystemPrompt(financialSummary || "No financial data available.");

            // Build Gemini contents array from conversation history
            const contents = [];
            if (Array.isArray(conversationHistory)) {
                for (const msg of conversationHistory.slice(-10)) {
                    if (msg.role === "user" || msg.role === "assistant") {
                        contents.push({
                            role: msg.role === "assistant" ? "model" : "user",
                            parts: [{ text: msg.content }],
                        });
                    }
                }
            }

            // Add the current user message
            contents.push({
                role: "user",
                parts: [{ text: message.trim() }],
            });

            try {
                const apiKey = GEMINI_API_KEY.value().trim();
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: systemPrompt }],
                        },
                        contents,
                        generationConfig: {
                            temperature: 0.7,
                            topP: 0.9,
                            topK: 40,
                            maxOutputTokens: 1024,
                        },
                        safetySettings: [
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        ],
                    }),
                });

                if (!response.ok) {
                    const errorBody = await response.text();
                    console.error("Gemini API error:", response.status, errorBody);
                    if (response.status === 429) {
                        throw new HttpsError("resource-exhausted", "Too many requests. Please wait a moment and try again.");
                    }
                    throw new HttpsError("internal", "AI service temporarily unavailable.");
                }

                const result = await response.json();
                const aiResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!aiResponse) {
                    throw new HttpsError("internal", "No response from AI service.");
                }

                return { success: true, response: aiResponse };
            } catch (error) {
                if (error.code && error.httpErrorCode) throw error;
                console.error("askFinancialQuestion error:", error);
                throw new HttpsError("internal", "Failed to get AI response. Please try again.");
            }
        }
    );

    return exports;
};
