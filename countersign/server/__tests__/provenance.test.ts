import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { appendProvenanceEvent, readProvenanceEvents } from "../log.js";
import { normalizeTelemetry, validateProvenanceEvent } from "../provenance.js";
import type { NewProvenanceEvent, ProvenanceEvent } from "../types.js";

const input: NewProvenanceEvent = {
  session_id: "sess_synthetic", user: { id: "stu-synthetic", name: "Capt Synthetic Test" },
  route: "/quiz/1", action: "GET /quiz/1", rule_id: "scaffold-route-visit", class: "unrestricted",
  decision: "allowed", actor_class: "unverified", presence: null, attestation: null,
  signals: { score: 0, flags: [] }, telemetry: null, form_hash: null, notes: "",
};
const event = (): ProvenanceEvent => ({ ...input, telemetry: null, ts: "2026-09-16T18:00:00.000Z", event_id: "evt_synthetic" });
async function file(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "countersign-provenance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "events.jsonl");
}

test("event validation accepts each documented enum and UP-only preferred-UV evidence", () => {
  for (const decision of ["allowed", "blocked", "flagged", "masked", "unmasked", "presence-requested", "contradiction"]) {
    assert.equal(validateProvenanceEvent({ ...event(), decision }).decision, decision);
  }
  for (const value of ["human-required", "attested", "marking", "unrestricted"]) validateProvenanceEvent({ ...event(), class: value });
  for (const actor_class of ["agent-declared", "automation-suspected", "unverified"]) validateProvenanceEvent({ ...event(), actor_class });
  const verified = validateProvenanceEvent({ ...event(), actor_class: "human-verified", presence: {
    assertion_id: "asr_synthetic", credential_id: "synthetic-public-id", up: true, uv: false, age_ms: 12,
  } });
  assert.equal(verified.presence?.uv, false);
  for (const attestation of [null, "own-work", "ai-assisted"]) validateProvenanceEvent({ ...event(), class: "attested", attestation });
});

test("invalid metadata, enums, signal ranges, and proof claims fail validation", () => {
  for (const change of [
    { event_id: "" }, { session_id: null }, { action: null }, { rule_id: 1 }, { ts: "not-a-date" },
    { route: null }, { notes: {} }, { user: { id: "x" } }, { class: "other" }, { decision: "other" },
    { actor_class: "other" }, { attestation: "yes" }, { signals: { score: NaN, flags: [] } },
    { signals: { score: Infinity, flags: [] } }, { signals: { score: -1, flags: [] } },
    { signals: { score: 1.1, flags: [] } }, { signals: { score: 0, flags: [1] } },
    { presence: {} }, { actor_class: "human-verified" }, { form_hash: {} },
    { telemetry: { field: "body" } },
  ]) assert.throws(() => validateProvenanceEvent({ ...event(), ...change }), /Invalid provenance/);
  const proof = { assertion_id: "asr_x", credential_id: "cred_x", up: true, uv: true, age_ms: 1 };
  for (const change of [{ up: false }, { uv: null }, { age_ms: -1 }, { age_ms: Infinity }, { assertion_id: "" }]) {
    assert.throws(() => validateProvenanceEvent({ ...event(), actor_class: "human-verified", presence: { ...proof, ...change } }));
  }
  assert.throws(() => validateProvenanceEvent({ ...event(), presence: proof }), /actor_class\/presence/);
  assert.throws(() => validateProvenanceEvent(null), /Invalid provenance/);
});

test("telemetry accepts real client, partial, multi-field, and no-input shapes without coercion", () => {
  const sample = { field: "body", final_length: 80, keystrokes: 0, input_events: 1,
    input_types: { insertFromPaste: 1 }, single_event_fill: true, time_on_field_ms: 12,
    first_input_ts: "2026-09-16T18:00:00.000Z", last_input_ts: null };
  assert.deepEqual(normalizeTelemetry(sample), { telemetry: sample, discarded: false });
  assert.deepEqual(normalizeTelemetry([sample, { single_event_fill: false }]), { telemetry: [sample, { single_event_fill: false }], discarded: false });
  assert.deepEqual(normalizeTelemetry(null), { telemetry: null, discarded: false });
  assert.deepEqual(normalizeTelemetry([]), { telemetry: null, discarded: false });
});

