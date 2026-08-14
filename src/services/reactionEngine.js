const Reaction = require("../models/Reaction");
const Chemical = require("../models/Chemical");

/**
 * Builds the canonical lookup key for a set of reactant chemical ids: sorted, joined with "+".
 * Used both at seed time (to precompute Reaction.reactantKey) and at request time.
 */
const buildReactantKey = (chemicalIds) => {
  return chemicalIds
    .map((id) => id.toString())
    .sort()
    .join("+");
};

/**
 * Looks up a reaction for the given set of chemical ids and conditions.
 * Returns { found: true, reaction } | { found: false, reason, hint? }.
 */
const findReaction = async (chemicalIds, conditions = {}) => {
  const key = buildReactantKey(chemicalIds);
  const reaction = await Reaction.findOne({ reactantKey: key, isActive: true })
    .populate("reactants.chemical")
    .populate("products.chemical");

  if (!reaction) {
    const chemicals = await Chemical.find({ _id: { $in: chemicalIds } });
    return { found: false, reason: "no_known_reaction", explanation: explainNoReaction(chemicals) };
  }

  if (reaction.conditions.requiresHeat && !conditions.heated) {
    return {
      found: false,
      reason: "conditions_not_met",
      hint: `This reaction needs heat to proceed. Try using the burner first.`,
      reaction,
    };
  }

  return { found: true, reaction };
};

/**
 * Deterministic, category-driven explanation for why no reaction was found.
 * Not Gemini-backed — the AI Tutor chat is where a student can ask for a deeper explanation.
 */
const explainNoReaction = (chemicals) => {
  if (chemicals.length < 2) {
    return "Add at least two chemicals to see if they react.";
  }

  const categories = chemicals.map((c) => c.category);

  if (categories.every((c) => c === "metal")) {
    return "Two metals were combined — metals don't typically react with each other at room temperature in this way.";
  }

  if (categories.every((c) => c === "salt")) {
    return "Both substances are salts already in a stable, dissolved state — no new insoluble product forms from this combination.";
  }

  if (categories.includes("acid") && categories.includes("acid")) {
    return "Both substances are acids — acids don't neutralize each other.";
  }

  return "No known reaction between these substances in the curated dataset. They may be unreactive together, or this combination isn't part of the current set — ask the AI Tutor if you'd like to understand more.";
};

/**
 * Shapes a populated Reaction doc (reactants.chemical/products.chemical populated) into the
 * client-facing ReactionResultType (found: true branch) — shared by every endpoint that reports
 * a matched reaction (labRun.controller.js's continuous check, mixChemicals, and
 * session.controller.js's live-bench mix-step grading).
 */
const serializeReactionMatch = (reaction) => ({
  found: true,
  reaction: {
    id: reaction._id,
    name: reaction.name,
    balancedEquation: reaction.balancedEquation,
    reactionType: reaction.reactionType,
    products: reaction.products.map((p) => ({ chemical: p.chemical, coefficient: p.coefficient })),
    observableChanges: reaction.observableChanges,
    educationalInfo: reaction.educationalInfo,
    safetyNotes: reaction.safetyNotes,
  },
});

module.exports = { buildReactantKey, findReaction, explainNoReaction, serializeReactionMatch };
