# Countersign Tasks

Stable IDs preserve the ordering and grouping in `docs/countersign-plan.md` sections 1-3.

## Wednesday Morning - Adversary Checks

- [ ] **M1** Create a fresh macOS user account for demo work. Enroll Touch ID for it.
- [ ] **M2** Install Comet in that account. Sign in to nothing real.
- [ ] **M3** Create a throwaway HTML page with a 3-question quiz and submit; create another with a fake SSN and clinical note; serve both on `localhost`.
- [ ] **M4** Test A: determine whether Comet completes and submits the quiz with 2-3 prompt phrasings.
- [ ] **M5** Test B: determine whether Comet reads and summarizes the sensitive page.
- [ ] **M6** Test C: determine whether a WebAuthn prompt fires inside Comet on `localhost` and Touch ID completes it.
- [ ] **M7** Record each adversary test in `NOTES.md`, including pass/fail and the phrasing that worked.
- [ ] **M8** Check the ChatGPT Chrome extension; if unavailable, buy the cheapest Manus Browser Operator tier and time-box Tests A and B to 60 minutes.

## Wednesday Morning - Scaffold

- [x] **M9** Create the repository layout with `portal/`, `countersign/{client,server,policy,generate}/`, `dashboard/`, and `docs/`.
- [x] **M10** Decide Node/TypeScript versus Python. Default: Node, Express, and SimpleWebAuthn.
- [ ] **M11** Confirm Codex CLI and OpenCode authentication and record each model in `NOTES.md`.
- [x] **M12** Write root `AGENTS.md` with the stack, layout, toggle, fake-data rule, and contracts pointer.
- [x] **M13** Scaffold the Express app, fake-SSO login, three routes, static `countersign.js`, `COUNTERSIGN=off|on`, and JSONL writer.
- [x] **M14** Add three fictional students plus the demo student, 900-series SSNs, and fabricated notes.
- [x] **M15** Confirm the governed and ungoverned app instances run on ports 3000 and 3001.
- [ ] **M16** Run the Bedrock GovCloud smoke test, record model and region in `NOTES.md`, and confirm the OpenAI fallback.

## Wednesday Morning - Together

- [x] **M17** Iterate on the spec, pitch, and plan documents.
- [ ] **M18** Lock the stack, extension adversary, and slide ownership.
- [ ] **M19** Create the skeleton slide deck with the 11 pitch-outline titles.
- [x] **M20** Create the repository, commit the docs, and start `docs/BUILD-LOG.md` from commit timestamps.
- [ ] **M21** Confirm presentation format, semifinal/final schedule, and deliverables.
- [ ] **M22** Select the coursebook chapter, extract the CUI category/LDC files, note dataset fields, and register all three datasets on the portal.

## Track A - Morning

- [ ] **A1** Build plain portal pages with real synthetic content for the quiz, discussion, and record routes.
- [ ] **A2** Implement first-login WebAuthn registration and action assertions; store credentials in memory/JSON.
- [ ] **A3** Implement `countersign.js` v1 to intercept policy-matched forms, request a challenge, call WebAuthn, and submit assertion plus form.
- [ ] **A4** Implement middleware v1 to load policy, verify human-required assertions and binding, enforce UP/UV and age, and write the event.
- [ ] **A5** Run Comet against the governed quiz and record the 13:00 checkpoint when the wall works.

## Track A - Afternoon

- [ ] **A6** Render record markings and the `Countersign-Marking` response header.
- [ ] **A7** Implement browser signals, deterministic scoring, and page-load/pre-submit delivery.
- [ ] **A8** Mask marked fields at the threshold, implement step-up reveal, and log `unmask`.
- [ ] **A9** Detect discussion actor class and store/render the AI-assisted tag.
- [ ] **A10** Finalize the provenance event schema.

## Track A - Evening

- [ ] **A11** Fix bugs from the integrated run; add nothing new.

## Track B - Morning

- [ ] **B1** Build dashboard v1 with one-second JSONL polling, actor-class colors, and per-user drill-down.
- [ ] **B2** Draft and hand-test the policy generator prompt against all three pages.
- [ ] **B3** Draft pitch slides 2, 3, 8, 9, and 10.

## Track B - Afternoon

- [ ] **B4** Implement the policy generator CLI/endpoint, constrained Registry vocabulary, and draft-policy output.
- [ ] **B5** If on schedule, attach a Registry definition and governing-document citation to each marking.
- [ ] **B6** Implement policy review, per-rule approval, approve-all, active-policy writes, and middleware hot reload.
- [ ] **B7** Run and record quiz and record tasks with the chosen Chrome extension, including its vendor-side trace.
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
