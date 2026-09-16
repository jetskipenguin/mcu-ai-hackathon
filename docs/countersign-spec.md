# Countersign — Browser-Agent Governance for Web Applications

**Status.** Draft v0.1 — hackathon scope. Everything marked *(iterate)* is a decision we haven't locked.

## 0. The name

A sentry challenges anyone approaching the line: *"Halt, who goes there?"* The approaching party gives the **countersign** — a prearranged response that proves they're friendly and belong. Without it, nobody passes, no matter whose uniform they're wearing.

That's exactly what this system does at the moment an action matters. The agent arrives at Submit wearing the student's session — the right cookies, the right credentials, the right uniform. Countersign challenges. The only valid response is a fresh proof that a human is physically present: a fingerprint on the sensor, a touch on the security key, a CAC in the reader. The agent can carry the session; it cannot give the countersign.

The word carries a second meaning that also fits. To **countersign** a document is to add a second signature confirming the first — a check, a human verification that the action is authorized. Every governed action here ends up with a countersignature: a WebAuthn assertion, cryptographically bound to that specific action, recorded in the provenance log.

Two ideas in one word: the challenge at the line, and the second signature on the record. Both military-native, both familiar to this audience, neither tied to exams alone — which matters because the same mechanism covers voucher approvals and PHI acknowledgments.

Usage: **Countersign** is the product. A governed action is *countersigned* when it carries a human presence proof. The log entry is the *countersignature*. The client script is `countersign.js`; the policy file is `countersign.policy.json`; the env toggle is `COUNTERSIGN=on|off`.

Why not "Proctor," the earlier working name: ProctorU and Proctorio already own that word in education, and to faculty it means webcam exam surveillance — a narrower product with privacy baggage we don't want attached.

---

## 1. One-liner

> **AI where it's allowed, humans where it's required, and proof of which was which.**

Countersign is a drop-in governance layer that lets any web application declare which actions must be performed by a human and which content is off-limits to AI, enforce those rules against agentic browsers and AI extensions, and record cryptographic provenance for every governed action.

---

## 2. The problem

### 2.1 Scenario

A Marine in a distance-education PME course logs into the learning portal from a personal laptop, or a company laptop with an unmanaged browser. Their browser has an AI assistant built in (Perplexity Comet, Gemini in Chrome) or an AI extension installed (Manus Browser Operator, the ChatGPT extension, Claude in Chrome). That assistant:

- can **act** using the student's authenticated session — take a quiz, submit an essay, click "I attest," approve a voucher — and the application cannot tell an agent's click from the student's;
- can **read** everything the student can see — SSNs, medical notes, CUI — and sends it to a commercial cloud model that is not authorized for that data.

The application owner (MCU, an HR system, a finance system) does not control the endpoint and cannot rely on endpoint policy. The application has to defend itself.

### 2.2 Three problems hiding in one prompt

The use-case text bundles three concerns that live at *different enforcement points*. Separating them is the core design insight and the opening of our pitch.

| Concern | Example | Where it can be enforced |
|---|---|---|
| **Governing agent actions** | "Submit exam" must be done by a human | **App-side.** The app is the authority on what happens to it. |
| **Governing LLM reads** | PHI must not leave the browser to a third-party model | **Endpoint or egress only.** A co-resident extension can read anything the app renders. The app can *mark* content and *mask* it for suspected agents, but cannot technically prevent a DOM read. |
| **Provenance / identity / intent** | Who actually did this, and can we prove it? | **The log** that ties the other two together. |

Countersign is primarily a solution to the first and third. It supports the second by (a) machine-readable content markings that governed tools honor, (b) masking marked content for suspected-agent sessions until a human proves presence, and (c) *(stretch)* an egress gateway for sanctioned AI tools.

### 2.3 Why existing controls don't solve it

- **CAPTCHAs** test for a solver, and agents solve them. They also don't bind to a specific action.
- **Vendor guardrails** (Comet, Gemini, ChatGPT all "pause before purchases") are the vendor's policy, not the app's. Quizzes and personnel records aren't on any vendor's pause list. The next agent won't ask.
- **Extension allowlists / browser bans** only work on managed endpoints — not a student's personal laptop — and banning a browser is a blunt instrument.
- **Bot detection / fingerprinting** is an arms race against tools built to look human. Useful as a *signal*, useless as a *guarantee*.

---

## 3. Non-goals (say these out loud; they build credibility)

