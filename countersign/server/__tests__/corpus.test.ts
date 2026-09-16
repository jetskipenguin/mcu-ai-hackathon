import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { normalizeCategories, normalizeLdcs, readCorpus } from "../../generate/corpus.js";
import { loadRegistry, parseVocabulary } from "../../generate/vocabulary.js";
import { DEFAULT_POLICY_PATHS } from "../policy.js";

test("categories retain source IDs even when abbreviations are empty or duplicate instruction text", () => {
  const records = ["", "", "Use source instructions", "Use source instructions"].map((marking, index) => ({
    source_id: `test-source-${index}`, category: `Synthetic category ${index}`, category_marking: marking,
    description: `Synthetic definition ${index}`, authority_and_sanctions_text: "Synthetic authority text",
    source_url: `https://example.invalid/source-${index}`, provisional: !marking,
  }));
  const entries = parseVocabulary(normalizeCategories(records), "test corpus");
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 4);
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.id, records[index].source_id);
    assert.equal(entry.description, records[index].description);
    assert.equal(entry.authority, records[index].authority_and_sanctions_text);
    assert.equal(entry.source?.category_marking, records[index].category_marking);
    assert.equal(entry.source?.provisional, records[index].provisional);
  }
  assert.throws(() => normalizeCategories([{ ...records[0], description: "" }]), /requires description/);
});

test("LDC definitions preserve multiline notes and template markings; missing source evidence fails", () => {
  const records = [{ control: "Synthetic list", marking: "TEST LIST [X]", portion_marking: "TEST LIST [X]",
    source_url: "https://example.invalid/ldcs", source_id: "test-ldcs" }];
  const text = "Title\nPortion Marking\nSynthetic list\nSynthetic definition.\nNote: a required qualifier.\nTEST LIST [X] -\nLinks\n";
  const entries = normalizeLdcs(records, text);
  assert.equal(entries[0].id, "TEST LIST [X]");
  assert.equal(entries[0].description, "Synthetic definition.\nNote: a required qualifier.");
  assert.equal(entries[0].source?.portion_marking, "TEST LIST [X]");
  assert.throws(() => normalizeLdcs(records, text.replace("Synthetic list", "Other heading")), /Missing source definition/);
  assert.throws(() => normalizeLdcs(records, text.replace("TEST LIST [X] -", "Unknown marking")), /Missing source definition/);
  assert.throws(() => normalizeLdcs(records, ""), /table header/);
});

test("runtime vocabulary contains all 126 source categories and 10 LDCs without offering legacy placeholders", () => {
  const registry = loadRegistry(DEFAULT_POLICY_PATHS);
  assert.equal(registry.categories.length, 126);
  assert.equal(registry.ldcs.length, 10);
  assert.equal(registry.placeholder, false);
  assert.equal(registry.categories.filter((entry) => entry.source?.category_marking === "").length, 9);
  for (const entry of registry.entries) {
    assert.ok(!entry.legacy && !entry.placeholder);
    assert.ok(entry.description?.trim());
    assert.match(String(entry.source?.source_url), /^https:\/\/www\.archives\.gov\/cui\/registry\//);
  }
  for (const entry of registry.categories) assert.equal(entry.id, entry.source?.source_id);
  assert.match(registry.ldcs.find((entry) => entry.id === "Attorney-Client")!.description!, /only with the "Legal Privilege" category/);
});

const sourceDirectory = resolve("data/source/public-reference-corpus");
test("supplied corpus reproduces every installed current definition, identifier, and provenance field", {
  skip: !existsSync(sourceDirectory) && "Original source archive is intentionally gitignored.",
}, () => {
  const source = readCorpus(sourceDirectory);
  const registry = loadRegistry(DEFAULT_POLICY_PATHS);
  assert.deepEqual(registry.categories, parseVocabulary(source.categories, "source categories"));
  assert.deepEqual(registry.ldcs, parseVocabulary(source.ldcs, "source LDCs"));
});
