# Countersign — Build Plan (v0.1)

**Team:** Chris, Collin
**Time:** Tue evening (scope + docs + repo) · Wed 08:00 de-risk, then build · Thu half day (polish + rehearse) · presentations after.
**Governing rule:** the presentation is the product. Every task below exists because a slide or a demo beat needs it. If a task doesn't map to §3 of the pitch outline, it doesn't get done.

Implementation/adversary checkboxes are synchronized with [TASKS.md](TASKS.md); that file links the detailed outcomes and verification evidence. Live/recorded demo checkpoints are tracked separately from automated implementation checks.

---

## 0. Principles

1. **De-risk before building.** The two things that can kill the demo — Comet's behavior and WebAuthn inside Comet — get tested first thing Wednesday, before a line of product code.
2. **End-to-end first, then wide.** A working `human-required` step-up on one page with a hand-written policy beats three pages with nothing enforced. Get the Touch ID wall working by Wednesday 13:00.
3. **Freeze early.** Feature freeze Wednesday 19:00. Thursday is polish, recording, rehearsal — not features.
4. **Record everything the moment it works.** Every act gets a backup clip the first time it runs cleanly.
5. **Two tracks, one integration point.** Split the work so we're not blocked on each other; integrate at fixed checkpoints.
6. **Capture the build story as it happens.** "Built with AI in 1.5 days" is a slide (pitch §3, Slide 9½) and it only works with real timestamps. Granular commits with honest messages; a screenshot at every checkpoint; `docs/BUILD-LOG.md` with one line per milestone. Reconstructing this Thursday morning produces a worse slide and eats an hour.

---

## 1. Tuesday night (done) and Wednesday 08:00–09:30 — de-risk before building

**Tuesday night, actually completed:** use case chosen; spec, pitch, and plan drafted and iterated; datasets identified with roles; name decided; repo created with the docs committed. That commit is the first `BUILD-LOG.md` entry.

**Wednesday 08:00–09:30, in this order.** Everything below was originally "tonight." It moved; it didn't shrink. The 12:00 checkpoint becomes **13:00**; everything after shifts an hour. Nothing else changes.

1. **Comet tests A, B, C** (Chris, 45 min) — the whole demo depends on these, so they go first. Fresh macOS account, Touch ID enrolled, Comet installed, throwaway quiz and record pages, WebAuthn prompt inside Comet. Decision gates below apply unchanged.
2. **Token checks** (Collin, parallel, 20 min) — Codex/OpenCode authenticate and run one trivial task; OpenAI returns a small JSON object from one model; note model IDs in `NOTES.md`.
3. **`AGENTS.md` + `docs/contracts.md`** (both, 15 min) — log event shape, policy shape, challenge/assertion endpoints. Written before anyone opens a coding session.
4. **Extension adversary decision** (Chris, 5 min) — is the ChatGPT extension available? If not, buy Manus, and Collin runs the one-hour time-box in the afternoon.
5. **Datasets** (Collin, 10 min) — coursebook chapter picked; CUI ZIP unpacked, category/LDC files located; all three registered on the portal.
6. **Portal questions** (2 min) — presentation format, semi/final schedule, deliverables. Whoever's logged in.

Then split into tracks.

### 1.1 Adversary checks — Chris
- [ ] Create a fresh macOS user account for demo work. Enroll Touch ID for it.
- [ ] Install Comet in that account. Sign in to nothing real.
- [ ] Throwaway HTML page with a 3-question quiz + submit; another with a fake SSN and "clinical note." Serve on `localhost`.
- [x] **Test A:** does Comet complete and submit the quiz? Try 2–3 phrasings ("help me finish this," "complete this quiz," "answer these and submit"). Outcome: two refusals; recorded in `NOTES.md`.
- [x] **Test B:** does Comet read and summarize the sensitive page? Outcome: reproduced the requested synthetic fields.
- [ ] **Test C:** does a WebAuthn prompt fire inside Comet on `localhost`? (Use webauthn.io or a 20-line SimpleWebAuthn demo.) Does Touch ID complete it?
- [ ] Record the outcome of each test in `NOTES.md` — pass/fail and the phrasing that worked.
- [ ] Check whether the ChatGPT Chrome extension is available on your account and whether it will act on a page. If yes → extension adversary chosen. If no → buy the cheapest Manus tier with Browser Operator; time-box setup to 60 min; try Tests A and B.