- Not preventing a co-resident extension from reading the DOM or taking screenshots. Nothing app-side can.
- Not adversary-proof agent fingerprinting. Detection produces *signals*; the guarantee comes from proof of presence.
- Not real CAC/PIV integration in the hackathon build. Touch ID / passkey stands in; CAC is the production root.
- Not proving *which* human. Countersign proves *a* human was physically present at the action. Binding to identity is the authentication system's job (CAC), and Countersign logs the session identity alongside the presence proof.
- Not an "AI ban." The point is governed AI, not no AI. The discussion-post flow exists specifically to show AI being *allowed*.

---

## 4. Solution overview

Three layers, one policy:

1. **Declare.** The app's policy (`countersign.policy.json`) states, per route/element/action: who may act, and how content is marked. An **AI policy generator** drafts this policy by reading the app; a human approves it.
2. **Enforce.**
   - *Human-required actions* → a fresh **WebAuthn user-presence assertion** at the moment of the action. A human must physically touch hardware. Agents stall.
   - *Marked content* → served with machine-readable markings; **masked** for sessions flagged by agent signals until a human steps up.
   - *AI-assist-allowed actions* → permitted, but the submission is **tagged** with its actor class (disclosure).
3. **Prove.** Every governed action is appended to a provenance log with: session identity, actor class, presence assertion ID (if any), agent signals observed, policy rule that fired, timestamp. A dashboard renders this.

---

## 5. Core concepts

### 5.1 Action classes — three governance modes

| Class | Mode | Meaning | Enforcement |
|---|---|---|---|
| `human-required` | **Require the human** | Only a physically present human may perform this. | WebAuthn step-up at action time. No assertion → action blocked. |
| `attested` | **Make the record honest** | A human must be present *and* declare provenance; AI use is permitted or not per policy, but the record must be truthful. | WebAuthn step-up + explicit attestation ("own work" / "AI-assisted"). Composition telemetry (§5.5) recorded alongside. A contradiction between attestation and telemetry is **logged for faculty, not blocked.** |
| `unrestricted` | — | Default. | Logged only if the session is flagged. |

Content markings (§5.2) are the third mode, **protect the data**, and apply to pages rather than actions.

Why `attested` exists: presence-at-submit proves a human clicked Submit; it says nothing about who wrote 280 words. For text, the honest governance is a truthful record, not a claim of certified authorship. "We don't stop you from using AI on your post. We make the record truthful." Faculty decide the consequence; the instructor's policy can also set `ai_use: prohibited | disclosed | encouraged` per forum, which changes the attestation wording and what counts as a contradiction.

### 5.2 Content markings

Machine-readable, CUI-style markings on DOM elements and pages, e.g.

```html
<section data-marking="CUI//SP-PRVCY" data-categories="PII">
<span data-marking="PHI">…clinical note…</span>
```

- Modeled on DoD CUI banner/portion marking conventions (DoDI 5200.48 / 32 CFR 2002) so the vocabulary is already familiar to the audience. **Exact category and LDC identifiers come from the CUI Tagging Dataset's Registry list (§11.1) — don't hand-type them.** The `CUI//SP-PRVCY` examples in this doc are placeholders until checked against that list.
- Honored by: Countersign's own masking logic; the *(stretch)* egress gateway; any cooperative agent that reads them.
- Page-level markings also emitted as an HTTP response header (`Countersign-Marking: CUI//SP-PRVCY`) so proxies and gateways can act without parsing HTML.

### 5.3 Actor classes (what the provenance log records)

| Actor class | How it's determined |
|---|---|
| `human-verified` | Fresh WebAuthn assertion with user presence (UP) — and user verification (UV) where available — bound to this action's challenge. |
| `agent-declared` | Session or request self-identified as an agent (cooperative agent header / WebMCP-style declaration). |
| `automation-suspected` | Agent signals exceeded threshold; no presence proof. |
| `unverified` | No signals, no proof. Normal browsing. |

### 5.4 Proof of presence (the hard guarantee)

- Mechanism: WebAuthn `navigator.credentials.get()` with a server-issued challenge that encodes the specific action (route + form hash + nonce). The server verifies the assertion, checks the UP/UV flags, and only then executes the action.
- Demo authenticator: MacBook Touch ID (platform authenticator). Also works with a YubiKey or Windows Hello.
- Production root: CAC/PIV-derived FIDO2 credential or a DoD-issued security key. Same protocol, same code path.
- Why it works against every agent: Comet, Manus, Gemini, ChatGPT, Claude can all use the logged-in session; none of them can press the sensor. The prompt appears *inside* the agent's own browser and the agent stalls.
- Constraint: WebAuthn requires a secure context — `localhost` or HTTPS. Demo runs on one machine on `localhost`. *(iterate: mkcert if we need a second machine)*

