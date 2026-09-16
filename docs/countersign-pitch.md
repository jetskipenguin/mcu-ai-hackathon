# Countersign — Pitch Outline (Semi-final, v0.1)

**Assumption:** 7 minutes of pitch + demo, followed by judge Q&A. **Verify on the portal tonight** — if the 7 minutes *includes* Q&A, cut to the 5-minute variant in §6.

---

## 0. What the judges score, and where we earn it

| Criterion | Weight | What they wrote | Where it's earned in this pitch |
|---|---|---|---|
| **Mission Impact** | 30% | Alignment with defense priorities and real-world use cases | Slide 2 (PME distance-ed scenario, their population), Slide 8 (education / finance / HR-medical; Zero Trust per-action verification; CUI markings), Slide 10 (pilot ask) |
| **Technical Innovation** | 25% | Originality, feasibility, technical depth | Slide 3 (the three-enforcement-point insight), Act 3 (presence-bound WebAuthn — nobody else is doing this for agents), Act 2 (AI-drafted policy), Slide 9½ (built in 1.5 days) |
| **Usability & Design** | 20% | Clarity of the demo, ease of use, potential for reuse or extension | Acts 1–3 (one story, three beats), Slide 8 (SDK + reverse-proxy modes, open policy schema — reuse on any app) |
| **Security & Sustainability** | 15% | Readiness for DoW testing, long-term viability, maintainability | Slide 8 (standards we ride, not invent: WebAuthn/FIDO2 — DoD-accepted authenticator class; CAC as root), Slide 9 (honest limits), repo hygiene (README, tests, pinned deps) |
| **Team Collaboration** | 10% | Teamwork, presentation quality, resilience under pressure | Two presenters, one driving while the other narrates; rehearsed fallback to backup video; Slide 9½ |

Bonus criteria (1% each) — mention only where free: policy generator can run on GenAI.mil models ("Sanctioned"); CAC/LMS integration on the roadmap ("Reach the Enterprise"). Don't build for them.

**Mission-impact language to use, verbatim from their own documents:** TECOM Campaign Plan LOE 4B "leveraging data and AI"; Training & Education 2030 "utilizing AI to enhance human performance." Countersign is how you let AI enhance human performance *without* losing the ability to certify the human performed.

---

## 1. What "shark-tank style" means for us

On the show, founders pitch investors: a hook, the product, a live demo, then the sharks interrogate — market, viability, cost, "what's your ask." Judges who adopt that framing tend to:

- **interrupt** — so every slide must survive being cut short, and the demo must land early;
- ask **"who pays / who adopts / why now"** — so we need an adoption path, not just a prototype;
- reward **confidence and honesty in equal measure** — a clean "no, and here's why that's fine" beats a hedge;
- expect **an ask** — for us, that's a pilot, not money.

Practical rules: never read the slide; one idea per slide; the demo is the pitch, slides are connective tissue; be at 6:15 in rehearsal so a 45-second interruption doesn't kill the close.

---

## 2. Time budget (7:00)

| Segment | Time | Cumulative |
|---|---|---|
| Hook + problem | 1:00 | 1:00 |
| The insight (three problems, three enforcement points) | 0:20 | 1:20 |
| Act 1 — the problem, live/recorded | 1:00 | 2:20 |
| Act 2 — turn Countersign on (policy generator) | 0:45 | 3:05 |
| Act 3 — same agent hits the wall (live, Touch ID) | 1:30 | 4:35 |
| Provenance dashboard | 0:30 | 5:05 |
| How it generalizes + standards | 0:40 | 5:45 |
| Honest limits | 0:20 | 6:05 |
| Built with AI in 1.5 days | 0:20 | 6:25 |
| Roadmap + the ask | 0:25 | 6:50 |
| Buffer | 0:10 | 7:00 |

---

## 3. Slide-by-slide

Speaker assignments are placeholders — *(iterate)*: split so the person not talking is driving the demo.

### Slide 1 — Title (0:10)
**Countersign.** *AI where it's allowed. Humans where it's required. Proof of which was which.*
Team names, SwRI. One sentence on the name, because it's the whole idea: "When a sentry challenges you, the countersign is how you prove you belong. An AI agent can wear your session. It can't give the countersign." Then move.

### Slide 2 — Hook (0:55) — Chris
No slide text beyond one image or one sentence. Tell the scenario:

> A Marine in a distance-ed course. Personal laptop. Their browser has an AI assistant — built in, or an extension. They say "help me finish this quiz." It finishes the quiz. Later they open their own personnel record to check something. The extension reads the whole page — SSN, limited-duty note — and ships it to a commercial model in someone else's cloud. The learning portal saw a logged-in student doing normal things. It has no idea.

Then the three-sentence problem: web apps can't tell an agent's click from a human's; they can't stop what they render from being read; and when a human hands their session to an agent, *identity, intent, and provenance* all become ambiguous. That last phrase is the use case's own language — use it.

### Slide 3 — The insight (0:20) — Chris
Three-row table: **Actions → app-side. Reads → endpoint/egress. Provenance → the log.**
Line: "The prompt bundles three problems that live at different enforcement points. Most of the value is in the first and third, and that's what an app owner can actually control — especially when the student is on a laptop you don't manage."

