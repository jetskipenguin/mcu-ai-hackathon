# Countersign

Countersign is a governance layer for web applications that declares which actions require a physically present human and which content is off-limits to AI. It enforces action-time presence checks, attaches machine-readable content markings, and records provenance for governed decisions. This repository contains a mock MCU Learning Portal, the Countersign middleware and client, a policy generator entry point, and a small dashboard.

## Name

A sentry asks for a countersign before allowing someone to pass, even when that person appears to have the right uniform. Here, an AI agent may carry the user's authenticated browser session, but only a human can answer the action-bound WebAuthn challenge.

## Architecture

```
┌────────────────────────── Student's laptop ────────────────────────────────┐
│  Browser (Comet / Chrome + extension)                                      │
│    └─ Agent (cloud LLM behind it) ──────────────────────────► public CSP   │
│    └─ Portal pages + countersign.js (signals, step-up UI, masking)         │
└─────────────────────────────────┬──────────────────────────────────────────┘
                                  │ HTTPS / localhost
┌─────────────────────────────────▼──────────────────────────────────────────┐
│  Mock "MCU Learning Portal" (the governed app)                             │
│    routes: /quiz  /discussion  /record/:id  /login                         │
│    ─ countersign middleware: policy eval, WebAuthn verify, markings,       │
│      provenance log                                                        │
│    ─ countersign.policy.json                                               │
├────────────────────────────────────────────────────────────────────────────┤
│  Countersign dashboard   /countersign/*   (timeline, flags, policy review) │
│  Policy generator        CLI/endpoint → LLM → draft policy                 │
│  (stretch) Egress gateway   sanctioned-agent → gateway → LLM               │
└────────────────────────────────────────────────────────────────────────────┘
```

## Run

Use Node.js 20.12 or newer for native `.env` loading. Install the pinned dependencies:

```sh
npm install
```

Run the two instances in separate terminals:

```sh
npm run dev
npm run dev:ungoverned
```

The governed instance is at `http://localhost:3000`; the ungoverned instance is at `http://localhost:3001`. Set `SESSION_SECRET` for a stable signed-cookie key across restarts; when omitted, the server creates an ephemeral development key. The instances use separate cookie names so logging into one does not replace the other's session.

Configure `.env` using the variable names in `.env.example`. Both server and CLI
load it automatically; exported shell variables take precedence. The selected
demo provider is `LLM_PROVIDER=openai` with `OPENAI_MODEL=gpt-6-astra`. Put the API
key only in the gitignored `.env` file. Restart the server after changing model
configuration. Bedrock and Anthropic are available through explicit provider
selection; their model IDs also come from configuration.

Run the provider smoke test, generator, and checks with:

```sh
npm run llm:smoke
npm run generate
npm test
npm run build
```

The generator signs into the local ungoverned portal, reads `/quiz/1`,
`/discussion/2`, and `/record/1`, and sends rendered HTML, form actions, and the
loaded vocabulary to the selected model. Keep port 3001 running and use a student
who has not posted an initial response. `GENERATOR_BASE_URL` and
`GENERATOR_USER_ID` configure that source (defaults: `http://localhost:3001` and
`stu-0011`). Responses are schema/identifier checked; supplied definitions are
attached as citations. Invalid output leaves the previous draft intact.

Review the result at **http://localhost:3000/countersign/policy/review** after
signing in. **Generate draft**, **Approve this rule**, **Approve selected**, and
**Approve all** are implemented. Partial approval preserves other rules and global
defaults; approve-all replaces the whole policy. Approval takes effect on the next
request without a restart. The demo's required quiz/discussion/record interfaces
are validated before activation. Generation itself never changes the active file.

The Registry lists now contain all **126 source categories and 10 LDCs**. To
reproduce the import from the supplied archive in the ignored `data/source/` folder:

```sh
unzip -q -n data/source/public-reference-corpus-portal-2026-09-13.zip -d data/source
npm run cui:import -- --corpus data/source/public-reference-corpus
npm run generate
```

The importer checks the expected 126 categories and 10 LDCs, definitions, and
unique IDs. It retains legacy identifiers for the existing active policy while
new drafts use the imported vocabulary. See [`data/cui/README.md`](data/cui/README.md).
The source files are available locally and the source-backed draft has passed a
live GPT-6 run. M22's separate hackathon-portal dataset registration still needs
confirmation. See [dataset import evidence](docs/build-log/dataset-import-verification.md).

## Demo Walkthrough

