# A12 — Repeatable discussion demo

Recorded 2026-09-16T20:43:46Z on `feat/policy-generator-datasets`.

## User-visible behavior

On either `/discussion/2` instance, sign in as **Capt J. Demo**, expand **Demo
controls**, check the confirmation box, and select **Reset discussion demo**.
The response returns to `/discussion/2?reset=1`, with an empty initial-response
composer and server-hidden peers. No server restart or passkey reenrollment is
needed. Reload other discussion tabs; use a fresh agent context when measuring
independent-first behavior, since a reset cannot erase content already seen.

The reset removes only this demo user's runtime-added posts in this app instance.
Seeded posts, other learners' runtime posts, other instances, credentials, login,
observed signals, policies, and existing audit events are retained. Each successful
reset appends an administrative `demo-discussion-reset` event, including in off
mode. It records mode and removed IDs/count, not content or the CSRF token.
Ordinary off-mode posts remain ungoverned and unlogged.

Controls are deliberately demo-only, not a production administrator boundary or
a claim that an agent cannot operate them. Their token is bound to the signed-in
session, instance, mode, and reset generation; successful reset invalidates old
controls. Native confirmation and same-origin validation protect against accidental
or cross-origin resets. The target is always the signed-in demo identity.

## Presence and race safety

- Audit append precedes mutation. Failure returns `reset_not_recorded` without
  deleting posts, and retry remains possible after storage recovery.
- Reset invalidates all outstanding discussion challenges for this user across
  login sessions, including already-consumed assertions awaiting verification and
  options still being generated. The next governed initial post needs fresh
  attestation and a valid action-bound assertion.
- A final portal generation guard rejects stale submissions after awaited audit
  writes, even when the old request matched an unrestricted rule. A prior allowed
  governance event does not mean that this stale request was published.
- Concurrent resets/submissions cannot mutate the target during reset. Quiz,
  record-reveal, registration, and other users' ceremonies are unaffected.
- Maintenance HTML and its token are removed before policy-generator form
  discovery/model input. Missing initial-form errors now point to the reset UI;
  the crawler never resets state automatically.

## Automated verification

Executed:

```sh
TMPDIR="$PWD/node_modules/.cache" npm test
npm run build
git diff --check
```

**108 tests passed**, with zero failures, cancellations, skips, or TODOs. Strict
TypeScript compilation and whitespace checks passed; no separate linter is
configured. No dependency or runtime-flag changes were needed.

Eleven new reset tests cover:

1. Governed post → reset → post, new attestation/assertion, retained signal evidence,
   original audit prefix, byte-identical credential storage across reset, preserved
   peer/seed posts, and rejection of an old reset token after the new post.
2. Ungoverned repeat behavior with maintenance-only audit and no fabricated proof.
3. Authentication, fixed-user targeting, Origin, CSRF/session, confirmation, media
   type, malformed-token, and wrong-method rejection.
4. Cross-session pending discussion challenge revocation while existing quiz,
   record, registration, and another user's quiz ceremonies remain usable.
5. Revocation during asynchronous option generation.
6. Revocation after challenge consumption during asynchronous signature verification.
7. Rejection of a formerly unrestricted request after its delayed audit write.
8. Concurrent reset/submission rejection during delayed reset auditing.
9. Failed audit retaining state, followed by successful retry.
10. Instance/token isolation.
11. Removal of multiple runtime demo posts and auditing a fresh no-op reset.

The crawler integration test additionally proves that only the discussion body
form reaches the model input; reset controls and tokens are absent. Existing
cryptographic/binding, page, record, dashboard, generator, and approval tests pass.

The first verification run identified the crawler's new maintenance form exposure;
that was fixed by excluding maintenance markup rather than weakening its test.
A peer-credential test initially used the authenticator helper's default demo
user handle; correcting the test identity resolved the expected verification
rejection. No production authentication checks were relaxed.

## Browser verification

Using the existing optional Playwright 1.58.2 tooling and installed Google Chrome:

```sh
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx docs/build-log/discussion-reset-browser-smoke.mts
```

The [retained harness](discussion-reset-browser-smoke.mts) creates isolated app
instances with temporary storage and a virtual platform authenticator for the
governed case. Browser traffic, including redirects, is proxied to those instances.

Passed in **both modes**:

- Native checkbox validation prevents an unconfirmed reset request.
- Initial publication displays the peers and hides the composer; reset restores
  the empty composer with zero rendered peer-post elements.
- Existing credential bytes and prior audit data are retained; exactly one reset
  event is recorded with the matching mode.
- A second initial post succeeds without restarting or registering again. The old
  post is absent; the old audit remains. An old reset token cannot clear the new post.
- Governed mode asks for two separate attestations and produces distinct assertion
  IDs; direct no-proof posting after reset is rejected. Off mode requests neither
  ceremony and records only the administrative reset.
- Quiz submission and record reveal still complete verified WebAuthn ceremonies
  after the governed discussion reset.

Screenshots after reset:

- [Governed: restored composer and hidden peers](discussion-reset-governed.png)
- [Ungoverned: restored composer and hidden peers](discussion-reset-ungoverned.png)

A12 is complete in both task/plan documents. The human Comet/physical Touch ID
rehearsal remains separate; these are virtual-authenticator results.
