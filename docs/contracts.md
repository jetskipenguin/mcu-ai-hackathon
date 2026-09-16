# Contracts — Countersign

The interfaces Track A (portal + enforcement) and Track B (dashboard + generator) build to. Change this file in the same commit as any change to an interface. Examples are normative: field names and enum values are exact.

---

## 1. Provenance log event

One JSONL line per governed decision, appended to `data/provenance.jsonl`. Never rewritten.
The schema is finalized for this demo. Ellipses in the example below abbreviate
identifiers/hashes; they are not literal runtime values.

```json
{
  "ts": "2026-09-16T13:02:11.482Z",
  "event_id": "evt_01J9…",
  "session_id": "sess_…",
  "user": { "id": "stu-0011", "name": "Capt J. Demo" },
  "route": "/quiz/1",
  "action": "POST /quiz/1/submit",
  "rule_id": "quiz-submit",
  "class": "human-required",
  "decision": "allowed",
  "actor_class": "human-verified",
  "presence": {
    "assertion_id": "asr_7f3a…",
    "credential_id": "cred_…",
    "up": true,
    "uv": true,
    "age_ms": 1840
  },
  "attestation": null,
  "signals": { "score": 0.82, "flags": ["fill-without-focus", "uniform-timing"] },
  "telemetry": null,
  "form_hash": "sha256:9c1e…",
  "notes": ""
}
```

Enums:

| Field | Values |
|---|---|
| `class` | `human-required` · `attested` · `marking` · `unrestricted` |
| `decision` | `allowed` · `blocked` · `flagged` · `masked` · `unmasked` · `presence-requested` · `contradiction` |
| `actor_class` | `human-verified` · `agent-declared` · `automation-suspected` · `unverified` |
| `attestation` | `own-work` · `ai-assisted` · `null` |

Field semantics:

- All shown top-level fields are present. Unavailable `presence`, `attestation`,
  `telemetry`, and `form_hash` are explicitly `null`; `notes` may be empty.
- The writer assigns `ts` (UTC ISO timestamp) and an opaque, unique `event_id`.
  IDs are not sortable timestamps. JSONL append order is the event order, even
  across clock corrections. The current ID implementation is `evt_` plus UUID hex.
- `session_id` and `user` come from server authentication context, never submitted
  identity claims. This portal uses selectable synthetic identities, not real SSO.
- `presence: null` means **no accepted action-time presence proof for this
  decision**. This includes missing, rejected, and expired assertions as well as
  visits, signal observations, and challenge requests. An accepted proof has UP
  true, UV as verified (false is valid for `preferred`), and finite nonnegative age.
  `human-verified` requires that accepted proof; a previous login or action does
  not confer this classification on a later page visit.
- `attestation` is the declaration bound to the challenge. It can remain null on
  failures before binding succeeds. It is not an authorship determination.
- `signals.score` is finite and in `[0,1]`; `flags` is a string array. Signals are
  advisory, including when attached to `human-verified` decisions. On page visits,
  known session evidence and request declarations retain the precedence in §7.
- `telemetry` is normalized advisory data, non-null only for `attested` actions
  (see §5). It is never a substitute for presence or a reason to reject valid proof.
- `form_hash` is the SHA-256 of canonical editable form fields (§6). Visits,
  signal observations, and record decisions use null. Record reveal internally
  binds the empty form but has no editable form hash to report.
- `route` names the governed page. Form challenge events use the target submit
  action, while record challenge/verification events use their respective
  `/countersign/unmask` and `/countersign/unmask/verify` action paths. Signal
  observations carry a client-reported route (possibly empty), not proof of a
  navigation. `scaffold-route-visit`, `session-signals`, and `default-unrestricted`
  are synthetic rule IDs, not entries that must appear in the policy file.
- `allowed` records a governance authorization, not the outcome of later portal
  validation/persistence. One submission has one `allowed` or `blocked` decision;
  attestation findings produce separate linked `contradiction`/`flagged` events.
  A signal observation may independently produce a `flagged` event.

