# WebAuthn Notes — Countersign

Read this before touching anything in `countersign/server/webauthn*` or the step-up code in `countersign.js`. The presence proof is the one thing the demo cannot survive getting subtly wrong.

Library: `@simplewebauthn/server` + `@simplewebauthn/browser`. Confirm option names against the installed version's docs; the shapes below are correct for the v10+ API family but names have drifted between majors.

---

## 1. Fixed configuration

```ts
export const RP = {
  rpName: "Countersign",
  rpID: "localhost",                     // hostname only, no port, no scheme
  origin: "http://localhost:3000",       // scheme + host + port, exact
};
```

- WebAuthn requires a secure context. `http://localhost` counts. Any other hostname needs HTTPS. **Do not** try `127.0.0.1` — it is a different origin and the credential won't match.
- The ungoverned instance (`:3001`) never calls WebAuthn. Only `:3000` registers `RP`.
- If a second machine is ever needed: `mkcert`, a real hostname, and `rpID` becomes that hostname. Not for the demo.

---

## 2. Registration (once per user, at first login on the governed instance)

Purpose: bind a platform authenticator (Touch ID) to the demo user so assertions are possible later.

```ts
const options = await generateRegistrationOptions({
  rpName: RP.rpName,
  rpID: RP.rpID,
  userID: isoUint8Array.fromUTF8String(user.id),
  userName: user.id,
  userDisplayName: user.name,
  attestationType: "none",                       // we don't care about device attestation
  authenticatorSelection: {
    authenticatorAttachment: "platform",         // forces Touch ID / Windows Hello, not a roaming key
    residentKey: "preferred",
    userVerification: "required",
  },
  excludeCredentials: user.credentials.map(c => ({ id: c.id, transports: c.transports })),
});
// store options.challenge in the session, then send options to the client
```

Client: `startRegistration({ optionsJSON: options })` → POST the result to `/countersign/webauthn/register/verify`.

Server verify:

```ts
const { verified, registrationInfo } = await verifyRegistrationResponse({
  response,
  expectedChallenge: session.regChallenge,
  expectedOrigin: RP.origin,
  expectedRPID: RP.rpID,
  requireUserVerification: true,
});
// persist: registrationInfo.credential.id, .publicKey, .counter, .transports, and registrationInfo.credentialDeviceType
```

Store credentials in `data/credentials.json` keyed by user id. It's fine for them to survive server restarts; it's *required* that they survive a switch between the two instances (they share the file).

**Demo pitfall:** the credential is created inside whichever browser profile does the registration. A platform passkey made in Chrome is not necessarily visible from Comet (unless iCloud Keychain passkeys are on and synced). **Register the demo user from inside Comet, in the demo macOS account, on the demo day.** Put this in the stage checklist.

---

## 3. Action-bound assertion (the step-up)

The whole point: the assertion must prove a human was present *for this specific submission*, not just "recently."

### 3.1 Challenge issuance — `POST /countersign/challenge`

```ts
const options = await generateAuthenticationOptions({
  rpID: RP.rpID,
  allowCredentials: user.credentials.map(c => ({ id: c.id, transports: c.transports })),
  userVerification: rule.presence.uv === "required" ? "required" : "preferred",
  timeout: 60_000,
});
challenges.set(challengeId, {
  challenge: options.challenge,         // the random bytes the authenticator will sign over
  user: user.id,
  rule_id, action, form_hash,           // what we are binding to
  attestation: body.attestation ?? null,
  created: Date.now(),
});
return { challenge_id: challengeId, options, expires_at: created + 120_000 };
```

The binding is server-side: the authenticator signs the random challenge; the server remembers what that challenge was issued *for*. Never accept an assertion whose `challenge_id` isn't in the map. Delete the entry on first use, success or failure.