test("malformed telemetry is dropped and unknown payload fields never enter the audit record", () => {
  for (const value of ["raw text", 0, true, { final_length: -1 }, { keystrokes: 0.5 }, { input_events: Infinity },
    { single_event_fill: "true" }, { time_on_field_ms: NaN }, { input_types: { insertText: -1 } },
    { first_input_ts: "not-a-date" }, { last_input_ts: {} }, { field: [] }]) {
    assert.deepEqual(normalizeTelemetry(value), { telemetry: null, discarded: true });
  }
  const raw = { field: "body", final_length: 80, body: "DO NOT STORE THIS TEXT" };
  assert.deepEqual(normalizeTelemetry(raw), { telemetry: { field: "body", final_length: 80 }, discarded: true });
  assert.ok("body" in raw, "normalization does not mutate caller data");
  assert.deepEqual(normalizeTelemetry([{ field: "body", keystrokes: -1, single_event_fill: true }, { final_length: 5 }]),
    { telemetry: [{ final_length: 5 }], discarded: true });
});

test("writer normalizes advisory input, generates opaque IDs/time, and appends one exact event per line", async (t) => {
  const path = await file(t);
  const first = await appendProvenanceEvent({ ...input, class: "attested", telemetry: { field: "body", raw: "DO NOT STORE" } }, path);
  const second = await appendProvenanceEvent(input, path);
  assert.match(first.event_id, /^evt_[a-f0-9]{32}$/);
  assert.notEqual(first.event_id, second.event_id);
  assert.equal(new Date(first.ts).toISOString(), first.ts);
  assert.deepEqual(first.telemetry, { field: "body" });
  assert.match(first.notes, /Discarded/);
  const raw = await readFile(path, "utf8");
  assert.doesNotMatch(raw, /DO NOT STORE/);
  assert.equal(raw, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
  assert.deepEqual(await readProvenanceEvents(path), [first, second]);
  await assert.rejects(appendProvenanceEvent({ ...input, signals: { score: Infinity, flags: [] } }, path), /signals/);
  assert.equal(await readFile(path, "utf8"), raw, "invalid metadata does not alter the log");
});

test("reader handles absent/empty logs and retries incomplete final appends without losing complete events", async (t) => {
  const path = await file(t);
  assert.deepEqual(await readProvenanceEvents(path), []);
  await writeFile(path, "\n");
  assert.deepEqual(await readProvenanceEvents(path), []);
  const first = await appendProvenanceEvent(input, path);
  const second = { ...event(), event_id: "evt_later_append", ts: "2026-09-15T01:00:00.000Z" };
  const json = JSON.stringify(second);
  await appendFile(path, json.slice(0, 35));
  assert.deepEqual(await readProvenanceEvents(path), [first]);
  await appendFile(path, `${json.slice(35)}\n`);
  assert.deepEqual(await readProvenanceEvents(path), [first, second], "file order is retained despite an earlier timestamp");
});

test("reader rejects completed corruption and invalid event shapes without leaking record contents", async (t) => {
  const path = await file(t);
  for (const broken of ["PRIVATE RAW TEXT\n", "{}\n", "null\n", "{}"]) {
    await writeFile(path, `${JSON.stringify(event())}\n${broken}`);
    await assert.rejects(readProvenanceEvents(path), { message: "Invalid provenance record at line 2." });
  }
});

test("legacy advisory normalization leaves source JSONL untouched", async (t) => {
  const path = await file(t);
  const raw = `${JSON.stringify({ ...event(), class: "attested", telemetry: { field: "body", legacy_raw_text: "DO NOT RETURN" } })}\n`;
  await writeFile(path, raw);
  const [result] = await readProvenanceEvents(path);
  assert.deepEqual(result.telemetry, { field: "body" });
  assert.match(result.notes, /Discarded/);
  assert.equal(await readFile(path, "utf8"), raw);
});

test("concurrent writers produce complete uniquely identifiable JSONL records", async (t) => {
  const path = await file(t);
  const written = await Promise.all(Array.from({ length: 20 }, (_, index) => appendProvenanceEvent({ ...input, notes: `Event ${index}` }, path)));
  const loaded = await readProvenanceEvents(path);
  assert.equal(loaded.length, 20);
  assert.deepEqual(new Set(loaded.map(item => item.event_id)), new Set(written.map(item => item.event_id)));
});
