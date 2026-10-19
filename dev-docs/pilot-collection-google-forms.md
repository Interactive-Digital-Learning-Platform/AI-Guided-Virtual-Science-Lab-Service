# Pilot Collection via Google Forms — build guide + exact content

> I can't create a live Google Form directly (no Google account/API access from here) — this is
> the complete content to paste in, plus a script that turns the exported Google Sheet straight
> into the format `score-inventory.js` already expects. Building the two forms from this should
> take about 10–15 minutes each.
>
> **Reminder before you send anything out:** consent and ethics are still open gates (see
> `model-training-checklist-sep21-oct04.md` Phase 1 — `pilot-consent-pack-draft.md` hasn't been
> reviewed by your supervisor yet). Nothing below changes that; it's the collection *instrument*,
> not permission to collect. Decide with your supervisor whether to run this now or wait.

## Why two forms, not one

The practical happens in the app, between the pre-test and the post-test — a single Google Form
can't pause for that. Build **two separate forms**:

1. **Form 1 — Consent, Assent, Pre-test (Form A).** Given before the student touches the app.
2. **Form 2 — Post-test (Form B).** Given right after they finish the practical + report.

Both forms start with the same **participant code** field — that's what joins them to each other
and (later) to the session telemetry. You assign the code (e.g. `P01`, `P02`, …) when you hand the
student their copy; write `participantCode ↔ sessionId` down yourself once they finish the
practical (not at the end of the day — you will forget whose session was whose).

## Google Forms setup notes (so scoring works automatically)

- **Turn OFF quiz mode.** Settings → do not toggle "Make this a quiz." These items should never
  show a student whether they got it right.
- **Every item is two questions**, both `Multiple choice`, both required: an **Answer** question
  with choices typed as just `A` / `B` / `C` / `D`, and a **Reason** question with choices typed
  as just `i` / `ii` / `iii` / `iv`. Put the full question text (with what each letter means) in
  the question's **description** field, not in the choice labels — so a student picks a bare
  letter, same as a bubble sheet, and the exported data is already clean.
- **Title each question exactly** `P<n> answer` / `P<n> reason` on Form 1, `Q<n> answer` /
  `Q<n> reason` on Form 2 (e.g. `P1 answer`, `P1 reason`, … `P15 answer`, `P15 reason`). The
  conversion script below matches on this exact pattern — keep it consistent.
- **Use Sections + branching** for consent/assent so a "no" skips straight to the end instead of
  showing the quiz:
  - Section A (participant code) → Section B (parent consent) → Section C (student assent) →
    Section D onward (the 15 items).
  - On the parent-consent Yes/No question: "If No" → jump to a final "Thank you, no further
    action needed" section. "If Yes" → continue.
  - Same branch on the student-assent question.
- Responses go to a linked Google Sheet (Responses tab → the green Sheets icon). Export that
  sheet as CSV (`File → Download → .csv`) when you're ready to score a batch.

---

## Form 1 — Consent, Assent, Pre-test (Form A)

### Section A — Participant code
- **Short answer, required.** Title: `Participant code`. Description: "Write the code the
  researcher gave you (e.g. P01)."