### 5.5 Agent signals (soft evidence)

Collected by `countersign.js`; produce a score, never a verdict. Examples:

- `navigator.webdriver` true; CDP/automation artifacts
- Form fills with no preceding pointer/keyboard events on the field
- Inhuman timing: multi-field completion in < N ms; uniform inter-keystroke intervals
- Focus/visibility anomalies (document hidden while inputs change)
- Known agent extension fingerprints where detectable *(iterate: probably skip)*
- Request-level: user-agent oddities, cooperative agent headers
- **Composition telemetry (text fields):** keystroke count vs. final length; `input` events with `inputType` of `insertFromPaste` / `insertReplacementText` vs. `insertText`; time-on-field; single-event fills. A human writes 280 words over minutes with hundreds of keystrokes; an agent sets the field value in one event with none. This is the signal that makes `attested` meaningful. ~30 lines in `countersign.js`.

Effects of a high score: marked content masks; `human-required` actions still require presence proof (they always do); event logged as `automation-suspected`. **Never block solely on signals.**

### 5.6 AI policy generator (the AI in the solution, and the "general-purpose" answer)

- Input: a URL (crawl) or a set of rendered pages / form definitions.
- An LLM reads page semantics — "this is an exam submission," "this field is an SSN," "this is a clinical note," "this is a discussion post" — and drafts `countersign.policy.json`: action classes per submit target, markings per element/page, rationale per rule.
- **Marking vocabulary is constrained to the National CUI Registry** — the 126 categories and 10 limited-dissemination controls from the CUI Tagging Dataset are supplied as structured input, and the generator may only emit identifiers from that list. No invented markings. Each proposed marking carries a citation to the Registry definition (and, if built, a retrieved chunk from a governing document). "The AI selected from the authoritative list and told you why."
- LDCs and categories are treated as dissemination rules, and an LLM endpoint is a dissemination target: the same vocabulary that says who may receive a document says which model may receive a page.
- Output is a **draft for human approval** in the dashboard (diff view: proposed vs. current). Nothing takes effect until approved.
- Why it matters: governance for legacy DoD web apps without hand-writing rules per app. Point Countersign at an existing system; get a starting policy in minutes.
- Model: Bedrock in GovCloud West for the hackathon (see §10.2) — the same class of infrastructure the production pitch names, so the story and the build match. Provider switch with OpenAI fallback for resilience.

### 5.7 Provenance log and dashboard

- Append-only JSONL (hackathon) → signed/hash-chained in production.
- Event: `{ts, session_user, route, action, rule_id, actor_class, presence_assertion_id, signals, decision}`
- Dashboard views: live event timeline; per-user provenance ("this quiz: human-verified at 14:02:11, assertion 7f3a…"); flagged sessions; policy editor/approval.

### 5.8 Stretch: egress gateway for sanctioned AI

The honest answer to the "LLM reads" problem, and near-identical to an enterprise LLM proxy pattern.

- All *sanctioned* AI tools on the endpoint route through the gateway.
- Gateway inspects outbound content for markings (from headers / DOM attributes) and deterministic PII patterns; redacts or blocks per **model clearance** (e.g., GovCloud model cleared for CUI but not PHI; commercial model cleared for nothing marked).
- Demo: an open-source browser agent (bring-your-own-key) pointed at the gateway; show the redaction transcript.
- Only if core is green by Thursday mid-morning.

### 5.9 Stretch: "compliant assistant" mode

An in-portal AI tutor that honors markings and action classes — helps the student study the material, refuses to answer the quiz, never sees the record page. Shows "governed AI" is a feature, not a restriction. Cheap if the policy generator's LLM plumbing already exists.

---

## 6. Architecture

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

**Deployment modes** (say this; the second is the DoD selling point):
1. **SDK** — app includes `countersign.js` and the middleware natively.
2. **Reverse proxy** — Countersign fronts a legacy app, injects `countersign.js`, evaluates policy on the way through. No app changes.

**Components**
- `portal/` — mock app with fake data (three pages; deliberately plain)
- `countersign/client/countersign.js` — signals, step-up prompt, masking
- `countersign/server/` — middleware, WebAuthn registration + assertion, policy engine, log
- `countersign/policy/countersign.policy.json` — hand-written first, generated second
- `countersign/generate/` — policy generator
- `dashboard/` — small SPA or server-rendered pages
- `gateway/` — stretch