The writer normalizes advisory telemetry and validates metadata shape, enums,
numeric ranges, and actor/presence consistency before appending. That validation
does not perform cryptographic verification; the WebAuthn service does. Audit
write failures propagate rather than silently authorize an unrecorded action.

Events the demo must produce, in order, for Act 3:

1. `presence-requested` on `quiz-submit` (agent clicked Submit)
2. `allowed` / `human-verified` on `quiz-submit` (human touched sensor)
3. `masked` / `automation-suspected` on `student-record`
4. `unmasked` / `human-verified` on `student-record.unmask`
5. `presence-requested` on `discussion-initial-post`
6. `allowed` + `contradiction` / `human-verified` on `discussion-initial-post` (attested own-work, telemetry says single-event fill)

---

## 2. Policy file

`countersign/policy/countersign.policy.json` (active) and `countersign.policy.draft.json` (generator output). Same schema.

```json
{
  "version": "0.1",
  "app": "mcu-learning-portal",
  "defaults": { "class": "unrestricted", "signals": { "suspect_threshold": 0.6 } },
  "rules": [
    {
      "id": "quiz-submit",
      "match": { "route": "/quiz/*", "action": "POST /quiz/:id/submit" },
      "class": "human-required",
      "presence": { "uv": "required", "max_age_s": 60 },
      "rationale": "Exam submission. Academic integrity requires the enrolled student to perform this.",
      "citations": []
    },
    {
      "id": "discussion-initial-post",
      "match": { "route": "/discussion/*", "action": "POST /discussion/:id/post", "when": { "is_initial_post": true } },
      "class": "attested",
      "ai_use": "disclosed",
      "presence": { "uv": "preferred", "max_age_s": 60 },
      "rationale": "Q&A forum, independent_first: the initial post must be the learner's own thinking.",
      "citations": []
    },
    {
      "id": "student-record",
      "match": { "route": "/record/*" },
      "class": "marking",
      "markings": [
        { "selector": "[data-field=ssn]",     "marking": "<from data/cui/>", "categories": ["PII"] },
        { "selector": "[data-field=dod-id]",  "marking": "<from data/cui/>", "categories": ["PII"] },
        { "selector": "[data-field=medical]", "marking": "<from data/cui/>", "categories": ["PHI"] }
      ],
      "page_marking": "<from data/cui/>",
      "mask_when": "automation-suspected",
      "unmask": { "rule_id": "student-record.unmask", "class": "human-required", "presence": { "uv": "required", "max_age_s": 300 } },
      "rationale": "Personnel and medical data; not authorized for third-party models.",
      "citations": [ { "source": "cui-registry", "ref": "<category id>", "excerpt": "<one sentence>" } ]
    }
  ]
}
```

Field notes:

- `match.route` is a glob; `match.action` is `METHOD /path` with Express-style params; `match.when` is an optional object of named predicates the portal evaluates (`is_initial_post` is the only one for the demo).
- `presence.uv`: `required` forces user verification (Touch ID); `preferred` accepts presence-only (security key tap). `max_age_s`: how old an assertion may be at the moment the action executes.
- `ai_use` (attested only): `prohibited` · `disclosed` · `encouraged`. Changes the attestation wording and what counts as a contradiction (§7).
- `markings[].marking` and `page_marking` must be identifiers present in `data/cui/categories.json` or `data/cui/ldcs.json`. The policy loader rejects unknown identifiers.
- `citations[]` is generator output for the approval view: `{source, ref, excerpt}`. Empty array is valid.
- Approving a draft copies it over the active file and the server hot-reloads. No restart.

---

## 3. Server endpoints

All under `/countersign/`. JSON in, JSON out. Errors: `{ "error": "<code>", "message": "…" }`.

### WebAuthn — registration (once per user, first login)

