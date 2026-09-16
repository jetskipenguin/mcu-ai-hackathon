# A2–A4 verification — 2026-09-16

## Implemented

- First-login passkey enrollment at `/register`, verified for origin
  `http://localhost:3000`, RP ID `localhost`, and required UP/UV.
- Atomic JSON persistence of public credentials, counters, transports, and device
  metadata; additional browser-profile registration through the navigation link.
- Random challenges, single-use consumption before async verification, 120-second
  TTL plus the policy's maximum age, and binding to user/session/rule/action/form
  hash/attestation.
- Real signature verification and per-submission allowed/blocked provenance.
  Counter regression is advisory as required by the WebAuthn notes.
- Separate cookie namespaces for the two demo ports. No ceremonies or provenance
  writes for ungoverned submissions.
- Client enrollment and submission, cancellation/retry, form-change detection,
  duplicate-submit prevention, and tolerance of advisory-signal endpoint failure.
- Attested submissions preserve disclosure/telemetry and log contradictions
  separately without blocking a valid presence proof.

## Automated commands and results

```text
npm test
  tests: 50
  pass: 50
  fail: 0
  cancelled: 0
  skipped: 0
  todo: 0

npm run build
  tsc -p tsconfig.json — exit 0

node --check countersign/client/countersign.js
  exit 0

git diff --check
  exit 0
```

After implementation, live HTTP checks returned 200 for `/login`,
`/countersign/policy`, and `/countersign/` on both ports 3000 and 3001.

There is no separate linter configured in this repository. Strict TypeScript
compilation and the vanilla-client syntax check both passed.

These are the final results after integration with `c42299a` (record masking).
The initial A2–A4 implementation passed 40 tests; the combined suite includes
the seven upstream record tests and three new cross-flow regression tests.
Those regressions cover shared credentials/counters after fresh registration,
record-versus-quiz challenge isolation, and advisory session scores in quiz logs.

The seven required tests use the documented verifier mock where appropriate.
Additional tests use a test-only software authenticator generating actual P-256
keys, CBOR registration data, and signed assertions against SimpleWebAuthn v14.
They cover invalid signatures, challenge/origin/RP ID, missing UP/UV, wrong
credential/user handle, replay, concurrent replay, user/session/action/attestation
binding, TTL/policy age, and credential persistence. No production bypass exists.

## Browser verification

Playwright 1.58.2 was installed in the pre-approved temporary tooling directory;
no project dependency was added. The installed Chrome browser was launched in an
isolated profile with a CDP virtual `ctap2`/`internal` platform authenticator.
Chrome host-resolver rules preserved the actual localhost origins while routing
to separate test servers and temporary credential/provenance files. The live
demo's credential store was not populated with virtual credentials.

Executed:

```sh
./node_modules/.bin/tsx /var/folders/wv/ktng7tvs3z15kmclhh537c7r0000gn/T/opencode/countersign-browser-smoke.mts
```

Result:

```text
PASS: first-login registration uses the real client and SimpleWebAuthn verification.
PASS: ungoverned submission succeeds with no script, ceremony, or provenance writes.
PASS: governed submission survives signal failure, verifies the assertion, and logs presence-requested then allowed/human-verified.
PASS: cancelled ceremony leaves only a presence-requested event; a fresh retry succeeds.
PASS: changed fields during confirmation require a fresh ceremony and are not submitted.
PASS: attested post requests disclosure, verifies presence, publishes, and logs an advisory contradiction.
PASS: the same newly enrolled passkey reveals a flagged record after successful quiz and discussion submissions.
PASS: no browser JavaScript errors. Physical Touch ID remains a separate manual check.
```

Screenshot: [successful virtual-authenticator submission](a2-a4-virtual-authenticator.png).
This is automated browser evidence, **not a real Touch ID recording**.

## Remaining human checkpoint — M6 / A5

1. In the actual Chrome profile used by Nanobrowser, open
   `http://localhost:3000/login` and choose Capt J. Demo. Reload/sign in again
   after development restarts if the ephemeral session cookie is no longer valid.
2. Register a localhost passkey with the real sensor. Use `/register` if another
   browser's credential already exists but is unavailable in this profile.
3. Ask Nanobrowser to complete and submit `/quiz/1` as it did on port 3001.
4. Observe it waiting at the OS prompt. Touch the sensor; confirm the page says
   "Quiz submitted. Human presence verified."
5. Confirm a `presence-requested` event followed by `allowed` / `human-verified`
   with an assertion ID in `/countersign/events` (or the dashboard).
6. Repeat the local enrollment/manual-submit check inside Comet. Its external
   WebAuthn.io credential and successful external check do not satisfy M6.
7. Capture a recording. Keep the physical-sensor tasks open until observed.

Record masking/unmasking and deterministic signal scoring were merged from
`c42299a` and verified with the shared WebAuthn service before committing this
implementation. Richer attestation UI/tags and the real LLM generator remain
separate track work.