---

## 7. Policy file (draft schema)

```json
{
  "version": "0.1",
  "app": "mcu-learning-portal",
  "rules": [
    {
      "id": "quiz-submit",
      "match": { "route": "/quiz/*", "action": "POST /quiz/:id/submit" },
      "class": "human-required",
      "presence": { "uv": "preferred", "max_age_s": 60 },
      "rationale": "Exam submission. Academic integrity requires the enrolled student to perform this."
    },
    {
      "id": "discussion-initial-post",
      "match": { "route": "/discussion/*", "action": "POST /discussion/:id/post", "when": { "is_initial_post": true } },
      "class": "attested",
      "ai_use": "disclosed",
      "presence": { "uv": "preferred", "max_age_s": 60 },
      "rationale": "Q&A forum, independent_first: the initial post must be the learner's own thinking. AI use must be disclosed; contradictions between attestation and composition telemetry are surfaced to faculty."
    },
    {
      "id": "student-record",
      "match": { "route": "/record/*" },
      "markings": [
        { "selector": "[data-field=ssn]", "marking": "CUI//SP-PRVCY", "categories": ["PII"] },
        { "selector": "[data-field=medical]", "marking": "PHI", "categories": ["PHI"] }
      ],
      "mask_when": "automation-suspected",
      "unmask": "human-required",
      "rationale": "Personnel and medical data; not authorized for third-party models."
    }
  ],
  "signals": { "suspect_threshold": 0.6 }
}
```

---

## 8. Enforcement flows

**A. Human-required action (quiz submit)**
1. Agent (or human) clicks Submit → `countersign.js` intercepts, requests challenge for `quiz-submit`.
2. Server issues challenge bound to `{rule, form_hash, nonce}`; logs `presence-requested`.
3. Browser shows WebAuthn prompt (Touch ID). Agent cannot satisfy it; stalls or reports "needs user."
4. Human touches sensor → assertion → server verifies signature, UP/UV, challenge binding → executes submit → logs `human-verified` with assertion ID.
5. If no assertion within `max_age_s`: submit rejected; logged `blocked / automation-suspected` or `blocked / no-presence`.

**B. Marked content in a flagged session (student record)**
1. Page renders with markings; `countersign.js` computes signal score.
2. Score ≥ threshold → marked fields replaced with masked placeholders; banner: "Sensitive content hidden — verify presence to view."
3. Human step-up (same WebAuthn path) → fields revealed; logged `unmask / human-verified`.
4. Unflagged human session: content shown normally; markings still present for gateways.

**C. Attested action (discussion initial post)**
1. Agent drafts the post and fills the field (one `input` event, zero keystrokes — telemetry records this) and clicks Submit.
2. `countersign.js` shows the attestation + presence step: "This post is: ○ my own work ○ AI-assisted" and the WebAuthn prompt. Agent stalls.
3. Human selects an option, touches the sensor. Submit proceeds.
4. Server logs `{attestation, composition_telemetry, presence_assertion_id}`. If attestation = "own work" and telemetry says single-event fill → event flagged `attestation-contradiction` for faculty review. Post is published either way; faculty view shows the provenance badge.
5. Demo line: "Same agent, same session. We didn't block the post. We made the record truthful — and the instructor can see it."

---

## 9. Standards alignment (one slide; makes it look like we're riding a wave, not inventing one)

- **WebAuthn / FIDO2** — user presence & verification; CAC/PIV → FIDO2 derived credentials are the production path.
- **WebMCP** — Chrome origin trial (Chrome 149) for apps declaring tools/capabilities to agents; Countersign's cooperative declaration can align to it.
- **Web Bot Auth / HTTP Message Signatures** (IETF drafts, Cloudflare et al.) — how cooperative agents identify themselves; maps to `agent-declared`.
- **CUI marking conventions** (DoDI 5200.48, 32 CFR 2002) — Countersign's markings use the same vocabulary, made machine-readable.

*(Verify current status of WebMCP and Web Bot Auth drafts before the slide.)*

---

## 10. External tools and why

### 10.1 Adversaries (what we demo against)

