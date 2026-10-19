// Capability tags per equipment type — experiment-INDEPENDENT. A micro-step declares a required
// capability (e.g. expectedTransfer.method = "small_quantity_transfer"); the grading engine then
// accepts ANY instrument that carries that capability, so the curriculum author doesn't have to
// name a specific equipment type unless the science genuinely requires one (in which case they set
// expectedTransfer.instrumentCategory instead). Adding a new instrument = one entry here (+ one in
// liquidTransferService.TRANSFER_INSTRUMENTS for the mechanical spec if it's a transfer tool).
//
// This is the single source of truth for "what can this piece of equipment do" — never branch on
// experiment title/id anywhere; branch on capability.
const EQUIPMENT_CAPABILITIES = {
  // liquid transfer
  dropper: ["small_quantity_transfer"],
  pipette: ["accurate_volume_transfer", "measured_transfer"],
  burette: ["controlled_volume_delivery", "measured_transfer"],
  // bulk handling
  beaker: ["bulk_transfer", "mixing_vessel"],
  flask: ["bulk_transfer", "mixing_vessel"],
  test_tube: ["bulk_transfer", "small_scale_vessel"],
  // measurement
  measuring_cylinder: ["volume_measurement"],
  ph_meter: ["ph_measurement"],
  thermometer: ["temperature_measurement"],
  balance: ["mass_measurement"],
  // process
  burner: ["heating"],
  stirrer: ["mixing"],
};

const capabilitiesOf = (equipmentType) => EQUIPMENT_CAPABILITIES[equipmentType] || [];
const hasCapability = (equipmentType, capability) => capabilitiesOf(equipmentType).includes(capability);
const equipmentTypesWithCapability = (capability) =>
  Object.keys(EQUIPMENT_CAPABILITIES).filter((t) => EQUIPMENT_CAPABILITIES[t].includes(capability));

// Capabilities that make an instrument a "liquid-transfer instrument" (fill → move → dispense).
const TRANSFER_CAPABILITIES = ["small_quantity_transfer", "accurate_volume_transfer", "controlled_volume_delivery"];
const isTransferCapable = (equipmentType) => capabilitiesOf(equipmentType).some((c) => TRANSFER_CAPABILITIES.includes(c));

module.exports = {
  EQUIPMENT_CAPABILITIES,
  capabilitiesOf,
  hasCapability,
  equipmentTypesWithCapability,
  TRANSFER_CAPABILITIES,
  isTransferCapable,
};