| Endpoint | Body | Returns |
|---|---|---|
| `POST /countersign/webauthn/register/options` | `{}` (session user) | `PublicKeyCredentialCreationOptionsJSON` |
| `POST /countersign/webauthn/register/verify` | `RegistrationResponseJSON` | `{ "ok": true, "credential_id": "cred_…" }` |

Both endpoints require the signed-in session and a JSON request. Registration
challenges are random, session/user-bound, single-use, and valid for 120 seconds.
Registration verifies the exact origin `http://localhost:3000`, RP ID `localhost`,
and both UP and UV before saving any credential. `credential_id` is the
authenticator's base64url credential ID; `cred_…` above is illustrative.

The governed portal redirects first login to `/register` when the user has no
credentials. `/register` also allows adding a passkey for another browser profile.
Public keys (base64url), counters, transports, and device/backup metadata are saved
in `data/credentials.json`, keyed by user ID. Challenges stay in memory and do not
survive a server restart. The two portal instances use separate signed-cookie
names because cookies are shared across ports on the same hostname.

Quiz, discussion, and record reveal use the same registration, credential store,
and verifier. A newly enrolled credential is immediately usable by each flow;
record and form challenges cannot authorize each other's actions. Session signal
scores/declarations are included in form provenance, but a valid presence proof
still takes precedence as `human-verified` regardless of the score.

Ceremony endpoints return `401 login_required` without a session,
`415 json_required` for non-JSON requests, and `403 origin_mismatch` when a browser
sends an Origin other than `http://localhost:3000`. Registration verification
failures return HTTP 400 with the standard error/message envelope. The ungoverned
instance returns `404 countersign_disabled` for these endpoints without issuing
challenges, verifying credentials, or writing provenance.

### WebAuthn — action step-up

| Endpoint | Body | Returns |
|---|---|---|
| `POST /countersign/challenge` | `{ "rule_id", "action", "form_hash", "attestation"?: "own-work"\|"ai-assisted" }` | `{ "challenge_id", "options": PublicKeyCredentialRequestOptionsJSON, "expires_at" }` |

The server stores `{challenge_id → {challenge, user, session_id, rule_id, action, form_hash, attestation, created}}`. It consumes the entry synchronously before verification, whether the attempt succeeds or fails. Entries expire after 120 seconds and are removed on consumption or expiry pruning during subsequent issuance. The rule's shorter `max_age_s` also applies.

The portal supplies a server-owned registry of action/route pairs and predicates;
the client cannot invent an action or declare `is_initial_post`. Issuance validates
the active rule, action, canonical hash syntax, and attestation. Invalid bindings
return HTTP 400 (`invalid_action` or `invalid_binding`); a user with no registered
credential receives `409 registration_required` and must visit `/register`.
Successful issuance writes one `presence-requested` event. Its authentication
options allow only credentials belonging to the signed-in user.

### Governed form submission

The portal's own action route (e.g. `POST /quiz/1/submit`) receives the normal form fields **plus** a `countersign` object:

```json
{
  "answers": { "q1": "b", "q2": "d", "q3": "a", "q4": "c", "q5": "b" },
  "countersign": {
    "challenge_id": "chg_…",
    "assertion": { "...": "AuthenticationResponseJSON" },
    "attestation": null,
    "telemetry": null
  }
}
```

Middleware order on a governed route: match rule → recompute `form_hash` from submitted fields and compare with the stored challenge → verify assertion (see `webauthn-notes.md`) → check `presence.uv` / `max_age_s` → derive `actor_class` (§7) → write event → call the route handler. Any failure returns:

```json
HTTP 403  { "error": "countersign_required", "reason": "no_assertion" | "expired" | "form_mismatch" | "verification_failed" | "uv_required" }
```

and writes a `blocked` event. The ungoverned instance (`COUNTERSIGN=off`) skips all of this and writes nothing.

