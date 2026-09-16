import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../../../portal/app.js";
import { readProvenanceEvents } from "../log.js";

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "countersign-dashboard-"));
  const path = join(directory, "events.jsonl");
  const server = createApp({ countersignEnabled: true, provenancePath: path,
    credentialsPath: join(directory, "credentials.json"), sessionSecret: "dashboard-test" }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_id: "stu-0011" }) });
  const cookie = login.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
  await login.text();
  const get = (route: string, headers: Record<string, string> = {}) => fetch(base + route, { headers: { cookie, ...headers } });
  const post = (route: string, body: unknown) => fetch(base + route, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { path, get, post };
}

test("dashboard serves accessible user filtering and expandable evidence with one-second polling", async (t) => {
  const h = await setup(t);
  const response = await h.get("/countersign/?user=stu-0011");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const control of ["user-filter", "all-users", "timeline-status", "events"]) assert.ok(html.includes(`id="${control}"`));
  assert.match(html, /setInterval\(refresh, 1000\)/);
  assert.match(html, /Event details/);
  assert.match(html, /JSON.stringify\(event, null, 2\)/);
  assert.match(html, /textContent/);
  for (const actor of ["human-verified", "agent-declared", "automation-suspected", "unverified"]) assert.ok(html.includes(`class="${actor}"`));
});

test("events API is no-store, preserves append order, and implements exclusive opaque cursors", async (t) => {
  const h = await setup(t);
  assert.deepEqual(await (await h.get("/countersign/events")).json(), { events: [] });
  await (await h.get("/quiz/1")).text();
  await (await h.get("/discussion/2")).text();
  const all = await h.get("/countersign/events");
  assert.equal(all.headers.get("cache-control"), "no-store");
  const { events } = await all.json();
  assert.equal(events.length, 2);
  assert.deepEqual(events, await readProvenanceEvents(h.path));
  const query = (id: string) => h.get(`/countersign/events?since=${encodeURIComponent(id)}`).then(r => r.json());
  assert.deepEqual(await query(events[0].event_id), { events: [events[1]] });
  assert.deepEqual(await query(events[1].event_id), { events: [] });
  assert.deepEqual(await query("unknown-cursor"), { events });
  assert.deepEqual(await query(""), { events });
  for (const event of events) {
    assert.deepEqual(event.user, { id: "stu-0011", name: "Capt J. Demo" });
    assert.match(event.session_id, /^sess_/);
    assert.equal(event.presence, null);
  }
});

test("events API reports corrupt completed records without exposing contents and recovers next request", async (t) => {
  const h = await setup(t);
  await writeFile(h.path, "CONFIDENTIAL SENTINEL\n");
  const response = await h.get("/countersign/events");
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "provenance_unavailable", message: "The provenance log could not be read." });
  await writeFile(h.path, "");
  assert.deepEqual(await (await h.get("/countersign/events")).json(), { events: [] });
});

test("page visits retain advisory session signals and declaration precedence without claiming presence", async (t) => {
  const h = await setup(t);
  await (await h.post("/countersign/signals", { route: "/quiz/1", signals: { webdriver: true } })).json();
  await (await h.get("/quiz/1")).text();
  let event = (await readProvenanceEvents(h.path)).at(-1)!;
  assert.equal(event.actor_class, "automation-suspected");
  assert.equal(event.decision, "allowed");
  assert.equal(event.presence, null);
  assert.equal(event.signals.score, 0.6);
  await (await h.get("/discussion/2", { "Countersign-Agent": "synthetic-test" })).text();
  event = (await readProvenanceEvents(h.path)).at(-1)!;
  assert.equal(event.actor_class, "agent-declared");
  assert.equal(event.presence, null);
  assert.ok(event.signals.flags.includes("webdriver"));
  const flagged = await (await h.get("/countersign/sessions/flagged")).json();
  assert.equal(flagged.sessions.length, 1);
  assert.deepEqual(Object.keys(flagged.sessions[0]).sort(), ["session_id", "user", "score", "flags", "first_seen"].sort());
  assert.equal(flagged.sessions[0].session_id, event.session_id);
  assert.deepEqual(flagged.sessions[0].user, event.user);
});
