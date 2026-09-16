import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadRegistry, type Vocabulary } from "../generate/vocabulary.js";
import { DEFAULT_POLICY_PATHS, loadPolicy, matchRule, validatePolicy, type PolicyPaths } from "./policy.js";
import type { CountersignPolicy } from "./types.js";

export interface PolicyStorePaths extends PolicyPaths {
  draftPath: string;
  metadataPath: string;
}

export interface DraftMetadata {
  generated_at: string;
  provider: string;
  model: string;
  region?: string;
  source_urls: string[];
  vocabulary: { categories: number; ldcs: number; placeholder: boolean };
  draft_revision: string;
}

export class PolicyError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export function revision(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// The generator/approval UI is scoped to the three demo contracts, not an
// arbitrary policy editor. In particular it must not disable the quiz wall.
export function validateDemoPolicy(value: unknown, vocabulary: Vocabulary): CountersignPolicy {
  const policy = validatePolicy(value, vocabulary.allIdentifiers);
  const ids = new Set(policy.rules.map((rule) => rule.id));
  if (policy.app !== "mcu-learning-portal" || policy.rules.length !== 3 ||
      !["quiz-submit", "discussion-initial-post", "student-record"].every((id) => ids.has(id))) {
    throw new PolicyError("invalid_demo_policy", "The demo policy must contain exactly quiz-submit, discussion-initial-post, and student-record.");
  }
  const quiz = matchRule("/quiz/1", "POST /quiz/1/submit", {}, policy);
  const discussion = matchRule("/discussion/2", "POST /discussion/2/post", { is_initial_post: true }, policy);
  const record = matchRule("/record/1", "GET /record/1", {}, policy);
  if (quiz?.id !== "quiz-submit" || quiz.class !== "human-required" || quiz.presence?.uv !== "required") {
    throw new PolicyError("invalid_demo_policy", "Quiz submission must require verified human presence (UV required).");
  }
  if (discussion?.id !== "discussion-initial-post" || discussion.class !== "attested" ||
      discussion.match.when?.is_initial_post !== true || Object.keys(discussion.match.when).length !== 1) {
    throw new PolicyError("invalid_demo_policy", "The initial discussion post must be attested and matched by is_initial_post=true.");
  }
  if (record?.id !== "student-record" || record.class !== "marking" || record.mask_when !== "automation-suspected" ||
      record.unmask?.rule_id !== "student-record.unmask" || record.unmask.presence.uv !== "required") {
    throw new PolicyError("invalid_demo_policy", "The record must retain masking and UV-required student-record.unmask verification.");
  }
  for (const field of ["name", "ssn", "dod-id", "medical"]) {
    const marking = record.markings?.find((item) => item.selector === `[data-field=${field}]`);
    if (!marking?.categories.includes(field === "medical" ? "PHI" : "PII")) {
      throw new PolicyError("invalid_demo_policy", `Missing record marking/category for ${field}.`);
    }
  }
  return policy;
}

export class PolicyStore {
  readonly paths: PolicyStorePaths;
  constructor(paths: Partial<PolicyStorePaths> = {}) {
    this.paths = { ...DEFAULT_POLICY_PATHS,
      draftPath: resolve(process.cwd(), "countersign/policy/countersign.policy.draft.json"),
      metadataPath: resolve(process.cwd(), "countersign/policy/countersign.policy.draft.meta.json"), ...paths };
  }

  active(): CountersignPolicy { return loadPolicy(this.paths); }
  vocabulary(): Vocabulary { return loadRegistry(this.paths); }

  draft(): CountersignPolicy | null {
    let raw: string;
    try { raw = readFileSync(this.paths.draftPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    return validateDemoPolicy(JSON.parse(raw), this.vocabulary());
  }

  metadata(draft: CountersignPolicy | null): DraftMetadata | null {
    if (!draft) return null;
    try {
      const metadata = JSON.parse(readFileSync(this.paths.metadataPath, "utf8")) as DraftMetadata;
      return metadata.draft_revision === revision(draft) ? metadata : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  saveDraft(policy: CountersignPolicy, metadata: Omit<DraftMetadata, "draft_revision">): DraftMetadata {
    validateDemoPolicy(policy, this.vocabulary());
    const saved = { ...metadata, draft_revision: revision(policy) };
    atomicJson(this.paths.draftPath, policy);
    atomicJson(this.paths.metadataPath, saved);
    return saved;
  }

  approve(input: { all?: unknown; rule_ids?: unknown; active_revision?: unknown; draft_revision?: unknown }) {
    const active = this.active();
    const draft = this.draft();
    if (!draft) throw new PolicyError("no_draft", "Generate a draft before approving.", 404);
    if ((input.active_revision !== undefined && input.active_revision !== revision(active)) ||
        (input.draft_revision !== undefined && input.draft_revision !== revision(draft))) {
      throw new PolicyError("stale_policy", "The active policy or draft changed. Reload the review page.", 409);
    }
    const ids = input.rule_ids;
    if (input.all === true ? ids !== undefined : !Array.isArray(ids) || ids.length === 0 ||
        !ids.every((id) => typeof id === "string") || new Set(ids).size !== ids.length) {
      throw new PolicyError("invalid_selection", "Send all:true or a non-empty array of unique rule_ids.");
    }
    if (input.all !== undefined && input.all !== true) throw new PolicyError("invalid_selection", "all must be true when supplied.");
    const selected = input.all === true ? draft.rules.map((rule) => rule.id) : ids as string[];
    if (selected.some((id) => !draft.rules.some((rule) => rule.id === id))) throw new PolicyError("invalid_selection", "A selected rule is not in the draft.");
    // Partial approval changes only selected rules, preserving global defaults.
    const next = input.all === true ? draft : { ...active, version: draft.version,
      rules: active.rules.map((rule) => selected.includes(rule.id) ? draft.rules.find((item) => item.id === rule.id)! : rule) };
    validateDemoPolicy(next, this.vocabulary());
    atomicJson(this.paths.policyPath, next);
    return { ok: true, active_version: next.version, active_revision: revision(next), approved_rule_ids: selected };
  }
}
