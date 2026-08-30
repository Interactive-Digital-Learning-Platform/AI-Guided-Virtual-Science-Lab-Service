# Two-Tier Concept Inventory — Acid–Base Neutralisation & Indicators

Status: **draft instrument — needs expert review + a small validity pilot before the main study.**
Companion to [research-direction.md](./research-direction.md) §7.1 and
[implementation-plan-student-model.md](./implementation-plan-student-model.md) §7.

Purpose: the **ground-truth label source** for the student-model evaluation. Given before and after
the *Acid-Base Neutralization* virtual practical. It produces, per student:

1. a **conceptual understanding score** (0–15) → the pre→post gain for Study 2 (learning-gains RCT);
2. a **misconception flag** for each of `CHEM_001`, `CHEM_002`, `CHEM_003`, `CHEM_004`
   (∈ {0, 1}) → the `label_<CODE>` columns the analysis scripts join in (Study 1, `fit-params`).

---

## 1. Why this design

- **Two-tier** (Treagust 1988): every item has a content question (tier 1) **and** a "reason for your
  answer" question (tier 2). A student only counts as understanding the idea if **both** tiers are
  right; a specific wrong tier-1 + wrong tier-2 combination identifies a specific misconception.
- **Tier 2 is forced-choice, not free text.** This is the key decision that makes the "students
  only, no expert coders" constraint work: scoring is a lookup against the key (§7), so no teacher
  has to read and code anything. The trade-off is that the reason options must be authored well —
  hence the expert-review step below.
- **Parallel forms.** Form A (pre) and Form B (post) test the same constructs with different
  substances/numbers, so a gain isn't just familiarity with the exact questions. Item `Q_k` is the
  parallel of `P_k`.
- Adapted from the methodology and item styles of published acid–base two-tier diagnostics
  (Chandrasegaran, Treagust & Mocerino 2007; Demircioğlu, Ayas & Demircioğlu 2005) — **not lifted
  verbatim**; these items are new and unvalidated until the pilot (§8).

## 2. Coverage map

| Misconception (KB code) | Plain statement of the wrong idea | Items (Form A / B) |
|---|---|---|
| `CHEM_001` | The order you add chemicals doesn't affect the result | P4, P8, P12 / Q4, Q8, Q12 |
| `CHEM_002` | Indicators change colour because of temperature, not pH | P1, P6, P11 / Q1, Q6, Q11 |
| `CHEM_003` | Every neutralisation ends at exactly pH 7 | P2, P7, P13 / Q2, Q7, Q13 |
| `CHEM_004` | Mixing any two solutions always causes a reaction | P3, P9, P14 / Q3, Q9, Q14 |
| — (control: correct understanding, maps to no misconception) | | P5, P10, P15 / Q5, Q10, Q15 |

15 items per form, ~20–25 min, individual, no notes, no calculator.

## 3. Administration protocol

| | |
|---|---|
| **Pre-test (Form A)** | Immediately before the student's first exposure to the *Acid-Base Neutralization* practical. Paper or a simple digital form. |
| **Post-test (Form B)** | Same day, immediately after completing the practical (and its report). |
| **Delayed post-test (optional)** | Form A again, 2–3 weeks later — retention. |
| **Identity** | Each student gets a short participant code. Record `participantCode ↔ sessionId` in a **separate** list held by the researcher, so responses join to the telemetry (`--labels`) but the response sheets themselves carry no name. |
| **Instructions to read aloud** | "For each question, first choose the best answer. Then choose the reason that best matches your thinking. There is always exactly one answer and one reason. If you are unsure, pick the option closest to what you think — do not leave anything blank." |
| **Conditions** | Silent, individual. No help from staff on content. ~25 min cap. |

---

## 4. Form A (pre-test)

> Instructions: choose one **answer** and one **reason** for every question.

**P1.** Phenolphthalein is added to a colourless solution of sodium hydroxide. It turns pink.
Answer — the colour change happens because the solution is:
 (A) basic (high pH)  (B) warm  (C) cold  (D) concentrated
Reason:
 (i) phenolphthalein is pink when the pH is above about 8
 (ii) phenolphthalein turns pink when a solution warms up
 (iii) phenolphthalein turns pink when a solution cools down
 (iv) phenolphthalein turns pink when a solution is strong

**P2.** Dilute hydrochloric acid (a strong acid) is neutralised by exactly the right amount of
sodium hydroxide (a strong base). The pH of the final solution is:
 (A) about 7  (B) a little above 7  (C) a little below 7  (D) about 1
