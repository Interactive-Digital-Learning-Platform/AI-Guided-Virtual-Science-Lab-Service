const { isConfigured, generateText } = require("./groqClient");
const {
  ASSET_TYPES,
  ACTION_TYPES,
  DIFFICULTIES,
  MIN_STAGES,
  MAX_STAGES,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
  validateGeneratedVisualization,
} = require("../utils/generatedVisualizationSchema");

// Curated Grade 10/11 (G.C.E. O/L-equivalent) Biology syllabus topics — there is no persisted
// curriculum whitelist anywhere in this codebase (Concept.js's visualizationType enum is stale),
// so this list is the classification boundary embedded directly in the prompt.
const SUPPORTED_TOPICS = `
- Cell structure and organisation
- Nutrition in plants (photosynthesis, transport in plants, xylem/phloem, transpiration)
- Nutrition in humans (digestion, enzymes, absorption)
- Transport in humans (circulatory system, blood, heart)
- Respiration and gas exchange (breathing, alveoli, cellular respiration)
- Excretion
- Reproduction (in plants and humans, including the menstrual cycle)
- Coordination and response (nervous system, reflex action, hormones)
- Homeostasis
- Ecosystems and the environment (water cycle, food chains, carbon cycle)
- Health and disease
- Basic genetics and variation (Mendelian inheritance at an introductory level)
`.trim();

// These must not include curriculum-outside/human-authored text — the LLM's own "message" field
// (if any) is always ignored in favour of these fixed strings, so wording stays consistent and
// never accidentally reveals something off-curriculum via a stray sentence.
const UNSUPPORTED_MESSAGE =
  "This topic is outside the Grade 10-11 Biology content currently supported by the lab. Try asking about a topic such as photosynthesis, respiration, digestion, transport in plants, or gas exchange.";
const RELATED_PREFIX =
  "This concept is related to your Grade 10/11 Biology syllabus. Here's an explanation at the level appropriate for your grade.";

const buildPrompt = ({ question, correction }) => `
You are a curriculum-aware content generator for a Sri Lankan Grade 10/11 Biology virtual lab app.
A student asked: "${question}"

Supported Grade 10/11 Biology syllabus topics:
${SUPPORTED_TOPICS}

Task: classify the question, then (if applicable) produce a short structured storyboard for an
interactive 2D animation explaining it. Respond with ONLY a single JSON object, no prose, no
markdown fences, matching exactly this shape:

{
  "status": "supported" | "related" | "unsupported",
  "visualization": null | {
    "title": string,
    "description": string,
    "syllabusTopic": string,
    "learningObjective": string,
    "keyConcept": string,
    "difficulty": "easy" | "medium" | "hard",
    "durationSec": number (${MIN_DURATION_SEC}-${MAX_DURATION_SEC}),
    "stages": [ // ${MIN_STAGES}-${MAX_STAGES} stages, in order
      {
        "stageId": number (1-based, sequential),
        "title": string (short stage caption, e.g. "Evaporation"),
        "durationMs": number (typically 3000-5000),
        "explanation": string (1-2 plain sentences, Grade 10/11 level),
        "componentIds": string[] (elementIds from this stage's sceneElements that are tappable, must match an entry in "components"),
        "sceneElements": [ // what actually appears/moves in this stage, 1-4 elements
          {
            "elementId": string (stable id, reused across stages if the same object persists, e.g. "leaf-1"),
            "assetType": one of [${ASSET_TYPES.map((t) => `"${t}"`).join(", ")}],
            "action": one of [${ACTION_TYPES.map((t) => `"${t}"`).join(", ")}],
            "fromX": number (0-100), "fromY": number (0-100),
            "toX": number (0-100), "toY": number (0-100)
            // for actions that don't move the element (pulse, highlight, fadeIn, fadeOut, appear, disappear, grow, shrink, rotate), set toX/toY equal to fromX/fromY
          }
        ]
      }
    ],
    "components": [ // tap-to-learn info for elementIds referenced in any stage's componentIds
      { "componentId": string, "label": string, "shortInfo": string (1-2 sentences) }
    ],
    "learningQuestions": [ // exactly 1 short multiple-choice check reinforcing the concept
      { "question": string, "options": string[] (3 options), "correctIndex": number, "replayStageId": number | null }
    ]
  }
}

Rules:
- If the question is clearly outside the supported topics (e.g. university/graduate-level content
  such as gene editing techniques, advanced biochemistry, or anything unrelated to Biology),
  set "status": "unsupported" and "visualization": null.
- If the question is Biology but only loosely related to the supported topics, set "status":
  "related" and still produce a simplified, Grade 10/11-appropriate visualization.
- Otherwise set "status": "supported".
- Never use university-level terminology or assume knowledge beyond Grade 10/11.
- coordinates are percentages of a 0-100 canvas; keep related elements visually sensible
  (e.g. water should move from roots toward leaves, not the reverse).
${correction ? `\nYour previous response was invalid: ${correction}\nFix exactly this and return the corrected JSON object only.` : ""}
`.trim();

const extractJson = (text) => {
  // Strip markdown code fences if the model wrapped the JSON despite instructions not to.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
};

// Runs the classify+generate pipeline for one student question. Returns:
//   { status: "unsupported", message }
//   { status: "related" | "supported", visualization }
//   { status: "generation_unavailable" }  — Groq not configured
//   { status: "generation_failed" }       — LLM output invalid after one retry
const generateVisualization = async (question) => {
  if (!isConfigured()) {
    return { status: "generation_unavailable" };
  }

  let correction = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generateText(buildPrompt({ question, correction }));
      const parsed = JSON.parse(extractJson(raw));

      if (!["supported", "related", "unsupported"].includes(parsed?.status)) {
        correction = 'status must be exactly one of "supported", "related", "unsupported".';
        continue;
      }

      if (parsed.status === "unsupported") {
        return { status: "unsupported", message: UNSUPPORTED_MESSAGE };
      }

      const { valid, reason } = validateGeneratedVisualization(parsed.visualization);
      if (!valid) {
        correction = reason;
        continue;
      }

      const visualization = parsed.visualization;
      if (parsed.status === "related") {
        visualization.description = `${RELATED_PREFIX} ${visualization.description}`;
      }

      return { status: parsed.status, visualization };
    } catch (error) {
      correction = `Your response could not be parsed as JSON (${error.message}).`;
    }
  }

  return { status: "generation_failed" };
};

module.exports = { generateVisualization, UNSUPPORTED_MESSAGE };
