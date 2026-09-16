import { readFileSync } from "node:fs";
import { isRecord } from "../server/canonical.js";

export interface VocabularyEntry {
  id: string;
  name: string;
  authority?: string;
  description?: string;
  // Exact source metadata (URL, banner alternatives, review date); id remains
  // the policy identifier, not an assertion that a particular banner applies.
  source?: Record<string, unknown>;
  placeholder?: boolean;
  legacy?: boolean;
}

export interface Vocabulary {
  categories: VocabularyEntry[];
  ldcs: VocabularyEntry[];
  // Keep legacy placeholders available to the active policy during import.
  allIdentifiers: Set<string>;
  entries: VocabularyEntry[];
  placeholder: boolean;
}

export function parseVocabulary(value: unknown, label: string): VocabularyEntry[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty JSON array of Registry entries.`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() ||
        typeof entry.name !== "string" || !entry.name.trim()) throw new Error(`${label}[${index}] requires id and name.`);
    if (seen.has(entry.id)) throw new Error(`Duplicate vocabulary identifier: ${entry.id}`);
    seen.add(entry.id);
    for (const key of ["authority", "description"] as const) {
      if (entry[key] !== undefined && typeof entry[key] !== "string") throw new Error(`${label}[${index}].${key} must be a string.`);
    }
    if (entry.placeholder !== undefined && typeof entry.placeholder !== "boolean") throw new Error(`${label}[${index}].placeholder must be boolean.`);
    if (entry.legacy !== undefined && typeof entry.legacy !== "boolean") throw new Error(`${label}[${index}].legacy must be boolean.`);
    if (entry.source !== undefined && !isRecord(entry.source)) throw new Error(`${label}[${index}].source must be an object.`);
    return { id: entry.id, name: entry.name,
      ...(entry.authority !== undefined ? { authority: entry.authority as string } : {}),
      ...(entry.description !== undefined ? { description: entry.description as string } : {}),
      ...(entry.source !== undefined ? { source: entry.source as Record<string, unknown> } : {}),
      ...(entry.placeholder === true || entry.id.startsWith("PLACEHOLDER-") ? { placeholder: true } : {}),
      ...(entry.legacy === true ? { legacy: true } : {}) };
  });
}

export function loadRegistry(paths: { categoriesPath: string; ldcsPath: string }): Vocabulary {
  const allCategories = parseVocabulary(JSON.parse(readFileSync(paths.categoriesPath, "utf8")), "categories");
  const allLdcs = parseVocabulary(JSON.parse(readFileSync(paths.ldcsPath, "utf8")), "ldcs");
  const authoritativeCategories = allCategories.filter((entry) => !entry.placeholder && !entry.legacy);
  const authoritativeLdcs = allLdcs.filter((entry) => !entry.placeholder && !entry.legacy);
  const complete = authoritativeCategories.length > 0 && authoritativeLdcs.length > 0;
  const categories = complete ? authoritativeCategories : allCategories;
  const ldcs = complete ? authoritativeLdcs : allLdcs;
  const entries = [...categories, ...ldcs];
  const all = [...allCategories, ...allLdcs];
  if (new Set(all.map((entry) => entry.id)).size !== all.length) throw new Error("Category and LDC identifiers must be distinct.");
  return { categories, ldcs, entries, placeholder: !complete,
    allIdentifiers: new Set(all.map((entry) => entry.id)) };
}
