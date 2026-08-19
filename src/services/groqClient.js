const OpenAI = require("openai");

let client = null;

const isPlaceholder = (key) => !key || key === "your_groq_api_key_here";

const getClient = () => {
  if (!client && !isPlaceholder(process.env.GROQ_API_KEY)) {
    client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return client;
};

const isConfigured = () => Boolean(getClient());

/**
 * Sends a single-turn prompt to Groq's OpenAI-compatible chat completions API
 * and returns the trimmed response text. Throws on API failure — callers fall back
 * to their rule-based response on error, mirroring the previous Gemini integration.
 */
const generateText = async (prompt) => {
  const groq = getClient();
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    messages: [{ role: "user", content: prompt }],
  });
  return (completion.choices[0]?.message?.content || "").trim();
};

module.exports = { isConfigured, generateText };
