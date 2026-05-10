const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAI = null;

const getGenAI = () => {
  if (!genAI && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here") {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
};

/**
 * Generate personalized natural-language feedback using Gemini
 */
const generateFeedback = async ({ experimentTitle, score, misconceptions, strengths, grade }) => {
  const client = getGenAI();
  if (!client) {
    // Return rule-based feedback if Gemini is not configured
    return buildRuleBasedFeedback(experimentTitle, score, misconceptions, strengths);
  }

  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });

  const misconceptionText =
    misconceptions.length > 0
      ? misconceptions.map((m) => `- ${m.description} (Step ${m.relatedStep || "N/A"})`).join("\n")
      : "None detected.";

  const strengthText =
    strengths.length > 0 ? strengths.map((s) => `- ${s}`).join("\n") : "Keep practicing to build strengths.";

  const prompt = `
You are a friendly, encouraging science teacher giving feedback to a Grade ${grade} student.
The student just completed the virtual experiment: "${experimentTitle}".
Their score: ${score}/100.

Strengths observed:
${strengthText}

Misconceptions detected:
${misconceptionText}

Write a short, encouraging 3-4 sentence feedback message. 
- Start with a positive note
- Gently mention one misconception if any, with a clear explanation
- End with an encouraging next step
- Use simple language appropriate for Grade ${grade}
- Do NOT use bullet points. Write as natural flowing sentences.
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("Gemini API error:", error.message);
    return buildRuleBasedFeedback(experimentTitle, score, misconceptions, strengths);
  }
};

const buildRuleBasedFeedback = (experimentTitle, score, misconceptions, strengths) => {
  const parts = [];

  if (score >= 80) {
    parts.push(`Fantastic work on "${experimentTitle}"! You scored ${score}% — that's excellent!`);
  } else if (score >= 50) {
    parts.push(`Good effort on "${experimentTitle}"! You scored ${score}% — you're making great progress.`);
  } else {
    parts.push(`Thank you for trying "${experimentTitle}"! You scored ${score}% — don't worry, practice makes perfect.`);
  }

  if (strengths.length > 0) {
    parts.push(strengths[0]);
  }

  if (misconceptions.length > 0) {
    parts.push(`One thing to work on: ${misconceptions[0].description} ${misconceptions[0].correctionStrategy}`);
  } else {
    parts.push("Great job — no major misconceptions were detected in this session!");
  }

  parts.push("Keep exploring and experimenting — every attempt makes you a better scientist! 🔬");

  return parts.join(" ");
};

module.exports = { generateFeedback };