The discussion demo reset also advances a server-only per-user/action generation.
It revokes that user's discussion challenges across sessions; generation is checked
after option generation and again in `checkAge`, including after async verification.
Already-consumed/in-flight assertions cannot cross a reset. Registration, quiz,
record, and other users' challenges remain separate. The portal adds a final
generation guard so a stale request cannot publish after awaiting audit I/O.
See [the reset contract](contracts.md#demo-only-discussion-reset).

### 3.2 Client — inside `countersign.js`

```js
form.addEventListener("submit", async (e) => {
  const rule = form.dataset.countersignRule;
  if (!rule) return;                                   // ungoverned form
  e.preventDefault();
  const select = form.querySelector("select[data-countersign-attestation]");
  const attestation = form.dataset.countersignClass === "attested" ? readAttestation(select) : null;
  const fields = serialize(form);                       // excludes countersign fields
  const form_hash = await sha256Canonical(fields);      // see contracts.md §6
  const { challenge_id, options } = await postJSON("/countersign/challenge", { rule_id: rule, action: form.dataset.countersignAction, form_hash, attestation });
  const assertion = await startAuthentication({ optionsJSON: options });   // ← Touch ID prompt appears here; an agent stalls here
  if (await sha256Canonical(serialize(form)) !== form_hash || (select && select.value !== attestation)) {
    throw new Error("The form or disclosure changed. Submit again for a fresh confirmation.");
  }
  await postJSON(form.action, { ...fields, countersign: { challenge_id, assertion, attestation, telemetry: telemetryFor(form) } });
});
```

`startAuthentication` throws `NotAllowedError` on cancel/timeout. Show a plain message ("A human must confirm this action.") and write nothing — the server will log `presence-requested` at challenge time and `blocked` only if a submit arrives without a valid assertion.

The disclosure is a required **Own work / AI-assisted** dropdown with an empty
placeholder, replacing the scaffold's `window.prompt`. Its name is
`countersign[attestation]`, so serialization excludes it from business fields;
the server binds its enum separately. The client also supplies a dropdown for
annotated attested forms without server-rendered controls. A changed declaration
aborts publication; retry uses a new challenge. Cancellation keeps the choice.

**Native prompt wording:** the browser/OS owns Touch ID and passkey-dialog text.
[`PublicKeyCredentialRequestOptions`](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialRequestOptions)
has no custom per-action instruction field. RP identity/account information may
be displayed differently by different browsers; it is not an action-message API.
Countersign instead displays **Human confirmation required — [action]** in a
visible in-page status region before invoking native credentials. This adds no
extra click, does not imitate system UI, and does not change RP identity or proof
requirements. Verify the actual Comet/Touch ID appearance during human rehearsal.

### 3.3 Server verification — inside the governed route middleware

```ts
const stored = challenges.get(cs.challenge_id);           // 403 no_assertion if missing
challenges.delete(cs.challenge_id);                       // single use, always
if (Date.now() - stored.created > 120_000) → 403 expired
if (stored.rule_id !== rule.id || stored.form_hash !== recomputeHash(req.body)) → 403 form_mismatch

const { verified, authenticationInfo } = await verifyAuthenticationResponse({
  response: cs.assertion,
  expectedChallenge: stored.challenge,
  expectedOrigin: RP.origin,
  expectedRPID: RP.rpID,
  credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports },
  requireUserVerification: rule.presence.uv === "required",
});
if (!verified) → 403 verification_failed
if (rule.presence.uv === "required" && !authenticationInfo.userVerified) → 403 uv_required
cred.counter = authenticationInfo.newCounter;            // persist; a non-increasing counter on a roaming key is a cloning signal — log it, don't block for the demo
```

What the library checks for you: signature over `authenticatorData || sha256(clientDataJSON)`, origin, RP ID hash, challenge match, and the **UP (user present) flag** — it rejects assertions where UP is not set. `userVerified` reflects the **UV flag** (Touch ID / PIN). Both flags come from the authenticator, not the browser, which is why an agent driving the browser can't forge them.

`age_ms` for the event = `Date.now() - stored.created`. Enforce `rule.presence.max_age_s` against that.

**Installed v14 implementation detail:** SimpleWebAuthn throws on non-increasing
counters before returning a verification result. To implement the demo's advisory
counter policy, Countersign supplies `counter: 0` to that verifier, then compares
the verified `newCounter` with the persisted counter itself. A regression is
recorded in event `notes`, and the persisted counter never decreases. Signature,
challenge, origin, RP ID, UP, and required UV checks remain enabled; single-use
server challenges remain the replay defense. No `advancedFIDOConfig` is supplied,
so the library always enforces UP, including for `uv: preferred` rules.

---

## 4. Why an agent cannot pass this

- The session cookie gets the agent to the form. It does not get it past `startAuthentication`: the browser hands control to the OS authenticator UI, which requires a physical touch or biometric. There is no DOM element to click and no JS API to satisfy it.
- The assertion is a signature by a private key that never leaves the Secure Enclave, over a challenge the server chose and remembers. Replaying an old assertion fails (challenge single-use). Getting an assertion for one form and submitting another fails (`form_hash`). Waiting and reusing fails (`max_age_s`).
- Agent detection has been removed. **None of the above depends on detecting the agent.** Protected records are masked for every session until fresh human authentication. If a judge asks "what if the agent looks perfectly human?", the answer is: it still has to touch the sensor.

---

## 5. Development without touching the sensor every time

- **Chrome DevTools → More tools → WebAuthn → Enable virtual authenticator environment.** Add a `platform`, `ctap2`, internal transport authenticator with "supports user verification" on. Registration and assertions then complete instantly with UP and UV set. Use this in Chrome for all development.
- Test in Comet with the real Touch ID at least once per checkpoint (13:00, 16:00) and in the final rehearsals. Comet is Chromium-based and should behave like Chrome here — but "should" is why we test.
- **No server-side bypass flag.** Do not add `COUNTERSIGN_SKIP_WEBAUTHN` or similar. A bypass that's accidentally on during the demo is the single worst outcome available. If you need to test the policy engine in isolation, mock `verifyAuthenticationResponse` in the test file.

---

## 6. Tests that must exist

In `countersign/server/__tests__/webauthn.test.ts`, with the verify function mocked to return `{verified: true, authenticationInfo: {userVerified, newCounter}}`:

1. Missing `countersign` object on a governed route → 403 `no_assertion`, `blocked` event written.
2. Unknown or already-used `challenge_id` → 403 `no_assertion`.
3. Challenge older than 120 s → 403 `expired`.
4. Submitted fields differ from the hash the challenge was issued for → 403 `form_mismatch`.
5. `uv: required` rule with `userVerified: false` → 403 `uv_required`.
6. Happy path → route handler called, `allowed` / `human-verified` event with `assertion_id` and `age_ms`.
7. `COUNTERSIGN=off` → none of the above runs; handler called directly; no event.

These seven are the "readiness for testing" evidence for the judges. They take under an hour with the verify mocked.

---

## 7. Stage checklist (WebAuthn items)

- [ ] Demo macOS account has Touch ID enrolled — two fingers.
- [ ] Demo user registered **from inside Comet** on the governed instance that morning; `data/credentials.json` contains the credential.
- [ ] One full assertion completed in Comet with the real sensor before going on stage.
- [ ] `:3000` and `:3001` both up; `:3000` responds to `GET /countersign/policy`.
- [ ] YubiKey (if available) registered as a second credential for the same user, `uv: preferred` rules will accept it if Touch ID misbehaves.
