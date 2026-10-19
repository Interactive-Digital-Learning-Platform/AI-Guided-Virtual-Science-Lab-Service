// Chemistry-wide "what does the stuff in this container look like right now" engine.
//
// The backend stays authoritative for observable appearance (spec §6/§12): a student action
// mutates a container's contents, the controller calls computeObservableState(), and the result
// is persisted on LabRun.equipment[].observableState and shipped to the mobile client, which
// just renders it. The mobile app never recomputes chemistry.
//
// Precedence when resolving a container's observable liquid colour (spec §10):
//   1. explicit reaction result (reaction.observableChanges)
//   2. indicator result  (an indicator is present -> map container pH -> indicator colour)
//   3. dominant dissolved chemical's own appearance
//   4. default colourless liquid (faint, still visible)
// Suspended solid + liquid together => precipitate / cloudiness, layered on top of the colour.

const { computeContainerPh } = require("./phService");
const { fallbackAppearance } = require("../data/chemicalAppearance");

const COLOURLESS = { color: "#DCEBF7", opacity: 0.32 };

// --- Indicator colour models -------------------------------------------------------------------
// Each model: given the container pH (or null), returns { color, opacity } or null ("no colour of
// its own here — fall through to the underlying solution"). Educational bands, deliberately
// distinguishable on a phone screen (spec §17) without being neon.
const band = (ph, bands, fallback) => {
  for (const [max, value] of bands) if (ph <= max) return value;
  return fallback;
};

const INDICATOR_MODELS = {
  // Universal indicator — full pH range.
  UI: {
    name: "universal indicator",
    resolve: (ph) => {
      if (ph == null) return { color: "#7CA644", opacity: 0.8 }; // neat, not yet reacted
      return band(
        ph,
        [
          [2.5, { color: "#E53935", opacity: 0.85 }], // strongly acidic — red
          [4.5, { color: "#FB8C00", opacity: 0.85 }], // acidic — orange
          [6.4, { color: "#F9D423", opacity: 0.85 }], // weakly acidic — yellow
          [7.6, { color: "#43A047", opacity: 0.82 }], // neutral — green
          [9.5, { color: "#1E88E5", opacity: 0.85 }], // basic — blue
          [11.5, { color: "#3949AB", opacity: 0.85 }], // strongly basic — indigo
        ],
        { color: "#6A1B9A", opacity: 0.88 } // very strongly basic — violet
      );
    },
    describe: (ph) => {
      if (ph == null) return "Universal indicator added.";
      if (ph <= 2.5) return "The universal indicator turned red — the solution is strongly acidic.";
      if (ph <= 4.5) return "The universal indicator turned orange — the solution is acidic.";
      if (ph <= 6.4) return "The universal indicator turned yellow — the solution is weakly acidic.";
      if (ph <= 7.6) return "The universal indicator stayed green — the solution is close to neutral.";
      if (ph <= 9.5) return "The universal indicator turned blue — the solution is basic.";
      if (ph <= 11.5) return "The universal indicator turned indigo — the solution is strongly basic.";
      return "The universal indicator turned violet — the solution is very strongly basic.";
    },
  },

  // Phenolphthalein — colourless in acid/neutral, pink above ~pH 8.2.
  Phph: {
    name: "phenolphthalein",
    resolve: (ph) => (ph != null && ph >= 8.2 ? { color: "#EC407A", opacity: 0.8 } : null),
    describe: (ph) =>
      ph != null && ph >= 8.2
        ? "The phenolphthalein turned pink — the solution is basic."
        : "The phenolphthalein stayed colourless — the solution is not basic.",
  },

  // Methyl orange — red < 3.1, orange transition, yellow > 4.4.
  MeOr: {
    name: "methyl orange",
    resolve: (ph) => {
      if (ph == null) return { color: "#F57C00", opacity: 0.8 };
      if (ph < 3.1) return { color: "#E53935", opacity: 0.85 };
      if (ph <= 4.4) return { color: "#FB8C00", opacity: 0.85 };
      return { color: "#F9D423", opacity: 0.85 };
    },
    describe: (ph) => {
      if (ph == null) return "Methyl orange added.";
      if (ph < 3.1) return "Methyl orange turned red — the solution is acidic.";
      if (ph <= 4.4) return "Methyl orange is orange — the solution is weakly acidic.";
      return "Methyl orange stayed yellow — the solution is neutral or basic.";
    },
  },

  // Litmus solution — red in acid, blue in base, purple near neutral.
  Litmus: {
    name: "litmus",
    resolve: (ph) => {
      if (ph == null) return { color: "#7E57C2", opacity: 0.8 };
      if (ph < 6) return { color: "#E53935", opacity: 0.85 };
      if (ph > 8) return { color: "#1E88E5", opacity: 0.85 };
      return { color: "#8E44AD", opacity: 0.82 };
    },
    describe: (ph) => {
      if (ph == null) return "Litmus added.";
      if (ph < 6) return "Litmus turned red — the solution is acidic.";
      if (ph > 8) return "Litmus turned blue — the solution is basic.";
      return "Litmus stayed purple — the solution is close to neutral.";
    },
  },
};

