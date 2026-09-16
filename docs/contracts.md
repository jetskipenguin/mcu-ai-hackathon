# Contracts — Countersign

The interfaces Track A (portal + enforcement) and Track B (dashboard + generator) build to. Change this file in the same commit as any change to an interface. Examples are normative: field names and enum values are exact.

---

## 1. Provenance log event

One JSONL line per governed decision, appended to `data/provenance.jsonl`. Never rewritten.

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

`presence` is `null` when no assertion was presented. `telemetry` is non-null only for `attested` actions (see §5). `form_hash` is the SHA-256 of the canonical form (§6).

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

### WebAuthn — action step-up

| Endpoint | Body | Returns |
|---|---|---|
| `POST /countersign/challenge` | `{ "rule_id", "action", "form_hash", "attestation"?: "own-work"\|"ai-assisted" }` | `{ "challenge_id", "options": PublicKeyCredentialRequestOptionsJSON, "expires_at" }` |

The server stores `{challenge_id → {user, rule_id, action, form_hash, attestation, created}}` and deletes it on first use or expiry (120 s). The challenge is single-use.

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

### Signals and masking

| Endpoint | Body | Returns |
|---|---|---|
| `POST /countersign/signals` | `{ "route", "signals": { … §4 } }` | `{ "score": 0.0–1.0, "flagged": bool, "actor_class" }` |
| `POST /countersign/unmask` | same as `/challenge` with `rule_id: "student-record.unmask"`, then the assertion via `POST /countersign/unmask/verify` `{ challenge_id, assertion }` | `{ "ok": true, "fields": { "ssn": "…", "medical": "…" } }` — values are only ever sent after verification |

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
| `POST /countersign/policy/approve` | `{ "rule_ids": ["…"] }` or `{ "all": true }` → `{ "ok": true, "active_version" }` |

---

## 4. Client → server signal payload

Sent by `countersign.js` on page load and again immediately before any governed submit.

```json
{
  "route": "/record/1",
  "signals": {
    "webdriver": false,
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

---

## 5. Composition telemetry (attested actions)

Collected per text field by `countersign.js`, sent in `countersign.telemetry` on submit.

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

---

## 6. Canonical form hash

`form_hash = "sha256:" + hex(sha256(canonical))` where `canonical` is the form's fields (excluding the `countersign` object) sorted by name, JSON-serialized with no whitespace. Client computes it at challenge time; server recomputes from the submitted body. Mismatch → `form_mismatch`. This binds the assertion to the exact submission.

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
- `portal/data/quiz.json` — 5 MCQs from the chosen 8670 coursebook chapter; include `source_ref` per question.
- `portal/data/forum.json` — the 8801 Seminar 12 dataset filtered to `ifd == 2`; `roster[]` and `posts[]` unchanged; add the demo student to the roster with `tier: "-"`.
- `data/cui/categories.json` and `data/cui/ldcs.json` — extracted from the CUI Tagging Dataset; shape `{ "id", "name", "authority"?, "description"? }`.
