# Contracts — Countersign

The interfaces Track A (portal + enforcement) and Track B (dashboard + generator) build to. Change this file in the same commit as any change to an interface. Examples are normative: field names and enum values are exact.

---

## 1. Provenance log event

One JSONL line per governed decision, appended to `data/provenance.jsonl`. Never rewritten.
The demo-only administrative discussion reset (§3) also appends an event in both modes.
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
  "signals": { "score": 0, "flags": [] },
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
| `actor_class` | New events: `human-verified` · `unverified`. Historical audit records also accept `agent-declared` · `automation-suspected`. |
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
  visits and challenge requests. An accepted proof has UP
  true, UV as verified (false is valid for `preferred`), and finite nonnegative age.
  `human-verified` requires that accepted proof; a previous login or action does
  not confer this classification on a later page visit.
- `attestation` is the declaration bound to the challenge. It can remain null on
  failures before binding succeeds. It is not an authorship determination.
- `signals` is retained for audit compatibility. New events always write
  `{ "score": 0, "flags": [] }`; no browser signals are collected or scored.
  Historical scores remain readable (finite, in `[0,1]`, with string-array flags).
- `telemetry` is normalized advisory data, non-null only for `attested` actions
  (see §5). It is never a substitute for presence or a reason to reject valid proof.
- `form_hash` is the SHA-256 of canonical editable form fields (§6). Visits,
  and record decisions use null. Record reveal internally
  binds the empty form but has no editable form hash to report.
- `route` names the governed page. Form challenge events use the target submit
  action, while record challenge/verification events use their respective
  `/countersign/unmask` and `/countersign/unmask/verify` action paths.
  `scaffold-route-visit`, `default-unrestricted`, and
  `demo-discussion-reset` are synthetic rule IDs, not entries that must appear in
  the policy file.
- `allowed` records a governance authorization, not the outcome of later portal
  validation/persistence. One submission has one `allowed` or `blocked` decision;
  attestation findings produce separate linked `contradiction`/`flagged` events.
  Historical signal events remain in the append-only log.

The writer normalizes advisory telemetry and validates metadata shape, enums,
numeric ranges, and actor/presence consistency before appending. That validation
does not perform cryptographic verification; the WebAuthn service does. Audit
write failures propagate rather than silently authorize an unrecorded action.

Events the demo must produce, in order, for Act 3:

1. `presence-requested` on `quiz-submit` (agent clicked Submit)
2. `allowed` / `human-verified` on `quiz-submit` (human touched sensor)
3. `masked` / `unverified` on `student-record` (every session)
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
  "defaults": { "class": "unrestricted" },
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
      "mask_when": "always",
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
- Marking rules require `mask_when: "always"` and a `human-required` unmask rule with `presence.uv: "required"`. Missing/default-off masking, conditional agent masking, and presence-only reveal policies are rejected. `defaults.signals` is no longer supported.
- `citations[]` is generator output for the approval view: `{source, ref, excerpt}`. Empty array is valid.
- Approving a draft copies it over the active file and the server hot-reloads. No restart.

---

## 3. Server endpoints

Service endpoints are under `/countersign/`; portal action routes are named below. JSON in, JSON out; errors: `{ "error": "<code>", "message": "…" }`, except where noted.

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
record and form challenges cannot authorize each other's actions. Only accepted
action-time proof produces `human-verified`; browser behavior and agent declarations
are not inspected or classified.

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

The server stores `{challenge_id → {challenge, user, session_id, rule_id, action, form_hash, attestation, created, generation}}`. It consumes the entry synchronously before verification, whether the attempt succeeds or fails. Entries expire after 120 seconds and are removed on consumption, action revocation, or expiry pruning during subsequent issuance. The rule's shorter `max_age_s` also applies.

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

and writes a `blocked` event. Ordinary submissions on the ungoverned instance (`COUNTERSIGN=off`) skip all of this and write nothing. The demo-only administrative reset below is an explicit audit exception.

Binding checks also compare the signed-in user/session, concrete action, rule ID,
and attestation. A cross-user/session attempt returns `verification_failed`;
rule/action/form/attestation mismatches return `form_mismatch`. Expiration and the
per-user/action generation are checked again after asynchronous signature
verification. Each submission has one `allowed` or `blocked` decision; the
additional advisory attestation decisions in §7 are separate events. Cancellation
in the browser sends no submission, leaving only the challenge's
`presence-requested` event.

The quiz's JSON success response is `{ "ok": true, "message": "…", "assertion_id": "asr_…" }`;
`assertion_id` is null for an unrestricted/ungoverned submission. The client shows
the success message in the form. Editing a form during confirmation requires a
new ceremony.

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

