# Scaffold prompt — Countersign

Paste everything below the line into Codex CLI or OpenCode with the repo open (AGENTS.md at root, design docs in `docs/`). If using ChatGPT directly, attach `AGENTS.md`, `docs/countersign-spec.md`, `docs/countersign-plan.md`, `docs/contracts.md`, and `docs/webauthn-notes.md`, and ask for the output as a file tree with full file contents.

---

You are scaffolding a hackathon project called **Countersign**. Read these files completely, in this order, before writing anything:

1. `AGENTS.md` — project conventions. Treat every rule in it as binding.
2. `docs/contracts.md` — the interfaces. Endpoint paths, JSON shapes, enum values, and npm script names are exact; do not rename or "improve" them.
3. `docs/webauthn-notes.md` — the WebAuthn configuration and the seven required tests.
4. `docs/countersign-spec.md` §5, §6, §7, §8, §11 — design detail when the contracts need context.
5. `docs/countersign-plan.md` §2 — the task list.

## Your task

Produce a **working skeleton**, not a finished product. Scaffold means: the app starts, every route responds, every endpoint exists, every interface from `contracts.md` has a stub that returns the right shape, and the pieces that are trivial are actually implemented. Two engineers will implement the rest in parallel tracks starting from your output, so consistency and correct interfaces matter more than functionality.

### Implement fully (these are simple and the tracks depend on them)

- `package.json` with pinned dependencies and exactly these scripts: `dev`, `dev:ungoverned`, `generate`, `test`, `build`. `dev` runs the governed instance (`COUNTERSIGN=on`, port 3000); `dev:ungoverned` runs the same code with `COUNTERSIGN=off` on port 3001. One command each. Use `tsx` or equivalent so there's no build step during development.
- Express app in TypeScript with the directory layout from `AGENTS.md` §3.
- Fake SSO login at `/login`: a page listing the users in `portal/data/students.json`; clicking one sets a signed session cookie. No passwords.
- Three portal routes rendering placeholder content from fixtures: `/quiz/1` (5 MCQs from `quiz.json` with a submit form), `/discussion/2` (faculty prompt + existing posts from `forum.json`, plus a post form for the demo student who has no posts yet; peers hidden until the demo student has posted — `independent_first`), `/record/1` (student record with `data-field` and `data-marking` attributes per `contracts.md` §2).
- The `COUNTERSIGN=on|off` toggle as middleware that is fully bypassed when off.
- Provenance log writer: one function that appends one JSONL line to `data/provenance.jsonl` matching the event shape in `contracts.md` §1, with an ID and timestamp generated. Wire it so that visiting any governed route while `COUNTERSIGN=on` writes one `unrestricted` / `unverified` event, proving the pipeline works end to end.
- Policy loader: reads `countersign/policy/countersign.policy.json`, validates the schema in `contracts.md` §2, rejects any `marking` or `page_marking` identifier not present in `data/cui/categories.json` or `data/cui/ldcs.json`, and exposes `matchRule(route, action, ctx)`. Ship an initial policy file with the three rules from `contracts.md` §2 and placeholder markings, plus placeholder `data/cui/*.json` files containing two or three obviously-fake entries clearly marked `"placeholder": true` so the loader runs until the real dataset is extracted.
- `countersign.js` (vanilla JS, no build step) that: finds forms with `data-countersign-rule`, intercepts submit, computes the canonical form hash per `contracts.md` §6, posts signals per §4 on page load, and calls the challenge and submit flow per `webauthn-notes.md` §3.2 using `@simplewebauthn/browser` loaded from a local copy under `countersign/client/vendor/`. The WebAuthn calls may hit stubbed endpoints for now; the client code should be complete.
- `.env.example` listing every variable: `COUNTERSIGN`, `PORT`, `SESSION_SECRET`, `LLM_PROVIDER`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. `.gitignore` covering `.env`, `data/provenance.jsonl`, `data/credentials.json`, `node_modules`, and any PDF.

### Stub with correct shapes (the tracks implement these)

