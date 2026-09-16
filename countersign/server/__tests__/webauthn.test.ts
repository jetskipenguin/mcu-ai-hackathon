import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendProvenanceEvent } from "../log.js";

test.todo(
  "missing countersign object returns 403 no_assertion and writes a blocked event",
);
test.todo("unknown or already-used challenge_id returns 403 no_assertion");
test.todo("challenge older than 120 seconds returns 403 expired");
test.todo("submitted field mismatch returns 403 form_mismatch");
test.todo("required UV with userVerified false returns 403 uv_required");
test.todo(
  "happy path calls the handler and logs allowed human-verified with assertion metadata",
);
test.todo(
  "COUNTERSIGN=off calls the handler directly and writes no event",
);

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
