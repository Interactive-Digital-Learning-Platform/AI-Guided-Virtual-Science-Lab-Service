// Turns the validity-pilot statistics into a fix / keep decision table, using the review rules in
// dev-docs/concept-inventory-acid-base.md §8. Pure — unit-tested.
//
// These flags GUIDE a human review; with n = 10–15 they are noisy and never justify deleting an item on
// their own (a teacher/curriculum judgement always wins over a statistic).

const THRESHOLDS = {
  minDifficulty: 0.2, // proportion fully correct; below → too hard
  maxDifficulty: 0.9, // above → too easy
  minDiscrimination: 0.2, // item-rest correlation
  maxOmissionRate: 0.1, // blank / half-answered
  minPrevalence: 0.25, // per misconception code: share of students flagged, else the study can't say much
  minAlpha: 0.6,
  timingTarget: 0.9, // share finishing within the time cap
  timingCapMinutes: 25,
};

/**
 * @param items  [{ item, code|null, n, answered, correct, flagged, discrimination|null }]
 *               n = participants, answered = fully answered, correct = both tiers correct,
 *               flagged = chose the pattern that flags the item's misconception
 * @returns [{ item, code, difficulty, discrimination, omissionRate, verdict: "KEEP"|"REVIEW", reasons[] }]
 */
function reviewItems(items, t = THRESHOLDS) {
  return items.map((it) => {
    const difficulty = it.n ? it.correct / it.n : null;
    const omissionRate = it.n ? (it.n - it.answered) / it.n : null;
    const reasons = [];
    if (difficulty != null && difficulty < t.minDifficulty) reasons.push(`too hard (${(difficulty * 100).toFixed(0)}% correct)`);
    if (difficulty != null && difficulty > t.maxDifficulty) reasons.push(`too easy (${(difficulty * 100).toFixed(0)}% correct)`);
    if (it.discrimination == null) reasons.push("no variance — cannot judge discrimination");
    else if (it.discrimination < t.minDiscrimination) reasons.push(`weak discrimination (${it.discrimination.toFixed(2)})`);
    if (omissionRate != null && omissionRate > t.maxOmissionRate) reasons.push(`omitted by ${(omissionRate * 100).toFixed(0)}%`);
    return {
      item: it.item,
      code: it.code,
      difficulty,
      discrimination: it.discrimination,
      omissionRate,
      verdict: reasons.length ? "REVIEW" : "KEEP",
      reasons,
    };
  });
}

/** Per misconception code: is the pilot able to say anything about it? */
function prevalenceReview(perCode, t = THRESHOLDS) {
  return Object.entries(perCode).map(([code, { flagged, n }]) => {
    const rate = n ? flagged / n : null;
    return {
      code,
      flagged,
      n,
      rate,
      verdict: rate == null || rate < t.minPrevalence ? "LOW" : "OK",
      note:
        rate == null || rate < t.minPrevalence
          ? "flagged in too few students — the study may not be able to say anything about this code (strengthen its items, elicit it in the practical, or drop it)"
          : "",
    };
  });
}

module.exports = { THRESHOLDS, reviewItems, prevalenceReview };