- All `/countersign/webauthn/*`, `/countersign/challenge`, `/countersign/signals`, `/countersign/unmask*`, `/countersign/events`, `/countersign/sessions/flagged`, `/countersign/policy*` endpoints from `contracts.md` §3. Each returns the documented response shape with obviously-placeholder values, or `501 { "error": "not_implemented" }` where no sensible placeholder exists. Put the WebAuthn stubs in `countersign/server/webauthn.ts` with the `RP` constant from `webauthn-notes.md` §1 already defined and the SimpleWebAuthn imports in place.
- Governed-route middleware per `contracts.md` §3 "Governed form submission": the ordering of checks should be present as named functions that currently pass through, with a `// TODO(track-a)` on each.
- Signal scoring in `countersign/server/signals.ts`: the weighted-sum shape with weights read from policy `defaults.signals`, returning a fixed 0.0 for now.
- Composition telemetry collection in `countersign.js` per `contracts.md` §5: collect the fields, send them; scoring is server-side and stubbed.
- Policy generator entry point `countersign/generate/index.ts` and `countersign/generate/llm.ts` with the `LLM_PROVIDER` switch and one function `complete(prompt): Promise<string>` implemented for `openai` and `bedrock` (use the AWS SDK v3 `BedrockRuntimeClient`; the region and model ID come from env) and stubbed for `anthropic`. The generator itself should read the fixtures, build a prompt skeleton, and write a draft policy that is just a copy of the active policy for now, with `// TODO(track-b)`.
- Dashboard at `/countersign/` (server-rendered, minimal HTML, no CSS framework): a page that polls `/countersign/events` every second and renders rows. Policy review page stubbed with the draft/active JSON side by side.
- Tests: `countersign/server/__tests__/webauthn.test.ts` with the seven cases from `webauthn-notes.md` §6 as `test.todo(...)` entries plus one passing test that the log writer produces a valid event, and `policy.test.ts` with one passing test that the loader rejects an unknown marking identifier.

### Markdown files to create

- `README.md`: what Countersign is (three sentences), the name in two sentences, architecture diagram (copy from the spec §6), how to run both instances, how to run the generator and tests, demo walkthrough (ungoverned on :3001 then governed on :3000; the three pages and what each demonstrates), datasets used with the caveats from `AGENTS.md` §7 verbatim, non-goals (spec §3 condensed to five bullets), status ("hackathon prototype, built in 1.5 days"), team. No marketing tone.
- `docs/TASKS.md`: every checkbox from `docs/countersign-plan.md` §1 (the Wednesday morning block), §2 (Track A and Track B), and §3, as a flat checklist with stable IDs — `M1…` for morning, `A1…` for Track A, `B1…` for Track B, `T1…` for Thursday — so commit messages can reference them. Preserve the order and grouping from the plan.
- `docs/BUILD-LOG.md`: a table with columns Timestamp · Milestone · Evidence (path under `docs/build-log/`), seeded with one row for the initial docs commit (use `git log` for the timestamp) and one for this scaffold.
- `docs/build-log/.gitkeep`.

### Rules

- Follow `AGENTS.md` §5, §6, and §7 exactly: commit directly to main, no PRs; fake data only, 900-series SSNs, no secrets, pinned dependencies, no new dependencies without a one-line reason in your summary.
- Do not implement the WebAuthn verification logic, agent scoring, masking, attestation UI, or the real policy generator. Those are the tracks' work; leave clear `// TODO(track-a)` / `// TODO(track-b)` markers.
- Do not add a database, a frontend framework for the portal, a CSS framework, Docker, CI, or anything not listed here.
- Do not ask clarifying questions. Where the docs leave something open, choose the simplest option that satisfies the contracts and list it under "Assumptions" at the end.
- Do not modify anything in `docs/` except to create `TASKS.md`, `BUILD-LOG.md`, and `build-log/`. Do not modify `AGENTS.md`.

### When you finish

1. Run `npm install`, `npm test`, and start both instances; confirm `/login`, all three portal routes, `/countersign/policy`, and `/countersign/` respond on :3000 and that :3001 serves the same pages with no `countersign` middleware active and no log events written.
2. Commit as `scaffold: Countersign skeleton per docs/contracts.md` and append the BUILD-LOG row.
3. Report: the file tree; what is implemented vs stubbed; every `TODO(track-a)` and `TODO(track-b)` location; the assumptions you made; the exact SimpleWebAuthn version installed and any option names that differ from `docs/webauthn-notes.md`.
