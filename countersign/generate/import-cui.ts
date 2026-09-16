import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicJson } from "../server/policy-store.js";
import { DEFAULT_POLICY_PATHS } from "../server/policy.js";
import { loadRegistry, parseVocabulary } from "./vocabulary.js";
import { readCorpus } from "./corpus.js";

export function importVocabulary(categoriesSource: string, ldcsSource: string,
  paths = { categoriesPath: DEFAULT_POLICY_PATHS.categoriesPath, ldcsPath: DEFAULT_POLICY_PATHS.ldcsPath }) {
  return installVocabulary(JSON.parse(readFileSync(categoriesSource, "utf8")), JSON.parse(readFileSync(ldcsSource, "utf8")), paths);
}

export function importCorpus(directory: string,
  paths = { categoriesPath: DEFAULT_POLICY_PATHS.categoriesPath, ldcsPath: DEFAULT_POLICY_PATHS.ldcsPath }) {
  const { categories, ldcs } = readCorpus(directory);
  return installVocabulary(categories, ldcs, paths);
}

function installVocabulary(categoriesValue: unknown, ldcsValue: unknown,
  paths: { categoriesPath: string; ldcsPath: string }) {
  const categories = parseVocabulary(categoriesValue, "categories source");
  const ldcs = parseVocabulary(ldcsValue, "LDC source");
  const incoming = [...categories, ...ldcs];
  if (categories.length !== 126 || ldcs.length !== 10) throw new Error("Expected the dataset's 126 categories and 10 LDCs. Inspect/normalize the source manifests first.");
  if (incoming.some((entry) => entry.placeholder || entry.legacy || !entry.description?.trim())) {
    throw new Error("Imported entries must have source definitions and must not be placeholders.");
  }
  if (new Set(incoming.map((entry) => entry.id)).size !== incoming.length) throw new Error("Category and LDC source identifiers overlap.");
  const existing = loadRegistry(paths);
  // Additive migration: never remove identifiers still referenced by the active
  // policy before a generated replacement can be reviewed and approved.
  const oldCategories = parseVocabulary(JSON.parse(readFileSync(paths.categoriesPath, "utf8")), "existing categories");
  const oldLdcs = parseVocabulary(JSON.parse(readFileSync(paths.ldcsPath, "utf8")), "existing LDCs");
  const categoryIds = new Set(categories.map((entry) => entry.id));
  const ldcIds = new Set(ldcs.map((entry) => entry.id));
  if (oldCategories.some((entry) => ldcIds.has(entry.id)) || oldLdcs.some((entry) => categoryIds.has(entry.id))) {
    throw new Error("An imported identifier conflicts with an existing vocabulary kind.");
  }
  atomicJson(paths.categoriesPath, [...categories, ...oldCategories.filter((entry) => !categoryIds.has(entry.id)).map((entry) => ({ ...entry, legacy: true }))]);
  atomicJson(paths.ldcsPath, [...ldcs, ...oldLdcs.filter((entry) => !ldcIds.has(entry.id)).map((entry) => ({ ...entry, legacy: true }))]);
  return { categories: categories.length, ldcs: ldcs.length,
    retained_legacy_identifiers: [...existing.allIdentifiers].filter((id) => !incoming.some((entry) => entry.id === id)).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { corpus: { type: "string" }, categories: { type: "string" }, ldcs: { type: "string" } } });
    if (values.corpus && (values.categories || values.ldcs) || !values.corpus && (!values.categories || !values.ldcs)) {
      throw new Error("Usage: npm run cui:import -- --corpus <extracted-public-reference-corpus> OR --categories <normalized-categories.json> --ldcs <normalized-ldcs.json>");
    }
    console.log(JSON.stringify(values.corpus ? importCorpus(values.corpus) : importVocabulary(values.categories!, values.ldcs!), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Vocabulary import failed.");
    process.exitCode = 1;
  }
}