// --- reaction.observableChanges colour words -> hex ---------------------------------------------
const COLOR_WORDS = [
  ["colourless", null], ["colorless", null],
  ["pale blue", "#90CAF9"], ["light blue", "#90CAF9"], ["blue", "#1E88E5"],
  ["reddish-brown", "#A1552F"], ["reddish brown", "#A1552F"], ["brown", "#8D6E63"],
  ["pink", "#EC407A"], ["red", "#E53935"], ["orange", "#FB8C00"], ["yellow", "#F9D423"],
  ["green", "#43A047"], ["violet", "#7B1FA2"], ["purple", "#6A1B9A"],
  ["milky", "#E9EFF0"], ["cloudy", "#DEE7E9"], ["white", "#ECEFF1"],
  ["silver", "#C0C0C0"], ["grey", "#9E9E9E"], ["gray", "#9E9E9E"], ["black", "#37474F"],
  ["clear", null],
];
const wordToHex = (text) => {
  if (!text) return undefined;
  const t = String(text).toLowerCase();
  for (const [word, hex] of COLOR_WORDS) if (t.includes(word)) return hex; // may be null (colourless)
  return undefined; // unrecognised — caller falls through
};

// --- helpers ----------------------------------------------------------------------------------
const chemState = (chem) => chem && chem.state;
const isLiquid = (chem) => chemState(chem) === "liquid" || chemState(chem) === "aqueous";
const isSolid = (chem) => chemState(chem) === "solid";

const appearanceOf = (chem) => (chem && chem.appearance && chem.appearance.solutionColor ? chem.appearance : fallbackAppearance(chem || {}));

// The dissolved chemical that dominates the look of the mixture — highest volume liquid that
// isn't an indicator (indicators are handled separately) and isn't plain water when something
// else is dissolved.
const dominantLiquid = (contents, chemicalsById) => {
  const liquids = contents
    .map((c) => ({ c, chem: chemicalsById[c.chemical.toString()] }))
    .filter((x) => isLiquid(x.chem) && x.chem.category !== "indicator");
  if (liquids.length === 0) return null;
  const nonWater = liquids.filter((x) => x.chem.symbol !== "H2O");
  const pool = nonWater.length ? nonWater : liquids;
  pool.sort((a, b) => (b.c.volume || 0) - (a.c.volume || 0));
  return pool[0].chem;
};

/**
 * @param {Object} args
 * @param {Array}  args.contents       instance.contents ([{ chemical, volume, mass }])
 * @param {Object} args.chemicalsById  { <chemicalId>: chemicalDoc } for every id in contents
 * @param {Object} [args.reaction]     the reaction that just fired (serializeReactionMatch shape or raw doc), or null
 * @param {Object} [args.previous]     the instance's existing observableState (to preserve persistent bits)
 * @returns observableState object
 */