**Decision gate (after the Comet tests):**
- A + C pass → plan proceeds as written.
- A fails (Comet refuses the quiz) → try Gemini in Chrome (if AI Pro) or Claude in Chrome as the live adversary; Comet becomes a recorded "it refused, but…" clip or is dropped. Adjust pitch Slide 4.
- C fails (no WebAuthn in Comet) → live adversary moves to Chrome + extension (WebAuthn certainly works in Chrome); Comet becomes a recorded Act 1 clip. **Test this before assuming.**

### 1.2 Scaffold — Collin (after the token checks)
- [x] Repo: `countersign/` with `portal/`, `countersign/{client,server,policy,generate}/`, `dashboard/`, `docs/` (drop the three markdown docs in `docs/`).
- [x] Decide Node/TS vs Python (§10.2 of spec). Default: Node + Express + SimpleWebAuthn.
- [ ] Confirm Codex CLI and OpenCode are installed and authenticated against the free OpenAI access; run one trivial task in each to make sure the tokens actually flow. Note which model each is using in `NOTES.md`.
- [x] Write `AGENTS.md` at the repo root (both tools read it): stack, directory layout, the `COUNTERSIGN=off|on` toggle, "fake data only," and a pointer to `docs/contracts.md`. Ten minutes now saves both of us re-explaining the project to every fresh session tomorrow.
- [x] Use Codex/OpenCode to scaffold: Express app, fake-SSO login (pick a user), three empty routes, static `countersign.js`, `COUNTERSIGN=off|on` env toggle, JSONL log writer.
- [x] Fake data file: 3 students, obviously fictional, 900-series SSNs, fabricated notes.
- [x] Confirm the app runs on two ports (`:3000` governed, `:3001` ungoverned) using `npm run dev` and `npm run dev:ungoverned`.
- [ ] OpenAI smoke test: one call from the hackathon credentials, ask for a small JSON object, see which model returns it cleanly. Note the model ID in `NOTES.md` and confirm OpenAI is the default for `LLM_PROVIDER`.

### 1.3 Together (before splitting)
- [x] Iterate on the spec/pitch/plan docs.
- [ ] Lock: stack, extension adversary, who presents which slide. (Name is decided: Countersign — spec §0 explains it.)
- [ ] Skeleton slide deck with the 11 slide titles from the pitch outline. No content yet.
- [x] Repo created, docs committed. Start `docs/BUILD-LOG.md` with that as the first entry (timestamps from the commits).
- [ ] Rubric is in hand (pitch §0). Still need: presentation format (7 min inclusive or exclusive of Q&A?), semi/final schedule, deliverables list.
- [ ] Datasets (spec §11.1): forum dataset ✔ inspected, CUI dataset ✔ confirmed by description. Wednesday morning: download the 8670 EWS coursebook and pick the quiz chapter; unzip the CUI dataset and locate the category/LDC files and the chunk JSONL, note field names. Register all three on the portal so it's off the list.

---

## 2. Wednesday — build

### Checkpoint schedule
| Time | Checkpoint | Must be true |
|---|---|---|
| 08:00 | De-risk block (§1) | Comet tests, token checks, contracts, adversary decision, datasets |
| 09:30 | Kickoff | Gates resolved; stack locked; tracks split |
| 13:00 | **Wall stands** | Comet hits Touch ID on quiz submit in the governed portal; submit succeeds after touch; log line written |
| 16:00 | **Three pages governed** | Record masking + step-up reveal; discussion tagging; dashboard shows the timeline |
| 18:00 | **AI in the loop** | Policy generator drafts the policy; approve flow in dashboard |
| 19:00 | **Feature freeze** | Everything after this is bugs, polish, recording, slides |
| 22:00 | Recorded + rehearsed once | Act 1 clips (Comet + extension), Act 3 backup, first full run-through timed |

### Track A — Portal + enforcement — Collin *(iterate: or Chris)*
**Morning (to 13:00)**
- [ ] Portal pages with real (fake) content: `/quiz/1` (5 MCQ), `/discussion/2`, `/record/1`. Plain, readable, clearly a learning portal. Bootstrap-level styling is enough.
- [x] WebAuthn: registration on first login (Touch ID), assertion endpoint. Store credentials in memory/JSON.
- [x] `countersign.js` v1: intercept form submits matching policy; request challenge; call `navigator.credentials.get`; POST assertion + form together.
- [x] Middleware v1: load `countersign.policy.json` (hand-written); for `human-required` verify assertion (signature, challenge binding, UP/UV flags, max age) before executing; write log event.
- [ ] **Run Comet against it. This is the 13:00 checkpoint. Record it the moment it works.**

