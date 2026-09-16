import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../../../portal/app.js";
import { formHash } from "../canonical.js";
import { CredentialStore } from "../credentials.js";
import { readProvenanceEvents } from "../log.js";
import type { Attestation, SubmissionProvenance } from "../types.js";
import { authenticator } from "./authenticator.js";

async function setup(context: TestContext, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), "countersign-discussion-"));
  const credentialsPath = join(directory, "credentials.json");
  const provenancePath = join(directory, "provenance.jsonl");
  const device = authenticator();
  new CredentialStore(credentialsPath).add("stu-0011", device.credential);
  const server = createApp({ countersignEnabled: enabled, credentialsPath, provenancePath,
    sessionSecret: "discussion-test-session" }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  let cookie = "";
  async function login(user = "stu-0011") {
    const response = await fetch(`${base}/login`, { method: "POST", redirect: "manual",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: user }) });
    assert.equal(response.status, 303);
    cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
    await response.text();
  }
  await login();
  async function post(path: string, body: unknown) {
    return fetch(`${base}${path}`, { method: "POST", redirect: "manual",
      headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  }
  async function page() {
    const response = await fetch(`${base}/discussion/2`, { headers: { cookie } });
    assert.equal(response.status, 200);
    return response.text();
  }
  async function publish(attestation: Attestation, telemetry: unknown, options: {
    fields?: Record<string, unknown>; flags?: number; spoof?: Record<string, unknown>;
  } = {}) {
    const fields = options.fields ?? { body: "Synthetic discussion: judgment and human responsibility remain essential." };
    const issued = await post("/countersign/challenge", {
      rule_id: "discussion-initial-post", action: "POST /discussion/2/post", form_hash: formHash(fields), attestation,
    });
    assert.equal(issued.status, 200);
    const challenge = await issued.json();
    const response = await post("/discussion/2/post", { ...fields, countersign: {
      ...options.spoof, challenge_id: challenge.challenge_id, attestation, telemetry,
      assertion: device.assertion(challenge.options.challenge, { flags: options.flags }),
    } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<{ ok: boolean; post_id: string; redirect: string; provenance: SubmissionProvenance }>;
  }
  return { login, post, page, publish, events: () => readProvenanceEvents(provenancePath) };
}

function publishedArticle(html: string, postId: string): string {
  const article = html.match(new RegExp(`<article id="${postId}"[^>]*>[\\s\\S]*?</article>`));
  assert.ok(article, "the published post is rendered");
  return article[0];
}

test("AI-assisted posts retain server provenance across reloads and expose it to peers after publishing", async (context) => {
  const h = await setup(context);
  assert.match(await h.page(), /Peer posts are hidden until/);
  const result = await h.publish("ai-assisted", { field: "body", single_event_fill: true, keystrokes: 0, final_length: 75 });
  assert.equal(result.ok, true);
  assert.equal(result.redirect, `/discussion/2?posted=${result.post_id}#${result.post_id}`);
  const provenance = result.provenance;
  const events = (await h.events()).filter((event) => event.action === "POST /discussion/2/post");
  assert.deepEqual(events.map((event) => event.decision), ["presence-requested", "allowed"]);
  assert.equal(provenance.event_id, events[1].event_id);
  assert.equal(provenance.attestation, "ai-assisted");
  assert.equal(provenance.actor_class, "human-verified");
  assert.deepEqual(provenance.presence, events[1].presence);
  assert.deepEqual(provenance.review_flags, []);
  for (const user of ["stu-0011", "stu-0003"]) {
    await h.login(user);
    const html = await h.page();
    const article = publishedArticle(html, result.post_id);
    assert.match(article, /AI-assisted \(disclosed\)/);
    assert.match(article, /Human presence verified at submit/);
    assert.ok(article.includes(provenance.event_id));
    assert.ok(article.includes(provenance.presence!.assertion_id));
    assert.doesNotMatch(article, /Flagged for review/);
    assert.match(html, /Provenance not recorded/); // Fixtures are not retroactively verified.
    assert.match(html, /SYNTHETIC - AI GENERATED/);
  }
});

test("own-work remains a declaration, with presence-only proofs accepted under preferred UV", async (context) => {
  const h = await setup(context);
  const result = await h.publish("own-work", [{ field: "body", single_event_fill: false, keystrokes: 90, final_length: 75 }], { flags: 0x01 });
  assert.equal(result.provenance.presence?.up, true);
  assert.equal(result.provenance.presence?.uv, false);
  assert.deepEqual(result.provenance.review_flags, []);
  const article = publishedArticle(await h.page(), result.post_id);
  assert.match(article, /Own work \(declared\)/);
  assert.match(article, /Human presence verified at submit/);
  assert.match(article, /UV: false/);
  assert.doesNotMatch(article, /AI-assisted|Flagged for review/);
});

test("contradictory own-work publishes with a review badge tied to the actual review event", async (context) => {
  const h = await setup(context);
  const result = await h.publish("own-work", [{ field: "body", single_event_fill: true, keystrokes: 0, final_length: 75 }]);
  const events = (await h.events()).filter((event) => event.action === "POST /discussion/2/post");
  assert.deepEqual(events.map((event) => event.decision), ["presence-requested", "allowed", "contradiction"]);
  assert.deepEqual(result.provenance.review_flags, [{ decision: "contradiction", event_id: events[2].event_id, notes: events[2].notes }]);
  const article = publishedArticle(await h.page(), result.post_id);
  assert.match(article, /Own work \(declared\)/);
  assert.match(article, /Flagged for review/);
  assert.match(article, /Published for faculty review/);
  assert.match(article, /Composition signals do not establish authorship/);
  assert.ok(article.includes(events[2].event_id));
  assert.doesNotMatch(article, /AI-assisted \(disclosed\)/);
});

test("client-supplied badge metadata is ignored and post text is escaped", async (context) => {
  const h = await setup(context);
  const forged = { event_id: "forged-event", actor_class: "agent-declared", attestation: "own-work",
    presence: null, review_flags: [{ decision: "flagged", event_id: "forged-review", notes: "FORGED BADGE" }] };
  const result = await h.publish("ai-assisted", null, {
    fields: { body: '<img src=x onerror="alert(1)"> Synthetic response.', provenance: forged },
    spoof: { ...forged, provenance: forged },
  });
  assert.equal(result.provenance.actor_class, "human-verified");
  assert.equal(result.provenance.attestation, "ai-assisted");
  assert.deepEqual(result.provenance.review_flags, []);
  const article = publishedArticle(await h.page(), result.post_id);
  assert.match(article, /&lt;img/);
  assert.doesNotMatch(article, /<img|forged-event|forged-review|FORGED BADGE/);
});

test("missing proof does not publish a post or disclose the hidden peer discussion", async (context) => {
  const h = await setup(context);
  const response = await h.post("/discussion/2/post", { body: "This submission has no presence proof." });
  assert.equal(response.status, 403);
  const html = await h.page();
  assert.match(html, /Peer posts are hidden until/);
  assert.doesNotMatch(html, /This submission has no presence proof|Enduring purpose, changing means/);
  const events = (await h.events()).filter((event) => event.action === "POST /discussion/2/post");
  assert.deepEqual(events.map((event) => event.decision), ["blocked"]);
});

test("ungoverned posts ignore forged provenance, render no badges, and write no events", async (context) => {
  const h = await setup(context, false);
  const forged = { actor_class: "human-verified", attestation: "ai-assisted", presence: { assertion_id: "forged-assertion" } };
  const response = await h.post("/discussion/2/post", {
    body: "An ungoverned synthetic response.", provenance: forged, countersign: forged,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.provenance, null);
  const html = await h.page();
  assert.match(html, /An ungoverned synthetic response/);
  assert.doesNotMatch(html, /data-actor-class|data-disclosure|data-presence-status|data-review-flag|forged-assertion/);
  assert.deepEqual(await h.events(), []);
});