Reason:
 (i) the salt formed (sodium chloride) does not make the solution acidic or basic
 (ii) every neutralisation reaction produces a solution of exactly pH 7
 (iii) there is always a little unreacted acid left over
 (iv) sodium chloride is a basic salt

**P3.** A student pours some sodium chloride solution into some potassium nitrate solution.
What happens?
 (A) nothing — the ions just mix together  (B) a solid forms and sinks  (C) bubbles of gas appear
 (D) the mixture gets noticeably hot
Reason:
 (i) all of the ions stay dissolved, so no solid, gas, or new substance can form
 (ii) whenever two solutions are mixed, a chemical reaction takes place
 (iii) sodium chloride and potassium nitrate always react to make a precipitate
 (iv) mixing solutions always releases heat

**P4.** A student wants to find the exact point at which an acid has been neutralised by a base,
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

**P5.** *(control)* During a neutralisation between an acid and a base, the temperature of the
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

**P6.** A solution of an acid is slowly warmed on a hotplate. Methyl orange indicator has been
added and the solution is red. As it warms up (no other chemical is added), the colour will:
 (A) stay red  (B) turn yellow  (C) turn green  (D) turn colourless
Reason:
 (i) heating alone does not change how acidic the solution is, so the indicator colour stays the same
 (ii) methyl orange turns yellow when a solution gets hot
 (iii) heating makes any acid weaker
 (iv) methyl orange loses its colour when heated

**P7.** "At the exact end-point of an acid–base titration, the pH is always 7." This statement is:
 (A) never true  (B) only true for a strong acid with a strong base  (C) always true
 (D) only true when an indicator is used
Reason:
 (i) the end-point pH depends on whether the acid and the base are strong or weak
 (ii) neutral always means pH 7, whatever the acid and base are
 (iii) indicators only work at pH 7
 (iv) titrations are designed to stop exactly at pH 7

**P8.** In a titration, a student adds the base to the flask **before** adding the indicator to
the acid. Compared with the correct order, this makes it:
 (A) harder to see the exact end-point  (B) easier to see the exact end-point
 (C) exactly the same  (D) impossible for any reaction to happen
Reason:
 (i) without the indicator present from the start, the colour change that marks the end-point can be missed or overshot
 (ii) the order of adding substances has no effect on a titration
 (iii) adding the base first makes the reaction go faster
 (iv) the indicator only works if it is added first to the base

**P9.** Copper(II) sulfate solution (blue) is added to sodium chloride solution (colourless).
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

**P10.** *(control)* Universal indicator is added to a beaker of pure water. The colour is green
(pH 7). A few drops of dilute acid are then added. The colour becomes:
 (A) orange or red  (B) blue or purple  (C) stays green  (D) colourless
Reason:
 (i) adding acid increases the concentration of hydrogen ions, lowering the pH
 (ii) adding any liquid to water turns the indicator red
 (iii) the indicator reacts with water over time
 (iv) acids remove the colour from indicators

**P11.** Two beakers each contain the same dilute sodium hydroxide solution with phenolphthalein
added (both pink). One beaker is warmed to 40 °C; the other is left at room temperature. The pink
colours will be:
 (A) about the same in both  (B) much darker in the warm beaker  (C) gone in the warm beaker
 (D) gone in the cool beaker
Reason:
 (i) the pH is essentially unchanged by this small temperature difference, so the indicator colour is essentially unchanged
 (ii) warming a solution always deepens an indicator's colour
 (iii) warming a solution always removes an indicator's colour
 (iv) indicators only show colour at room temperature

**P12.** When making up a dilute acid from a concentrated one, the safe instruction is "add acid
to water, never water to acid." A student says the order does not matter as long as the same
amounts are used. This student is:
 (A) wrong — the order affects safety  (B) right — only the amounts matter
 (C) right — order never matters in chemistry  (D) wrong — you should never dilute acid at all
Reason:
 (i) adding water to concentrated acid can release heat so fast that the mixture spits or boils
 (ii) the order chemicals are combined in has no effect on the outcome
 (iii) water and acid do not mix if added in the wrong order
 (iv) diluting acid is always unsafe

**P13.** Dilute ethanoic acid (a **weak** acid) is neutralised by exactly the right amount of
sodium hydroxide (a strong base). The final solution is:
 (A) a little basic (pH above 7)  (B) exactly pH 7  (C) a little acidic (pH below 7)
 (D) strongly acidic
