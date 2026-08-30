# Multiplayer Virtual Lab + AI Tutor Agent — Integration Plan

Status: proposal / design doc
Scope: backend (`AI-Guided-Virtual-Science-Lab-Service`). Mobile/web client changes noted but not detailed.

---

## 1. Existing implementation (relevant parts)

- **Stack**: Node.js + Express + MongoDB (Mongoose). Single stateless process (`src/app.js`, `app.listen`). REST only, JWT auth (`middleware/auth.js` → `protect`).
- **LLM**: Groq via OpenAI-compatible client (`services/groqClient.js`, `generateText(prompt)`), single-turn, one call per request. Every AI feature has a rule-based fallback.
- **Core domain objects**:
  - `Experiment` — static practical definition: `steps[]` → `microSteps[]` ("Current Tasks"), each with `expectedIntent`, `expectedEquipment/Chemicals`, `requiresReactionCheck`, `expectedMeasurement`, hints, `misconceptionRisks`.
  - `Session` — **one student's one attempt** at one experiment. Holds `currentStep`, `currentMicroStep`, `stepProgress[]` (+ nested `microSteps[]`), `behaviorFeatures`, `aiFeedback`. `userId` is single.
  - `LabRun` — **live bench state** for that session: `equipment[]` (instances + contents + observableState), `physicsEquipment[]`, `circuitBoardState`, `materials[]`, `actions[]` (bench telemetry sub-docs), `reactionsTriggered[]`, `tutorConversation[]`. `userId` single, `sessionId` optional link.
  - `Action` — graded step-attempt records (per session, separate collection).
- **Grading is server-authoritative**: `session.controller.js#logAction` + `evaluateOnBench()` read the live `LabRun` and decide correct/incorrect; client cannot self-report success. Reaction/measurement/circuit checks delegated to `services/*Engine.js`.
- **Bench actions**: `labRun.controller.js#logLabAction` — big `switch(actionType)` mutating `LabRun`, runs `checkAndApplyReaction` + `checkSafetyIntervention` continuously (no explicit "mix").
- **AI tutor today**:
  - Reactive Q&A: `POST /api/lab/runs/:id/tutor` → `labTutorService.generateTutorResponse` (chemicals present + last 5 actions + last 6 turns → one prompt).
  - Proactive: rule-triggered `generateInterventionHint` (equipment/chemical mismatch, repeated mistake, unnecessary heat, unknown combination, heating empty, contamination). Event-driven, ≤1 per action, template fallback.
  - Post-session: `aiService.analyzeSession` — rules + 1 LLM summary call.

---

## 2. Feasibility — can multiplayer be added without breaking changes?

**Yes.** The feature is purely additive. Rationale:

- The whole single-player flow (`Session` + `LabRun` per user, all REST endpoints) stays untouched and keeps working.
- Only one edit to existing runtime code is required and it is behavior-neutral:
  - `app.js`: `app.listen(PORT)` → `const server = http.createServer(app); server.listen(PORT)` so a WebSocket server can share the port.
