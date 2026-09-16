import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../../../portal/app.js";
import { formHash } from "../canonical.js";
import { CredentialStore } from "../credentials.js";
import { readProvenanceEvents } from "../log.js";
import { simpleWebAuthn } from "../webauthn.js";
import { authenticator } from "./authenticator.js";

const fields = { body: "Synthetic first-run response for reset verification." };
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function setup(t: TestContext, enabled = true) {
  const directory = await fs.mkdtemp(join(tmpdir(), "countersign-reset-"));
  const credentialsPath = join(directory, "credentials.json");
  const provenancePath = join(directory, "events.jsonl");
  const device = authenticator();
  new CredentialStore(credentialsPath).add("stu-0011", device.credential);
  const server = createApp({ countersignEnabled: enabled, credentialsPath, provenancePath,
    sessionSecret: "synthetic-reset-tests" }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function login(id = "stu-0011") {
    const response = await fetch(base + "/login", { method: "POST", redirect: "manual",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: id }) });
    assert.equal(response.status, 303);
    await response.text();
    return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  }
  const cookie = await login();
  const post = (path: string, body: unknown, session = cookie, headers: Record<string, string> = {}) => fetch(base + path, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/json", accept: "application/json", cookie: session, ...headers },
    body: JSON.stringify(body),
  });
  const page = async (session = cookie) => {
    const response = await fetch(base + "/discussion/2", { headers: { cookie: session } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.text();
  };
  const token = async (session = cookie) => {
    const match = (await page(session)).match(/name="reset_token" value="([^"]+)"/);
    assert.ok(match, "demo page contains a reset token");
    return match[1];
  };
  const issue = (session = cookie, values = fields, attestation = "own-work") => post("/countersign/challenge", {
    rule_id: "discussion-initial-post", action: "POST /discussion/2/post", form_hash: formHash(values), attestation,
  }, session);
  let counter = 0;
  const envelope = (challenge: { challenge_id: string; options: { challenge: string } }, attestation = "own-work") => ({
    challenge_id: challenge.challenge_id, assertion: device.assertion(challenge.options.challenge, { counter: ++counter }), attestation,
  });
  const publish = async (values = fields, attestation = "own-work") => {
    let countersign;
    if (enabled) { const response = await issue(cookie, values, attestation); assert.equal(response.status, 200); countersign = envelope(await response.json(), attestation); }
    const response = await post("/discussion/2/post", { ...values, ...(countersign ? { countersign } : {}) });
    assert.equal(response.status, 200, await response.clone().text());
    return { result: await response.json(), countersign };
  };
  const reset = (reset_token: string, extra: Record<string, unknown> = {}) => post("/discussion/2/reset", { reset_token, confirmation: "reset-discussion", ...extra });
  return { base, cookie, credentialsPath, provenancePath, device, login, post, page, token, issue, envelope, publish, reset,
    events: () => readProvenanceEvents(provenancePath) };
}