### Slide 4 — Act 1: the problem (1:00) — Collin drives
**Live if Comet is reliable; recorded otherwise. Recording always ready.**
- Comet, logged in as `student`, ungoverned portal: "Finish this quiz for me." → submitted. (25s)
- "Write my initial post for IFD 2." The forum prompt is *"Does autonomy change the nature of war?"* — the agent writes a Marine officer's argument about AI, on a Q&A forum whose whole design is that you post your own thinking first. Posted. Say the irony out loud, once. (20s)
- "Summarize this record." → reads SSN and note; shows summary. (15s)
- **Recorded 20s clip:** the same thing via an extension in stock Chrome (Manus or ChatGPT ext). Cut to the vendor's task log / chat history showing the SSN sitting in their cloud.
Line: "Two different products, one from a browser vendor and one from a third-party extension. Same result. Neither one asked."

### Slide 5 — Act 2: turn Countersign on (0:45) — Chris
- Run the policy generator against the portal. Show the draft in the dashboard: `quiz-submit → human-required`, `student-record → CUI//SP-PRVCY, PHI`, `discussion-post → ai-assist-allowed`. Each with a one-line rationale.
- Approve.
Line: "An LLM read the app and drafted the rules. A human approved them. That's how this retrofits onto a legacy system without anyone hand-writing policy."

### Slide 6 — Act 3: the wall (1:30) — Collin drives, Chris narrates
**This is the pitch. Everything else exists to set this up.**
1. Same Comet, same prompt: "Finish this quiz." It fills the answers. It clicks Submit. **Touch ID prompt appears inside Comet.** Comet stalls / reports it needs the user. *Pause. Let the judges see it stall.* (30s)
2. Chris touches the sensor. Submit goes through. Dashboard: `quiz-submit — human-verified — assertion 7f3a…`. (15s)
3. "Summarize this record." Session is flagged; the SSN and note are masked. Agent summarizes a page of `████`. Human steps up → fields reveal → logged. (30s)
4. "Write my initial post for IFD 2." Agent drafts and fills the field. Submit → attestation prompt ("own work / AI-assisted") plus Touch ID. Agent stalls. Human picks "own work," touches the sensor. Post publishes — and the faculty view shows a provenance badge: *attestation: own work; composition: filled in one event, 0 keystrokes; flagged for review.* (20s)
Line: "Three pages, three modes. The quiz: we required the human. The record: we protected the data. The post: we didn't block it — we made the record truthful, and the instructor can see it. The agent can use my session. It cannot press my fingerprint sensor, and it cannot type."

### Slide 7 — Provenance (0:30) — Chris
Dashboard timeline: human-verified, blocked, automation-suspected, AI-assisted — with assertion IDs and the rule that fired.
Line: "Identity: whose session. Intent: what the rule required. Provenance: proof of what actually happened. That's the audit trail the use case asked for."

### Slide 8 — Why this generalizes (0:40) — Chris
Three columns, one line each: **Education** (exam integrity, honor-code attestations) · **Finance** (voucher approvals, "a human authorized this payment") · **HR/Medical** (PII/PHI acknowledgments, break-glass reveals).
One line for the defense-priority tie: "This is Zero Trust applied to the human/agent boundary — never trust the session, verify the human, per action." Judges scoring Mission Impact will hear that phrase.
Bottom row — standards we're riding, not inventing: **WebAuthn/FIDO2** (DoD already accepts FIDO2 authenticators; CAC → FIDO2 is the production root — *verify the current DoD CIO memo before the slide*) · **WebMCP** (Chrome origin trial — apps declaring tools to agents) · **CUI markings** (DoDI 5200.48), made machine-readable.
Reuse line, for the Usability score: "A script tag and a policy file, or a proxy in front of a legacy app. The policy schema is open. Any web app, no rewrite."
Enterprise hook, one sentence: "The forum dataset we used was built to test MCU's Learning Intelligence Dashboard. That analyzer scores Bloom's levels and engagement. It has no authorship column. Countersign's provenance log is that column."
Infrastructure, one sentence: "The AI that drafts your governance reads your app's pages — so it runs in GovCloud, on Bedrock, not in someone else's cloud. That's how we built it this week, not a promise."

### Slide 9 — Honest limits (0:20) — Chris
One slide, three bullets, delivered fast and unbothered:
- Can't stop an extension from reading what's on screen — that's an endpoint/egress problem, and we have a gateway design for the sanctioned-tool case.
- Proves *a* human was present, not *which* — that's the CAC's job, and we log the session identity next to the proof.
- Agent detection is a signal, never the guarantee.
Line: "We'd rather tell you where the edges are than have you find them."

