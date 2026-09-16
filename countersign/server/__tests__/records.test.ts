import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createApp } from "../../../portal/app.js";
import { loadPolicy } from "../policy.js";
import { scoreSignals } from "../signals.js";
import { RP } from "../webauthn.js";
import type { NewProvenanceEvent } from "../types.js";

const visible = { webdriver: false, document_hidden: false, document_has_focus: true };
const background = { ...visible, document_hidden: true, document_has_focus: false };

async function setup(context: TestContext, enabled = true) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  // COSE EC2/P-256 key: {1:2, 3:-7, -1:1, -2:x, -3:y}.
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y!, "base64url"),
  ]);
  const directory = await mkdtemp(join(tmpdir(), "countersign-record-"));
  const credentialsPath = join(directory, "credentials.json");
  await writeFile(credentialsPath, JSON.stringify({ "stu-0011": [{ id: "test-credential", publicKey: cose.toString("base64url"), counter: 0 }] }));
  const events: NewProvenanceEvent[] = [];
  const app = createApp({ countersignEnabled: enabled, sessionSecret: "test-record-secret", recordOptions: {
    credentialsPath, writeEvent: async (event) => { events.push(event); },
  } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function login(userId = "stu-0011") {
    const response = await fetch(`${base}/login`, { method: "POST", redirect: "manual",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
    return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  }
  const cookie = await login();
  const request = (path: string, body?: unknown, session = cookie) => fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "manual",
    headers: { "content-type": "application/json", cookie: session },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function signedReveal(flags = 0x05, origin: string = RP.origin, corrupt = false) {
    const challenge = await (await request("/countersign/unmask", unmaskRequest)).json();
    const hash = (value: string | Buffer) => createHash("sha256").update(value).digest();
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challenge.options.challenge, origin }));
    const authenticatorData = Buffer.concat([hash(RP.rpID), Buffer.from([flags, 0, 0, 0, 1])]);
    const signature = sign("sha256", Buffer.concat([authenticatorData, hash(clientData)]), privateKey);
    if (corrupt) signature[signature.length - 1] ^= 1;
    return {
      challenge_id: challenge.challenge_id,
      assertion: {
        id: "test-credential", rawId: "test-credential", type: "public-key", clientExtensionResults: {},
        response: { clientDataJSON: clientData.toString("base64url"), authenticatorData: authenticatorData.toString("base64url"), signature: signature.toString("base64url") },
      },
    };
  }
  return { request, login, events, credentialsPath, signedReveal };
}

test("scores read-only background automation; visible and incomplete samples stay finite", () => {
  const weights = loadPolicy().defaults.signals;
  assert.equal(scoreSignals({}, weights).score, 0);
  assert.equal(scoreSignals(visible, weights, "/record/1").flagged, false);
  assert.equal(scoreSignals(background, weights, "/quiz/1").flagged, false);
  assert.equal(scoreSignals({ ...background, document_has_focus: true }, weights, "/record/1").flagged, false);
  const result = scoreSignals(background, weights, "/record/1");
  assert.equal(result.score, weights.suspect_threshold);
  assert.equal(result.actor_class, "automation-suspected");
  assert.deepEqual(result.flags, ["background-record-read"]);
  assert.equal(scoreSignals({ webdriver: true }, weights).flagged, true);
  assert.equal(scoreSignals({ agent_header_declared: true }, weights).actor_class, "agent-declared");
});

test("record HTML never includes field values; BrowserOS-style read masks and persists the flag", async (context) => {
  const { request, events } = await setup(context);
  const html = await request("/record/1");
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.ok(html.headers.get("Countersign-Marking"));
  const text = await html.text();
  for (const value of ["Capt J. Demo", "900-12-3411", "1948267305", "limited running"]) assert.ok(!text.includes(value));
  assert.match(text, /data-protected-record/);
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, "masked");
  assert.equal((await (await request("/countersign/record-fields", {})).json()).masked, true);
  const result = await (await request("/countersign/record-fields", { signals: background })).json();
  assert.equal(result.masked, true);
  assert.equal(result.actor_class, "automation-suspected");
  assert.equal(result.fields, undefined);
  const last = events.at(-1)!;
  assert.equal(last.rule_id, "student-record");
  assert.equal(last.decision, "masked");
  assert.equal(last.actor_class, "automation-suspected");
  assert.deepEqual(last.signals.flags, ["background-record-read"]);
  assert.equal((await (await request("/countersign/record-fields", { signals: visible })).json()).masked, true);
  assert.match(await (await request("/record/1")).text(), /Automation suspected/);
  const flagged = await (await request("/countersign/sessions/flagged")).json();
  assert.equal(flagged.sessions.length, 1);
  assert.equal(flagged.sessions[0].user.id, "stu-0011");
});