for (const enabled of [true, false]) test(`post-reset-post restores only demo state and retains credentials/audit (governed=${enabled})`, async t => {
  const h = await setup(t, enabled);
  if (enabled) await (await h.post("/countersign/signals", { route: "/discussion/2", signals: { webdriver: true } })).json();
  const first = await h.publish();
  const peer = await h.login("stu-0003");
  const other = await (await h.post("/discussion/2/post", { body: "Another synthetic student's runtime response." }, peer)).json();
  assert.ok(other.post_id);
  const resetToken = await h.token();
  const previousLog = await fs.readFile(h.provenancePath, "utf8").catch(() => "");
  const credentials = await fs.readFile(h.credentialsPath, "utf8");
  const result = await h.reset(resetToken, { user_id: "stu-0003" }); // Target is server-owned, never this claim.
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, removed_posts: 1, redirect: "/discussion/2?reset=1" });
  assert.equal(await fs.readFile(h.credentialsPath, "utf8"), credentials);
  assert.ok((await fs.readFile(h.provenancePath, "utf8")).startsWith(previousLog));
  const initial = await h.page();
  assert.match(initial, /Peer posts are hidden until|Your initial response/);
  assert.match(initial, /<textarea id="body"/);
  assert.doesNotMatch(initial, /data-post-id=|Synthetic first-run response/);
  const peerView = await h.page(peer);
  assert.ok(!peerView.includes(`data-post-id="${first.result.post_id}"`));
  assert.ok(peerView.includes(`data-post-id="${other.post_id}"`));
  assert.equal([...peerView.matchAll(/data-post-id=/g)].length, 31, "30 source posts plus the other user's runtime post remain");
  const resetEvent = (await h.events()).find(event => event.rule_id === "demo-discussion-reset")!;
  assert.equal(resetEvent.class, "unrestricted");
  assert.equal(resetEvent.decision, "allowed");
  assert.equal(resetEvent.presence, null);
  assert.equal(resetEvent.user.id, "stu-0011");
  if (enabled) assert.ok(resetEvent.signals.flags.includes("webdriver"), "reset does not erase observed suspicion");
  assert.match(resetEvent.notes, new RegExp(`COUNTERSIGN=${enabled ? "on" : "off"}; removed_posts=1`));
  assert.ok(resetEvent.notes.includes(first.result.post_id));
  assert.ok(!resetEvent.notes.includes(fields.body) && !resetEvent.notes.includes(resetToken));
  if (enabled) {
    assert.equal((await h.post("/discussion/2/post", fields)).status, 403, "reset is not a presence bypass");
    assert.equal((await h.post("/discussion/2/post", { ...fields, countersign: first.countersign })).status, 403);
  }
  const second = await h.publish({ body: "A fresh synthetic second-run response." }, "ai-assisted");
  assert.notEqual(second.result.post_id, first.result.post_id);
  if (enabled) {
    assert.equal(second.result.provenance.attestation, "ai-assisted");
    assert.notEqual(second.result.provenance.presence.assertion_id, first.result.provenance.presence.assertion_id);
  } else {
    assert.equal(second.result.provenance, null);
    assert.deepEqual((await h.events()).map(event => event.rule_id), ["demo-discussion-reset"], "off mode only audits maintenance");
  }
  assert.equal((await h.reset(resetToken)).status, 403, "a stale control cannot erase the new run");
  assert.ok((await h.page()).includes(second.result.post_id));
});

test("reset rejects unauthenticated, non-demo, cross-origin, unconfirmed, stale-session, and malformed requests", async t => {
  const h = await setup(t);
  const token = await h.token();
  const body = { reset_token: token, confirmation: "reset-discussion" };
  assert.equal((await h.post("/discussion/2/reset", body, "")).status, 401);
  const peer = await h.login("stu-0003");
  assert.doesNotMatch(await h.page(peer), /data-demo-controls/);
  assert.equal((await h.post("/discussion/2/reset", body, peer)).status, 403);
  for (const origin of ["https://example.invalid", "http://localhost:3001", "null"]) {
    assert.equal((await h.post("/discussion/2/reset", body, h.cookie, { origin })).status, 403);
  }
  assert.equal((await h.post("/discussion/2/reset", { confirmation: "reset-discussion" })).status, 403);
  assert.equal((await h.reset("é".repeat(token.length))).status, 403);
  assert.equal((await h.post("/discussion/2/reset", { reset_token: token })).status, 400);
  assert.equal((await h.post("/discussion/2/reset", body, h.cookie, { "content-type": "text/plain" })).status, 415);
  assert.equal((await h.post("/discussion/2/reset", body, await h.login())).status, 403);
  assert.equal((await fetch(h.base + "/discussion/2/reset", { headers: { cookie: h.cookie } })).status, 404);
  assert.ok(!(await h.events()).some(event => event.rule_id === "demo-discussion-reset"));
});