- Everything else is new files: new models, a `src/realtime/` layer, new `/api/rooms` routes.
- Two **small, safe refactors** (extract, don't rewrite) enable reuse:
  1. Pull JWT-verify logic out of `protect` into `services/authToken.js` (`verifyToken(token) → user`); `protect` calls it. Reused by the WS handshake.
  2. Extract the grading core of `logAction` and the `switch` of `logLabAction` into plain services (`labActionService.applyBenchAction(labRun, payload)`, `gradingService.gradeAttempt(session, labRun, payload)`) that take objects, not `req/res`. Existing controllers become thin wrappers → identical behavior, now callable from WS handlers.
- Scaling caveat: in-memory room/socket state assumes **single instance**. Fine for the project; horizontal scale later needs a Redis pub/sub adapter (see §7).

---

## 3. What to add

### 3.1 New models

- **`LabRoom`** (collaborative session / "room"):
  - `experimentId`, `hostId`, `joinCode` (short, unique), `status` (`lobby | active | completed | abandoned`)
  - `participants[]`: `{ userId, role: student|observer|teacher, sessionId, joinedAt, leftAt, connection: online|offline }`
  - `sharedLabRunId` (one shared bench for the room — see §3.3)
  - `sharedProgress`: `{ currentStep, currentMicroStep }` (room advances together)
  - `settings`: `{ maxParticipants, controlMode: free|turn-based|host-locked }`
  - `tutorState` snapshot (see §4.3), `startedAt`, `endedAt`
- **`RoomEvent`** (append-only, ordered log — source of truth for replay + tutor feed):
  - `roomId`, `seq` (monotonic per room), `actorUserId`, `type` (`join|leave|bench_action|attempt_graded|chat|tutor_ask|tutor_feedback|progress_advance`), `payload`, `ts`
- **`TutorObservation`** (what the tutor concluded — persisted for the report + teacher view):
  - `roomId`, `ts`, `tier` (0|1|2), `targetUserIds[]`, `assessment`, `suggestion`, `severity`, `misconceptionCodes[]`, `delivered`

### 3.2 Realtime layer — `src/realtime/`

- `index.js` — attach `socket.io` (recommended: rooms, reconnection, ack built-in) to the shared `http.Server`.
- `handshake.js` — auth middleware: read JWT from `socket.handshake.auth.token` → `verifyToken` → attach `socket.user`.
- `roomManager.js` — in-memory registry: `roomId → { members: Map<userId,socket>, ... }`; join/leave, presence broadcast, late-join snapshot, host migration.
- `handlers/` — one file per inbound event:
  - `lab:action` → `applyBenchAction` → persist `LabRun` + `RoomEvent` → broadcast `lab:state` diff to room.
  - `lab:attempt` → `gradeAttempt` (shared bench, `actorUserId`) → update room `sharedProgress` + each participant `Session` (via reducer) → broadcast `lab:graded` + `progress`.
  - `chat:message`, `tutor:ask`, `hand:raise`, `session:advance` (host), `cursor:move` (optional, not persisted).
- All outbound state is a **diff/patch**, not full `LabRun`, to keep payloads small.

### 3.3 Shared bench decision

- **Recommended: one shared `LabRun` per room** (`LabRoom.sharedLabRunId`). All students manipulate the same bench → real collaboration; simplest tutor context (one bench to describe).
- Only existing-schema touch: add optional `actorUserId` to the `LabRun.actions[]` sub-doc (additive, nullable → non-breaking) for per-student attribution.
- Each participant still gets their **own `Session`** for individual scoring/report/analytics (reuse everything). A reducer projects `RoomEvent`s into each `Session` (per-student action counts, errors, hints, misconceptions).
- Concurrency: serialize writes to the shared `LabRun` per room (in-memory async queue / mutex) so two simultaneous actions can't clobber each other.

### 3.4 REST additions (`/api/rooms`) — lobby & history, not realtime

- `POST /api/rooms` (create → joinCode), `POST /api/rooms/join` (by code), `POST /api/rooms/:id/start` (host), `GET /api/rooms/:id`, `GET /api/rooms/:id/report`, `GET /api/rooms/history`.

### 3.5 Client (not this repo — note only)

- Socket client + reconnection, room lobby / join-by-code, shared bench rendering with presence (avatars, who-did-what), tutor feed panel, host controls, optional teacher dashboard.

---

## 4. AI Tutor Agent — continuous, low-token monitoring

Goal: tutor watches the whole lab session, attributes each action to a student, evaluates it, and pushes suggestions — **without an LLM call per action** and with a bounded token budget per room per session.

### 4.1 Three tiers (most work happens with zero tokens)

- **Tier 0 — deterministic rule engine (0 tokens, every event)**
  - Generalize the existing intervention rules to multi-actor: wrong equipment/chemical for current task, repeated mistake, rushed step (`timeTaken` small), unnecessary heat, unknown combination, contamination, **idle student**, **student diverging from `sharedProgress`**.
  - Emits template-phrased suggestions immediately. Handles the majority of feedback.
  - Maintains a per-student **struggle score** (decaying counter): +on error/hint, −over time. Only a threshold crossing escalates to Tier 1/2.

- **Tier 1 — batched digest evaluation (cheap LLM, periodic)**
  - A per-room **tutor tick** fires on a debounce: whichever comes first of *~25 s elapsed*, *N substantive events*, or *a milestone* (step completed, struggle threshold crossed). Never on trivial events (cursor/chat).
  - Sends a **compact digest** only:
    - static context (experiment title + current step goal + expected-intent) — sent once, reused via prompt caching / kept server-side by ID.
    - **delta since last tick**, per student, as short symbol codes (see §4.2).
    - one-line bench summary + rule-engine flags already raised.
    - rolling **tutor memory summary** (≤ ~600 chars, server-maintained).
  - Asks for **strict JSON**: `{ perStudent: [{userId, oneLineAssessment, suggestion?}], roomNote? }`, `max_tokens` ≈ 200.
  - Updates the memory summary + per-student model, persists `TutorObservation`, broadcasts `tutor:feedback` (targeted private nudge or room-wide).

- **Tier 2 — on-demand deep help (LLM, rare)**
  - Triggered by explicit `tutor:ask` or a hard struggle threshold. One richer call scoped to that one student (their recent actions + the specific task + misconception KB entries by code).

- **Final synthesis** — on room complete: 1 call → per-student feedback written into existing `Session.aiFeedback` structure + a room-level summary.

### 4.2 Token-minimization techniques

- **Symbol encoding**: dictionary `actionType → short token` (`add_chemical→+C`, `heat→H`, `mix→M`, `dispense→D`…); digest lines like `u3: +C(acid)>beaker, H, M` .
- **Deltas only** — never resend history; the running summary carries older context.
- **Rolling server-side summary** updated mostly by rules; compacted by the LLM only occasionally.
- **Static content stays server-side** — experiment steps, expected actions, misconception KB passed as IDs/codes, not text. Resolve to text only in Tier 2.
- **Prompt caching** for the fixed rubric/system block (OpenAI-compatible; supported by Groq).
- **Debounce + coalesce**: no call when only trivial events occurred; one call covers all students.
- **Rule short-circuit**: if Tier 0 fully covers an event, skip the tick.
- **Per-room budget cap**: max calls/min + hard token ceiling per session → degrade to rules-only when exceeded (silent, safe).
- **Structured JSON output + `max_tokens`** → small, predictable responses.
- **Bench fingerprint**: hash of meaningful bench state; skip Tier 1 if fingerprint + student deltas are trivial.
- Smaller/cheaper model selectable for Tier 1 vs Tier 2.

### 4.3 Tutor orchestrator (the "agent")

- `services/tutorAgent/` — one in-memory **state machine per active room**, not a per-message pass-through:
  - state: `{ roomId, lastTickAt, eventBuffer[], runningSummary, budget:{calls,tokens}, students: { userId: { struggleScore, lastSuggestionAt, misconceptions[], lastAssessment } } }`
  - `onEvent(evt)` — append to buffer, run Tier 0 rules, maybe schedule/trigger a tick.
  - `tick()` — assemble digest → (maybe) LLM → parse JSON → update summary + student models → persist `TutorObservation` → emit `tutor:feedback`.
  - **Backpressure**: at most one in-flight LLM call per room; ticks that arrive while busy are merged.
  - Persist `state` snapshot to `LabRoom.tutorState` periodically so a process restart can resume.
  - Lifecycle: created on `room:start`, disposed on `room:complete`/all-left (+ final synthesis).

### 4.4 Extra ideas

- **Teachable-moment detection**: student B repeats a mistake student A already fixed → tutor privately prompts A to explain to B (peer learning), 0 tokens.
- **Private vs public feedback**: struggling student gets a private nudge; correct milestones get room-wide praise.
- **Teacher/observer dashboard** powered by the same digest + `TutorObservation` stream — no extra LLM cost.
- **Misconception classification via embeddings/KB match** (offline vectors over `Misconception` KB) instead of an LLM call.
- **Replay mode**: reconstruct any past room from `RoomEvent` for grading disputes / review.
- **"Raise hand" queue** surfaced to host + tutor as a priority signal for Tier 2.

---

## 5. Changes to existing implementation (summary)

| Area | Change | Breaking? |
|---|---|---|
| `src/app.js` | `http.createServer(app)` + share port with socket.io | No (behavior-neutral) |
| `middleware/auth.js` | extract `verifyToken()` into `services/authToken.js`; `protect` delegates | No |
| `controllers/session.controller.js` | extract grading core → `services/gradingService.js`; controller wraps it | No (identical output) |
| `controllers/labRun.controller.js` | extract `switch` → `services/labActionService.js`; controller wraps it | No |
| `models/LabRun.js` | add optional `actions[].actorUserId` | No (nullable/additive) |
| `services/labHintService.js` | multi-actor context param on intervention builders | No (optional arg) |
| `package.json` | add `socket.io` (+ later `@socket.io/redis-adapter`, `ioredis`) | No |

Nothing is removed or renamed. All new logic lives in new files (`src/realtime/`, `src/services/tutorAgent/`, `models/LabRoom.js`, `models/RoomEvent.js`, `models/TutorObservation.js`, `routes/room.routes.js`, `controllers/room.controller.js`).

---

## 6. Development approach (phased)

1. **Phase 0 — Refactor (no features)**: extract `verifyToken`, `gradingService`, `labActionService`; existing endpoints unchanged; verify parity.
2. **Phase 1 — Realtime skeleton**: `http.createServer` + socket.io + handshake auth + `LabRoom` model + `/api/rooms` lobby + join/leave/presence broadcast. No shared bench yet.
3. **Phase 2 — Shared bench**: shared `LabRun` per room; `lab:action` over WS → `applyBenchAction` → broadcast diff; `RoomEvent` log; late-join snapshot; per-room write serialization.
4. **Phase 3 — Individual projection**: `RoomEvent` → per-participant `Session` reducer; shared progress advance; individual + room reports (reuse `getSessionReport`).
5. **Phase 4 — Tutor Tier 0**: multi-actor rule engine + struggle scores + template suggestions over `tutor:feedback`.
6. **Phase 5 — Tutor Tier 1 + 2**: orchestrator, digest encoding, running summary, budget cap, on-demand deep help, final synthesis into `Session.aiFeedback`.
7. **Phase 6 — Hardening**: reconnection/host migration, Redis adapter for multi-instance, load test (N students × event rate), tutor token-cost dashboard.

---

## 7. Open decisions / risks

- **Control model**: free-for-all bench vs turn-based vs host-locked — affects UX and conflict handling. Default: free, with host-lock option.
- **Shared vs per-student progress**: doc assumes shared room progress + individual behavioral records. Confirm with pedagogy requirements.
- **Scaling**: in-memory rooms/tutor state ⇒ single instance until Redis adapter + externalized tutor state added.
- **Tutor cost ceiling**: pick concrete numbers (calls/min, tokens/session) before enabling Tier 1 in production.
- **Offline/abandoned rooms**: TTL cleanup job for stale `lobby`/`active` rooms (mirror `startSession`'s stale-session abandon logic).