test("unflagged foreground records load for the signed-in user, not a hard-coded student", async (context) => {
  const { request, login } = await setup(context);
  const demo = await (await request("/countersign/record-fields", { signals: visible })).json();
  assert.equal(demo.masked, false);
  assert.equal(demo.fields.name, "Capt J. Demo");
  const otherSession = await login("stu-0003");
  assert.ok(otherSession);
  const other = await (await request("/countersign/record-fields", { signals: visible }, otherSession)).json();
  assert.equal(other.fields.name, "Maj Rowan Vector");
  assert.equal(other.fields.ssn, "900-12-3403");
});

test("unauthenticated and ungoverned signal/reveal APIs cannot release data", async (context) => {
  const { request } = await setup(context);
  for (const path of ["/countersign/record-fields", "/countersign/unmask", "/countersign/unmask/verify", "/countersign/webauthn/register/options"]) {
    assert.equal((await request(path, {}, "")).status, 401);
  }
  const off = await setup(context, false);
  assert.match(await (await off.request("/record/1")).text(), /900-12-3411/);
  assert.equal(off.events.length, 0);
  assert.equal((await off.request("/countersign/record-fields", { signals: background })).status, 404);
});

const unmaskRequest = { rule_id: "student-record.unmask", action: "POST /countersign/unmask/verify" };

test("missing/fabricated assertions never unmask; registration is not a placeholder success", async (context) => {
  const { request, events } = await setup(context);
  const denied = await request("/countersign/unmask/verify", {});
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).reason, "no_assertion");
  const challenge = await (await request("/countersign/unmask", unmaskRequest)).json();
  const forged = { challenge_id: challenge.challenge_id, assertion: { id: "test-credential", response: {} } };
  assert.equal((await request("/countersign/unmask/verify", forged)).status, 403);
  assert.equal(events.at(-1)?.decision, "blocked");
  assert.ok(!events.some((event) => event.decision === "unmasked"));
  const registration = await (await request("/countersign/webauthn/register/options", {})).json();
  assert.equal(registration.rp.id, "localhost");
  assert.equal(registration.user.name, "stu-0011");
  assert.equal((await request("/countersign/webauthn/register/verify", {})).status, 400);
});

test("reveal rejects and consumes cross-session and expired challenges", async (context) => {
  const { request, login, signedReveal } = await setup(context);
  const second = await login();
  const first = await signedReveal();
  const response = await request("/countersign/unmask/verify", first, second);
  assert.equal((await response.json()).reason, "binding_mismatch");
  assert.equal((await request("/countersign/unmask/verify", first)).status, 403);
  const expired = await signedReveal();
  const now = Date.now();
  const clock = context.mock.method(Date, "now", () => now + 121_000);
  const expiry = await request("/countersign/unmask/verify", expired);
  assert.equal((await expiry.json()).reason, "expired");
  clock.mock.restore();
  assert.equal((await request("/countersign/unmask/verify", expired)).status, 403);
});

test("real WebAuthn verifier requires signed UP/UV, correct origin, and valid signature", async (context) => {
  const { request, events, credentialsPath, signedReveal } = await setup(context);
  await request("/countersign/record-fields", { signals: background });
  for (const scenario of [
    { flags: 0x04, origin: RP.origin, corrupt: false, expected: 403 }, // No UP
    { flags: 0x01, origin: RP.origin, corrupt: false, expected: 403 }, // No UV
    { flags: 0x05, origin: "http://localhost:3001", corrupt: false, expected: 403 },
    { flags: 0x05, origin: RP.origin, corrupt: true, expected: 403 },
    { flags: 0x05, origin: RP.origin, corrupt: false, expected: 200 },
  ]) {
    const body = await signedReveal(scenario.flags, scenario.origin, scenario.corrupt);
    const response = await request("/countersign/unmask/verify", body);
    assert.equal(response.status, scenario.expected);
    const result = await response.json();
    if (scenario.expected === 403) {
      assert.equal(result.fields, undefined);
    } else {
      assert.equal(result.fields.ssn, "900-12-3411");
      const event = events.at(-1)!;
      assert.equal(event.decision, "unmasked");
      assert.equal(event.actor_class, "human-verified");
      assert.match(event.presence!.assertion_id, /^asr_/);
      assert.equal(event.presence!.uv, true);
      assert.equal(JSON.parse(await readFile(credentialsPath, "utf8"))["stu-0011"][0].counter, 1);
    }
    assert.equal((await request("/countersign/unmask/verify", body)).status, 403);
  }
  assert.equal(events.filter((event) => event.decision === "unmasked").length, 1);
  assert.equal((await (await request("/countersign/record-fields", { signals: visible })).json()).masked, true);
});