Binding checks also compare the signed-in user/session, concrete action, rule ID,
and attestation. A cross-user/session attempt returns `verification_failed`;
rule/action/form/attestation mismatches return `form_mismatch`. Expiration is
checked again after asynchronous signature verification. Each submission has one
`allowed` or `blocked` decision; the additional advisory attestation decisions in
§7 are separate events. Cancellation in the browser sends no submission, leaving
only the challenge's `presence-requested` event.

The quiz's JSON success response is `{ "ok": true, "message": "…", "assertion_id": "asr_…" }`;
`assertion_id` is null for an unrestricted/ungoverned submission. The client shows
the success message in the form. Signal delivery failures never prevent the
presence ceremony, and editing a form during confirmation requires a new ceremony.

### Discussion post provenance (A9)

`POST /discussion/2/post` saves the server-generated `SubmissionProvenance` with
the published post and returns it in the JSON success response:

```json
{
  "ok": true,
  "post_id": "post_…",
  "message": "Discussion response published.",
  "redirect": "/discussion/2?posted=post_…#post_…",
  "provenance": {
    "event_id": "evt_…",
    "actor_class": "human-verified",
    "attestation": "own-work",
    "presence": {
      "assertion_id": "asr_…",
      "credential_id": "…",
      "up": true,
      "uv": true,
      "age_ms": 1840
    },
    "review_flags": [
      { "decision": "contradiction", "event_id": "evt_…", "notes": "Attestation and composition telemetry disagree." }
    ]
  }
}
```

- `event_id` identifies the actual `allowed` JSONL event. Each review flag
  identifies a separately written `contradiction` or `flagged` event. A normal
  post has `review_flags: []`. A9 does not add or duplicate log decisions.
- This metadata is generated only after server verification/logging. Client
  `provenance`, actor labels, presence claims, and review flags are ignored.
- Rendering distinguishes **AI-assisted (disclosed)** or **Own work (declared)**
  from **Human presence verified at submit**. Presence does not certify authorship.
  Review flags are displayed as **Flagged for review** without preventing publication.
  The details disclosure shows actor class, assertion properties, and event IDs.
- Seeded posts without recorded metadata show **Provenance not recorded**.
  Governed unrestricted posts without proof show **Presence not verified** and
  **AI use not attested**. Ungoverned posts return `provenance: null` and display
  no Countersign badges.
- Posts and their metadata share the portal's existing in-memory lifetime:
  they survive reloads/logins, not server restarts. The JSONL audit remains durable.
  The `posted` query parameter forces a page reload; the fragment then scrolls to
  the new post. A fragment-only redirect would leave the old form on screen.

### Signals and masking

| Endpoint | Body | Returns |
|---|---|---|
| `POST /countersign/signals` | `{ "route", "signals": { … §4 } }` | `{ "score": 0.0–1.0, "flags": ["…"], "flagged": bool, "actor_class" }`; retains observed suspicion in the signed-in session |
| `POST /countersign/record-fields` | `{ "signals": { … §4 } }` | Signal result + `masked: bool`; `fields: {name, ssn, "dod-id", medical}` only for a complete, unflagged signal sample and a session with no previous suspicion |
| `POST /countersign/unmask` | `{ "rule_id": "student-record.unmask", "action": "POST /countersign/unmask/verify" }` | `{challenge_id, options, expires_at}`; `409 registration_required` if no passkey is enrolled |
| `POST /countersign/unmask/verify` | `{ "challenge_id", "assertion" }` | `{ "ok": true, "fields": {name, ssn, "dod-id", medical} }` only after a valid action-bound presence assertion |

Governed record HTML **always contains placeholders**, including the name. Values are not embedded in hidden nodes, attributes, scripts, or CSS. The client evaluates signals and requests `/record-fields` atomically, so a read before JavaScript finishes never sees plaintext. Missing signals or failed requests leave placeholders. Responses use `Cache-Control: no-store` and the marking header. The record belongs to the signed-in user, not a client-selected ID.

