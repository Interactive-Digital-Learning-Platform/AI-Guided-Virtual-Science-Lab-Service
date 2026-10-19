// Turns a Current Task's HIDDEN requirements + the LIVE LabRun bench into a concrete, student-
// facing action instruction — used ONLY by requestHelp (after the 3-level hint ladder is
// exhausted and Help is server-gated). This never runs before Help; earlier hints are untouched.
//
// Experiment-INDEPENDENT: it reasons from the micro-step's expectedIntent / expectedEquipment /
// expectedChemicalsForStep / expectedTransfer and the bench's actual equipment instances +
// contents. No experiment title/id branching.
const { equipmentTypesWithCapability } = require("../data/equipmentCapabilities");

const CONTAINER_TYPES = [
  "test_tube",
  "beaker",
  "flask",
  "conical_flask",
  "boiling_tube",
  "measuring_cylinder",
  "watch_glass",
  "evaporating_dish",
  "petri_dish",
];
const isContainerType = (t) => CONTAINER_TYPES.includes(t);

const titleCase = (s) =>
  String(s || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

// Equipment type → student-facing label. `cap` gives the Title Case form for names ("Test Tube A"),
// otherwise the mid-sentence form ("use the pH meter"). A few types read badly under plain casing.
const LABEL_CAP = { ph_meter: "pH Meter" };
const LABEL_LOWER = { ph_meter: "pH meter" };
const equipLabel = (type, cap = true) =>
  cap ? LABEL_CAP[type] || titleCase(type) : LABEL_LOWER[type] || titleCase(type).toLowerCase();

const listAnd = (arr) => {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a[0] || "";
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
};

const HUMAN_METRIC = {
  g: "acceleration due to gravity",
  spring_constant: "spring constant",
  density: "density",
  period: "period",
  resistance: "resistance",
  current: "current",
  voltage: "voltage",
};

// Friendly label per LabRun instance: "Test Tube", or "Test Tube A" / "Test Tube B" when more
// than one of that type is on the bench. Registration order in labRun.equipment fixes A/B/C.
// Raw instanceIds are never surfaced.
const friendlyLabels = (labRun) => {
  const byType = {};
  (labRun?.equipment || []).forEach((e) => {
    (byType[e.equipmentType] = byType[e.equipmentType] || []).push(e.instanceId);
  });
  const labels = {};
  Object.entries(byType).forEach(([type, ids]) => {
    ids.forEach((id, i) => {
      labels[id] = ids.length > 1 ? `${titleCase(type)} ${String.fromCharCode(65 + i)}` : titleCase(type);
    });
  });
  return labels;
};

// Which container instance does this task target? Resolved from live bench state, never authored.
//  - no container in the expected equipment → null (task isn't about a container)
//  - the expected container type isn't on the bench → { missing, type }
//  - exactly one → that one
//  - several of the same type → the one already holding a DIFFERENT chemical (the prepared sample
//    this task adds to), else any non-empty one, else the first.
const resolveTargetContainer = ({ expectedEquipment, expectedChemicalIds, labRun }) => {
  const wantedTypes = (expectedEquipment || []).filter(isContainerType);
  if (wantedTypes.length === 0) return null;
  const adding = new Set((expectedChemicalIds || []).map(String));
  const candidates = (labRun?.equipment || []).filter((e) => wantedTypes.includes(e.equipmentType));
  if (candidates.length === 0) return { missing: true, type: wantedTypes[0] };
  if (candidates.length === 1) return { instance: candidates[0] };
  const holdingOther = candidates.filter(
    (e) => (e.contents || []).length > 0 && !(e.contents || []).every((c) => adding.has(String(c.chemical)))
  );
  if (holdingOther.length >= 1) return { instance: holdingOther[0] };
  const nonEmpty = candidates.filter((e) => (e.contents || []).length > 0);
  return { instance: nonEmpty[0] || candidates[0] };
};

// Contents of an instance as friendly names, minus whatever this task is adding right now.
const otherContentNames = (instance, addingIds, nameOf) => {
  const adding = new Set((addingIds || []).map(String));
  return [
    ...new Set(
      (instance?.contents || [])
        .map((c) => String(c.chemical))
        .filter((id) => !adding.has(id))
        .map((id) => nameOf(id))
        .filter(Boolean)
    ),
  ];
};

/**
 * @returns {{ actionInstruction: string|null, actionSteps: string[] }}
 *   actionInstruction — one clear sentence ("Use the dropper to add sodium hydroxide to Test Tube A,
 *     which already contains hydrochloric acid.")
 *   actionSteps — an ordered short sequence for multi-action tasks (fill → move → dispense); [] otherwise.
 * Falls back to the authored exactAnswer when it can't synthesise anything more specific.
 */
const buildHelpAction = ({ target, step, experiment, labRun, chemicalDocs }) => {
  const nameById = {};
  (chemicalDocs || []).forEach((c) => {
    nameById[String(c._id)] = c.name;
  });
  const nameOf = (id) => nameById[String(id)] || null;

  const microStep = target.usingMicroSteps ? target.microStep : null;
  const intent = microStep?.expectedIntent || null;
  const expectedEquipment = target.equipment || [];
  const expectedChemicalIds = target.chemicals || [];
  const primaryChem = expectedChemicalIds[0] ? nameOf(expectedChemicalIds[0]) : null;
  const labels = friendlyLabels(labRun);

  const et = target.expectedTransfer || microStep?.expectedTransfer || null;
  const transferInstrument =
    et && (et.method || et.instrumentCategory)
      ? et.instrumentCategory || equipmentTypesWithCapability(et.method)[0] || "dropper"
      : null;

  const reqChem = (experiment?.requiredChemicals || []).find((r) =>
    expectedChemicalIds.some((id) => String(id) === String(r.chemical))
  );
  const qty = reqChem && reqChem.quantity ? `${reqChem.quantity} ${reqChem.unit || "mL"}` : null;
  const qtyPrefix = qty ? `${qty} of ` : "";

  const isSelectIntent = ["SELECT_CONTAINER", "SELECT_EQUIPMENT", "SELECT_TRANSFER_EQUIPMENT"].includes(intent);
  const tc = resolveTargetContainer({ expectedEquipment, expectedChemicalIds, labRun });

  // Target container isn't on the bench — Help says how to prepare it (revealed only here). Not
  // for SELECT_* tasks, which are about placing equipment, not filling a container.
  if (tc && tc.missing && !isSelectIntent) {
    const contLabel = titleCase(tc.type);
    return {
      actionInstruction: primaryChem
        ? `Place a ${contLabel} on the bench, then add ${qtyPrefix}${primaryChem} to it.`
        : `Place a ${contLabel} on the bench and prepare your sample in it.`,
      actionSteps: [],
    };
  }

  // A container the task points at explicitly (via expectedEquipment), or — for a measure/record
  // task that names no container type — the single prepared (non-empty) container on the bench.
  let container = tc && tc.instance ? tc.instance : null;
  if (!container && ["MEASURE_RESULT", "RECORD_RESULT"].includes(intent)) {
    const nonEmpty = (labRun?.equipment || []).filter(
      (e) => isContainerType(e.equipmentType) && (e.contents || []).length > 0
    );
    if (nonEmpty.length === 1) container = nonEmpty[0];
  }
  const containerLabel = container ? labels[container.instanceId] || titleCase(container.equipmentType) : null;
  const holds = container ? otherContentNames(container, expectedChemicalIds, nameOf) : [];
  const containerClause = containerLabel
    ? holds.length
      ? `${containerLabel}, which already contains ${listAnd(holds)}`
      : containerLabel
    : null;

  const steps = [];
  let instruction = null;
  // A measured-volume transfer (pipette / burette) delivers its whole charge; a small-quantity
  // one (dropper) releases drops.
  const measuredTransfer = !!qty || (et && et.method === "accurate_volume_transfer") || (et && et.method === "controlled_volume_delivery");

  switch (intent) {
    case "SELECT_CONTAINER":
    case "SELECT_EQUIPMENT":
    case "SELECT_TRANSFER_EQUIPMENT": {
      const items = expectedEquipment.map((t) => equipLabel(t, true));
      if (items.length) instruction = `Drag ${listAnd(items)} onto the bench.`;
      break;
    }
    case "PREPARE_SAMPLE": {
      if (primaryChem && containerLabel) instruction = `Put ${qtyPrefix}${primaryChem} into ${containerLabel}.`;
      else if (primaryChem) instruction = `Prepare a sample of ${primaryChem} in a suitable container.`;
      break;
    }
    case "ADD_REAGENT":
    case "TRANSFER_LIQUID": {
      if (transferInstrument && primaryChem) {
        const instr = equipLabel(transferInstrument, false);
        const targetPhrase = containerClause || "the correct container";
        if (measuredTransfer) {
          steps.push(`Draw ${qtyPrefix || "the required amount of "}${primaryChem} up into the ${instr}.`);
          steps.push(`Move the ${instr} over ${targetPhrase}.`);
          steps.push(`Release it into ${containerLabel ? "that " + (container ? equipLabel(container.equipmentType, false) : "container") : "the container"}.`);
          instruction = `Use the ${instr} to transfer ${qtyPrefix}${primaryChem} into ${targetPhrase}.`;
        } else {
          steps.push(`Fill the ${instr} with ${primaryChem}.`);
          steps.push(`Move the ${instr} over ${targetPhrase}.`);
          steps.push(`Release ${et && et.minDispenses > 1 ? `${et.minDispenses} drops` : "a drop or two"} of ${primaryChem} into it.`);
          instruction = `Use the ${instr} to add ${primaryChem} to ${targetPhrase}.`;
        }
      } else if (primaryChem) {
        instruction = containerClause
          ? `Add ${qtyPrefix}${primaryChem} to ${containerClause}.`
          : `Add ${primaryChem} to the correct container.`;
      }
      break;
    }
    case "MIX_SUBSTANCES": {
      const names = expectedChemicalIds.map(nameOf).filter(Boolean);
      if (names.length >= 2 && containerLabel) {
        instruction = `Combine ${listAnd(names)} in ${containerLabel} and let the reaction happen.`;
      } else if (names.length && containerClause) {
        instruction = `Add ${listAnd(names)} to ${containerClause} and let the reaction happen.`;
      } else if (containerClause) {
        instruction = `Combine the substances in ${containerClause} and let the reaction happen.`;
      }
      break;
    }
    case "HEAT_SAMPLE": {
      instruction = containerClause ? `Heat ${containerClause}.` : "Heat the prepared sample.";
      break;
    }
    case "MEASURE_RESULT":
    case "RECORD_RESULT": {
      if (target.requiresMeasurementCheck && target.expectedMeasurement && target.expectedMeasurement.metric) {
        const m = HUMAN_METRIC[target.expectedMeasurement.metric] || target.expectedMeasurement.metric;
        instruction = `Work out the ${m} from your measurements and enter your value.`;
      } else if (expectedEquipment.includes("ph_meter")) {
        instruction = `Use the pH meter on ${containerClause || "your prepared sample"}, then record the reading.`;
      } else if (expectedEquipment.length) {
        instruction = `Use the ${listAnd(expectedEquipment.map((t) => equipLabel(t, false)))} to take the reading${
          containerClause ? ` from ${containerClause}` : ""
        }, then record it.`;
      }
      break;
    }
    default:
      break;
  }

  if (!instruction && steps.length === 0) {
    instruction = (microStep && microStep.exactAnswer) || step.exactAnswer || step.observationGoal || null;
  }

  return { actionInstruction: instruction || null, actionSteps: steps };
};

module.exports = { buildHelpAction };