Reason:
 (i) the salt formed (sodium ethanoate) reacts slightly with water to make the solution a little basic
 (ii) any exact neutralisation gives a solution of pH 7
 (iii) a weak acid can never be fully neutralised
 (iv) sodium hydroxide always leaves the solution strongly basic

**P14.** A student mixes dilute sodium sulfate solution with dilute potassium chloride solution
and waits. After several minutes:
 (A) there is no visible change  (B) a white precipitate has settled  (C) the solution has turned yellow
 (D) gas has been produced
Reason:
 (i) sodium, potassium, sulfate and chloride ions all stay dissolved together, so nothing happens
 (ii) mixing two salt solutions always forms a precipitate eventually
 (iii) sulfates always react with chlorides
 (iv) all mixtures react if you wait long enough

**P15.** *(control)* In the neutralisation of hydrochloric acid by sodium hydroxide, the products
are:
 (A) a salt (sodium chloride) and water  (B) a salt only  (C) hydrogen gas and a salt
 (D) carbon dioxide and water
Reason:
 (i) the H⁺ from the acid and the OH⁻ from the base combine to form water, and the remaining ions form the salt
 (ii) acids always release hydrogen gas when they react
 (iii) neutralisation always produces carbon dioxide
 (iv) the base is destroyed and only a salt is left

---

## 5. Form B (post-test)

> Same instructions. `Q_k` tests the same idea as `P_k`.

**Q1.** Methyl orange is added to a colourless solution of dilute hydrochloric acid. It turns red.
Answer — the colour change happens because the solution is:
 (A) acidic (low pH)  (B) cold  (C) warm  (D) dilute
Reason:
 (i) methyl orange is red when the pH is below about 3.5
 (ii) methyl orange turns red when a solution cools down
 (iii) methyl orange turns red when a solution warms up
 (iv) methyl orange turns red when a solution is dilute

**Q2.** Dilute nitric acid (a strong acid) is neutralised by exactly the right amount of potassium
hydroxide (a strong base). The pH of the final solution is:
 (A) about 7  (B) a little above 7  (C) a little below 7  (D) about 13
Reason:
 (i) the salt formed (potassium nitrate) does not make the solution acidic or basic
 (ii) every neutralisation gives a solution of exactly pH 7
 (iii) there is always some unreacted base left
 (iv) potassium nitrate is an acidic salt

**Q3.** A student pours some potassium chloride solution into some sodium sulfate solution.
What happens?
 (A) nothing — the ions just mix  (B) a solid forms  (C) a gas is given off  (D) the mixture gets hot
Reason:
 (i) all the ions stay dissolved, so nothing new can form
 (ii) mixing any two solutions causes a reaction
 (iii) chlorides and sulfates always react
 (iv) mixing solutions always releases heat

**Q4.** A student wants to find the exact point at which a base has been neutralised by an acid,
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

**Q5.** *(control)* During the neutralisation of nitric acid by potassium hydroxide the mixture
warms up slightly. This is because:
 (A) the reaction is exothermic  (B) stirring warms the mixture  (C) the indicator gives off heat
 (D) bases are always warm
Reason:
 (i) forming the product bonds releases more energy than is used breaking the reactant bonds
 (ii) mixing always causes friction heating
 (iii) a colour change means heat is being produced
 (iv) bases store heat and release it when used

**Q6.** A solution of a base has phenolphthalein added (pink) and is gently warmed on a hotplate,
with nothing else added. As it warms, the colour will:
 (A) stay pink  (B) turn colourless  (C) turn blue  (D) turn orange
Reason:
 (i) warming alone does not change the pH, so the indicator colour stays the same
 (ii) phenolphthalein loses its colour when heated
 (iii) heating makes any base weaker
 (iv) phenolphthalein turns orange when hot

**Q7.** "At the exact end-point of an acid–base titration the solution is always neutral, pH 7."
This is:
 (A) never true  (B) only true for a strong acid with a strong base  (C) always true
 (D) only true without an indicator
Reason:
 (i) the end-point pH depends on the strengths of the acid and the base
 (ii) neutral is always pH 7 regardless of the chemicals
 (iii) indicators only change at pH 7
 (iv) titrations always stop at pH 7 by design

**Q8.** In a titration a student adds the acid to the flask **before** putting the indicator into
the base. Compared with the correct order this makes it:
 (A) harder to see the exact end-point  (B) easier to see the exact end-point  (C) no different
 (D) impossible for a reaction to occur