test("reset revokes outstanding discussion challenges across sessions but preserves quiz, record, and registration", async t => {
  const h = await setup(t);
  const anotherSession = await h.login();
  const first = await (await h.issue()).json();
  const second = await (await h.issue(anotherSession)).json();
  const firstProof = h.envelope(first);
  const secondProof = h.envelope(second);
  const quizFields = { answers: { q1: "c" } };
  const quiz = await (await h.post("/countersign/challenge", { rule_id: "quiz-submit", action: "POST /quiz/1/submit", form_hash: formHash(quizFields) })).json();
  const record = await (await h.post("/countersign/unmask", { rule_id: "student-record.unmask", action: "POST /countersign/unmask/verify" })).json();
  const registration = await (await h.post("/countersign/webauthn/register/options", {})).json();
  const peerSession = await h.login("stu-0003");
  const peerDevice = authenticator();
  const peerRegistration = await (await h.post("/countersign/webauthn/register/options", {}, peerSession)).json();
  assert.equal((await h.post("/countersign/webauthn/register/verify", peerDevice.registration(peerRegistration.challenge), peerSession)).status, 200);
  const peerQuiz = await (await h.post("/countersign/challenge", { rule_id: "quiz-submit", action: "POST /quiz/1/submit", form_hash: formHash(quizFields) }, peerSession)).json();
  assert.equal((await h.reset(await h.token())).status, 200);
  for (const [proof, cookie] of [[firstProof, h.cookie], [secondProof, anotherSession]] as const) {
    const response = await h.post("/discussion/2/post", { ...fields, countersign: proof }, cookie);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, "no_assertion");
  }
  assert.equal((await h.post("/quiz/1/submit", { ...quizFields, countersign: { ...h.envelope(quiz), attestation: null } })).status, 200);
  assert.equal((await h.post("/countersign/unmask/verify", h.envelope(record))).status, 200);
  assert.equal((await h.post("/quiz/1/submit", { ...quizFields, countersign: { challenge_id: peerQuiz.challenge_id,
    assertion: peerDevice.assertion(peerQuiz.options.challenge, { user: "stu-0003" }), attestation: null } }, peerSession)).status, 200);
  const nextDevice = authenticator();
  assert.equal((await h.post("/countersign/webauthn/register/verify", nextDevice.registration(registration.challenge))).status, 200);
  assert.equal(new CredentialStore(h.credentialsPath).forUser("stu-0011").length, 2);
  assert.equal((await h.issue()).status, 200);
});

test("reset invalidates challenge generation that was already awaiting authentication options", { timeout: 10_000 }, async t => {
  const h = await setup(t);
  const token = await h.token();
  const entered = gate(); const resume = gate();
  const original = simpleWebAuthn.generateAuthenticationOptions;
  t.mock.method(simpleWebAuthn, "generateAuthenticationOptions", async (...args: Parameters<typeof original>) => {
    entered.release(); await resume.promise; return original(...args);
  });
  const pending = h.issue();
  try {
    await entered.promise;
    assert.equal((await h.reset(token)).status, 200);
  } finally { resume.release(); }
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "expired");
  assert.equal((await h.issue()).status, 200);
});

test("reset invalidates an already-consumed assertion while cryptographic verification awaits", { timeout: 10_000 }, async t => {
  const h = await setup(t);
  const token = await h.token();
  const challenge = await (await h.issue()).json();
  const entered = gate(); const resume = gate();
  const original = simpleWebAuthn.verifyAuthenticationResponse;
  t.mock.method(simpleWebAuthn, "verifyAuthenticationResponse", async (...args: Parameters<typeof original>) => {
    entered.release(); await resume.promise; return original(...args);
  });
  const pending = h.post("/discussion/2/post", { ...fields, countersign: h.envelope(challenge) });
  try {
    await entered.promise;
    assert.equal((await h.reset(token)).status, 200);
  } finally { resume.release(); }
  const response = await pending;
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, "expired");
  assert.match(await h.page(), /Your initial response/);
  assert.ok(!(await h.events()).some(event => event.action === "POST /discussion/2/post" && event.decision === "allowed"));
});