### Slide 9½ — Built with AI, in a day and a half (0:20) — Collin
A single timeline graphic with real timestamps — this slide only works if the evidence is real:
- Tue 20:00 — use case picked; spec, pitch, and plan drafted *with* AI in one evening
- Wed 12:00 — the Touch ID wall stands (screenshot of the first log line)
- Wed 17:00 — AI drafting policy for the app
- Thu 11:00 — frozen, rehearsed
Line: "Two engineers. The same class of agentic tooling that creates this problem built the defense in a day and a half — spec to working demo. AI wrote most of the code; it also *is* part of the product: the policy generator is an LLM reading your app and drafting governance for a human to approve."
This is the slide that answers "is this feasible?" (Technical Innovation), shows how we worked (Team Collaboration), and makes the meta-point the event is about (Mission Impact). Don't oversell it — one graphic, one line, move on.

### Slide 10 — Roadmap + the ask (0:25) — Chris
- **Next 90 days:** pilot in one MCU course on the LMS; CAC/FIDO2 presence root; gateway for sanctioned AI tools.
- **Ask:** an MCU/NPS sponsor for a pilot, and a conversation about making CUI markings machine-readable across the enterprise.
End on the tagline. Stop talking. Invite questions.

---

## 4. Anticipated judge questions (rehearse answers to 15 seconds each)

| Question | Answer |
|---|---|
| Why not just block the extension? | Only works on managed endpoints. Distance-ed students are on personal laptops. The app has to defend itself. |
| Can't the agent fake the fingerprint? | No. WebAuthn is a hardware-backed signature over a challenge we issued for this specific action. The agent has the session cookie; it doesn't have the sensor. |
| Can't the student just touch the sensor after the agent does everything else? | For a quiz, yes — and presence granularity is a policy choice: per question, on focus loss, at intervals. For a payment approval, "a human touched the key at the moment of approval" is exactly the guarantee you want. For written work we don't pretend presence proves authorship — that's why the post goes through *attested* mode: the human declares, the telemetry records, and a contradiction is visible to faculty. |
| Isn't this just a CAPTCHA? | CAPTCHAs test for a solver, and agents solve them. This requires a physical human action, cryptographically bound to the specific submission, and it's logged. |
| So you're policing students? | No — the post wasn't blocked. The instructor sets whether AI use is prohibited, disclosed, or encouraged for that forum; Countersign makes the record match reality. Faculty decide what to do with it, same as today. |
| What about screenshots / the agent reading the screen? | We can't stop that app-side and won't claim to. We mark content so sanctioned tools and gateways can honor it, mask it for suspected agents, and the egress gateway handles the sanctioned-tool case. |
| Doesn't every student need to register a key? | Touch ID / Windows Hello / phone passkeys are already on their devices. In production, the CAC is the root — no new enrollment. |
| What about students who legitimately use AI? | That's the discussion-post flow. Countersign governs, it doesn't ban. The instructor decides where AI is allowed and the record shows where it was used. |
| Legacy apps? | Reverse-proxy mode: Countersign fronts the app, injects the script, evaluates policy. No app changes. The policy generator drafts the rules. |
| Accessibility — users who can't use biometrics? | WebAuthn supports security keys and PIN-based user verification; the policy can accept UP without UV. Same as CAC PIN today. |
| How is this different from bot detection products? | Those try to *identify* the agent. We *require the human*. Detection is a signal for masking; presence is the guarantee. |
| Cost / what does it take to deploy? | A script tag and a middleware, or a proxy. WebAuthn is free and already in every browser. The policy generator runs on whatever LLM you're already authorized to use. |
| Mobile? | WebAuthn platform authenticators exist on iOS and Android. Not built for the hackathon. |
| Who's the customer? | The application owner — MCU for the LMS, but the same product for a finance or HR system. |
| What happens if the agent refuses to stall and just times out? | Same outcome: no assertion, no submit, logged as blocked. |

---

## 5. Semi-final vs. final

- **Semi-final:** this outline. Core demo, no stretch.
- **Final (different judges, likely more senior):** same spine, tightened from semi-final Q&A. Add if built: gateway redaction transcript (replaces half of Slide 8), compliant-assistant beat (10s in Act 3). Push the "machine-readable CUI markings" idea harder — that's the enterprise-scale story a senior audience will care about. Rerecord backup video with any fixes.

---

## 6. 5-minute variant (if 7:00 includes Q&A)

Cut Slide 3 into one sentence on Slide 2; cut Slide 7 (mention provenance during Act 3 step 2); merge Slides 8–10 into one slide with three columns and the ask. Act 3 stays untouched.

---

## 7. Stage logistics checklist

- [ ] One laptop, all windows pre-opened and arranged: Comet (student logged in), Chrome + extension (recorded clip instead), dashboard, slides, backup video queued
- [ ] Portal running on `localhost` with `COUNTERSIGN=off` and `COUNTERSIGN=on` instances on different ports so there's no restart mid-demo
- [ ] Touch ID enrolled and tested *in Comet* on the demo account that morning
- [ ] Backup video of every act, trimmed, with the same narration beats
- [ ] Do Not Disturb on; notifications off; display sleep off; screen mirroring tested
- [ ] Internet: Comet needs it. If the venue Wi-Fi is bad, tether — test tethering beforehand
- [ ] Prompts pre-typed and copied to clipboard history; never type live
- [ ] Rehearsed 3× end-to-end, timed, once with a forced fallback to video