Record-reveal challenges have a fixed action, no editable form, and are bound to `{session_id, user_id, rule_id, random challenge, created}`. They cannot authorize other actions. They are consumed on first verification attempt, expire after 120 seconds (or the policy age, if shorter), and require the policy's UV setting. Registration uses the real SimpleWebAuthn verifier and persists credentials in `data/credentials.json`. Registration alone never reveals fields. Successful reveal returns fields only for this view; it does not clear suspicion or grant subsequent plaintext requests. The client remasks on backgrounding and before back/forward caching.

Each initial HTML response and each subsequent field-release/reveal decision has its own provenance event; no field values are logged. A flagged field request produces `masked / automation-suspected`; a verified reveal produces `unmasked / human-verified` with assertion metadata. Declared agents also stay masked until presence verification.

Marked pages set a response header on the initial HTML:

```
Countersign-Marking: <page_marking>; categories=PII,PHI
```

### Dashboard / policy

| Endpoint | Returns |
|---|---|
| `GET /countersign/events?since=<event_id>` | `{ "events": [ … ] }` newest last |
| `GET /countersign/sessions/flagged` | `{ "sessions": [ { session_id, user, score, first_seen, flags } ] }` |
| `GET /countersign/policy` | active policy |
| `GET /countersign/policy/draft` | draft policy or `404` |
| `POST /countersign/policy/generate` | `{}` → `{ "ok": true, "draft_version", "generated_at", "provider", "model", "source_urls", "vocabulary", "draft_revision" }` (`region` also present for Bedrock) |
| `POST /countersign/policy/approve` | `{ "rule_ids": ["…"] }` or `{ "all": true }` → `{ "ok": true, "active_version", "active_revision", "approved_rule_ids" }` |

Timeline/read semantics:

- `/events` returns append order with `Cache-Control: no-store`. `since` is an
  exclusive event-ID cursor: omit the matched event and return subsequent lines.
  An absent, empty, or unknown cursor returns the full log. A missing/empty log
  returns `events: []`.
- A syntactically incomplete final line without its terminating newline is
  deferred until the next poll. A malformed completed line or invalid event
  metadata fails the read: HTTP 500 with `error: "provenance_unavailable"` and a
  generic message, never raw record contents. A valid final JSON record is readable
  even without its newline. Reads normalize historical advisory telemetry using
  §5's rules and annotate discards; the stored JSONL is never rewritten.
- Dashboard `/countersign/?user=<id>` filters the full snapshot by exact user ID,
  not display name. It polls every second with no overlapping request, preserves
  open event evidence/focus across updates, and retains the last displayed events
  with an error notice while retrying after failure. Details show the complete
  event, including session/event/assertion IDs, proof flags/age, attestation,
  signals, telemetry, hash, and notes. User/event text is rendered as text, not HTML.
- `/sessions/flagged` requires a signed-in governed session. Its five response
  fields are exactly those shown above. It lists in-memory signal-suspect sessions
  for this process, not a historical aggregation of all contradiction events.
  `first_seen` is the first signal observation, not the first flag; restarting the
  server resets that view while the JSONL timeline persists. A presence verification
  does not erase retained advisory suspicion.

The timeline is a local synthetic-demo read interface, not a production
administrator authorization system.

Generation and approval require the governed instance, a signed-in demo session,
JSON, and the expected browser Origin when supplied (`http://localhost:3000`).
They return 404 on the ungoverned instance, 401 without a session, 415 for non-JSON,
and 403 for an unexpected Origin. This is the demo's fake-SSO workflow, not an
administrator role system.

- **Generation:** uses server-configured `GENERATOR_BASE_URL` (HTTP localhost
  only) and `GENERATOR_USER_ID`. It logs into the ungoverned instance and fetches
  only the three demo pages, without submitting their forms. Cookies/credentials
  are not part of the model prompt. Concurrent generation returns 409; provider,
  crawl, or model-validation failures return 502 with an error/message envelope.
