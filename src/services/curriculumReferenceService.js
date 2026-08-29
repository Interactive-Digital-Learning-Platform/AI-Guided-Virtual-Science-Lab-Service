// Turns the textbook lesson/page pointers stored on Experiment.curriculumRefs /
// Experiment.steps[].curriculumRefs (see curriculumRefSchema in models/Experiment.js) into a
// client-ready "where to read" object for the hint ladder and the session report.
//
// These refs are precomputed by the sync job (npm run curriculum:sync — see scripts/curriculum/,
// which queries the Qdrant curriculum KB directly) from the ingested Sri Lankan curriculum, so
// this module is pure — no Qdrant/LLM calls at request time.

// Refs below this confidence are treated as "no usable match" and never shown to a student —
// the offline generator returns 0 when none of the retrieved textbook material was relevant
// (e.g. a Grade 11 practical before the Grade 11 textbook is ingested).
const MIN_CONFIDENCE = 0.35;

const formatPages = (pageStart, pageEnd) => {
  if (!pageStart) return null;
  if (!pageEnd || pageEnd === pageStart) return `page ${pageStart}`;
  return `pages ${pageStart}–${pageEnd}`;
};

/**
 * Formats one stored curriculumRef into the shape the mobile client renders.
 * Returns null if the ref has no usable page range.
 */
const formatCurriculumReference = (ref) => {
  if (!ref) return null;
  const pages = formatPages(ref.pageStart, ref.pageEnd);
  if (!pages || !ref.lessonTitle) return null;

  const book = ref.bookTitle || "curriculum textbook";
  const section = ref.sectionTitle ? ` (${ref.sectionTitle})` : "";

  return {
    bookTitle: ref.bookTitle || null,
    lessonTitle: ref.lessonTitle,
    sectionTitle: ref.sectionTitle || null,
    pageStart: ref.pageStart || null,
    pageEnd: ref.pageEnd || ref.pageStart || null,
    displayText: `To get an idea about this, read "${ref.lessonTitle}"${section} on ${pages} of the ${book}.`,
  };
};

/**
 * Picks the single best curriculumRef for a step, preferring the step's own refs over the
 * experiment-level fallback, then highest confidence. Returns the raw ref (or null), not the
 * formatted object — callers format with formatCurriculumReference.
 */
const pickBestRef = (stepRefs, experimentRefs) => {
  const pool = (stepRefs && stepRefs.length ? stepRefs : experimentRefs) || [];
  const usable = pool
    .filter((r) => (r.confidence ?? 0) >= MIN_CONFIDENCE)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return usable[0] || null;
};

/**
 * Convenience for the hint path: pick + format in one call.
 */
const curriculumReferenceForStep = (step, experiment) => {
  const best = pickBestRef(step && step.curriculumRefs, experiment && experiment.curriculumRefs);
  return formatCurriculumReference(best);
};

/**
 * The whole practical's curriculum placement — "this practical belongs to lesson X, pages A–B" —
 * for the session report. Uses the experiment-level curriculumRefs only (not step refs), and is
 * shown regardless of how the student performed. Returns null when there's no confident match.
 */
const practicalCurriculumReference = (experiment) => {
  const best = pickBestRef(null, experiment && experiment.curriculumRefs);
  if (!best) return null;
  const pages = formatPages(best.pageStart, best.pageEnd);
  if (!pages || !best.lessonTitle) return null;

  const book = best.bookTitle || "curriculum textbook";
  const section = best.sectionTitle ? ` — ${best.sectionTitle}` : "";
  return {
    bookTitle: best.bookTitle || null,
    lessonTitle: best.lessonTitle,
    sectionTitle: best.sectionTitle || null,
    pageStart: best.pageStart || null,
    pageEnd: best.pageEnd || best.pageStart || null,
    displayText: `This practical is covered by "${best.lessonTitle}"${section}, ${pages} of the ${book}.`,
  };
};

/**
 * Builds the session report's "follow-up reading" list from the steps the student struggled on
 * (session.behaviorFeatures.struggledSteps) — extra, step-specific reading on top of the
 * whole-practical placement (practicalCurriculumReference). Dedupes by book + page range, and
 * skips any entry that just repeats the practical-level reference.
 */
const buildFollowUpReading = (experiment, struggledStepIds) => {
  const struggled = new Set(struggledStepIds || []);
  const practicalRef = pickBestRef(null, experiment && experiment.curriculumRefs);
  const practicalKey = practicalRef
    ? `${practicalRef.bookFilename || practicalRef.bookTitle}:${practicalRef.pageStart}-${practicalRef.pageEnd}`
    : null;
  const seen = new Set(practicalKey ? [practicalKey] : []);
  const out = [];

  for (const step of experiment.steps || []) {
    if (!struggled.has(step.stepId)) continue;
    // Only the step's OWN refs here — an experiment-level fallback would just duplicate the
    // practical reference the report already shows.
    const best = pickBestRef(step.curriculumRefs, null);
    if (!best) continue;
    const key = `${best.bookFilename || best.bookTitle}:${best.pageStart}-${best.pageEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      stepId: step.stepId,
      stepTitle: step.title,
      bookTitle: best.bookTitle || null,
      lessonTitle: best.lessonTitle,
      sectionTitle: best.sectionTitle || null,
      pageStart: best.pageStart || null,
      pageEnd: best.pageEnd || best.pageStart || null,
    });
  }

  return out;
};

module.exports = {
  MIN_CONFIDENCE,
  formatCurriculumReference,
  pickBestRef,
  curriculumReferenceForStep,
  practicalCurriculumReference,
  buildFollowUpReading,
};
