const { isConfigured, generateText } = require("./groqClient");

/**
 * Generates a Reactive-Mode AI Tutor response using live lab state as context, per the
 * spec's prompt-assembly order: system prompt -> lab state -> recent actions -> recent
 * conversation -> student question.
 */
const generateTutorResponse = async ({ chemicalsPresent, recentActions, conversationHistory, question, grade }) => {
  if (!isConfigured()) {
    return buildFallbackTutorResponse(chemicalsPresent, question);
  }

  const chemicalsText =
    chemicalsPresent.length > 0
      ? chemicalsPresent.map((c) => `- ${c.name} (${c.symbol})`).join("\n")
      : "No chemicals currently in the workspace.";

  const actionsText =
    recentActions.length > 0
      ? recentActions.map((a) => `- ${describeAction(a)}`).join("\n")
      : "No actions taken yet.";

  const historyText =
    conversationHistory.length > 0
      ? conversationHistory.map((turn) => `${turn.role === "user" ? "Student" : "Tutor"}: ${turn.content}`).join("\n")
      : "No prior conversation this session.";

  const prompt = `
You are a friendly, encouraging virtual chemistry teacher for a Sri Lankan Grade ${grade || 10} student
working in a virtual science laboratory.

Current chemicals in the student's workspace:
${chemicalsText}

Recent actions taken by the student:
${actionsText}

Recent conversation:
${historyText}

The student's question:
"${question}"

Answer the student's question directly, using the lab state above as context where relevant.
- Use simple language appropriate for Grade ${grade || 10}
- Keep the answer to 2-4 sentences unless the question needs more detail
- If the student asks about something not present in their workspace, gently point that out
- Do NOT use bullet points. Write as natural flowing sentences.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
    return buildFallbackTutorResponse(chemicalsPresent, question);
  }
};

const describeAction = (action) => {
  switch (action.actionType) {
    case "add_chemical":
      return `Added chemical(s) to ${action.equipment || "equipment"}`;
    case "mix":
      return `Mixed chemicals in ${action.equipment || "equipment"} — result: ${action.resultType || "unknown"}`;
    case "heat":
      return `Heated ${action.equipment || "equipment"}${action.temperature ? ` to ${action.temperature}°C` : ""}`;
    default:
      return `${action.actionType} on ${action.equipment || "equipment"}`;
  }
};

const buildFallbackTutorResponse = (chemicalsPresent, question) => {
  const chemicalNames = chemicalsPresent.map((c) => c.name).join(", ");
  if (chemicalsPresent.length === 0) {
    return `That's a great question! Try adding a chemical to your workspace first, then ask me again so I can give you a more specific answer about "${question}".`;
  }
  return `Good question about "${question}". You currently have ${chemicalNames} in your workspace — try mixing them to observe what happens, and I can help explain the result once you do.`;
};

module.exports = { generateTutorResponse };
