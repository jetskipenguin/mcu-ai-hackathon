import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PolicyStore, validateDemoPolicy, type DraftMetadata } from "../server/policy-store.js";
import { validatePolicy } from "../server/policy.js";
import type { CountersignPolicy } from "../server/types.js";
import { crawlPortal, type PageSnapshot } from "./crawl.js";
import { loadEnvironment } from "./environment.js";
import { complete, modelConfiguration, type ModelConfiguration } from "./llm.js";
import { buildPrompt, GENERATOR_SYSTEM } from "./prompt.js";
import type { Vocabulary } from "./vocabulary.js";

export { buildPrompt } from "./prompt.js";

export function parseDraft(text: string, vocabulary: Vocabulary, pages: PageSnapshot[]): CountersignPolicy {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = JSON.parse(fenced?.[1] ?? trimmed) as unknown;
  // New drafts may use only the selected vocabulary, not legacy placeholders
  // retained solely to keep the existing active policy working during import.
  const policy = validatePolicy(raw, new Set(vocabulary.entries.map((entry) => entry.id)));
  validateDemoPolicy(policy, vocabulary);
  const catalog = new Map(vocabulary.entries.map((entry) => [entry.id, entry]));
  for (const rule of policy.rules) {
    for (const citation of rule.citations) {
      const page = pages.find((item) => item.route === citation.ref);
      const entry = catalog.get(citation.ref);
      if (citation.source === "portal-html" && page?.html.includes(citation.excerpt)) continue;
      if (entry?.description && citation.source === (entry.placeholder ? "scaffold-vocabulary" : "cui-registry") &&
          entry.description.includes(citation.excerpt)) continue;
      throw new Error(`Unsupported or ungrounded citation on ${rule.id}.`);
    }
    const identifiers = new Set([...(rule.markings?.map((marking) => marking.marking) ?? []),
      ...(rule.page_marking ? [rule.page_marking] : [])]);
    // Attach definitions from the loaded files instead of trusting LLM quotes.
    for (const id of identifiers) {
      const entry = catalog.get(id)!;
      if (!entry.description?.trim()) throw new Error(`Vocabulary entry ${id} needs a description for its Registry citation.`);
      rule.citations = rule.citations.filter((citation) => citation.ref !== id);
      rule.citations.push({ source: entry.placeholder ? "scaffold-vocabulary" : "cui-registry", ref: id, excerpt: entry.description });
    }
  }
  return policy;
}

export interface GenerationOptions {
  store?: PolicyStore;
  baseUrl?: string;
  userId?: string;
  // Dependency seams for isolated tests; the HTTP endpoint never accepts these.
  model?: ModelConfiguration;
  complete?: typeof complete;
  crawl?: typeof crawlPortal;
}

export async function generatePolicy(options: GenerationOptions = {}): Promise<{
  draft: CountersignPolicy; metadata: DraftMetadata;
}> {
  const store = options.store ?? new PolicyStore();
  const model = options.model ?? modelConfiguration();
  const vocabulary = store.vocabulary();
  const pages = await (options.crawl ?? crawlPortal)({ baseUrl: options.baseUrl, userId: options.userId });
  const prompt = buildPrompt(pages, vocabulary, store.active().defaults);
  const request = options.complete ?? complete;
  const text = await request(prompt, { system: GENERATOR_SYSTEM });
  let draft: CountersignPolicy;
  try {
    draft = parseDraft(text, vocabulary, pages);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("unknown marking identifier:")) throw error;
    // One fresh attempt for models that confuse Registry IDs with display banners.
    // Keep model output out of system instructions and validate the entire result again.
    const corrected = await request(prompt, { system: `${GENERATOR_SYSTEM}\nThe previous attempt failed because a marking was not in allowed_marking_identifiers. Generate the complete policy again, copying each markings[].marking and page_marking directly from the supplied list. Do not format these IDs as CUI banners.` });
    try {
      draft = parseDraft(corrected, vocabulary, pages);
    } catch (retryError) {
      throw new Error("Policy validation failed after one marking-correction retry; no draft was saved. " +
        (retryError instanceof Error ? retryError.message : "Invalid policy output."), { cause: retryError });
    }
  }
  const metadata = store.saveDraft(draft, {
    generated_at: new Date().toISOString(), provider: model.provider, model: model.model,
    ...(model.region ? { region: model.region } : {}), source_urls: pages.map((page) => page.url),
    vocabulary: { categories: vocabulary.categories.length, ldcs: vocabulary.ldcs.length, placeholder: vocabulary.placeholder },
  });
  return { draft, metadata };
}

async function main(): Promise<void> {
  loadEnvironment();
  const result = await generatePolicy();
  console.log(JSON.stringify({ ok: true, draft_version: result.draft.version, ...result.metadata,
    next: "Review at http://localhost:3000/countersign/policy/review. Active policy is unchanged until approval." }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Policy generation failed.");
    process.exitCode = 1;
  });
}