### Demo-only discussion reset

Only signed-in Capt J. Demo (`stu-0011`) sees the initially collapsed **Demo
controls** on `/discussion/2`, on both governed and ungoverned instances. Its native
**Reset discussion demo** form includes a hidden `reset_token` and a required
confirmation checkbox. This is a synthetic-demo affordance, not production
administrator authorization or a human-only guarantee; reset requires no WebAuthn
assertion or attestation.

`POST /discussion/2/reset` accepts `application/json` or
`application/x-www-form-urlencoded` with `reset_token` and
`confirmation: "reset-discussion"`. The CSRF token is HMAC-bound to the current
session, instance, mode, and reset generation. Successful reset advances the
generation, invalidating old tokens even in the same session. If supplied, Origin
must exactly equal `http://localhost:3000` in governed mode or
`http://localhost:3001` in ungoverned mode.

A JSON request returns the removed-post count, for example:

```json
{ "ok": true, "removed_posts": 1, "redirect": "/discussion/2?reset=1" }
```

A URL-encoded native form submission instead returns HTTP 303 to
`/discussion/2?reset=1`. The standard `requireUser` behavior applies before reset
validation: without a signed-in session, clients accepting HTML receive HTTP 303
to `/login`; requests with `Accept: application/json` receive `401 login_required`.

| Condition | Response |
|---|---|
| Signed-in user is not `stu-0011` | `403 demo_user_required` |
| Supplied Origin differs from the mode's canonical origin | `403 origin_mismatch` |
| Unsupported media type | `415`, body `{ "error": "unsupported_content_type" }` |
| Missing/invalid token, including another session/instance/mode or a pre-reset token | `403 invalid_reset_token` |
| Missing or incorrect confirmation | `400 confirmation_required` |
| Otherwise-valid concurrent reset while one is in progress | `409 reset_in_progress` |
| Audit append unavailable | `500 reset_not_recorded`; no posts removed |

Reset removes only this user's runtime-added discussion posts on the current
instance. Seeded posts, other users' runtime posts, and the other instance's posts
are retained. It clears the demo user's initial-post status, so the next page
response server-hides peers and restores the initial-response composer. The next
governed initial submission requires a fresh attestation and WebAuthn proof.
Credentials, login session, policies, and prior JSONL history
are retained; no restart, new dependency, or environment flag is required.

After the audit append, the WebAuthn service advances the generation for this
user and `POST /discussion/2/post` only. It revokes pending discussion challenges
and invalidates in-flight verification and challenge-option generation. Quiz,
record-reveal, registration, and other users' challenges are unaffected. The
portal also checks its discussion generation at the final post commit: this
user's submissions during reset or stale in-flight submissions reaching that
check return `409 discussion_reset`, including requests that matched unrestricted
before reset. A prior `allowed` governance event may remain even when this final
portal check prevents publication (§1).

Each successful reset first appends one administrative event, **even with
`COUNTERSIGN=off`**, before deleting posts. This narrow exception does not enable
governance logging for ordinary ungoverned actions. The event uses the existing
schema: `route: "/discussion/2"`, `action: "POST /discussion/2/reset"`,
`rule_id: "demo-discussion-reset"`, `class: "unrestricted"`, and
`decision: "allowed"`. `presence`, `attestation`, `form_hash`, and `telemetry` are
null; signals use the neutral legacy value, and actor class is `unverified` without
an accepted proof. Notes include `COUNTERSIGN=on` or `COUNTERSIGN=off`, `removed_posts`, and
`removed_post_ids`, never post bodies or the CSRF token. No decision enum or policy
rule is added, and old timeline events are never removed.

Reload other open discussion tabs after reset. Reset cannot make a person or agent
forget peers already seen; use a fresh agent context for a clean independent-first
measurement.

The policy crawler omits the server-rendered `data-demo-controls` section,
including its token and reset form, before building model input. Administrative
reset is not a proposed policy action. If an initial form is missing because the
crawler's demo student has already posted, it reports an error with reset guidance
rather than performing any reset itself.

### Default masking and human authentication

| Endpoint | Body | Returns |
|---|---|---|
| `POST /countersign/record-fields` | Ignored (legacy clients) | `{ "masked": true }`; never returns fields, including after a verified reveal |
| `POST /countersign/unmask` | `{ "rule_id": "student-record.unmask", "action": "POST /countersign/unmask/verify" }` | `{challenge_id, options, expires_at}`; `409 registration_required` if no passkey is enrolled |
| `POST /countersign/unmask/verify` | `{ "challenge_id", "assertion" }` | `{ "ok": true, "fields": {name, ssn, "dod-id", medical} }` only after a valid action-bound presence assertion |

