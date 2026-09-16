import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../server/canonical.js";
import type { VocabularyEntry } from "./vocabulary.js";

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`${label} must be an array of source records.`);
  return value;
}

function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Source record requires ${field}.`);
  return value;
}

// Category marking abbreviations are not unique identifiers: nine provisional
// categories have none and two NATO entries contain the same instruction text.
// Keep all 126 categories using the dataset's own unique source_id instead.
export function normalizeCategories(value: unknown): VocabularyEntry[] {
  return rows(value, "Registry categories").map((row) => {
    const { category, description, authority_and_sanctions_text, ...source } = row;
    text(row, "source_url");
    return { id: text(row, "source_id"), name: text(row, "category"),
      description: text(row, "description"), authority: text(row, "authority_and_sanctions_text"), source };
  });
}

// The LDC manifest contains names/markings but no definitions. Extract the exact
// definition between its control heading and marking in the companion text.
export function normalizeLdcs(value: unknown, registryText: string): VocabularyEntry[] {
  const lines = registryText.split(/\r?\n/).map((line) => line.trim());
  const tableStart = lines.indexOf("Portion Marking");
  if (tableStart < 0) throw new Error("LDC source text is missing the Registry table header.");
  return rows(value, "Registry LDCs").map((row) => {
    const name = text(row, "control");
    const id = text(row, "marking");
    const start = lines.indexOf(name, tableStart + 1);
    const end = lines.findIndex((line, index) => index > start && (line === id || line === `${id} -`));
    if (start < 0 || end <= start + 1) throw new Error(`Missing source definition for ${id}.`);
    const { control, marking, ...source } = row;
    return { id, name, description: lines.slice(start + 1, end).join("\n"),
      authority: text(row, "source_url"), source };
  });
}

export function readCorpus(directory: string) {
  const reports = join(directory, "build/reports");
  const categories = normalizeCategories(JSON.parse(readFileSync(join(reports, "cui-registry-categories.json"), "utf8")));
  const ldcs = normalizeLdcs(JSON.parse(readFileSync(join(reports, "cui-limited-dissemination-controls.json"), "utf8")),
    readFileSync(join(directory, "build/text/national-cui-registry/national-cui-registry-limited-dissemination.txt"), "utf8"));
  return { categories, ldcs };
}