| Tool | Role | Why | Notes |
|---|---|---|---|
| **Perplexity Comet** | Built-in agentic browser; **live demo** | Named in the use case; free; Chromium-based so Touch ID works inside it | Install in a fresh macOS user account; fake data only; uninstall after. Test tonight: will it complete a quiz? Read a record page? Does the WebAuthn prompt fire on localhost? |
| **Manus Browser Operator** | 3rd-party extension; **recorded clip** | Named in the use case; cloud agent ("from Meta") using local session — best exfil exhibit (show the SSN in the Manus task log) | Paid tier required. Buy for one month only if the ChatGPT extension isn't unlocked. Time-box setup to 1 hour. Beta; may fumble multi-field forms. |
| **ChatGPT Chrome extension** | 3rd-party extension; **recorded clip** (alternative) | Free if available; exfil exhibit via chatgpt.com history | Rolling out "where available" — check tonight. |
| **Claude in Chrome** | Fallback extension | Already available on a Max plan | Zero cost. Use if the above are unavailable. |
| **Gemini in Chrome (auto browse)** | Backup built-in agent | Default browser; runs on-device with logged-in sessions | Needs Google AI Pro/Ultra. |
| **Open-source agent** (Nanobrowser / browser-use / Playwright MCP) | Controllable agent for gateway stretch; last-resort adversary | No vendor guardrails; repeatable; can be pointed at our gateway | Bring-your-own-key. Less name recognition with judges. |

### 10.2 Build tools *(iterate tonight)*

| Tool | Use | Why |
|---|---|---|
| **Codex CLI and/or OpenCode, on GPT models** | Scaffolding and most implementation | Free OpenAI tokens for the week; Codex is OpenAI's own harness, OpenCode lets us point at the same models with a different workflow. Claude Code stays available on personal plans as a fallback if either tool stalls on something specific. Keep `AGENTS.md` at the repo root — both tools read it — with the contracts from `docs/contracts.md` so parallel sessions build to the same interfaces. |
| **Node.js + TypeScript, Express** | Portal + Countersign server | Single language client/server; mature WebAuthn library below. *(alt: Python/FastAPI + py_webauthn)* |
| **SimpleWebAuthn** (`@simplewebauthn/server` + `/browser`) | WebAuthn registration/assertion | Best-documented WebAuthn library; handles the crypto and the browser API quirks |
| **Vanilla JS for `countersign.js`** | Client script | Must be injectable into any page; no framework dependency |
| **React (or plain server-rendered pages)** | Dashboard | Whatever is faster to make look decent; Chris knows React |
| **Amazon Bedrock, GovCloud West** (hackathon-provided) | Policy generator; compliant-tutor stretch; the "cleared" endpoint in the gateway stretch | The generator reads the governed app's pages — in production, the CUI itself — so it must run on an authorized model. GovCloud Bedrock makes that real and is a one-line Security & Sustainability point. Anthropic models aren't in the provided list; use Nova / Llama / OpenAI-on-Bedrock, whichever returns clean JSON in tonight's test. |
| **Provider switch** `LLM_PROVIDER=bedrock\|openai\|anthropic` | Insurance | Hackathon creds expire and venue networks drop. Free OpenAI access is the fallback; a pre-generated draft policy is the fallback's fallback. |
| *Not used:* Kiro, Quick Suite, EKS/ECS, SageMaker, GPU EC2, AgentCore, Strands, LISA | — | Nothing the demo needs. AgentCore/Strands are roadmap (agent identity → `agent-declared`); LISA/SageMaker appear on the gateway diagram as "self-hosted cleared model." The portal never leaves the laptop: WebAuthn and Touch ID require it. |
| **Presidio or regex set** | Deterministic PII detection in gateway (stretch) | Don't rely on the LLM alone for SSN/DoD-ID patterns |
| **mkcert** | HTTPS if we need a second machine | WebAuthn secure-context requirement |
| **QuickTime / OBS** | Demo recordings | Backup video for every act; recorded clips for extension adversaries |
| **Slides** *(Keynote / Google Slides / PowerPoint — iterate)* | Presentation | Whatever exports cleanly and runs offline |

---

## 11. Demo fixture: the mock "MCU Learning Portal"

Deliberately plain. Three pages plus login (fake SSO: pick a user, no password).

| Page | Purpose | Governance mode |
|---|---|---|
| `/quiz/1` | Short multiple-choice quiz (5 questions) generated from the 8670 coursebook, with Submit | **Require the human** — `human-required` |
| `/discussion/2` | IFD 2 from the 8801 Seminar 12 forum dataset: "Does Autonomy Change the Nature of War, or Only Its Character?" Seeded with the faculty prompt and the 30 existing posts. Demo student is an 11th learner who hasn't posted; `independent_first` hides peers until the initial post. | **Make the record honest** — `attested`, `ai_use: disclosed` |
| `/record/1` | Student record: name, SSN, DoD ID, medical/limited-duty note | **Protect the data** — marked PII/PHI; masked when flagged |