function pauseAudit(t: TestContext, action: string) {
  const entered = gate(); const resume = gate();
  const original = fs.appendFile;
  let paused = false;
  const mock = t.mock.method(fs, "appendFile", async (...args: Parameters<typeof original>) => {
    const event = JSON.parse(String(args[1]));
    if (!paused && event.action === action) { paused = true; entered.release(); await resume.promise; }
    return original(...args);
  });
  syncBuiltinESMExports();
  return { entered: entered.promise, release: resume.release, restore: () => { mock.mock.restore(); syncBuiltinESMExports(); } };
}

test("a formerly unrestricted submission cannot publish after reset while its audit write awaits", { timeout: 10_000 }, async t => {
  const h = await setup(t);
  await h.publish();
  const token = await h.token();
  const paused = pauseAudit(t, "POST /discussion/2/post");
  const pending = h.post("/discussion/2/post", { body: "Stale unrestricted synthetic response." });
  try {
    await paused.entered;
    assert.equal((await h.reset(token)).status, 200);
  } finally { paused.release(); paused.restore(); }
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "discussion_reset");
  assert.match(await h.page(), /Your initial response/);
  const peer = await h.login("stu-0003");
  assert.doesNotMatch(await h.page(peer), /Stale unrestricted synthetic response/);
});

test("a concurrent reset or demo submission cannot interleave with the reset audit", { timeout: 10_000 }, async t => {
  const h = await setup(t);
  const token = await h.token();
  const paused = pauseAudit(t, "POST /discussion/2/reset");
  const pending = h.reset(token);
  try {
    await paused.entered;
    const again = await h.reset(token);
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error, "reset_in_progress");
    assert.equal((await h.post("/discussion/2/post", fields)).status, 409);
  } finally { paused.release(); paused.restore(); }
  assert.equal((await pending).status, 200);
  assert.equal((await h.events()).filter(event => event.rule_id === "demo-discussion-reset").length, 1);
});

test("failed audit leaves visible posts and credentials intact and the reset can be retried", async t => {
  const h = await setup(t, false);
  const post = await h.publish();
  const token = await h.token();
  const credentials = await fs.readFile(h.credentialsPath, "utf8");
  await fs.mkdir(h.provenancePath); // Simulate unavailable audit storage, not a writer bypass.
  const response = await h.reset(token);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "reset_not_recorded");
  assert.ok((await h.page()).includes(post.result.post_id));
  assert.equal(await fs.readFile(h.credentialsPath, "utf8"), credentials);
  await fs.rmdir(h.provenancePath);
  assert.equal((await h.reset(token)).status, 200);
  assert.match(await h.page(), /Your initial response/);
});

test("reset and its token are isolated to the current portal instance", async t => {
  const first = await setup(t, false);
  const second = await setup(t, false);
  await first.publish();
  const other = await second.publish();
  const token = await first.token();
  assert.equal((await second.reset(token)).status, 403);
  assert.equal((await first.reset(token)).status, 200);
  assert.ok((await second.page()).includes(other.result.post_id));
  assert.deepEqual(await second.events(), []);
});

test("reset removes all runtime demo posts and a fresh no-op reset is still audited", async t => {
  const h = await setup(t, false);
  const first = await h.publish();
  const extra = await (await h.post("/discussion/2/post", { body: "Another runtime demo response." })).json();
  const reset = await h.reset(await h.token());
  assert.equal((await reset.json()).removed_posts, 2);
  const peer = await h.login("stu-0003");
  const view = await h.page(peer);
  assert.ok(!view.includes(first.result.post_id) && !view.includes(extra.post_id));
  assert.equal([...view.matchAll(/data-post-id=/g)].length, 30);
  const again = await h.reset(await h.token());
  assert.equal((await again.json()).removed_posts, 0);
  assert.equal((await h.events()).length, 2);
});