1. Open `http://localhost:3001/login`, choose `Capt J. Demo`, and visit the three portal pages without Countersign enforcement or provenance writes.
2. Open `http://localhost:3000/login` in the browser/profile used by the demo agent and choose the same user. First login redirects to `/register`: click **Register passkey with Touch ID** and complete registration. Use the **Register passkey** navigation link to add a credential if another profile cannot access the existing one. Credentials survive server restarts in gitignored `data/credentials.json`.
3. On `/quiz/1`, let the agent fill the form and submit. A fresh WebAuthn prompt requires human confirmation. After Touch ID, the page shows **Quiz submitted. Human presence verified.** The log records `presence-requested`, then `allowed` / `human-verified` with an assertion ID. Canceling leaves the form available for a fresh attempt; direct submissions without a valid assertion return a logged 403.
4. On `/discussion/2`, `independent_first` hides peer posts until the learner submits an initial response. Declare `own-work` or `ai-assisted` at Publish, then complete the presence check. The published post displays **Own work (declared)** or **AI-assisted (disclosed)** separately from **Human presence verified at submit**. Contradictions publish with **Flagged for review**; expand **Provenance details** for the assertion and matching event IDs. Seeded posts show **Provenance not recorded**. Demo posts/badges last for the current server run; the JSONL audit persists.
5. On `/record/1`, the `marking` rule withholds record fields until signal evaluation. A suspected-agent session sees placeholders and an **Automation suspected** banner. Register a passkey and select **Verify presence to view** to reveal the record using WebAuthn.
6. Open `/countersign/` on port 3000 to watch the provenance timeline. Click a user or use **Show user** for exact-ID filtering; `/countersign/?user=stu-0011` is a shareable drill-down. Expand **Event details** for the assertion ID, UP/UV, age, attestation, signals, telemetry, hash, and notes. One-second polling preserves open details and retains the last rows during a recoverable read error. Use `/countersign/policy/review` to compare active and draft policies.

A2–A4 implement registration, action-bound WebAuthn verification, and governed submission enforcement. Challenges are single-use and bound to the user, session, action, form contents, and attestation; required UP/UV and age checks run server-side. A9 stores and renders the attested discussion's disclosure, presence status, and advisory review flags. Record masking, deterministic signal scoring, and action-bound reveal from A6–A8 share the same credential and verification service. A1's source-derived fixtures and B4's Registry-backed GPT-6 drafting are implemented and verified alongside policy approval.

### Student-record protection (A6–A8)

- Record HTML contains only placeholders. The server evaluates signals before releasing fields; suspected automation stays masked until WebAuthn verification. Responses are `no-store` and every decision is logged.
- Hidden, unfocused record reads score `0.6`, reaching the policy threshold. This catches the observed BrowserOS workflow despite `webdriver=false`. Suspicion persists for the login session; verified reveals do not clear it.
- This is a heuristic: background human tabs can be flagged, while foreground agents or spoofed telemetry can evade it. See `docs/contracts.md` for the endpoints and presence-verification rules.

`npm test` covers the seven required enforcement cases plus real cryptographic verification, record access, registration, replay, session/action binding, and origin/RP/UP/UV rejection. An isolated Chrome run with a virtual platform authenticator also verifies the browser flow; evidence is in `docs/build-log/a2-a4-verification.md`. A live governed quiz assertion was verified separately in `docs/build-log/live-quiz-verification.md`. **The complete agent/Touch ID recording and Comet-local checkpoint remain open.** Register separately on localhost; the WebAuthn.io test credential does not apply. Disable any DevTools virtual authenticator before the physical-sensor demo.

The B1 dashboard and A10 finalized provenance contract are verified by **97 tests**,
the strict TypeScript build, and isolated Chrome checks. Advisory composition data
is normalized before logging and contradiction checks; malformed telemetry never
blocks otherwise valid presence. The append-only log validates event metadata and
reports corrupt completed records explicitly. See [verification and the repeatable
browser harness](docs/build-log/dashboard-provenance-verification.md).

## Datasets

- **8670 EWS Distance Education Program Prerequisite Coursebook:** five derived MCQs from Lesson 2 Reading, *Fundamentals of National Defense* (original PDF pages 4–23 of 220), each with a section/page citation.
- **8801 Seminar 12 Synthetic Forum Dataset:** IFD 2's faculty prompt and all 30 other posts, preserving source fields and the complete synthetic-data notice. The demo is an eleventh learner with no seeded posts. Peer posts remain server-hidden until the initial submission in both modes.
- **CUI Tagging Dataset:** the supplied public reference corpus provides the 126 categories, 10 LDCs, exact definitions, source URLs, and marking metadata used by the generator. Three legacy identifiers remain solely for active-policy migration.

Reproduce the forum fixture with:

```sh
npm run forum:import -- data/source/8801-seminar12-synthetic-forum-dataset/8801-seminar12-synthetic-forum-dataset.json
```

Raw ZIP/PDF/JSON inputs and extracted source text remain in gitignored
`data/source/`. The normalized vocabulary and derived portal fixtures are the
repository artifacts. [Source hashes and mappings](docs/build-log/dataset-import-verification.md)
record exactly what was imported.

Data caveats:

- **Fake data only.** Student names obviously fictional, SSNs in the 900-series, DoD IDs random 10-digit, medical notes fabricated. Never use a real person's details even as a placeholder.
- The forum fixture is already synthetic and says so; keep its synthetic-data notice in the page footer.
- The 8670 EWS coursebook is UNCLASSIFIED but not necessarily public-release; quiz questions derived from it are fine, but do not commit the PDF.
- The CUI Tagging Dataset contains no live CUI; its historical markings reflect original documents, not current handling status.

## Non-Goals

- Preventing a co-resident browser extension from reading the DOM or taking screenshots.
- Treating agent fingerprinting as an adversary-proof control; signals remain advisory.
- Providing real CAC/PIV integration in the hackathon build; Touch ID or a passkey is the stand-in.
- Proving which human is present; identity binding remains the authentication system's responsibility.
- Banning AI; Countersign governs where and how it may be used.

## Status

Hackathon prototype, built in 1.5 days.

## Team

Chris and Collin.
