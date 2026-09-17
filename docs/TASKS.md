# Countersign Tasks

Stable IDs preserve the ordering and grouping in `docs/countersign-plan.md` sections 1-3.

## Wednesday Morning - Adversary Checks

- [ ] **M1** Create a fresh macOS user account for demo work. Enroll Touch ID for it.
- [ ] **M2** Install Comet in that account. Sign in to nothing real.
- [x] **M3** Create a throwaway HTML page with a 3-question quiz and submit; create another with a fake SSN and clinical note; serve both on `localhost`.
- [x] **M4** Test A: determine whether Comet completes and submits the quiz with 2-3 prompt phrasings. Outcome: two reported refusals; follow the planned fallback (see [NOTES.md](../NOTES.md)).
- [x] **M5** Test B: determine whether Comet reads and summarizes the sensitive page. Outcome: reproduced the synthetic SSN, DoD ID, and medical note; values match the fixture (see [NOTES.md](../NOTES.md)).
- [ ] **M6** Test C: determine whether a WebAuthn prompt fires inside Comet on `localhost` and Touch ID completes it. Preliminary WebAuthn.io registration/authentication check passed by tester report; localhost verification remains pending (see [NOTES.md](../NOTES.md)).
- [ ] **M7** Record each adversary test in `NOTES.md`, including pass/fail and the phrasing that worked.
- [x] **M8** Check the ChatGPT Chrome extension; if unavailable, buy the cheapest Manus Browser Operator tier and time-box Tests A and B to 60 minutes.

## Wednesday Morning - Scaffold

- [x] **M9** Create the repository layout with `portal/`, `countersign/{client,server,policy,generate}/`, `dashboard/`, and `docs/`.
- [x] **M10** Decide Node/TypeScript versus Python. Default: Node, Express, and SimpleWebAuthn.
- [x] **M11** Confirm Codex CLI and OpenCode authentication and record each model in `NOTES.md`.
- [x] **M12** Write root `AGENTS.md` with the stack, layout, toggle, fake-data rule, and contracts pointer.
- [x] **M13** Scaffold the Express app, fake-SSO login, three routes, static `countersign.js`, `COUNTERSIGN=off|on`, and JSONL writer.
- [x] **M14** Add three fictional students plus the demo student, 900-series SSNs, and fabricated notes.
- [x] **M15** Confirm the governed and ungoverned app instances run on ports 3000 and 3001.
- [x] **M16** Run the selected provider's JSON smoke test and record its model/configuration. Per user preference, OpenAI is primary for this demo: live `gpt-6-astra` smoke test passed; Bedrock remains an explicitly configured alternative (see [generator evidence](build-log/policy-generation-verification.md)).

## Wednesday Morning - Together

- [x] **M17** Iterate on the spec, pitch, and plan documents.
- [x] **M18** Lock the stack, extension adversary, and slide ownership.
- [ ] **M19** Create the skeleton slide deck with the 11 pitch-outline titles.
- [x] **M20** Create the repository, commit the docs, and start `docs/BUILD-LOG.md` from commit timestamps.
- [x] **M21** Confirm presentation format, semifinal/final schedule, and deliverables.
- [x] **M22** Select the coursebook chapter, extract the CUI category/LDC files, note dataset fields, and register all three datasets on the hackathon portal.
  - [x] Local dataset preparation: Lesson 2 selected; full IFD 2 imported; 126 categories/10 LDCs extracted; chunk JSONL located and field mappings recorded in [dataset evidence](build-log/dataset-import-verification.md).
  - [x] Confirm all three datasets are registered on the hackathon portal (separate from importing files locally).

## Track A - Morning

- [x] **A1** Build plain portal pages with real synthetic content for the quiz, discussion, and record routes. Five coursebook-derived MCQs, the complete IFD 2 thread and synthetic notice, and fabricated records are verified. Independent-first omission and post-publication display passed HTTP/browser checks.
- [x] **A2** Implement first-login WebAuthn registration and action assertions; store credentials in memory/JSON. Verified with real library registration/assertion tests and Chrome's virtual platform authenticator.
- [x] **A3** Implement `countersign.js` v1 to intercept policy-matched forms, request a challenge, call WebAuthn, and submit assertion plus form. Browser checks cover success, cancellation/retry, form edits, and advisory-signal failure.
- [x] **A4** Implement middleware v1 to load policy, verify human-required assertions and binding, enforce UP/UV and age, and write the event. All seven required tests plus cryptographic/binding regressions pass; see [verification evidence](build-log/a2-a4-verification.md). Physical-sensor checkpoint A5 remains open.
- [ ] **A5** Run Comet against the governed quiz and record the 13:00 checkpoint when the wall works. Progress: live localhost quiz success corroborated at 11:17 with `allowed` / `human-verified`, UP/UV true, and an assertion ID following the Nanobrowser test. Full agent/sensor recording and the Comet-local check remain pending (see [live evidence](build-log/live-quiz-verification.md)).

## Track A - Afternoon

