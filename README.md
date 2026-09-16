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

Node.js 20 or newer is required. Install the pinned dependencies:

```sh
npm install
```

Run the two instances in separate terminals:

```sh
npm run dev
npm run dev:ungoverned
```

The governed instance is at `http://localhost:3000`; the ungoverned instance is at `http://localhost:3001`. Set `SESSION_SECRET` for a stable signed-cookie key across restarts; when omitted, the server creates an ephemeral development key.

Run the current generator scaffold and test suite with:

```sh
npm run generate
npm test
npm run build
```

The generator currently copies the validated active policy to `countersign/policy/countersign.policy.draft.json`. Track B replaces that copy step with an LLM-generated draft.

## Demo Walkthrough

1. Open `http://localhost:3001/login`, choose `Capt J. Demo`, and visit the three portal pages without Countersign enforcement or provenance writes.
2. Open `http://localhost:3000/login`, choose the same user, and repeat the flow with the Countersign client and middleware active.
3. On `/quiz/1`, the `human-required` rule demonstrates the action-time WebAuthn boundary at submission.
4. On `/discussion/2`, `independent_first` hides peer posts until the learner submits an initial response; the `attested` rule records disclosure and composition telemetry.
5. On `/record/1`, the `marking` rule withholds record fields until signal evaluation. A suspected-agent session sees placeholders and an **Automation suspected** banner. Register a passkey and select **Verify presence to view** to reveal the record using WebAuthn.
6. Open `/countersign/` on port 3000 to watch the provenance timeline and `/countersign/policy/review` to compare active and draft policies.

Record masking, deterministic signal scoring, passkey registration, and action-bound record reveal are implemented. Quiz/discussion assertion enforcement, attestation presentation, and LLM policy generation remain scaffold work; the seven original quiz/WebAuthn tests are still TODOs.

### Student-record protection (A6–A8)

- The governed record's initial HTML contains no record values, including the name. A server-side field endpoint evaluates signals before returning data. Incomplete checks leave the fields hidden.
- The observed BrowserOS neo workflow opens a hidden, unfocused tab while reporting `navigator.webdriver=false`. That background record read contributes `0.6`, meeting the active policy threshold and logging `masked / automation-suspected` with `background-record-read` evidence. Suspicion persists across later clean samples in that login session.
- This is a heuristic, not a reliable browser identity detector: human background tabs can be flagged and foreground agents or spoofed client telemetry can evade it. Unflagged foreground sessions can view records normally. The proof protecting **flagged** reveals is WebAuthn, not the score.
- Register the demo user's passkey in the demo browser, then select **Verify presence to view**. The server checks the signature, origin, RP, UP/UV, session/user binding, nonce, and age. Challenges are single-use. The reveal is logged with an assertion ID, and does not clear the session's suspicion. The page remasks when hidden or restored from browser history.
- Responses are `no-store`; plaintext is never hidden in CSS, DOM attributes, or inline scripts. Fields already revealed to a human can still be read by a co-resident extension—the app cannot retract data already delivered.

`npm test` includes record-route tests and a real cryptographic WebAuthn assertion test (temporary test keys), alongside mocked verifier tests for binding and expiry. A physical Touch ID / Windows Hello check still needs a human on the demo machine.

## Datasets

- **8670 EWS Distance Education Program Prerequisite Coursebook:** source for the final five-question quiz fixture; the committed scaffold questions remain labeled placeholders until an approved chapter is selected.
- **8801 Seminar 12 Synthetic Forum Dataset:** source for the final IFD 2 discussion fixture; this repository currently carries a compact synthetic scaffold with the same required fields.
- **CUI Tagging Dataset:** source for the National CUI Registry category and limited-dissemination vocabularies; the committed vocabulary contains clearly labeled placeholders until extraction.

Data caveats:

- **Fake data only.** Student names obviously fictional, SSNs in the 900-series, DoD IDs random 10-digit, medical notes fabricated. Never use a real person's details even as a placeholder.
- The forum fixture is already synthetic and says so; keep its synthetic-data notice in the page footer.
- The 8670 EWS coursebook is UNCLASSIFIED but not necessarily public-release; quiz questions derived from it are fine, but do not commit the PDF.
- The CUI Tagging Dataset contains no live CUI; its historical markings reflect original documents, not current handling status. Say that in README.

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
