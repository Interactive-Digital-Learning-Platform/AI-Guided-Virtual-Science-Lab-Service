// Regression guard for services/curriculumReferenceService.js — turns stored textbook refs into
// the "where to read" strings the hint ladder (level >= 2) and the report show. Pure module.
const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("../../src/services/curriculumReferenceService");

const ref = (over = {}) => ({
  bookTitle: "Grade 10 Science Textbook",
  bookFilename: "grade-10-science-text-book-v1.pdf",
  grade: 10,
  lessonTitle: "Acids, Bases and Salts",
  sectionTitle: "",
  pageStart: 80,
  pageEnd: 88,
  confidence: 0.7,
  ...over,
});

test("formatCurriculumReference — builds the display string", () => {
  const out = c.formatCurriculumReference(ref());
  assert.equal(out.lessonTitle, "Acids, Bases and Salts");
  assert.equal(out.pageStart, 80);
  assert.equal(out.pageEnd, 88);
  assert.equal(out.displayText, 'To get an idea about this, read "Acids, Bases and Salts" on pages 80–88 of the Grade 10 Science Textbook.');
});

test("formatCurriculumReference — single page, and null when unusable", () => {
  assert.match(c.formatCurriculumReference(ref({ pageStart: 84, pageEnd: 84 })).displayText, /on page 84 of/);
  assert.equal(c.formatCurriculumReference(ref({ pageStart: null, pageEnd: null })), null);
  assert.equal(c.formatCurriculumReference(ref({ lessonTitle: "" })), null);
  assert.equal(c.formatCurriculumReference(null), null);
});

test("pickBestRef — step refs preferred, then highest confidence, then MIN_CONFIDENCE gate", () => {
  const stepRefs = [ref({ lessonTitle: "Step Ref", confidence: 0.5 })];
  const expRefs = [ref({ lessonTitle: "Exp Ref", confidence: 0.9 })];
  assert.equal(c.pickBestRef(stepRefs, expRefs).lessonTitle, "Step Ref");
  assert.equal(c.pickBestRef(null, expRefs).lessonTitle, "Exp Ref");
  assert.equal(
    c.pickBestRef(null, [ref({ confidence: 0.9, lessonTitle: "Hi" }), ref({ confidence: 0.4, lessonTitle: "Lo" })]).lessonTitle,
    "Hi"
  );
  assert.equal(c.pickBestRef(null, [ref({ confidence: 0.2 })]), null, "below MIN_CONFIDENCE 0.35");
  assert.equal(c.MIN_CONFIDENCE, 0.35);
});

test("practicalCurriculumReference — experiment-level only, report phrasing", () => {
  const experiment = { curriculumRefs: [ref()] };
  const out = c.practicalCurriculumReference(experiment);
  assert.match(out.displayText, /^This practical is covered by "Acids, Bases and Salts", pages 80–88 of the Grade 10 Science Textbook\.$/);
  assert.equal(c.practicalCurriculumReference({ curriculumRefs: [] }), null);
  assert.equal(c.practicalCurriculumReference({}), null);
});

test("curriculumReferenceForStep — pick + format in one call", () => {
  const step = { curriculumRefs: [ref({ lessonTitle: "Neutralisation", confidence: 0.8 })] };
  const experiment = { curriculumRefs: [ref({ lessonTitle: "General", confidence: 0.9 })] };
  assert.equal(c.curriculumReferenceForStep(step, experiment).lessonTitle, "Neutralisation");
  assert.equal(c.curriculumReferenceForStep({ curriculumRefs: [] }, { curriculumRefs: [] }), null);
});

test("buildFollowUpReading — struggled steps only, deduped against the practical ref", () => {
  const experiment = {
    curriculumRefs: [ref({ pageStart: 80, pageEnd: 88 })],
    steps: [
      { stepId: 1, title: "S1", curriculumRefs: [ref({ pageStart: 80, pageEnd: 88 })] }, // dupes practical -> skipped
      { stepId: 2, title: "S2", curriculumRefs: [ref({ lessonTitle: "Indicators", pageStart: 90, pageEnd: 92, confidence: 0.7 })] },
      { stepId: 3, title: "S3", curriculumRefs: [ref({ pageStart: 100, pageEnd: 104 })] }, // not struggled -> skipped
    ],
  };
  const out = c.buildFollowUpReading(experiment, [1, 2]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    stepId: 2,
    stepTitle: "S2",
    bookTitle: "Grade 10 Science Textbook",
    lessonTitle: "Indicators",
    sectionTitle: null,
    pageStart: 90,
    pageEnd: 92,
  });
});
