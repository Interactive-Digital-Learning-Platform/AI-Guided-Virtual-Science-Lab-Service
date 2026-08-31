// config/featureFlags.js — flag gating + stable per-user RCT arm assignment.
const test = require("node:test");
const assert = require("node:assert/strict");
const flags = require("../../src/config/featureFlags");

const withEnv = (env, fn) => {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

test("isStudentModelEnabled — only 'true'/'1' enable it", () => {
  withEnv({ STUDENT_MODEL_ENABLED: undefined }, () => assert.equal(flags.isStudentModelEnabled(), false));
  withEnv({ STUDENT_MODEL_ENABLED: "false" }, () => assert.equal(flags.isStudentModelEnabled(), false));
  withEnv({ STUDENT_MODEL_ENABLED: "true" }, () => assert.equal(flags.isStudentModelEnabled(), true));
  withEnv({ STUDENT_MODEL_ENABLED: "1" }, () => assert.equal(flags.isStudentModelEnabled(), true));
});

test("experimentArmForUser — 'off' when disabled, stable per user when enabled", () => {
  withEnv({ STUDENT_MODEL_ENABLED: undefined }, () => {
    assert.equal(flags.experimentArmForUser("user-abc"), "off");
  });
  withEnv({ STUDENT_MODEL_ENABLED: "true" }, () => {
    const a = flags.experimentArmForUser("user-abc");
    assert.ok(["treatment", "control"].includes(a));
    assert.equal(flags.experimentArmForUser("user-abc"), a, "same user -> same arm across calls");
  });
});

test("experimentArmForUser — STUDENT_MODEL_FORCE_ARM overrides the split (dev only)", () => {
  withEnv({ STUDENT_MODEL_ENABLED: "true", STUDENT_MODEL_FORCE_ARM: "treatment" }, () => {
    assert.equal(flags.experimentArmForUser("user-abc"), "treatment");
    assert.equal(flags.experimentArmForUser("user-xyz"), "treatment");
  });
  withEnv({ STUDENT_MODEL_ENABLED: "true", STUDENT_MODEL_FORCE_ARM: "control" }, () => {
    assert.equal(flags.experimentArmForUser("user-abc"), "control");
  });
  withEnv({ STUDENT_MODEL_ENABLED: undefined, STUDENT_MODEL_FORCE_ARM: "treatment" }, () => {
    assert.equal(flags.experimentArmForUser("user-abc"), "off", "force does nothing when the feature is off");
  });
  withEnv({ STUDENT_MODEL_ENABLED: "true", STUDENT_MODEL_FORCE_ARM: "nonsense" }, () => {
    assert.ok(["treatment", "control"].includes(flags.experimentArmForUser("user-abc")), "invalid value ignored");
  });
});

test("experimentArmForUser — the split is roughly balanced across many users", () => {
  withEnv({ STUDENT_MODEL_ENABLED: "true" }, () => {
    let treatment = 0;
    const N = 400;
    for (let i = 0; i < N; i += 1) if (flags.experimentArmForUser(`u${i}`) === "treatment") treatment += 1;
    assert.ok(treatment > N * 0.35 && treatment < N * 0.65, `treatment share ${treatment}/${N}`);
  });
});

test("studentModelDrivesHints / DrivesDiagnosis — need feature on + drive flag + treatment arm", () => {
  const treatment = { experimentArm: "treatment" };
  const control = { experimentArm: "control" };

  withEnv({ STUDENT_MODEL_ENABLED: "true", STUDENT_MODEL_DRIVES_HINTS: "true" }, () => {
    assert.equal(flags.studentModelDrivesHints(treatment), true);
    assert.equal(flags.studentModelDrivesHints(control), false, "control arm never driven");
  });
  withEnv({ STUDENT_MODEL_ENABLED: "true", STUDENT_MODEL_DRIVES_HINTS: undefined }, () => {
    assert.equal(flags.studentModelDrivesHints(treatment), false, "drive flag off -> shadow");
  });
  withEnv({ STUDENT_MODEL_ENABLED: undefined, STUDENT_MODEL_DRIVES_HINTS: "true" }, () => {
    assert.equal(flags.studentModelDrivesHints(treatment), false, "feature master-off");
  });
  withEnv({ STUDENT_MODEL_ENABLED: "true", STUDENT_MODEL_DRIVES_DIAGNOSIS: "true" }, () => {
    assert.equal(flags.studentModelDrivesDiagnosis(treatment), true);
    assert.equal(flags.studentModelDrivesDiagnosis(control), false);
  });
});