Fake data only — obviously fictional names, invalid SSNs (e.g., 900-series), fabricated notes. The forum dataset is already synthetic and says so in its header; keep the notice in the page footer. Toggle: `COUNTERSIGN=off|on` to run the same portal ungoverned (Act 1) and governed (Act 3).

### 11.1 Datasets (from the hackathon portal)

The datasets are the *content of the governed app* and the *reference corpus for the AI component* — not the thing Countersign governs. Register these; don't submit a new one.

| Dataset | Format / tag | Used for | Verify tonight |
|---|---|---|---|
| **8670 EWS Distance Education Program Prerequisite Coursebook** | PDF, UNCLASSIFIED | Source material for `/quiz/1` (generate 5 MCQs from a chapter) and the compliant-assistant stretch. Makes the demo the actual MCU distance-ed scenario. | Distribution statement before any public repo. Pick one self-contained chapter. |
| **8801 Seminar 12 Synthetic Forum Dataset** (CSC DEP, "Theory and Nature of War") | JSON + PDF, SYNTHETIC – AI GENERATED | Seeds `/discussion/2`. Clean structure: `roster[]`, `posts[]` with `post_id`, `ifd`, `parent_id`, `depth`, `author`, `timestamp`, `subject`, `body`. Built to test MCU's Learning Intelligence Dashboard (LID) forum analyzer — Countersign's provenance log is the authorship column that analyzer lacks. | ✔ Inspected. Use IFD 2 (posts with `ifd == 2`). |
| **CUI Tagging Dataset** (C. Whitworth, compiler) | ZIP: JSONL chunks, CSV/JSON manifests, PUBLIC | **Must:** all 126 National CUI Registry categories + 10 limited-dissemination controls as the generator's marking vocabulary — constrained output, only real identifiers. **Should (1 hr):** cite a Registry definition or a governing-document chunk per proposed marking (the dataset's stated use is cited retrieval). **Stretch:** the 7,155 marked chunks as a test set for the gateway classifier. | ✔ Confirmed by description. Tonight: unzip, locate the category/LDC files and the chunk JSONL, note field names. README caveat: historical markings reflect original documents, not current handling status. |

Optional, last thing Thursday: contribute the synthetic student-record fixture back as a `SYNTHETIC – AI GENERATED` dataset. Zero priority.

Doctrine to quote, not register: **MCDP 7 (Learning)** on the hook slide; **OBME / CJCSM 1810** if a judge asks where assessments fit in the JPME framework.

---

## 12. Open questions

**Answered**
1. ~~Name~~ — Countersign (§0).
2. ~~Exact marking strings~~ — come from the CUI Tagging Dataset's Registry list, never hand-typed (§5.2, §11.1). ~~DoDI 5200.48 on a slide~~ — yes, it's on pitch Slide 8 as one of three standards we ride.
3. ~~Judging rubric~~ — in hand: Mission Impact 30 / Technical Innovation 25 / Usability & Design 20 / Security & Sustainability 15 / Team Collaboration 10, plus four 1% bonuses we don't build for. Mapped slide-by-slide in pitch §0.
4. ~~Which LLM for the generator~~ — Bedrock in GovCloud West with an OpenAI fallback behind `LLM_PROVIDER` (§5.6, §10.2). Specific model ID decided by tonight's smoke test.

**Still open — decide tonight**
5. Node vs. Python for the server. Default: Node + Express + SimpleWebAuthn. Decide when Collin scaffolds.
6. Which extension adversary. Sequence: check ChatGPT extension availability → if unavailable, buy the cheapest Manus tier with Browser Operator, one-hour time-box → Claude in Chrome as zero-cost fallback.
7. Compliant-assistant stretch: in the pitch even if unbuilt? Recommended default: **no** — the three-modes story is complete without it; mention it only if it exists by Thursday 11:00.

**Still open — need the portal**
8. Presentation format: is the 7 minutes inclusive or exclusive of Q&A? (Pitch §6 has the 5-minute variant if inclusive.)
9. Semi-final and final schedule, and what differs between them.
10. Deliverables list (plan §8 has a guess: repo, deck PDF, demo video, abstract).