const computeObservableState = ({ contents = [], chemicalsById = {}, reaction = null, previous = null }) => {
  const state = {
    liquidColor: COLOURLESS.color,
    opacity: COLOURLESS.opacity,
    phase: "liquid",
    hasPrecipitate: false,
    precipitateColor: null,
    gasProduced: false,
    cloudiness: 0,
    temperatureChange: null,
    description: null,
    source: "default",
    lastChangedAt: previous?.lastChangedAt || null,
  };

  const resolved = contents.map((c) => ({ c, chem: chemicalsById[c.chemical?.toString()] })).filter((x) => x.chem);
  const liquids = resolved.filter((x) => isLiquid(x.chem));
  const solids = resolved.filter((x) => isSolid(x.chem));
  const indicators = resolved.filter((x) => x.chem.category === "indicator");

  if (resolved.length === 0) return state;

  // Only solids present -> render as the dominant solid.
  if (liquids.length === 0 && solids.length > 0) {
    const dom = solids.sort((a, b) => (b.c.mass || 0) - (a.c.mass || 0))[0].chem;
    const ap = appearanceOf(dom);
    return {
      ...state,
      liquidColor: ap.solutionColor,
      opacity: ap.opacity ?? 1,
      phase: ap.phase || "solid",
      source: "solid",
      description: null,
    };
  }

  // Container pH (indicators excluded from the average inside phService already).
  const ph = computeContainerPh({ contents }, chemicalsById);
  const phValue = ph.measurable ? ph.value : null;

  const rxnChanges = reaction?.observableChanges || reaction?.reaction?.observableChanges || null;
  // A reaction's outcome persists in the vessel after it fires (spec §12). If one fired earlier
  // and set the observable state, and no NEW reaction fired this pass, carry that outcome forward
  // as the baseline rather than re-deriving "there's a solid in here => cloudy" from the product
  // list (a soluble salt product like NaCl is dissolved, not a suspension).
  const carriedFromReaction = !rxnChanges && previous?.source === "reaction";
  let reactionSaysNoPrecipitate = false;
  let reactionSetColour = false;

  // 1a. a reaction fired THIS pass -> its explicit observable changes. `source` becomes "reaction"
  // regardless of whether it named a colour, so the outcome (esp. "no precipitate") carries
  // forward to later passes.
  if (rxnChanges) {
    state.source = "reaction";
    const toHex = wordToHex(rxnChanges.colorChange?.to);
    if (toHex === null) {
      state.liquidColor = COLOURLESS.color;
      state.opacity = COLOURLESS.opacity;
      reactionSetColour = true;
    } else if (toHex) {
      state.liquidColor = toHex;
      state.opacity = 0.85;
      reactionSetColour = true;
    }
    if (rxnChanges.precipitateFormed) {
      state.hasPrecipitate = true;
      state.precipitateColor = wordToHex(rxnChanges.precipitateColor) || "#ECEFF1";
      state.cloudiness = Math.max(state.cloudiness, 0.6);
    } else {
      reactionSaysNoPrecipitate = true;
    }
    if (rxnChanges.gasProduced) state.gasProduced = true;
    if (rxnChanges.energyChange === "exothermic" || rxnChanges.energyChange === "endothermic") {
      state.temperatureChange = rxnChanges.energyChange;
    } else if (rxnChanges.heatProduced) {
      state.temperatureChange = "exothermic";
    }
  } else if (carriedFromReaction) {
    // 1b. no new reaction, but an earlier one still defines what's in the vessel
    state.liquidColor = previous.liquidColor ?? state.liquidColor;
    state.opacity = previous.opacity ?? state.opacity;
    state.hasPrecipitate = !!previous.hasPrecipitate;
    state.precipitateColor = previous.precipitateColor ?? null;
    state.cloudiness = previous.cloudiness ?? 0;
    state.temperatureChange = previous.temperatureChange ?? null;
    state.source = "reaction";
    reactionSaysNoPrecipitate = !previous.hasPrecipitate;
    reactionSetColour = previous.liquidColor != null && previous.liquidColor !== COLOURLESS.color;
  }

  // 2. indicator present -> its dye colours the whole solution, so it always wins the liquid
  //    tint (precipitate / gas / temperature from step 1 are kept). Last-added indicator is active.
  if (indicators.length > 0) {
    const activeSym = indicators[indicators.length - 1].chem.symbol;
    const model = INDICATOR_MODELS[activeSym];
    if (model) {
      const look = model.resolve(phValue);
      if (look) {
        state.liquidColor = look.color;
        state.opacity = look.opacity;
        state.source = "indicator";
        state.description = model.describe(phValue);
      }
    }
  }

  // 3. dominant dissolved chemical's own appearance — when nothing above claimed the colour
  //    (no indicator, and either no reaction or a reaction that didn't name a colour).
  if (!indicators.length && (state.source === "default" || (state.source === "reaction" && !reactionSetColour))) {
    const dom = dominantLiquid(contents, chemicalsById);
    if (dom) {
      const ap = appearanceOf(dom);
      state.liquidColor = ap.solutionColor;
      state.opacity = ap.opacity ?? 0.6;
      state.phase = ap.phase || "solution";
      if (state.source === "default") state.source = "chemical";
    }
  }

  // Undissolved solid sitting in liquid (e.g. chalk in acid before it reacts) -> cloudiness.
  // Skipped when a reaction (this pass or an earlier carried-forward one) says no precipitate
  // forms — its soluble salt product is dissolved.
  if (liquids.length > 0 && solids.length > 0 && !reactionSaysNoPrecipitate) {
    const domSolid = solids.sort((a, b) => (b.c.mass || 0) - (a.c.mass || 0))[0].chem;
    state.hasPrecipitate = true;
    state.precipitateColor = state.precipitateColor || appearanceOf(domSolid).solutionColor || "#ECEFF1";
    state.cloudiness = Math.max(state.cloudiness, 0.5);
  }

  return state;
};

// True when two observable states differ in any player-visible field — controller uses this to
// stamp lastChangedAt only on a real change (drives the mobile colour-transition trigger).
const observableStateChanged = (a, b) => {
  if (!a || !b) return true;
  return (
    a.liquidColor !== b.liquidColor ||
    (a.opacity ?? null) !== (b.opacity ?? null) ||
    !!a.hasPrecipitate !== !!b.hasPrecipitate ||
    a.precipitateColor !== b.precipitateColor ||
    !!a.gasProduced !== !!b.gasProduced ||
    (a.cloudiness ?? 0) !== (b.cloudiness ?? 0) ||
    (a.temperatureChange ?? null) !== (b.temperatureChange ?? null)
  );
};

module.exports = { INDICATOR_MODELS, COLOURLESS, computeObservableState, observableStateChanged, wordToHex };
