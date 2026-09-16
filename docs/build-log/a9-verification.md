# A9 — Discussion provenance display

Verified 2026-09-16 at 11:58 EDT.

## Behavior

- Published posts save server-generated disclosure, actor class, verified presence,
  allowed-event ID, and advisory review-event references.
- The UI separates **AI-assisted (disclosed)** / **Own work (declared)** from
  **Human presence verified at submit**. Presence is not an authorship claim.
- Contradictory own-work claims still publish, with **Flagged for review** and the
  actual contradiction event ID. Seeded posts remain **Provenance not recorded**.
- Badge metadata supplied by the client is ignored; post text remains escaped.
- Ungoverned submissions display no Countersign badges and write no events.
- Posts and badges persist through reloads/logins within the running instance;
  the existing in-memory forum resets on server restart. JSONL events persist.
- The success redirect adds a `posted` query and an anchor so the browser loads
  fresh server-rendered content and scrolls to the new post.

## Verification

```text
npm test
  56 passed; 0 failed, cancelled, skipped, or TODO

npm run build
  tsc -p tsconfig.json — exit 0
```

Six new HTTP/cryptographic integration tests cover AI-assisted publication and
peer/reload visibility, own-work with a presence-only proof, advisory contradiction
publication, spoofed metadata/HTML, missing proof, and ungoverned bypass. Existing
quiz, record, registration, replay, and action-binding tests also pass.

No separate linter is configured in this repository; strict TypeScript compilation
passed. No new project dependencies were added.

Browser checks used the existing temporary Playwright 1.58.2 installation, isolated
Chrome profiles, test-only servers/storage, and virtual platform authenticators.
Localhost origins were preserved with per-browser host-resolver rules.

```sh
./node_modules/.bin/tsx /var/folders/wv/ktng7tvs3z15kmclhh537c7r0000gn/T/opencode/a9-browser-smoke.mts
./node_modules/.bin/tsx /var/folders/wv/ktng7tvs3z15kmclhh537c7r0000gn/T/opencode/countersign-browser-smoke.mts
```

Results:

- AI-assisted post: publishes, shows disclosure and verified presence separately,
  links actual event/assertion IDs, has no inferred review flag, and survives reload.
- Own-work single-event fill: publishes with an advisory review flag and matching
  contradiction event; the badge remains after reload.
- Quiz regression: enrollment, valid submission, cancellation/retry, changed-form
  rejection, advisory-signal failure, and the ungoverned path pass.
- Record regression: policy markings/categories and `Countersign-Marking` header
  verified; flagged record reveal succeeds using the same newly enrolled passkey.
- No browser JavaScript errors.

The initial browser run exposed a fragment-only redirect leaving stale content;
the query-plus-anchor redirect fixed it, and both final browser runs passed.

## Screenshots

- [AI-assisted disclosure and verified presence](a9-ai-assisted.png)
- [Own-work disclosure with an advisory review flag](a9-review-flag.png)

These screenshots use virtual authenticators. A real agent/sensor recording for
the discussion page remains a demo rehearsal task.

## Checklist maintenance

Marked A9 complete in both task and build-plan checklists. Also completed A6's
stale checkbox after verifying its existing markings/header implementation.
Reconciled earlier scaffold, adversary, WebAuthn, signal, and masking checkboxes in
the plan with the already verified task list. Manual/recorded demo criteria remain
separate; the convention is now documented in `AGENTS.md`.

## Live follow-up

The tester reported the flow working at 12:06 EDT. The live
`http://localhost:3000/countersign/events` endpoint corroborated:

| Field | Observed value |
|---|---|
| Presence request | `2026-09-16T16:04:41.591Z`, `evt_33f7e900372c46f4b2fb54a5964322f9` |
| Accepted submission | `2026-09-16T16:04:46.801Z`, `evt_8443e01f0d0e41269a530c7e073f46ce` |
| Attestation | `own-work` |
| Decision / actor | `allowed` / `human-verified` |
| UP / UV | `true` / `true` |
| Assertion | `asr_fc061e79-5c3b-4ca9-9c77-fde012150ece` |

No contradiction event appeared for this submission in the returned log. This
adds live confirmation to the automated evidence above; an agent-specific
recording was not supplied.