Reason:
 (i) without the indicator present from the start the end-point colour change can be missed or overshot
 (ii) the order of adding substances has no effect
 (iii) adding the acid first speeds up the reaction
 (iv) the indicator only works if added first to the acid

**Q9.** Iron(III) chloride solution (yellow) is added to potassium nitrate solution (colourless).
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

**Q10.** *(control)* Universal indicator is green (pH 7) in pure water. A few drops of dilute
sodium hydroxide are added. The colour becomes:
 (A) blue or purple  (B) orange or red  (C) stays green  (D) colourless
Reason:
 (i) adding base lowers the hydrogen-ion concentration, raising the pH
 (ii) adding any liquid to water turns the indicator blue
 (iii) the indicator reacts with water over time
 (iv) bases remove the colour from indicators

**Q11.** Two beakers hold the same dilute hydrochloric acid with methyl orange added (both red).
One is warmed to 40 °C, the other left at room temperature. The red colours will be:
 (A) about the same in both  (B) much darker in the warm beaker  (C) yellow in the warm beaker
 (D) yellow in the cool beaker
Reason:
 (i) this small temperature change barely alters the pH, so the indicator colour is essentially unchanged
 (ii) warming always deepens an indicator's colour
 (iii) warming always turns methyl orange yellow
 (iv) indicators only show colour at room temperature

**Q12.** A technician says that when diluting concentrated sulfuric acid the order ("acid into
water") does not matter as long as the final concentration is the same. This is:
 (A) wrong — the order affects safety  (B) right — only concentration matters
 (C) right — order never matters  (D) wrong — sulfuric acid must never be diluted
Reason:
 (i) pouring water onto concentrated acid can release heat fast enough to make it spit or boil
 (ii) the order substances are combined in has no effect on the outcome
 (iii) acid and water will not mix if combined in the wrong order
 (iv) diluting sulfuric acid is always unsafe

**Q13.** Dilute ammonia solution (a **weak** base) is neutralised by exactly the right amount of
hydrochloric acid (a strong acid). The final solution is:
 (A) a little acidic (pH below 7)  (B) exactly pH 7  (C) a little basic (pH above 7)
 (D) strongly basic
Reason:
 (i) the salt formed (ammonium chloride) reacts slightly with water to make the solution a little acidic
 (ii) any exact neutralisation gives pH 7
 (iii) a weak base can never be fully neutralised
 (iv) hydrochloric acid always leaves the solution strongly acidic

**Q14.** A student mixes dilute potassium nitrate solution with dilute sodium chloride solution
and waits several minutes. Afterwards:
 (A) there is no visible change  (B) a white precipitate has settled  (C) the solution has turned blue
 (D) gas has formed
Reason:
 (i) potassium, sodium, nitrate and chloride ions all stay dissolved, so nothing happens
 (ii) mixing two salt solutions always forms a precipitate eventually
 (iii) nitrates always react with chlorides
 (iv) any mixture reacts if you wait long enough

**Q15.** *(control)* In the neutralisation of nitric acid by potassium hydroxide the products are:
 (A) a salt (potassium nitrate) and water  (B) a salt only  (C) hydrogen gas and a salt
 (D) carbon dioxide and water
Reason:
 (i) H⁺ from the acid and OH⁻ from the base form water, and the remaining ions form the salt
 (ii) acids always give off hydrogen gas when they react
 (iii) neutralisation always makes carbon dioxide
 (iv) the base is destroyed, leaving only a salt

---

## 6. Answer key

Format: **item → (correct answer, correct reason) | misconception combination that flags the code**.
"Flags the code" = the tier-1/tier-2 choice(s) that indicate the student holds that misconception.

| Item | Correct | Flags misconception when the student picks… | Code |
|---|---|---|---|
| P1 / Q1 | A, i | B+ii, or C+iii (temperature reason) | CHEM_002 |
| P2 / Q2 | A, i | any answer with reason **ii** ("always pH 7") | CHEM_003 |
| P3 / Q3 | A, i | any answer with reason **ii** ("any two solutions react") | CHEM_004 |
| P4 / Q4 | A, i | answer **D** or reason **ii** ("order never matters") | CHEM_001 |
| P5 / Q5 | A, i | — (control) | — |
| P6 / Q6 | A, i | answer **B/D** with reason **ii/iv** (heating changes the indicator) | CHEM_002 |
| P7 / Q7 | B, i | answer **C** with reason **ii** ("neutral is always pH 7") | CHEM_003 |
| P8 / Q8 | A, i | answer **C** or reason **ii** ("order has no effect") | CHEM_001 |
| P9 / Q9 | A, i | reason **ii** ("adding any solution always makes a new substance") | CHEM_004 |
| P10 / Q10 | A, i | — (control) | — |
| P11 / Q11 | A, i | answer **C/D** with reason **ii/iii** (warming changes indicator colour) | CHEM_002 |
| P12 / Q12 | A, i | answer **B/C** with reason **ii** ("order has no effect") | CHEM_001 |
| P13 / Q13 | A, i | answer **B** with reason **ii** ("any neutralisation gives pH 7") | CHEM_003 |
| P14 / Q14 | A, i | answer **B** with reason **ii** ("mixing two salt solutions always precipitates") | CHEM_004 |
| P15 / Q15 | A, i | — (control) | — |

## 7. Scoring

Two outputs per student per form.

### 7.1 Conceptual understanding score (0–15)

+1 for each item where **both** the answer and the reason are correct (per §6). Controls count.
Use the **gain** `postScore − preScore` (or Hake's normalised gain
`⟨g⟩ = (post − pre) / (15 − pre)`) as Study 2's primary outcome.

### 7.2 Misconception flags (the `label_<CODE>` columns)

Each code has **3 items** (see §2). For each code:

```
holders_signal = number of that code's 3 items where the student's choice flags the code (per §6)
label_<CODE> = 1  if holders_signal >= 2
label_<CODE> = 0  if holders_signal == 0
label_<CODE> = 1  if holders_signal == 1 AND the student also got < 2 of that code's items fully correct
             = 0  otherwise                         (the "1 out of 3" tie-break — err toward "not held")
```

Compute from the **pre-test** for Study 1's "does the mid-session posterior predict a pre-existing
misconception / later errors", and from the **post-test** for "did the misconception persist after
the practical". Keep both; the analysis scripts can use either column.

### 7.3 Label file for the analysis scripts

`predictive-validity.js` / `fit-params.js` take `--labels labels.csv` with:

```csv
sessionId,label_CHEM_001,label_CHEM_002,label_CHEM_003,label_CHEM_004
<sessionId for participant P07>,0,1,1,0
<sessionId for participant P12>,1,0,0,0
...
```

Build this by: score each response sheet (§7.2) → look up `participantCode → sessionId` in the
researcher's separate list → write one row per participant. (Use the **pre-test** flags for the
primary Study 1 run; keep a second `labels-post.csv` from the post-test.)

