// Deterministic mechanics formulas for the Grade 10-11 physics practicals — same "curated,
// deterministic state, not an LLM" principle as reactionEngine.js/phService.js. Every function
// returns { measurable, value, unit, reason } so callers (labRun.controller.js) can follow the
// same `if (result.measurable) {...}` pattern already established for pH.
const GRAVITY_REFERENCE = 9.8; // m/s^2, textbook reference value for tolerance checks

// T = 2π√(L/g)  =>  g = 4π²L / T²
// Measuring multiple oscillations and dividing (rather than timing a single swing) is the
// standard technique — timing a single oscillation is itself a common misconception (PHY_011).
const computePendulumPeriod = ({ length_cm, oscillationCount, elapsedSeconds }) => {
  if (!length_cm || length_cm <= 0) return { measurable: false, value: null, unit: null, reason: "missing_length" };
  if (!oscillationCount || oscillationCount < 1)
    return { measurable: false, value: null, unit: null, reason: "no_oscillations_counted" };
  if (!elapsedSeconds || elapsedSeconds <= 0)
    return { measurable: false, value: null, unit: null, reason: "no_time_recorded" };

  const lengthMeters = length_cm / 100;
  const period = elapsedSeconds / oscillationCount;
  const impliedG = (4 * Math.PI * Math.PI * lengthMeters) / (period * period);

  return {
    measurable: true,
    value: Math.round(impliedG * 100) / 100,
    unit: "m/s^2",
    reason: null,
    period: Math.round(period * 100) / 100,
  };
};

// k = F / x, with F = mg and x = extension in meters.
const computeSpringConstant = ({ naturalLength_cm, extendedLength_cm, mass_g }) => {
  if (naturalLength_cm == null || extendedLength_cm == null)
    return { measurable: false, value: null, unit: null, reason: "missing_length_reading" };
  const extensionCm = extendedLength_cm - naturalLength_cm;
  if (extensionCm <= 0) return { measurable: false, value: null, unit: null, reason: "no_extension" };
  if (!mass_g || mass_g <= 0) return { measurable: false, value: null, unit: null, reason: "missing_mass" };

  const forceNewtons = (mass_g / 1000) * GRAVITY_REFERENCE;
  const extensionMeters = extensionCm / 100;
  const springConstant = forceNewtons / extensionMeters;

  return { measurable: true, value: Math.round(springConstant * 100) / 100, unit: "N/m", reason: null };
};

// ρ = m / V, with V = final displaced volume - initial volume.
const computeDensity = ({ mass_g, initialVolume_ml, finalVolume_ml }) => {
  if (!mass_g || mass_g <= 0) return { measurable: false, value: null, unit: null, reason: "missing_mass" };
  if (initialVolume_ml == null || finalVolume_ml == null)
    return { measurable: false, value: null, unit: null, reason: "missing_volume_reading" };
  const displacedVolume = finalVolume_ml - initialVolume_ml;
  if (displacedVolume <= 0) return { measurable: false, value: null, unit: null, reason: "no_displacement" };

  const density = mass_g / displacedVolume;
  return { measurable: true, value: Math.round(density * 100) / 100, unit: "g/mL", reason: null };
};

// Generic tolerance-band correctness check shared across mechanics/circuit measurement microSteps
// (e.g. "does your calculated g match 9.8 within 10%", "does your recorded ammeter reading match
// the circuit's actual current within 5%").
const checkMeasurementTolerance = ({ expectedValue, studentValue, tolerancePct = 10 }) => {
  if (expectedValue == null || studentValue == null) return { correct: false, reason: "missing_value" };
  const tolerance = Math.abs(expectedValue) * (tolerancePct / 100);
  const correct = Math.abs(studentValue - expectedValue) <= tolerance;
  return { correct, reason: correct ? null : "outside_tolerance" };
};

// Resolves "what the bench actually says the answer is" for a given metric, from whatever
// physics instances are currently on the bench — the counterpart to reactionEngine's bench-driven
// grading for chemistry. Called from session.controller.js's logAction when a microStep's
// expectedMeasurement.metric needs checking against the student's submitted value.
const resolvePhysicsMeasurement = ({ metric, physicsEquipment = [] }) => {
  switch (metric) {
    case "g": {
      const stopwatch = physicsEquipment.find(
        (e) => e.equipmentType === "stopwatch" && e.lastMeasurement?.measurementType === "g"
      );
      if (!stopwatch) return { measurable: false, value: null, unit: null, reason: "no_timed_trial_recorded" };
      return { measurable: true, value: stopwatch.lastMeasurement.value, unit: "m/s^2", reason: null };
    }
    case "spring_constant": {
      const spring = physicsEquipment.find(
        (e) => e.equipmentType === "spring" && e.lastMeasurement?.measurementType === "spring_constant"
      );
      if (!spring) return { measurable: false, value: null, unit: null, reason: "no_extension_recorded" };
      return { measurable: true, value: spring.lastMeasurement.value, unit: "N/m", reason: null };
    }
    case "density": {
      const balance = physicsEquipment.find((e) => e.equipmentType === "balance" && e.attachedMass?.value != null);
      const cylinder = physicsEquipment.find(
        (e) =>
          e.equipmentType === "measuring_cylinder" &&
          e.measuredVolumeDisplacement?.initial != null &&
          e.measuredVolumeDisplacement?.final != null
      );
      if (!balance || !cylinder) return { measurable: false, value: null, unit: null, reason: "missing_readings" };
      return computeDensity({
        mass_g: balance.attachedMass.value,
        initialVolume_ml: cylinder.measuredVolumeDisplacement.initial,
        finalVolume_ml: cylinder.measuredVolumeDisplacement.final,
      });
    }
    default:
      return { measurable: false, value: null, unit: null, reason: "unsupported_metric" };
  }
};

module.exports = {
  computePendulumPeriod,
  computeSpringConstant,
  computeDensity,
  checkMeasurementTolerance,
  resolvePhysicsMeasurement,
};