Governed record HTML **always contains placeholders**, including the name. Values are not embedded in hidden nodes, attributes, scripts, or CSS. Every session remains masked until human authentication: PII, PHI, and CUI-marked content is never released based on browser behavior, focus, timing, headers, or client claims. No automatic field request is made at page load. JavaScript disabled, failed requests, canceled authentication, and invalid proof all leave placeholders. Responses use `Cache-Control: no-store` and the marking header. The record belongs to the signed-in user, not a client-selected ID.

Record-reveal challenges have a fixed action, no editable form, and are bound to `{session_id, user_id, rule_id, random challenge, created}`. They cannot authorize other actions. They are consumed on first verification attempt, expire after 120 seconds (or the policy age, if shorter), and require UP and UV. Registration uses the real SimpleWebAuthn verifier and persists credentials in `data/credentials.json`. Registration alone never reveals fields. Successful reveal returns fields only for this view; it does not grant subsequent plaintext requests. The client remasks on backgrounding and before back/forward caching. Reloading requires fresh authentication.

Each initial HTML response and each subsequent field/reveal decision has its own provenance event; no field values are logged. An unverified field request produces `masked / unverified`; a verified reveal produces `unmasked / human-verified` with assertion metadata. The former signal and flagged-session endpoints are removed (404).

Marked pages set a response header on the initial HTML:

```
Countersign-Marking: <page_marking>; categories=PII,PHI
```

### Dashboard / policy

| Endpoint | Returns |
|---|---|
| `GET /countersign/events?since=<event_id>` | `{ "events": [ … ] }` newest last |
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
- No agent-detection session state is retained. Historical actor labels and
  signals remain available in event details; the current legend shows only
  `human-verified` and `unverified`.

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

## 4. Agent detection removed

The client does not collect or transmit browser-agent detection signals. The
server does not score browser behavior, inspect agent declarations, or retain
suspected-agent sessions. `POST /countersign/signals` and
`GET /countersign/sessions/flagged` return 404. Previously supplied signals and
`Countersign-Agent` headers cannot release content or change actor classification.
Visibility events are used only to remask an already revealed view, not to infer
who is using the browser. Discussion composition telemetry (§5) remains an
advisory record of composition, not an agent classifier or an authentication input.

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
2. Otherwise → `unverified`

Note that `human-verified` on an `attested` action says a human was present at submit — it does not assert authorship. Authorship is what the attestation + telemetry pair records.

**Contradiction rule (attested):** `decision: contradiction` is written in addition to `allowed` when `attestation == "own-work"` and (`telemetry.single_event_fill` or `telemetry.keystrokes < 0.1 × final_length`). With `ai_use: prohibited`, an `ai-assisted` attestation is also logged as `flagged`. Never blocked.

---

## 8. Fixtures

- `portal/data/students.json` — 3 students + the demo student (`stu-0011`, "Capt J. Demo", no forum posts yet). SSNs 900-series. DoD IDs random.
- `portal/data/quiz.json` — 5 MCQs from Lesson 2 Reading, *Fundamentals of National Defense*, in the supplied AY27 8670 coursebook. `source_ref` includes the section and original PDF page number per question. The submit handler records acceptance; it does not grade answers.
- `portal/data/forum.json` — the 8801 Seminar 12 dataset filtered to `ifd == 2`: 31 records, comprising the opening prompt plus 30 subsequent posts. Original `roster[]`/`posts[]` fields and ordering are preserved; roster entries gain `user_id`/`name`, posts gain `user_id`, and the demo student is appended with `tier: "-"`. `fac-0001` is the instructor, `stu-0011` is the unposted demo learner. `source_dataset` holds the full source's metadata/counts; `course` retains course metadata. `faculty_prompt_post_id` identifies the opening prompt rendered separately from the peer list. Imported posts have no invented `provenance`. The complete PDF synthetic notice is retained in `synthetic_data_notice`.
- `data/cui/categories.json` and `data/cui/ldcs.json` — extracted from the CUI Tagging Dataset; shape `{ "id", "name", "authority"?, "description"?, "source"?, "placeholder"?, "legacy"? }`. Imported categories use the exact manifest `source_id`; LDCs use the exact `marking`. `source` retains original metadata (source URL/ID, marking/banner alternatives, portion marking, provisional status, review date as applicable). `description` supplies the exact category definition or the LDC definition/notes extracted from the companion Registry text. IDs identify vocabulary entries, not independently validated complete CUI banners.
