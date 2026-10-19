// Single source of truth for how a Chemistry material actually LOOKS as the substance in a
// vessel — distinct from `Chemical.color`, which is the card / bottle-tint artwork colour.
//
// This table is materialised onto `Chemical.appearance` at seed time (seed.js) and by the
// 20260829 migration, so `GET /api/chemicals` ships it to the mobile client and the reaction /
// observable-state engine (appearanceService.js) can read it server-side. Keep it keyed by
// `symbol` — reactions, practicals and grading all key off `symbol`, never `name`.
//
//   solutionColor : hex the liquid fill renders as inside a test tube / beaker
//   opacity       : 0..1 fill opacity — colourless liquids stay LOW but non-zero (still visible)
//   phase         : "solution" | "liquid" | "solid" | "gas" | "powder" | "crystals" | "metal"
//   texture       : "clear" | "cloudy" | "opaque" | "metallic" | "granular"
//
// A colourless aqueous solution is a faint blue-grey at low opacity — never invisible (spec §4).

const COLOURLESS_SOLUTION = { solutionColor: "#DCEBF7", opacity: 0.35, phase: "solution", texture: "clear" };

const CHEMICAL_APPEARANCE = {
  // --- Acids (all dilute aqueous, colourless) ---
  HCl: { ...COLOURLESS_SOLUTION },
  H2SO4: { ...COLOURLESS_SOLUTION },
  CH3COOH: { ...COLOURLESS_SOLUTION },

  // --- Bases ---
  NaOH: { ...COLOURLESS_SOLUTION },
  "Ca(OH)2": { solutionColor: "#EEF3F4", opacity: 0.4, phase: "solution", texture: "clear" }, // limewater — clear until CO2

  // --- Salts: aqueous unless noted ---
  NaCl: { solutionColor: "#FFFFFF", opacity: 1, phase: "crystals", texture: "granular" }, // solid in catalog
  CaCO3: { solutionColor: "#F4F4F0", opacity: 1, phase: "powder", texture: "opaque" },
  CaCl2: { ...COLOURLESS_SOLUTION },
  AgNO3: { ...COLOURLESS_SOLUTION },
  AgCl: { solutionColor: "#ECEFF1", opacity: 1, phase: "powder", texture: "opaque" }, // white precipitate solid
  NaNO3: { ...COLOURLESS_SOLUTION },
  BaCl2: { ...COLOURLESS_SOLUTION },
  Na2SO4: { ...COLOURLESS_SOLUTION },
  BaSO4: { solutionColor: "#ECEFF1", opacity: 1, phase: "powder", texture: "opaque" }, // white precipitate solid
  CuSO4: { solutionColor: "#2E86DE", opacity: 0.9, phase: "solution", texture: "clear" }, // classic blue
  ZnSO4: { ...COLOURLESS_SOLUTION },
  ZnCl2: { ...COLOURLESS_SOLUTION },
  MgCl2: { ...COLOURLESS_SOLUTION },
  CH3COONa: { ...COLOURLESS_SOLUTION },

  // --- Metals (bench solids) ---
  Mg: { solutionColor: "#C7C9CC", opacity: 1, phase: "metal", texture: "metallic" },
  Zn: { solutionColor: "#B7BBC2", opacity: 1, phase: "metal", texture: "metallic" },
  Cu: { solutionColor: "#B87333", opacity: 1, phase: "metal", texture: "metallic" },
  Na: { solutionColor: "#D2D2DC", opacity: 1, phase: "metal", texture: "metallic" },

  // --- Non-metals / elements used as reactants ---
  C: { solutionColor: "#2B2B2B", opacity: 1, phase: "powder", texture: "opaque" },
  Cl2: { solutionColor: "#D9F2A6", opacity: 0.25, phase: "gas", texture: "clear" }, // pale green gas
  S: { solutionColor: "#E6D200", opacity: 1, phase: "powder", texture: "granular" },

  // --- Gases ---
  O2: { solutionColor: "#EAF6FF", opacity: 0.12, phase: "gas", texture: "clear" },
  CO2: { solutionColor: "#EDEDED", opacity: 0.12, phase: "gas", texture: "clear" },
  H2: { solutionColor: "#EAF6FF", opacity: 0.1, phase: "gas", texture: "clear" },

  // --- Oxides ---
  H2O: { solutionColor: "#DCEBF7", opacity: 0.32, phase: "liquid", texture: "clear" },
  MgO: { solutionColor: "#F5F5F5", opacity: 1, phase: "powder", texture: "opaque" },

  // --- Indicators: the colour of the NEAT reagent (before it meets an acid/base). Its colour
  //     once added to a solution is computed by appearanceService.INDICATOR_MODELS, not here. ---
  Phph: { solutionColor: "#F3F0F7", opacity: 0.3, phase: "solution", texture: "clear" }, // near-colourless neat
  UI: { solutionColor: "#5C8A3A", opacity: 0.85, phase: "solution", texture: "clear" }, // neat UI is olive-green
  MeOr: { solutionColor: "#F57C00", opacity: 0.8, phase: "solution", texture: "clear" }, // neat methyl orange
  Litmus: { solutionColor: "#7E57C2", opacity: 0.8, phase: "solution", texture: "clear" }, // neat litmus is purple
};

// Category / state fallback for anything not explicitly listed above — so a newly added chemical
// still gets a sane lab appearance without a table entry.
const fallbackAppearance = (chemical) => {
  const state = chemical.state;
  if (state === "solid") return { solutionColor: chemical.color || "#EFEFEF", opacity: 1, phase: "solid", texture: "opaque" };
  if (state === "gas") return { solutionColor: chemical.color || "#EDEDED", opacity: 0.12, phase: "gas", texture: "clear" };
  // liquid / aqueous — treat a near-white curated colour as "colourless" and render the faint tint.
  const NEAR_WHITE = new Set(["#FFFFFF", "#FFF", "#F2F2F2", "#F5F5F5", "#FAFAFA", "#F5F5DC", "#EAF6FF", "#E8E8E8"]);
  const c = (chemical.color || "").toUpperCase();
  if (!c || NEAR_WHITE.has(c)) return { ...COLOURLESS_SOLUTION };
  return { solutionColor: chemical.color, opacity: 0.85, phase: state === "aqueous" ? "solution" : "liquid", texture: "clear" };
};

// Returns the appearance object to persist on a Chemical doc (plain data, not a Mongoose subdoc).
const appearanceFor = (chemical) => {
  const explicit = CHEMICAL_APPEARANCE[chemical.symbol];
  return explicit ? { ...explicit } : fallbackAppearance(chemical);
};

// Merge appearance into an array of raw chemical seed objects (mutating a shallow copy).
const withAppearance = (chemicalsData) =>
  chemicalsData.map((c) => ({ ...c, appearance: c.appearance || appearanceFor(c) }));

module.exports = { CHEMICAL_APPEARANCE, COLOURLESS_SOLUTION, fallbackAppearance, appearanceFor, withAppearance };
