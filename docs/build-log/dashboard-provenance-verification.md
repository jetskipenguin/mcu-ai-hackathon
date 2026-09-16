# B1 dashboard and A10 provenance verification

Recorded 2026-09-16T19:16:18Z on `feat/policy-generator-datasets`.

## Delivered

**B1:** one-second JSONL snapshot polling, the four actor colors and legend,
exact-user-ID links/filtering, shareable `?user=` drill-down, and expandable complete
event evidence. Proof details include assertion/credential IDs, UP/UV, age,
attestation, signals, telemetry, form hash, and notes. Polling keeps open evidence
and focus stable, does not overlap slow requests, and retains prior rows with an
error/retry notice if the endpoint fails. All event text is rendered as text.

**A10:** finalized `docs/contracts.md` and TypeScript types; runtime metadata
validation and advisory telemetry normalization at the log boundary. Unknown
telemetry keys are removed; malformed named metrics discard the sample and add a
note. Valid partial/array samples remain supported. Contradiction detection uses
normalized data and cannot reject an otherwise valid presence proof. Visit events
retain session signals/declaration instead of always claiming `unverified`.

The reader preserves append order, handles a concurrent incomplete final append,
normalizes historical advisory payloads without rewriting the file, and rejects
corrupt completed records. The API has no-store caching, exclusive opaque cursors,
and generic JSON read errors. Flagged sessions expose the documented five fields
and remain process-local signal state rather than a historical finding aggregate.

## Automated suite

Executed from the repository root:

```sh
TMPDIR="$PWD/node_modules/.cache" npm test
npm run build
git diff --check
```

- **97 tests passed**; zero failed, cancelled, skipped, or TODO.
- Strict TypeScript compilation and whitespace checks passed. No separate linter
  is configured.
- Fifteen added tests cover metadata enums/ranges/proof consistency, real-client
  and malformed telemetry shapes, append/read fidelity, legacy non-rewriting,
  partial/corrupt log reads, concurrent writers, events cursor/cache/error behavior,
  page-visit attribution, flagged-session fields, and non-blocking attested outcomes.
- Malformed negative-keystroke telemetry with `single_event_fill: true` did not
  fabricate a contradiction or prevent a verified post. AI-assisted disclosure
  under an AI-prohibited policy still produced `allowed` plus a linked advisory
  `flagged` event. Preferred-UV UP-only assertions still pass.
- Existing enrollment, quiz, discussion, record, cryptographic rejection, replay,
  action/session/form/attestation binding, generator, approval, and fixture tests
  passed against the updated writer.

## Browser checks

Harness: [`dashboard-browser-smoke.mts`](dashboard-browser-smoke.mts).
Requires locally installed Google Chrome. Optional test tooling setup:

```sh
npm install --no-save --package-lock=false --ignore-scripts playwright@1.58.2
mkdir -p node_modules/.cache
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx docs/build-log/dashboard-browser-smoke.mts
```

The final command was executed and passed. Playwright is local verification
tooling, not a project dependency; `package.json`/`package-lock.json` are unchanged.
The harness uses an ephemeral app and temporary credential/log files in ignored
`node_modules/.cache/`, with a Chrome virtual platform authenticator. It proxies
the fixed `http://localhost:3000` WebAuthn origin to that isolated app, including
explicit handling of redirects so they cannot escape to the live process.

Verified:

1. All four actor row classes; two distinct IDs with the same display name;
   user links, selector, all-users reset, deep-link reload, and unknown-user state.
2. New events appear during polling; expanded evidence and keyboard focus persist.
   Script/HTML-shaped notes render inertly.
3. HTTP 500 retains prior rows and recovers next tick; a 2.2-second response does
   not create overlapping requests.
4. Fresh browser enrollment, five-answer quiz submission, and record reveal with
   accepted UP/UV assertions under the unchanged action-bound verification service.
5. A real browser-generated full composition sample for an own-work paste remains
   valid after normalization, publishes, and produces the advisory contradiction.
6. Dashboard user drill-down exposes the actual verified quiz event/assertion
   and the subsequent discussion review event from the isolated run.

The first attempts found harness-only problems: redirected requests could leave
the proxy, and quiz radio names are `answers[qN]`, not `qN`. Debugger investigation
confirmed both; the corrected complete run passed without changing authentication
or verification logic.

Screenshot: [user drill-down with verified quiz proof](dashboard-user-drilldown.png).

## Existing-log compatibility and scope

A read-only probe of the running `/countersign/events` returned HTTP 200,
`Cache-Control: no-store`, and all **76 existing events** at the time checked.
The source log was not rewritten. The active policy file and dependency manifests
have no diff from this work.

B1 and A10 are checked in both task/plan documents. The native attestation prompt
remains the working demo UI. Physical Comet/Touch ID, agent recordings, and the
human integrated bug-fix checkpoint remain separate A5/A11 work. These automated
results do not claim a physical-sensor or live-agent rehearsal.