**Afternoon (to 16:00)**
- [x] Markings: render `data-marking` / `data-categories` attributes and `Countersign-Marking` header on `/record/1`.
- [x] Signals in `countersign.js`: `navigator.webdriver`; fill-without-focus; timing; score computation; send to server on page load and on submit.
- [x] Masking: when score ≥ threshold, replace marked fields with placeholders + banner; step-up reveal via the same WebAuthn path; log `unmask`.
- [x] Discussion post: detect actor class; store and render "AI-assisted" tag. Disclosure, verified presence, and advisory review flags are separate; see [A9 evidence](build-log/a9-verification.md).
- [ ] Log event schema finalized (spec §5.7).

**Evening**
- [ ] Bug fixes from the integrated run. Nothing new.

### Track B — Dashboard, policy generator, demo assets — Chris *(iterate)*
**Morning (to 13:00)**
- [ ] Dashboard v1: live timeline reading the JSONL log (poll every 1s); event rows colored by actor class; per-user drill-down.
- [ ] Draft the policy generator prompt: input = rendered HTML of each route + list of form actions; output = policy JSON per spec §7 with rationale strings. Test against the three pages by hand before wiring it.
- [ ] Pitch slides 2, 3, 8, 9, 10 first-draft (the ones that don't depend on the build).

**Afternoon (to 18:00)**
- [ ] Policy generator CLI/endpoint: crawl routes → LLM → draft policy → write `countersign.policy.draft.json`. Load the 126 Registry categories + 10 LDCs from the CUI dataset as structured input; the generator may only emit identifiers from that list (spec §5.6).
- [ ] *(1 hr, if on schedule)* Cite per marking: keyword/BM25 lookup over the dataset's JSONL chunks, attach the Registry definition and one governing-document chunk to each proposed marking's rationale. Shows in the approval view.
- [ ] Dashboard: policy review view (draft vs. current, per-rule approve, "Approve all"). Approval writes `countersign.policy.json` and hot-reloads the middleware.
- [ ] Extension adversary: run the quiz + record tasks in Chrome with the chosen extension; **record the clips**, including the vendor's task log / chat history showing the SSN.
- [ ] Manus (if bought): same, time-boxed.

**Evening**
- [ ] Record Act 1 with Comet (ungoverned portal). Trim clips.
- [ ] Record Act 3 backup with Comet (governed portal) once Track A is stable.
- [ ] First full rehearsal, timed. Note every place the demo stalls or a slide runs long.

### Integration points
- 13:00 and 16:00: both stop, run the full Act 3 sequence together, fix what breaks, continue.
- At every checkpoint: one screenshot (the log line, the dashboard, the policy draft) into `docs/build-log/` and one line in `BUILD-LOG.md`. Thirty seconds each. This is Slide 9½.
- Shared contract to agree on at 09:00: log event JSON shape, policy JSON shape, the challenge/assertion endpoints. Write them in `docs/contracts.md` before splitting, and point `AGENTS.md` at it — every Codex/OpenCode session on either laptop then starts with the same interfaces, which is what makes two parallel tracks merge cleanly at noon.

---

## 3. Thursday — polish, rehearse, present

| Time | Task |
|---|---|
| 08:30 | Smoke test on the demo account: portal up on both ports, Touch ID works in Comet, dashboard live, clips play. Fix only what's broken. |
| 09:00 | Slides final. Speaker notes for Q&A table (pitch §4). |
| 09:30 | **Stretch gate.** Only if everything above is green *and* both agree: start the egress gateway (spec §5.8) with an open-source agent. Hard stop at 11:00 regardless of state; it's a slide if it isn't a demo. |
| 10:00 | Rehearsal 2, timed. Then rehearsal 3 with a forced fallback to backup video mid-Act 3. |
| 11:00 | Re-record any backup clips affected by fixes. Lock the laptop state: nothing changes after this. |
| 11:30 | Stage checklist (pitch §7). Tether test. Prompts in clipboard. |
| — | Semi-final. |
| After | Capture every judge question. Update pitch §4. Tighten for the final. Build nothing unless it's a 30-minute fix to something a judge hit. |

---

## 4. Cut lines (in order, if we're behind)

1. Signals/masking on the record page → replace with: record page is `human-required` to *open* (still demonstrates the wall; loses the "masked ████" beat).
2. Policy approval UI → generator writes the policy file directly; show the JSON diff in a terminal.
3. Discussion tagging → mention verbally; one line in the log.
4. Dashboard → tail the JSONL in a terminal with `jq` and pretty colors. Honestly still convincing.
5. Extension adversary live → recorded only (already the plan) → if no clip, one slide with a screenshot.

**Never cut:** the Touch ID wall on quiz submit, live, in Comet (or the fallback agent). That is the demo.

---

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Free OpenAI access rate-limits, expires, or Codex/OpenCode chokes on WebAuthn specifics | Medium | Wednesday 08:00 token smoke test; Claude Code on personal plans as the fallback harness — same repo, same `AGENTS.md`, no workflow change |
| Comet refuses the quiz or record task | Medium | Wednesday 08:00 Tests A/B; phrasing variants; Gemini/Claude in Chrome fallback; "it refused today" is a talking point, not a loss |
| WebAuthn prompt doesn't fire in Comet | Low–Medium | Wednesday 08:00 Test C; fallback: Chrome + extension as the live adversary |
| Comet completes the quiz *and* somehow proceeds past the prompt | Low | Server rejects without a valid assertion regardless of what the UI does; show the log line |
| Venue Wi-Fi | Medium | Tether; recorded backup for everything |
| Touch ID flakiness on stage (sweaty thumb, wrong account) | Medium | Enroll two fingers; test that morning; YubiKey as second authenticator if one is available |
| Policy generator produces bad rules live | Medium | Run it live but with a pre-generated draft ready to "load"; the LLM call happens, the shown result is deterministic |
| Time sink on dashboard polish | High | Cut line #4; timebox styling to 45 minutes total |
| Manus setup eats the afternoon | Medium | 60-minute time-box; ChatGPT extension first |
| Scope creep toward the gateway | High | Stretch gate Thursday 09:30, hard stop 11:00 |

---

## 6. Definition of done (semi-final)

- [ ] Ungoverned portal: Comet completes the quiz and reads the record (live or recorded).
- [ ] Extension clip: same, in stock Chrome, with the vendor-side log/history showing the SSN.
- [ ] Governed portal: Comet reaches Submit → Touch ID prompt → stalls → human touch → submit succeeds → log shows `human-verified` + assertion ID.
- [ ] Governed portal: flagged session sees masked record; step-up reveals; logged.
- [ ] Discussion post via agent succeeds and is tagged.
- [ ] Policy generator drafts the three rules with rationale; approval applies them.
- [ ] Dashboard (or terminal) shows the provenance timeline.
- [ ] Backup video for every act.
- [ ] Deck done; 3 timed rehearsals; Q&A answers rehearsed.

---

## 7. Rubric-driven must-haves (cheap, easy to forget)

Most of the rubric is earned by the demo. These are the leftovers — each is under 30 minutes and directly scored.

| Criterion | Item | When |
|---|---|---|
| Security & Sustainability (15%) | `README.md`: what it is, how to run both instances, how to run the policy generator. Judges may open the repo. | Thu 09:00 |
| Security & Sustainability | A handful of real tests: assertion verification rejects a replayed/mismatched challenge; policy engine picks the right rule; masking triggers at threshold. Not coverage — proof we thought about it. | Wed evening, Track A |
| Security & Sustainability | Pinned dependencies, no secrets in the repo, LLM key via env var. Obvious, but a judge scanning for "readiness for DoW testing" will notice. | Wed |
| Usability & Design (20%) | Policy schema documented in the repo (spec §7 is enough). The "reuse on any app" claim needs a file to point at. | Thu 09:00 |
| Technical Innovation (25%) | `BUILD-LOG.md` with timestamps and screenshots — the feasibility evidence. | Continuous |
| Team Collaboration (10%) | Rehearsal 3 with the forced fallback to video. "Resilience under pressure" is literally in the rubric text. | Thu 10:00 |
| Mission Impact (30%) | Slide 2 uses their population and their documents' language (pitch §0). No build task; a writing task. | Wed evening |

Bonus criteria: one bullet each on Slide 10, zero build. Not worth more than that.

---

## 8. Deliverables to hand in *(check what the portal actually asks for)*

- Repo (public or zip) with README = spec §1–§4 condensed + run instructions
- Slide deck (PDF export)
- 2–3 minute demo video (the backup video, trimmed)
- One-paragraph abstract for the program