- **Draft files:** validated JSON is written atomically to the draft path, with
  provenance in `countersign.policy.draft.meta.json`. Metadata contains the model,
  source URLs, timestamp, vocabulary counts/placeholder status, and the draft's
  SHA-256 revision. Stale metadata is ignored if its revision does not match.
  Generation never writes the active policy.
- **Citations:** new marking references are restricted to the loaded vocabulary.
  Each selected marking gets its actual supplied description, with source
  `cui-registry` or, for placeholders, `scaffold-vocabulary`. Model-supplied
  quotations must match the supplied source. Optional corpus-chunk retrieval is
  separate B5 work.
- **Approval:** `rule_ids` must be unique, known, and non-empty, and cannot be
  combined with `all`. Per-rule approval replaces only those rules and preserves
  active defaults. Approve-all replaces the complete policy. Both validate the
  three demo interfaces, including UV-required quiz submission and record reveal.
  Unknown selections return 400; no draft returns 404; invalid drafts return 422.
- **Stale review protection:** the UI includes optional `active_revision` and
  `draft_revision` hashes in approval requests. A mismatch returns 409 and changes
  nothing. The hashes are SHA-256 of `JSON.stringify(policy)`; they are content
  revisions rather than user-controlled version labels.
- **Hot reload:** approval atomically replaces the active file. Form rendering,
  challenges, submission middleware, and record protection read that same store
  on subsequent requests. The existing server is not restarted.

The importer accepts the extracted public reference corpus via `--corpus`, or
normalized JSON arrays via `--categories` and `--ldcs` using §8's vocabulary fields.
It requires the dataset's expected 126 categories and 10 LDCs with definitions, and
retains old identifiers with `legacy: true` so an existing active policy remains
valid during migration. Newly generated drafts exclude those legacy identifiers
when the imported vocabulary is available. The current imported vocabulary is
126 categories and 10 LDCs; three legacy placeholders are retained only for the
existing active policy. The review UI and draft metadata expose vocabulary counts
and whether the generator is using placeholders.

---

## 4. Client → server signal payload

Sent by `countersign.js` on page load and again immediately before any governed submit.

```json
{
  "route": "/record/1",
  "signals": {
    "webdriver": false,
    "document_hidden": true,
    "document_has_focus": false,
    "pointer_events_before_input": 0,
    "keydown_events": 0,
    "fields_filled": 6,
    "fill_span_ms": 210,
    "visibility_hidden_during_input": false,
    "focus_before_fill": false,
    "agent_header_declared": false
  }
}
```

Scoring is server-side, deterministic, and documented in `countersign/server/signals.ts` as a weighted sum clamped to `[0,1]`. Weights are tunable in policy `defaults.signals`. **The score never blocks.**

The active policy gives `webdriver` and `background_record_read` weights of `0.6` each; fill-without-focus, fast multi-field input, and hidden input have weights of `0.2` each. `background-record-read` means a `/record/1` signal sample reports both a hidden document and no focus. This catches the observed BrowserOS neo background read even though its `navigator.webdriver` is false and its user agent looks like Chrome. It is deliberately labeled **suspected**: human background tabs can trigger it, and foreground agents or spoofed client telemetry can evade it. No universal agent fingerprint is claimed. Positive evidence is retained server-side for the lifetime of the login session (in-memory for this demo); later clean samples cannot downgrade it. Human-required submissions still need presence regardless of score.

---

## 5. Composition telemetry (attested actions)

Collected per text field by `countersign.js`, sent in `countersign.telemetry` on submit.

Shape: one field object, an array of field objects, or null. Current clients send
all the example's metrics; partial samples are accepted for compatibility, and
omitted metrics are not imputed as zeros. `first_input_ts` and `last_input_ts` may
be null when no input occurred. Missing/empty telemetry normalizes to null.

