// Deterministic, curated pH estimation for the pH meter instrument — same "deterministic
// chemistry state, not an LLM" principle as reactionEngine.js. Category fallbacks are rough
// O/L-level teaching approximations, not real pKa-derived values.
const CATEGORY_PH_FALLBACK = { acid: 2.5, base: 12, salt: 7, oxide: 7 };

// A chemical's pH, or null if it isn't meaningfully measurable (not liquid/aqueous, or no
// curated/category value applies — e.g. metals, gases, indicators).
const resolveChemicalPh = (chemical) => {
  if (chemical.phValue != null) return chemical.phValue;
  if (chemical.state !== "liquid" && chemical.state !== "aqueous") return null;
  return CATEGORY_PH_FALLBACK[chemical.category] ?? null;
};

// Deterministic pH reading for an equipment instance's current contents (post any reaction the
// controller has already applied). Simplification, in the same spirit as checkAndApplyReaction's
// existing "non-stoichiometric summation": a volume-weighted arithmetic mean of member pH values,
// not a rigorous [H+]-concentration mix — good enough for a curated teaching tool.
const computeContainerPh = (instance, chemicalsById) => {
  const liquidContents = instance.contents.filter((c) => {
    const chem = chemicalsById[c.chemical.toString()];
    return chem && (chem.state === "liquid" || chem.state === "aqueous");
  });
  if (liquidContents.length === 0) return { measurable: false, value: null, reason: "no_liquid" };

  const weighted = liquidContents
    .map((c) => ({ ph: resolveChemicalPh(chemicalsById[c.chemical.toString()]), weight: c.volume || 1 }))
    .filter((w) => w.ph != null);
  if (weighted.length === 0) return { measurable: false, value: null, reason: "ph_unknown" };

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const average = weighted.reduce((sum, w) => sum + w.ph * w.weight, 0) / totalWeight;
  const value = Math.round(Math.min(14, Math.max(0, average)) * 10) / 10;
  return { measurable: true, value, reason: null };
};

module.exports = { resolveChemicalPh, computeContainerPh };
