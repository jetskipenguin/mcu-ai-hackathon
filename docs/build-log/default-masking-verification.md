# A7–A8: default masking and human authentication

Verified 2026-09-16 after the request to remove all agent detection.

## Changes

- Removed browser-agent signal collection/delivery, server scoring, declaration
  handling, suspected-session storage, and signal/flagged-session endpoints.
- Every governed record begins masked. The legacy field endpoint always returns
  `{ "masked": true }`; clean browser samples and prior reveals do not authorize it.
- Fresh action/session/user-bound WebAuthn with UP and UV is required for each
  record reveal. Plaintext is returned only for that user's current view.
- Policies and generator use `mask_when: "always"`. Validation rejects missing or
  conditional masking and record reveal without required user verification.
- New provenance uses `unverified` or `human-verified`. Legacy actor labels and
  signal metadata remain readable in append-only history; new signal fields are
  neutral. Discussion composition telemetry and explicit AI-use disclosure remain
  separate from authentication and do not classify browser agents.
- The checked-in draft was manually migrated to the new policy contract; its
  original generation metadata no longer matches the revision and is ignored.

## Automated verification

- `npm run build`: passed.
- `npm test`: 112 tests, 110 passed, 2 skipped (gitignored source datasets absent),
  0 failures.
- Record regressions cover masked HTML, absent/clean/background/fabricated signals,
  agent headers, signed-in user scoping, fresh-proof requirements after reveal,
  missing/forged/replayed/expired/cross-session assertions, invalid signatures,
  origin mismatch, and required UP/UV using the real verifier.
- Quiz and discussion enforcement, registration, policy generation/approval/hot
  reload, provenance/dashboard reads, and discussion reset continue to pass.

## BrowserOS neo check

- Started the local portal explicitly with `COUNTERSIGN=on` and `PORT=3000` (the
  local environment selected the ungoverned mode when launched without overrides).
- Signed in as the synthetic demo user and opened `/record/1`.
- Verified name, SSN, DoD ID, and medical note were placeholders, including after
  JavaScript loaded; no protected fixture values were present in page HTML.
- Verified the human-authentication message and reveal/registration controls.
- Observed only static-script resource requests: no automatic `/signals` or
  `/record-fields` request.
- Selecting reveal left all fields masked while waiting for human authentication.
  Navigated back to the masked view without completing a physical assertion.
- Updated and ran the repeatable `check-record-masking` BrowserOS helper and saved
  `/neo-verify-default-record-masking`.

## Separate live checkpoint

Physical Touch ID / Windows Hello completion, a fresh revealed-view remasking
rehearsal, and the full Comet quiz recording remain open. Cryptographic integration
tests do not claim physical-sensor verification.
