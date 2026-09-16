import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPolicy } from "../policy.js";

test("policy loader rejects an unknown marking identifier", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "countersign-policy-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const policyPath = join(directory, "policy.json");
  const categoriesPath = join(directory, "categories.json");
  const ldcsPath = join(directory, "ldcs.json");

  await Promise.all([
    writeFile(categoriesPath, JSON.stringify([{ id: "KNOWN" }]), "utf8"),
    writeFile(ldcsPath, "[]", "utf8"),
    writeFile(
      policyPath,
      JSON.stringify({
        version: "0.1",
        app: "test",
        defaults: {
          class: "unrestricted",
          signals: { suspect_threshold: 0.6 },
        },
        rules: [
          {
            id: "record",
            match: { route: "/record/*" },
            class: "marking",
            markings: [
              {
                selector: "[data-field=ssn]",
                marking: "UNKNOWN",
                categories: ["PII"],
              },
            ],
            page_marking: "KNOWN",
            rationale: "test",
            citations: [],
          },
        ],
      }),
      "utf8",
    ),
  ]);

  assert.throws(
    () => loadPolicy({ policyPath, categoriesPath, ldcsPath }),
    /unknown marking identifier: UNKNOWN/,
  );
});