### Section B — Parent / Guardian Consent
Reuse the text from `pilot-consent-pack-draft.md` Part A verbatim (study title, your name,
supervisor, what's involved, confidentiality, voluntary participation, contact) as a
**Description** block at the top of this section — fill in the real supervisor/contact details
there first.

- Checkbox-grid or three separate checkbox questions (required), matching Part A's three consent
  bullets.
- **Parent/guardian name** — short answer, required.
- **Date** — date field, required.
- **"Do you consent to your child's participation?"** — Multiple choice, `Yes` / `No`, required.
  **This is the branch point** — No → jump to the end section; Yes → continue.

### Section C — Student Assent
Reuse Part B's plain-language text as a description block.

- **"Do you agree to take part?"** — Multiple choice, `Yes` / `No`, required. **Branch point** —
  No → jump to the end section; Yes → continue.
- **Student name** — short answer, required.

### Section D onward — Form A items (P1–P15)

For every item below: one section (or question group) with the full text + lettered options as
**description**, then the two required multiple-choice questions (`P<n> answer`: A/B/C/D,
`P<n> reason`: i/ii/iii/iv).

```
P1. Phenolphthalein is added to a colourless solution of sodium hydroxide. It turns pink.
Answer — the colour change happens because the solution is:
 (A) basic (high pH)  (B) warm  (C) cold  (D) concentrated
Reason:
 (i) phenolphthalein is pink when the pH is above about 8
 (ii) phenolphthalein turns pink when a solution warms up
 (iii) phenolphthalein turns pink when a solution cools down
 (iv) phenolphthalein turns pink when a solution is strong

P2. Dilute hydrochloric acid (a strong acid) is neutralised by exactly the right amount of
sodium hydroxide (a strong base). The pH of the final solution is:
 (A) about 7  (B) a little above 7  (C) a little below 7  (D) about 1
Reason:
 (i) the salt formed (sodium chloride) does not make the solution acidic or basic
 (ii) every neutralisation reaction produces a solution of exactly pH 7
 (iii) there is always a little unreacted acid left over
 (iv) sodium chloride is a basic salt

P3. A student pours some sodium chloride solution into some potassium nitrate solution.
What happens?
 (A) nothing — the ions just mix together  (B) a solid forms and sinks  (C) bubbles of gas appear
 (D) the mixture gets noticeably hot
Reason:
 (i) all of the ions stay dissolved, so no solid, gas, or new substance can form
 (ii) whenever two solutions are mixed, a chemical reaction takes place
 (iii) sodium chloride and potassium nitrate always react to make a precipitate
 (iv) mixing solutions always releases heat

P4. A student wants to find the exact point at which an acid has been neutralised by a base,
using phenolphthalein. In what order should they combine the three liquids?
 (A) acid, then the indicator, then slowly add the base
 (B) acid, then the base, then the indicator
 (C) the base, then the indicator, then the acid
 (D) it makes no difference — add all three at once
Reason:
 (i) the indicator must already be in the acid so it can show the moment the base is in slight excess
 (ii) the order in which chemicals are added never changes the result of a reaction
 (iii) the indicator must be added last so it is not used up
 (iv) the base must be added first because it is the more dangerous chemical

P5. (control) During a neutralisation between an acid and a base, the temperature of the
mixture rises slightly. This is because:
 (A) the reaction releases energy (it is exothermic)
 (B) stirring the mixture warms it up
 (C) the indicator produces heat as it changes colour
 (D) acids are always hot
Reason:
 (i) bonds forming in the products release more energy than is taken in to break the reactant bonds
 (ii) friction from mixing always raises the temperature
 (iii) a colour change is a sign that heat is being made
 (iv) acids store heat and release it when used

P6. A solution of an acid is slowly warmed on a hotplate. Methyl orange indicator has been
added and the solution is red. As it warms up (no other chemical is added), the colour will:
 (A) stay red  (B) turn yellow  (C) turn green  (D) turn colourless
Reason:
 (i) heating alone does not change how acidic the solution is, so the indicator colour stays the same
 (ii) methyl orange turns yellow when a solution gets hot
 (iii) heating makes any acid weaker
 (iv) methyl orange loses its colour when heated

P7. "At the exact end-point of an acid–base titration, the pH is always 7." This statement is:
 (A) never true  (B) only true for a strong acid with a strong base  (C) always true
 (D) only true when an indicator is used
Reason:
 (i) the end-point pH depends on whether the acid and the base are strong or weak
 (ii) neutral always means pH 7, whatever the acid and base are
 (iii) indicators only work at pH 7
 (iv) titrations are designed to stop exactly at pH 7

P8. In a titration, a student adds the base to the flask before adding the indicator to
the acid. Compared with the correct order, this makes it:
 (A) harder to see the exact end-point  (B) easier to see the exact end-point
 (C) exactly the same  (D) impossible for any reaction to happen
Reason:
 (i) without the indicator present from the start, the colour change that marks the end-point can be missed or overshot
 (ii) the order of adding substances has no effect on a titration
 (iii) adding the base first makes the reaction go faster
 (iv) the indicator only works if it is added first to the base

P9. Copper(II) sulfate solution (blue) is added to sodium chloride solution (colourless).
The student expects a reaction. In fact:
 (A) no reaction occurs; the mixture is just pale blue
 (B) a coloured solid always forms when a coloured solution is added to a colourless one
 (C) a gas is always released
 (D) the blue colour always disappears
Reason:
 (i) none of the ions present form an insoluble solid or a gas, so there is no reaction
 (ii) adding any solution to another always produces a new substance
 (iii) coloured solutions always react with colourless ones
 (iv) copper compounds react with everything

P10. (control) Universal indicator is added to a beaker of pure water. The colour is green
(pH 7). A few drops of dilute acid are then added. The colour becomes:
 (A) orange or red  (B) blue or purple  (C) stays green  (D) colourless
Reason:
 (i) adding acid increases the concentration of hydrogen ions, lowering the pH
 (ii) adding any liquid to water turns the indicator red
 (iii) the indicator reacts with water over time
 (iv) acids remove the colour from indicators

P11. Two beakers each contain the same dilute sodium hydroxide solution with phenolphthalein
added (both pink). One beaker is warmed to 40°C; the other is left at room temperature. The pink
colours will be:
 (A) about the same in both  (B) much darker in the warm beaker  (C) gone in the warm beaker
 (D) gone in the cool beaker
Reason:
 (i) the pH is essentially unchanged by this small temperature difference, so the indicator colour is essentially unchanged
 (ii) warming a solution always deepens an indicator's colour
 (iii) warming a solution always removes an indicator's colour
 (iv) indicators only show colour at room temperature

P12. When making up a dilute acid from a concentrated one, the safe instruction is "add acid
to water, never water to acid." A student says the order does not matter as long as the same
amounts are used. This student is:
 (A) wrong — the order affects safety  (B) right — only the amounts matter
 (C) right — order never matters in chemistry  (D) wrong — you should never dilute acid at all
Reason:
 (i) adding water to concentrated acid can release heat so fast that the mixture spits or boils
 (ii) the order chemicals are combined in has no effect on the outcome
 (iii) water and acid do not mix if added in the wrong order
 (iv) diluting acid is always unsafe

P13. Dilute ethanoic acid (a weak acid) is neutralised by exactly the right amount of
sodium hydroxide (a strong base). The final solution is:
 (A) a little basic (pH above 7)  (B) exactly pH 7  (C) a little acidic (pH below 7)
 (D) strongly acidic
Reason:
 (i) the salt formed (sodium ethanoate) reacts slightly with water to make the solution a little basic
 (ii) any exact neutralisation gives a solution of pH 7
 (iii) a weak acid can never be fully neutralised
 (iv) sodium hydroxide always leaves the solution strongly basic

P14. A student mixes dilute sodium sulfate solution with dilute potassium chloride solution
and waits. After several minutes:
 (A) there is no visible change  (B) a white precipitate has settled  (C) the solution has turned yellow
 (D) gas has been produced
Reason:
 (i) sodium, potassium, sulfate and chloride ions all stay dissolved together, so nothing happens
 (ii) mixing two salt solutions always forms a precipitate eventually
 (iii) sulfates always react with chlorides
 (iv) all mixtures react if you wait long enough

P15. (control) In the neutralisation of hydrochloric acid by sodium hydroxide, the products
are:
 (A) a salt (sodium chloride) and water  (B) a salt only  (C) hydrogen gas and a salt
 (D) carbon dioxide and water
Reason:
 (i) the H+ from the acid and the OH- from the base combine to form water, and the remaining ions form the salt
 (ii) acids always release hydrogen gas when they react
 (iii) neutralisation always produces carbon dioxide
 (iv) the base is destroyed and only a salt is left
```

### Final section
"Thank you — hand this back to the researcher now. You'll do the chemistry activity next, then
fill out a second short form afterward."

---

## Form 2 — Post-test (Form B)

### Section A — Participant code
Same as Form 1 — must match exactly.

### Section B onward — Form B items (Q1–Q15)

```
Q1. Methyl orange is added to a colourless solution of dilute hydrochloric acid. It turns red.
Answer — the colour change happens because the solution is:
 (A) acidic (low pH)  (B) cold  (C) warm  (D) dilute
Reason:
 (i) methyl orange is red when the pH is below about 3.5
 (ii) methyl orange turns red when a solution cools down
 (iii) methyl orange turns red when a solution warms up
 (iv) methyl orange turns red when a solution is dilute

Q2. Dilute nitric acid (a strong acid) is neutralised by exactly the right amount of potassium
hydroxide (a strong base). The pH of the final solution is:
 (A) about 7  (B) a little above 7  (C) a little below 7  (D) about 13
Reason:
 (i) the salt formed (potassium nitrate) does not make the solution acidic or basic
 (ii) every neutralisation gives a solution of exactly pH 7
 (iii) there is always some unreacted base left
 (iv) potassium nitrate is an acidic salt

Q3. A student pours some potassium chloride solution into some sodium sulfate solution.
What happens?
 (A) nothing — the ions just mix  (B) a solid forms  (C) a gas is given off  (D) the mixture gets hot
Reason:
 (i) all the ions stay dissolved, so nothing new can form
 (ii) mixing any two solutions causes a reaction
 (iii) chlorides and sulfates always react
 (iv) mixing solutions always releases heat

Q4. A student wants to find the exact point at which a base has been neutralised by an acid,
using methyl orange. In what order should they combine the three liquids?
 (A) base, then the indicator, then slowly add the acid
 (B) base, then the acid, then the indicator
 (C) acid, then the indicator, then the base
 (D) it makes no difference — add all three at once
Reason:
 (i) the indicator must already be in the base so it can show the moment the acid is in slight excess
 (ii) the order chemicals are added in never changes the result
 (iii) the indicator must be added last so it is not used up
 (iv) the acid must be added first because it is more dangerous

Q5. (control) During the neutralisation of nitric acid by potassium hydroxide the mixture
warms up slightly. This is because:
 (A) the reaction is exothermic  (B) stirring warms the mixture  (C) the indicator gives off heat
 (D) bases are always warm
Reason:
 (i) forming the product bonds releases more energy than is used breaking the reactant bonds
 (ii) mixing always causes friction heating
 (iii) a colour change means heat is being produced
 (iv) bases store heat and release it when used

Q6. A solution of a base has phenolphthalein added (pink) and is gently warmed on a hotplate,
with nothing else added. As it warms, the colour will:
 (A) stay pink  (B) turn colourless  (C) turn blue  (D) turn orange
Reason:
 (i) warming alone does not change the pH, so the indicator colour stays the same
 (ii) phenolphthalein loses its colour when heated
 (iii) heating makes any base weaker
 (iv) phenolphthalein turns orange when hot

Q7. "At the exact end-point of an acid–base titration the solution is always neutral, pH 7."
This is:
 (A) never true  (B) only true for a strong acid with a strong base  (C) always true
 (D) only true without an indicator
Reason:
 (i) the end-point pH depends on the strengths of the acid and the base
 (ii) neutral is always pH 7 regardless of the chemicals
 (iii) indicators only change at pH 7
 (iv) titrations always stop at pH 7 by design

Q8. In a titration a student adds the acid to the flask before putting the indicator into
the base. Compared with the correct order this makes it:
 (A) harder to see the exact end-point  (B) easier to see the exact end-point  (C) no different
 (D) impossible for a reaction to occur
Reason:
 (i) without the indicator present from the start the end-point colour change can be missed or overshot
 (ii) the order of adding substances has no effect
 (iii) adding the acid first speeds up the reaction
 (iv) the indicator only works if added first to the acid

Q9. Iron(III) chloride solution (yellow) is added to potassium nitrate solution (colourless).
The student expects a reaction. In fact:
 (A) no reaction occurs; the mixture is just pale yellow
 (B) a coloured solid always forms when a coloured solution meets a colourless one
 (C) a gas is always given off
 (D) the yellow colour always disappears
Reason:
 (i) none of the ions present form an insoluble solid or a gas, so there is no reaction
 (ii) adding one solution to another always makes a new substance
 (iii) coloured solutions always react with colourless ones
 (iv) iron compounds react with everything

Q10. (control) Universal indicator is green (pH 7) in pure water. A few drops of dilute
sodium hydroxide are added. The colour becomes:
 (A) blue or purple  (B) orange or red  (C) stays green  (D) colourless
Reason:
 (i) adding base lowers the hydrogen-ion concentration, raising the pH
 (ii) adding any liquid to water turns the indicator blue
 (iii) the indicator reacts with water over time
 (iv) bases remove the colour from indicators

Q11. Two beakers hold the same dilute hydrochloric acid with methyl orange added (both red).
One is warmed to 40°C, the other left at room temperature. The red colours will be:
 (A) about the same in both  (B) much darker in the warm beaker  (C) yellow in the warm beaker
 (D) yellow in the cool beaker
Reason:
 (i) this small temperature change barely alters the pH, so the indicator colour is essentially unchanged
 (ii) warming always deepens an indicator's colour
 (iii) warming always turns methyl orange yellow
 (iv) indicators only show colour at room temperature

Q12. A technician says that when diluting concentrated sulfuric acid the order ("acid into
water") does not matter as long as the final concentration is the same. This is:
 (A) wrong — the order affects safety  (B) right — only concentration matters
 (C) right — order never matters  (D) wrong — sulfuric acid must never be diluted
Reason:
 (i) pouring water onto concentrated acid can release heat fast enough to make it spit or boil
 (ii) the order substances are combined in has no effect on the outcome
 (iii) acid and water will not mix if combined in the wrong order
 (iv) diluting sulfuric acid is always unsafe

Q13. Dilute ammonia solution (a weak base) is neutralised by exactly the right amount of
hydrochloric acid (a strong acid). The final solution is:
 (A) a little acidic (pH below 7)  (B) exactly pH 7  (C) a little basic (pH above 7)
 (D) strongly basic
Reason:
 (i) the salt formed (ammonium chloride) reacts slightly with water to make the solution a little acidic
 (ii) any exact neutralisation gives pH 7
 (iii) a weak base can never be fully neutralised
 (iv) hydrochloric acid always leaves the solution strongly acidic

Q14. A student mixes dilute potassium nitrate solution with dilute sodium chloride solution
and waits several minutes. Afterwards:
 (A) there is no visible change  (B) a white precipitate has settled  (C) the solution has turned blue
 (D) gas has formed
Reason:
 (i) potassium, sodium, nitrate and chloride ions all stay dissolved, so nothing happens
 (ii) mixing two salt solutions always forms a precipitate eventually
 (iii) nitrates always react with chlorides
 (iv) any mixture reacts if you wait long enough

Q15. (control) In the neutralisation of nitric acid by potassium hydroxide the products are:
 (A) a salt (potassium nitrate) and water  (B) a salt only  (C) hydrogen gas and a salt
 (D) carbon dioxide and water
Reason:
 (i) H+ from the acid and OH- from the base form water, and the remaining ions form the salt
 (ii) acids always give off hydrogen gas when they react
 (iii) neutralisation always makes carbon dioxide
 (iv) the base is destroyed, leaving only a salt
```

### Final section
"Thank you for taking part."

---

## Administration (per `concept-inventory-acid-base.md` §3 — don't skip)

- Read aloud before Form 1's items: *"For each question, first choose the best answer. Then
  choose the reason that best matches your thinking. There is always exactly one answer and one
  reason. If you are unsure, pick the option closest to what you think — do not leave anything
  blank."*
- Silent, individual, no help on content, ~25 min cap per form.
- Record `participantCode ↔ sessionId` yourself, right after each student finishes the practical —
  into `pilot-data/session-map.csv` (`participantCode,sessionId`; create the folder if it doesn't
  exist — it's already gitignored for anything with real identifiers, but the map file holds no
  name, just codes and session ids, so it's fine to keep in the repo).

## Turning the export into `labels.csv`

1. Download each form's responses as CSV from the linked Sheet.
2. Run the converter below to reshape it into what `score-inventory.js` expects:

```
node scripts/analysis/convert-google-form-export.js form1-export.csv --form A -o responses-A.csv
node scripts/analysis/convert-google-form-export.js form2-export.csv --form B -o responses-B.csv
```

3. Merge `responses-A.csv` and `responses-B.csv` (same columns, different `form` value — just
   concatenate the data rows) into one `responses.csv`, then score as usual:

```
node scripts/analysis/score-inventory.js responses.csv --form A --sessions pilot-data/session-map.csv -o out/labels-pre.csv --item-stats
node scripts/analysis/score-inventory.js responses.csv --form B --sessions pilot-data/session-map.csv -o out/labels-post.csv
```
