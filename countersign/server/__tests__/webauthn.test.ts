import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { createApp } from "../../../portal/app.js";
import { formHash } from "../canonical.js";
import { CredentialStore } from "../credentials.js";
import { appendProvenanceEvent, readProvenanceEvents } from "../log.js";
import { RP, simpleWebAuthn } from "../webauthn.js";
import { authenticator } from "./authenticator.js";

const fields = { answers: { q1: "b", q2: "d", q3: "a", q4: "c", q5: "b" } };

async function harness(context: TestContext, options: { enabled?: boolean; seed?: boolean; counter?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "countersign-webauthn-"));
  const credentialsPath = join(directory, "credentials.json");
  const provenancePath = join(directory, "provenance.jsonl");
  const device = authenticator();
  const store = new CredentialStore(credentialsPath);
  if (options.seed !== false) store.add("stu-0011", { ...device.credential, counter: options.counter ?? 0 });
  const clock = { now: Date.now() };
  const app = createApp({
    countersignEnabled: options.enabled ?? true,
    credentialsPath, provenancePath, sessionSecret: "test-session-key",
    now: () => clock.now,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  async function login(user = "stu-0011") {
    const response = await fetch(`${base}/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user_id: user }),
    });
    assert.equal(response.status, 303);
    const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
    await response.text();
    return { cookie, location: response.headers.get("location") };
  }
  const session = await login();
  async function post(path: string, body: unknown, cookie = session.cookie, headers: Record<string, string> = {}) {
    return fetch(`${base}${path}`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/json", cookie, ...headers },
      body: JSON.stringify(body),
    });
  }
  async function issue(body = fields, binding: Record<string, unknown> = {}, cookie = session.cookie) {
    const response = await post("/countersign/challenge", {
      rule_id: "quiz-submit", action: "POST /quiz/1/submit", form_hash: formHash(body), ...binding,
    }, cookie);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  function submit(challenge: { challenge_id: string; options: { challenge: string } }, body: Record<string, unknown> = fields, assertion?: AuthenticationResponseJSON) {
    return post("/quiz/1/submit", {
      ...body, countersign: {
        challenge_id: challenge.challenge_id,
        assertion: assertion ?? device.assertion(challenge.options.challenge),
        attestation: null, telemetry: null,
      },
    });
  }
  return {
    base, store, credentialsPath, provenancePath, clock, device, session, login, post, issue, submit,
    events: () => readProvenanceEvents(provenancePath),
  };
}

function mockVerification(context: TestContext, userVerified = true, newCounter = 1) {
  return context.mock.method(simpleWebAuthn, "verifyAuthenticationResponse", async (_options: Parameters<typeof simpleWebAuthn.verifyAuthenticationResponse>[0]) => ({
    verified: true,
    authenticationInfo: { userVerified, newCounter },
  }));
}

async function expectBlocked(response: Response, reason: string) {
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "countersign_required", reason });
}

test("missing countersign object returns 403 no_assertion and writes exactly one blocked event", async (context) => {
  const h = await harness(context);
  const verify = mockVerification(context);
  await expectBlocked(await h.post("/quiz/1/submit", fields), "no_assertion");
  const events = await h.events();
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, "blocked");
  assert.equal(events[0].rule_id, "quiz-submit");
  assert.equal(events[0].presence, null);
  assert.equal(events[0].form_hash, formHash(fields));
  assert.equal(verify.mock.callCount(), 0);
});

test("unknown or already-used challenge_id returns 403 no_assertion", async (context) => {
  const h = await harness(context);
  const verify = mockVerification(context);
  const challenge = await h.issue();
  await expectBlocked(await h.submit({ ...challenge, challenge_id: "chg_unknown" }), "no_assertion");
  assert.equal((await h.submit(challenge)).status, 200);
  await expectBlocked(await h.submit(challenge), "no_assertion");
  assert.equal(verify.mock.callCount(), 1);
  assert.deepEqual((await h.events()).map((event) => event.decision), ["presence-requested", "blocked", "allowed", "blocked"]);
});

test("challenge older than 120 seconds returns 403 expired", async (context) => {
  const h = await harness(context);
  const verify = mockVerification(context);
  const challenge = await h.issue();
  h.clock.now += 120_001;
  await expectBlocked(await h.submit(challenge), "expired");
  assert.equal(verify.mock.callCount(), 0);
  await expectBlocked(await h.submit(challenge), "no_assertion");
});

test("submitted field mismatch returns 403 form_mismatch and consumes the challenge", async (context) => {
  const h = await harness(context);
  const verify = mockVerification(context);
  const challenge = await h.issue();
  await expectBlocked(await h.submit(challenge, { answers: { ...fields.answers, q1: "c" } }), "form_mismatch");
  await expectBlocked(await h.submit(challenge), "no_assertion");
  assert.equal(verify.mock.callCount(), 0);
});

test("required UV with userVerified false returns 403 uv_required", async (context) => {
  const h = await harness(context);
  mockVerification(context, false);
  await expectBlocked(await h.submit(await h.issue()), "uv_required");
  assert.equal(h.store.forUser("stu-0011")[0].counter, 0);
  assert.equal((await h.events()).at(-1)?.decision, "blocked");
});

test("happy path calls the handler and logs allowed human-verified with assertion metadata", async (context) => {
  const h = await harness(context);
  const verify = mockVerification(context, true, 3);
  const challenge = await h.issue();
  h.clock.now += 1840;
  const response = await h.submit(challenge);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  const events = await h.events();
  assert.equal(events.length, 2);
  assert.equal(events[0].decision, "presence-requested");
  const event = events[1];
  assert.equal(event.decision, "allowed");
  assert.equal(event.actor_class, "human-verified");
  assert.equal(event.presence?.age_ms, 1840);
  assert.equal(event.presence?.up, true);
  assert.equal(event.presence?.uv, true);
  assert.equal(event.presence?.credential_id, h.device.credential.id);
  assert.match(event.presence!.assertion_id, /^asr_/);
  assert.equal(result.assertion_id, event.presence?.assertion_id);
  assert.equal(h.store.forUser("stu-0011")[0].counter, 3);
  const args = verify.mock.calls[0].arguments[0];
  assert.equal(args.expectedOrigin, RP.origin);
  assert.equal(args.expectedRPID, RP.rpID);
  assert.equal(args.expectedChallenge, challenge.options.challenge);
  assert.equal(args.requireUserVerification, true);
  assert.equal(args.advancedFIDOConfig, undefined);
});

test("COUNTERSIGN=off calls the handler directly, disables ceremonies, and writes no event", async (context) => {
  const h = await harness(context, { enabled: false, seed: false });
  const verify = mockVerification(context);
  assert.equal(h.session.location, "/quiz/1");
  const response = await h.post("/quiz/1/submit", { ...fields, countersign: { assertion: "invalid" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).assertion_id, null);
  for (const path of ["/challenge", "/webauthn/register/options", "/webauthn/register/verify"]) {
    assert.equal((await h.post(`/countersign${path}`, {})).status, 404);
  }
  assert.equal(verify.mock.callCount(), 0);
  assert.deepEqual(await h.events(), []);
  const page = await fetch(`${h.base}/quiz/1`, { headers: { cookie: h.session.cookie } });
  const html = await page.text();
  assert.equal(html.includes('src="/assets/countersign.js"'), false);
  assert.deepEqual(await h.events(), []);
});

test("rule max_age_s is enforced before the 120-second challenge TTL", async (context) => {
  const h = await harness(context);
  const challenge = await h.issue();
  h.clock.now += 60_001;
  await expectBlocked(await h.submit(challenge), "expired");
});

test("age is checked again after async verification", async (context) => {
  const h = await harness(context);
  const challenge = await h.issue();
  context.mock.method(simpleWebAuthn, "verifyAuthenticationResponse", async () => {
    h.clock.now += 60_001;
    return { verified: true, authenticationInfo: { userVerified: true, newCounter: 1 } };
  });
  await expectBlocked(await h.submit(challenge), "expired");
});

test("simultaneous replay executes the handler only once", async (context) => {
  const h = await harness(context);
  const challenge = await h.issue();
  const responses = await Promise.all([h.submit(challenge), h.submit(challenge)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  const events = await h.events();
  assert.equal(events.filter((event) => event.decision === "allowed").length, 1);
  assert.equal(events.filter((event) => event.decision === "blocked").length, 1);
});

test("a challenge is consumed even when its submission omits the assertion", async (context) => {
  const h = await harness(context);
  const challenge = await h.issue();
  await expectBlocked(await h.post("/quiz/1/submit", { ...fields, countersign: { challenge_id: challenge.challenge_id } }), "no_assertion");
  await expectBlocked(await h.submit(challenge), "no_assertion");
});

for (const user of ["stu-0003", "stu-0011"]) {
  test(`challenge is bound to its user and login session (${user})`, async (context) => {
    const h = await harness(context);
    const challenge = await h.issue();
    const other = await h.login(user);
    await expectBlocked(await h.post("/quiz/1/submit", {
      ...fields, countersign: { challenge_id: challenge.challenge_id, assertion: h.device.assertion(challenge.options.challenge) },
    }, other.cookie), "verification_failed");
    await expectBlocked(await h.submit(challenge), "no_assertion");
  });
}

test("a discussion challenge cannot authorize the quiz, even with the same form hash", async (context) => {
  const h = await harness(context);
  const challenge = await h.issue(fields, {
    rule_id: "discussion-initial-post", action: "POST /discussion/2/post", attestation: "own-work",
  });
  await expectBlocked(await h.post("/quiz/1/submit", {
    ...fields, countersign: { challenge_id: challenge.challenge_id, assertion: h.device.assertion(challenge.options.challenge), attestation: "own-work" },
  }), "form_mismatch");
});

test("attestation is bound to the signed challenge", async (context) => {
  const h = await harness(context);
  const body = { body: "Synthetic discussion response" };
  const response = await h.post("/countersign/challenge", {
    rule_id: "discussion-initial-post", action: "POST /discussion/2/post", form_hash: formHash(body), attestation: "own-work",
  });
  const challenge = await response.json();
  await expectBlocked(await h.post("/discussion/2/post", {
    ...body, countersign: { challenge_id: challenge.challenge_id, assertion: h.device.assertion(challenge.options.challenge), attestation: "ai-assisted" },
  }), "form_mismatch");
});

test("preferred UV accepts real UP-only assertions and contradictions are logged without blocking", async (context) => {
  const h = await harness(context);
  const body = { body: "Synthetic discussion response" };
  const response = await h.post("/countersign/challenge", {
    rule_id: "discussion-initial-post", action: "POST /discussion/2/post", form_hash: formHash(body), attestation: "own-work",
  });
  const challenge = await response.json();
  assert.equal(challenge.options.userVerification, "preferred");
  const posted = await h.post("/discussion/2/post", {
    ...body, countersign: {
      challenge_id: challenge.challenge_id,
      assertion: h.device.assertion(challenge.options.challenge, { flags: 0x01 }),
      attestation: "own-work", telemetry: { single_event_fill: true, final_length: body.body.length, keystrokes: 0 },
    },
  });
  assert.equal(posted.status, 200);
  assert.equal((await posted.json()).ok, true);
  const events = await h.events();
  assert.deepEqual(events.map((event) => event.decision), ["presence-requested", "allowed", "contradiction"]);
  assert.equal(events[1].actor_class, "human-verified");
  assert.equal(events[1].presence?.uv, false);
  // The portal, not the caller, decides whether a post is still the initial post.
  assert.equal((await h.post("/countersign/challenge", {
    rule_id: "discussion-initial-post", action: "POST /discussion/2/post", form_hash: formHash(body), attestation: "own-work",
  })).status, 400);
});

test("the real library verifies a signed assertion and persists the counter across store instances", async (context) => {
  const h = await harness(context);
  const challenge = await h.issue();
  const response = await h.post("/quiz/1/submit", {
    ...fields, countersign: { challenge_id: challenge.challenge_id, assertion: h.device.assertion(challenge.options.challenge) },
  }, h.session.cookie, { "Countersign-Agent": "test-agent" });
  assert.equal(response.status, 200);
  assert.equal((await h.events()).at(-1)?.actor_class, "human-verified");
  assert.equal(new CredentialStore(h.credentialsPath).forUser("stu-0011")[0].counter, 1);
});

for (const variant of ["up", "uv", "origin", "rpID", "challenge", "signature", "credential", "userHandle"] as const) {
  test(`real cryptographic verification rejects invalid ${variant}`, async (context) => {
    const h = await harness(context);
    const challenge = await h.issue();
    const assertion = h.device.assertion(variant === "challenge" ? "wrong-challenge" : challenge.options.challenge, {
      flags: variant === "up" ? 0x04 : variant === "uv" ? 0x01 : 0x05,
      origin: variant === "origin" ? "http://localhost:3001" : RP.origin,
      rpID: variant === "rpID" ? "example.invalid" : RP.rpID,
      user: variant === "userHandle" ? "stu-0003" : "stu-0011",
    });
    if (variant === "signature") {
      const bytes = Buffer.from(assertion.response.signature, "base64url");
      bytes[bytes.length - 1] ^= 1;
      assertion.response.signature = bytes.toString("base64url");
    }
    if (variant === "credential") assertion.id = "unknown-credential";
    await expectBlocked(await h.submit(challenge, fields, assertion), variant === "uv" ? "uv_required" : "verification_failed");
    assert.equal((await h.events()).at(-1)?.decision, "blocked");
    assert.equal(h.store.forUser("stu-0011")[0].counter, 0);
  });
}

test("counter regression is advisory after valid signature verification", async (context) => {
  const h = await harness(context, { counter: 8 });
  const challenge = await h.issue();
  assert.equal((await h.submit(challenge, fields, h.device.assertion(challenge.options.challenge, { counter: 2 }))).status, 200);
  assert.match((await h.events()).at(-1)!.notes, /counter did not increase/);
  assert.equal(h.store.forUser("stu-0011")[0].counter, 8);
});

test("challenge issuance validates the known action, matching rule, hash, and attestation", async (context) => {
  const h = await harness(context);
  for (const binding of [
    { action: "POST /unknown" }, { rule_id: "discussion-initial-post" },
    { form_hash: "not-a-hash" }, { attestation: "own-work" },
  ]) {
    assert.equal((await h.post("/countersign/challenge", {
      rule_id: "quiz-submit", action: "POST /quiz/1/submit", form_hash: formHash(fields), ...binding,
    })).status, 400);
  }
  assert.deepEqual(await h.events(), []);
  const a = await h.issue();
  const b = await h.issue();
  assert.notEqual(a.options.challenge, b.options.challenge);
  assert.notEqual(a.challenge_id, b.challenge_id);
  assert.equal(a.expires_at, h.clock.now + 120_000);
  assert.deepEqual(a.options.allowCredentials.map((item: { id: string }) => item.id), [h.device.credential.id]);
});

test("first login enrolls a passkey and real registration persists a usable public key", async (context) => {
  const h = await harness(context, { seed: false });
  assert.equal(h.session.location, "/register");
  assert.equal((await h.post("/countersign/challenge", {
    rule_id: "quiz-submit", action: "POST /quiz/1/submit", form_hash: formHash(fields),
  })).status, 409);
  const options = await (await h.post("/countersign/webauthn/register/options", {})).json();
  assert.equal(options.rp.id, "localhost");
  assert.equal(options.user.id, Buffer.from("stu-0011").toString("base64url"));
  assert.equal(options.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(options.authenticatorSelection.userVerification, "required");
  const registration = h.device.registration(options.challenge);
  const response = await h.post("/countersign/webauthn/register/verify", registration);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).credential_id, h.device.credential.id);
  const reloaded = new CredentialStore(h.credentialsPath).forUser("stu-0011");
  assert.equal(reloaded.length, 1);
  assert.deepEqual(reloaded[0].publicKey, h.device.credential.publicKey);
  assert.equal(reloaded[0].credentialDeviceType, "singleDevice");
  assert.deepEqual(reloaded[0].transports, ["internal"]);
  assert.equal((await h.post("/countersign/webauthn/register/verify", registration)).status, 400);
  const nextOptions = await (await h.post("/countersign/webauthn/register/options", {})).json();
  assert.notEqual(nextOptions.challenge, options.challenge);
  assert.equal(nextOptions.excludeCredentials[0].id, h.device.credential.id);
  assert.equal((await h.submit(await h.issue())).status, 200);
  assert.equal((await h.login()).location, "/quiz/1");
});

for (const variant of ["expired", "session", "origin", "rpID", "up", "uv"] as const) {
  test(`registration rejects ${variant} and never persists an unverified credential`, async (context) => {
    const h = await harness(context, { seed: false });
    const options = await (await h.post("/countersign/webauthn/register/options", {})).json();
    if (variant === "expired") h.clock.now += 120_001;
    const cookie = variant === "session" ? (await h.login()).cookie : h.session.cookie;
    const response = await h.post("/countersign/webauthn/register/verify", h.device.registration(options.challenge, {
      origin: variant === "origin" ? "http://localhost:3001" : RP.origin,
      rpID: variant === "rpID" ? "example.invalid" : RP.rpID,
      flags: variant === "up" ? 0x44 : variant === "uv" ? 0x41 : 0x45,
    }), cookie);
    assert.equal(response.status, 400);
    assert.deepEqual(h.store.forUser("stu-0011"), []);
  });
}

test("ceremony endpoints require a session, JSON, and the expected browser Origin", async (context) => {
  const h = await harness(context);
  for (const path of ["/challenge", "/webauthn/register/options", "/webauthn/register/verify"]) {
    assert.equal((await h.post(`/countersign${path}`, {}, "")).status, 401);
    assert.equal((await h.post(`/countersign${path}`, {}, h.session.cookie, { origin: "http://localhost:3001" })).status, 403);
    assert.equal((await h.post(`/countersign${path}`, {}, h.session.cookie, { "content-type": "text/plain" })).status, 415);
  }
});

test("governed and ungoverned sessions use distinct cookie names", async (context) => {
  const on = await harness(context);
  const off = await harness(context, { enabled: false });
  assert.match(on.session.cookie, /countersign_user=/);
  assert.match(off.session.cookie, /countersign_off_user=/);
  const cookie = `${on.session.cookie}; ${off.session.cookie}`;
  const response = await on.post("/countersign/challenge", {
    rule_id: "quiz-submit", action: "POST /quiz/1/submit", form_hash: formHash(fields),
  }, cookie);
  assert.equal(response.status, 200);
});

test("route case/trailing-slash variants cannot bypass the quiz middleware", async (context) => {
  const h = await harness(context);
  for (const path of ["/quiz/1/submit/", "/QUIZ/1/SUBMIT"]) {
    await expectBlocked(await h.post(path, fields), "no_assertion");
  }
});

test("canonical hash sorts nested field names, preserves array order, and excludes only the envelope", () => {
  const hash = formHash({ answers: { q2: "d", q1: "b" }, countersign: { challenge_id: "ignored" } });
  assert.equal(hash, formHash({ answers: { q1: "b", q2: "d" } }));
  assert.notEqual(formHash({ values: ["a", "b"] }), formHash({ values: ["b", "a"] }));
  assert.notEqual(formHash({ data: { countersign: "a" } }), formHash({ data: { countersign: "b" } }));
});

test("fresh enrollment is immediately usable for both quiz and record without losing credentials or counters", async (context) => {
  const h = await harness(context, { seed: false });
  const options = await (await h.post("/countersign/webauthn/register/options", {})).json();
  assert.equal((await h.post("/countersign/webauthn/register/verify", h.device.registration(options.challenge))).status, 200);
  assert.equal((await h.submit(await h.issue())).status, 200);
  const reveal = await (await h.post("/countersign/unmask", {
    rule_id: "student-record.unmask", action: "POST /countersign/unmask/verify",
  })).json();
  assert.equal(reveal.options.allowCredentials[0].id, h.device.credential.id);
  const revealed = await h.post("/countersign/unmask/verify", {
    challenge_id: reveal.challenge_id,
    assertion: h.device.assertion(reveal.options.challenge, { counter: 2 }),
  });
  assert.equal(revealed.status, 200);
  assert.equal((await revealed.json()).fields.ssn, "900-12-3411");
  assert.equal(h.store.forUser("stu-0011")[0].counter, 2);

  const secondDevice = authenticator();
  const moreOptions = await (await h.post("/countersign/webauthn/register/options", {})).json();
  assert.equal((await h.post("/countersign/webauthn/register/verify", secondDevice.registration(moreOptions.challenge))).status, 200);
  const next = await h.issue();
  assert.equal((await h.submit(next, fields, secondDevice.assertion(next.options.challenge))).status, 200);
  const credentials = h.store.forUser("stu-0011");
  assert.equal(credentials.length, 2);
  assert.equal(credentials.find((item) => item.id === h.device.credential.id)?.counter, 2);
  assert.equal(credentials.find((item) => item.id === secondDevice.credential.id)?.counter, 1);
});

test("record and quiz challenges cannot authorize each other's actions", async (context) => {
  const h = await harness(context);
  const quiz = await h.issue();
  await expectBlocked(await h.post("/countersign/unmask/verify", {
    challenge_id: quiz.challenge_id, assertion: h.device.assertion(quiz.options.challenge),
  }), "binding_mismatch");
  await expectBlocked(await h.submit(quiz), "no_assertion");
  const record = await (await h.post("/countersign/unmask", {
    rule_id: "student-record.unmask", action: "POST /countersign/unmask/verify",
  })).json();
  await expectBlocked(await h.submit(record), "form_mismatch");
  await expectBlocked(await h.post("/countersign/unmask/verify", {
    challenge_id: record.challenge_id, assertion: h.device.assertion(record.options.challenge),
  }), "no_assertion");
  assert.ok(!(await h.events()).some((event) => event.decision === "allowed" || event.decision === "unmasked"));
});

test("session signals appear in quiz provenance but never block a valid presence proof", async (context) => {
  const h = await harness(context);
  const sample = { route: "/quiz/1", signals: { webdriver: true } };
  const signalResponse = await h.post("/countersign/signals", sample);
  assert.equal((await signalResponse.json()).flagged, true);
  const challenge = await h.issue();
  const requested = (await h.events()).at(-1)!;
  assert.equal(requested.actor_class, "automation-suspected");
  assert.ok(requested.signals.score >= 0.6);
  assert.equal((await h.submit(challenge)).status, 200);
  const allowed = (await h.events()).at(-1)!;
  assert.equal(allowed.actor_class, "human-verified");
  assert.equal(allowed.signals.score, requested.signals.score);
  await expectBlocked(await h.post("/quiz/1/submit", fields), "no_assertion");
  assert.equal((await h.events()).at(-1)?.actor_class, "automation-suspected");
  await h.post("/countersign/signals", sample, h.session.cookie, { "Countersign-Agent": "test-browser" });
  await h.issue();
  assert.equal((await h.events()).at(-1)?.actor_class, "agent-declared");
});

test("log writer appends one valid provenance event", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "countersign-log-"));
  const path = join(directory, "provenance.jsonl");
  context.after(async () => rm(directory, { recursive: true, force: true }));

  const event = await appendProvenanceEvent(
    {
      session_id: "sess_test",
      user: { id: "stu-0011", name: "Capt J. Demo" },
      route: "/quiz/1",
      action: "GET /quiz/1",
      rule_id: "scaffold-route-visit",
      class: "unrestricted",
      decision: "allowed",
      actor_class: "unverified",
      presence: null,
      attestation: null,
      signals: { score: 0, flags: [] },
      telemetry: null,
      form_hash: null,
      notes: "test",
    },
    path,
  );

  assert.match(event.event_id, /^evt_[a-f0-9]{32}$/);
  assert.equal(new Date(event.ts).toISOString(), event.ts);
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), event);
});