```json
{
  "field": "body",
  "final_length": 1774,
  "keystrokes": 0,
  "input_events": 1,
  "input_types": { "insertText": 0, "insertFromPaste": 0, "other": 1 },
  "single_event_fill": true,
  "time_on_field_ms": 340,
  "first_input_ts": "…",
  "last_input_ts": "…"
}
```

`single_event_fill` is true when ≥ 80% of `final_length` arrived in one `input` event.

Only the listed field names are retained. Counts and `time_on_field_ms` must be
nonnegative safe integers, `input_types` maps input-type strings to such counts,
`single_event_fill` is boolean, and non-null input timestamps must be parseable
timestamps. Unknown keys (including arbitrary text payloads) are removed; a
malformed known metric discards that field's entire sample. Valid samples in an
array are retained; no valid samples yields null. Discards are noted in event
`notes`. Contradiction checks use this normalized data, never coerced or malformed
metrics, and remain advisory. Telemetry is client-reported and does not establish
authorship.

---

## 6. Canonical form hash

`form_hash = "sha256:" + hex(sha256(canonical))` where `canonical` is the form's fields (excluding the top-level `countersign` object) sorted by name, JSON-serialized with no whitespace. Nested object keys are recursively sorted with the same JavaScript serialization on client and server; array order and value types are preserved. Client computes it at challenge time; server recomputes from the submitted body. Mismatch → `form_mismatch`. This binds the assertion to the exact submission.

---

## 7. Actor-class derivation (server, deterministic)

Evaluated in order; first match wins.

1. Valid assertion, `up: true`, within `max_age_s`, `uv` satisfies rule → `human-verified`
2. Request or session carries a cooperative agent declaration (header `Countersign-Agent: <id>` or a WebMCP-style declaration) → `agent-declared`
3. Signal score ≥ `suspect_threshold` → `automation-suspected`
4. Otherwise → `unverified`

Note that `human-verified` on an `attested` action says a human was present at submit — it does not assert authorship. Authorship is what the attestation + telemetry pair records.

**Contradiction rule (attested):** `decision: contradiction` is written in addition to `allowed` when `attestation == "own-work"` and (`telemetry.single_event_fill` or `telemetry.keystrokes < 0.1 × final_length`). With `ai_use: prohibited`, an `ai-assisted` attestation is also logged as `flagged`. Never blocked.

---

## 8. Fixtures

- `portal/data/students.json` — 3 students + the demo student (`stu-0011`, "Capt J. Demo", no forum posts yet). SSNs 900-series. DoD IDs random.
- `portal/data/quiz.json` — 5 MCQs from Lesson 2 Reading, *Fundamentals of National Defense*, in the supplied AY27 8670 coursebook. `source_ref` includes the section and original PDF page number per question. The submit handler records acceptance; it does not grade answers.
- `portal/data/forum.json` — the 8801 Seminar 12 dataset filtered to `ifd == 2`: 31 records, comprising the opening prompt plus 30 subsequent posts. Original `roster[]`/`posts[]` fields and ordering are preserved; roster entries gain `user_id`/`name`, posts gain `user_id`, and the demo student is appended with `tier: "-"`. `fac-0001` is the instructor, `stu-0011` is the unposted demo learner. `source_dataset` holds the full source's metadata/counts; `course` retains course metadata. `faculty_prompt_post_id` identifies the opening prompt rendered separately from the peer list. Imported posts have no invented `provenance`. The complete PDF synthetic notice is retained in `synthetic_data_notice`.
- `data/cui/categories.json` and `data/cui/ldcs.json` — extracted from the CUI Tagging Dataset; shape `{ "id", "name", "authority"?, "description"?, "source"?, "placeholder"?, "legacy"? }`. Imported categories use the exact manifest `source_id`; LDCs use the exact `marking`. `source` retains original metadata (source URL/ID, marking/banner alternatives, portion marking, provisional status, review date as applicable). `description` supplies the exact category definition or the LDC definition/notes extracted from the companion Registry text. IDs identify vocabulary entries, not independently validated complete CUI banners.