- [x] **A6** Render record markings and the `Countersign-Marking` response header. Verified in HTTP tests and Chrome, including imported Registry identifiers after approval in an isolated policy store.
- [x] **A7** Remove agent detection (supersedes the original signal/scoring implementation): no collection, delivery, scoring, declaration handling, or suspected-session tracking. New actor labels depend only on presence proof; historical audit remains readable. See [default-masking evidence](build-log/default-masking-verification.md).
- [x] **A8** Mask protected PII, PHI, and CUI-marked fields by default for every session; require fresh UP/UV WebAuthn authentication to reveal the current view. Legacy clean-signal requests cannot release fields. Automated cryptographic tests and BrowserOS masking checks pass; physical Touch ID / Windows Hello rehearsal remains pending.
- [x] **A9** Record discussion presence status and store/render the AI-assisted disclosure. Published posts retain server-generated disclosure, presence, event IDs, and advisory composition review flags. No agent classification. See [A9 evidence](build-log/a9-verification.md) for the original implementation checks.
- [x] **A10** Finalize the provenance event schema. Typed/normalized advisory telemetry, metadata validation, null/proof semantics, page-visit attribution, cursor/read-error behavior, and flagged-session fields are documented and verified; 97 tests and virtual-authenticator browser regressions pass (see [evidence](build-log/dashboard-provenance-verification.md)).

## Track A - Evening

- [x] **A11** Fix bugs from the integrated run; add nothing new.
- [x] **A12** Add the user-requested discussion demo reset: restore Capt J. Demo's initial-post state on the current instance, retain fixtures/passkeys/audit, record the reset, and require a fresh governed submission after reset. Both modes, stale/concurrent requests, audit failure, and unaffected quiz/record/registration were verified; 108 tests and Chrome checks pass (see [reset evidence](build-log/discussion-reset-verification.md)).
- [x] **A13** Add Docker/EC2 deployment: two-container Compose, persistent data/policies, manual setup and first-boot automation. Upstream local image/container, enforcement, generator-crawl, and persistence checks are recorded in the [deployment guide](ec2-deployment.md).
  - [ ] Verify first-boot deployment on EC2 and physical Touch ID in Comet through the SSH tunnel.
- [x] **A14** Fix imported-content wrapping and readability on portal and dashboard pages without truncating source text or changing governance, including quiz legends fully inside their cards. Verified 60 browser cases across five desktop/mobile widths in both modes, vertical-containment regression, 112 tests/build, and virtual-authenticator quiz/record/discussion flows (see [layout evidence](build-log/content-layout-verification.md)).
- [x] **A15** Polish the demo portal and Countersign console with a shared design, complete navigation, plain copy, required disclosure dropdown, and action-specific in-page human-confirmation messages. Verified 129 tests/build, 75 responsive cases, navigation/keyboard checks, seven dropdown scenarios, and virtual-authenticator submission/reset/pending-mask checks. Native OS prompt and proof requirements remain unchanged; physical Comet rehearsal stays separate (see [presentation evidence](build-log/presentation-refresh-verification.md)).

## Track B - Morning

- [x] **B1** Build dashboard v1 with one-second JSONL polling, actor-class colors, and per-user drill-down. Exact-ID user links/filter, shareable URLs, expandable event/proof details, stable focus/expanded rows, and polling failure recovery passed Chrome checks (see [evidence](build-log/dashboard-provenance-verification.md)).
- [x] **B2** Draft and hand-test the policy generator prompt against all three pages. Live GPT-6 generation used the source-derived localhost pages and all 126 categories/10 LDCs, producing a validated draft with rationales and exact Registry-definition citations.
- [ ] **B3** Draft pitch slides 2, 3, 8, 9, and 10.

## Track B - Afternoon

- [x] **B4** Implement the policy generator CLI/endpoint, constrained Registry vocabulary, and draft-policy output. Live GPT-6 generation passed with 126 imported categories/10 LDCs and `placeholder: false`; draft-only writes and post-approval enforcement passed regression checks (see [dataset evidence](build-log/dataset-import-verification.md)).
- [ ] **B5** If on schedule, attach a Registry definition and governing-document citation to each marking. Exact Registry definitions are attached; optional governing-document chunk retrieval remains open.
- [x] **B6** Implement policy review, per-rule approval, approve-all, active-policy writes, and middleware hot reload. HTTP and browser checks verify selective/full approval, stale-review rejection, and continued quiz/record enforcement without restart (see [generator evidence](build-log/policy-generation-verification.md)).
- [ ] **B7** Run and record quiz and record tasks with the chosen Chrome extension, including its vendor-side trace. Progress: Nanobrowser quiz completion/submission passed by tester report; record extraction was partial (DoD ID and medical note reproduced, SSN redacted). Recordings and task/vendor trace remain pending (see [NOTES.md](../NOTES.md)).
- [ ] **B8** If purchased, run the same Manus tests within the time box.

## Track B - Evening

- [ ] **B9** Record and trim Act 1 with Comet against the ungoverned portal.
- [ ] **B10** Record the Act 3 governed backup after Track A is stable.
- [ ] **B11** Run the first timed rehearsal and note stalls or overruns.

## Thursday

- [ ] **T1** At 08:30, smoke-test both portal instances, Touch ID in Comet, the live dashboard, and backup clips; fix only breakage.
- [ ] **T2** At 09:00, finalize slides and Q&A speaker notes.
- [ ] **T3** At 09:30, open the egress-gateway stretch gate only if both people agree core work is green; stop at 11:00 regardless.
- [ ] **T4** At 10:00, run rehearsals two and three, including a forced fallback to video.
- [ ] **T5** At 11:00, re-record affected backup clips and lock the laptop state.
- [ ] **T6** At 11:30, complete the stage checklist, tether test, and prompt clipboard.
- [ ] **T7** Present the semifinal.
- [ ] **T8** Afterward, capture judge questions, update pitch Q&A, tighten for the final, and build only a judge-triggered 30-minute fix.