## 8. Before the main study — validity & reliability checklist

Run a **small pilot** (10–15 students not in the main study, or think-aloud with 4–6):

- [ ] **Face validity** — one chemistry teacher / curriculum expert reviews every item and every
      reason option: is the science correct at O/L level? Does each "misconception" option really
      express that misconception and nothing else? Is the language clear?
- [ ] **Item difficulty** — proportion correct per item should sit roughly between 0.2 and 0.9
      (drop or revise items everyone gets right or wrong).
- [ ] **Discrimination** — each item's score should correlate positively with the total (point-biserial
      > 0.2).
- [ ] **Internal consistency** — Cronbach's α over the 15 items ≥ ~0.6 (concept inventories run low;
      don't chase 0.9).
- [ ] **Parallel-form check** — a group takes A then B (no teaching in between): mean scores and the
      per-item difficulties should be close. Adjust wording of any item that drifts.
- [ ] **Timing** — 90% of pilot students finish within 25 min.
- [ ] **Misconception prevalence** — from the pilot pre-tests, does each code get flagged in at least
      ~25–30% of students? If a code is almost never flagged, the study can't say anything about it —
      consider adding a task to the practical that elicits it, or dropping that code from the claim.

## 9. Provenance & citations (fill in exact refs during write-up)

- Treagust, D. F. (1988). Development and use of diagnostic tests to evaluate students' misconceptions
  in science. *International Journal of Science Education*. — the two-tier methodology.
- Chandrasegaran, A. L., Treagust, D. F., & Mocerino, M. (2007). The development of a two-tier
  multiple-choice diagnostic instrument for evaluating secondary school students' ability to describe
  and explain chemical reactions using multiple levels of representation. — acid–base item styles.
- Demircioğlu, G., Ayas, A., & Demircioğlu, H. (2005). Conceptual change achieved through a new
  teaching program on acids and bases. — acid–base misconception catalogue.
- Hake, R. R. (1998). Interactive-engagement versus traditional methods. — normalised gain ⟨g⟩.

These items are **newly written** for this study, informed by the above. They carry no validity
claim until §8 is done.
