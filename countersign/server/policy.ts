import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  CountersignPolicy,
  GovernanceClass,
  PolicyRule,
} from "./types.js";

export const DEFAULT_POLICY_PATHS = {
  policyPath: resolve(
    process.cwd(),
    "countersign/policy/countersign.policy.json",
  ),
  categoriesPath: resolve(process.cwd(), "data/cui/categories.json"),
  ldcsPath: resolve(process.cwd(), "data/cui/ldcs.json"),
};

export interface PolicyPaths {
  policyPath: string;
  categoriesPath: string;
  ldcsPath: string;
}

const GOVERNANCE_CLASSES = new Set<GovernanceClass>([
  "human-required",
  "attested",
  "marking",
  "unrestricted",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  object: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function loadVocabulary(path: string): Set<string> {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(value)) {
    throw new Error(`${path} must contain an array`);
  }

  const identifiers = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw new Error(`${path}[${index}] must be an object`);
    }
    identifiers.add(requireString(item, "id", `${path}[${index}]`));
  }
  return identifiers;
}

export function validatePolicy(
  value: unknown,
  knownMarkings: ReadonlySet<string>,
): CountersignPolicy {
  if (!isRecord(value)) {
    throw new Error("policy must be an object");
  }

  requireString(value, "version", "policy");
  requireString(value, "app", "policy");
  if (!isRecord(value.defaults)) {
    throw new Error("policy.defaults must be an object");
  }
  if (value.defaults.class !== "unrestricted") {
    throw new Error("policy.defaults.class must be unrestricted");
  }
  if (!isRecord(value.defaults.signals)) {
    throw new Error("policy.defaults.signals must be an object");
  }
  for (const [name, weight] of Object.entries(value.defaults.signals)) {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new Error(`policy.defaults.signals.${name} must be a number`);
    }
  }
  const threshold = value.defaults.signals.suspect_threshold;
  if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
    throw new Error(
      "policy.defaults.signals.suspect_threshold must be between 0 and 1",
    );
  }
  if (!Array.isArray(value.rules)) {
    throw new Error("policy.rules must be an array");
  }

  const ruleIds = new Set<string>();
  for (const [index, candidate] of value.rules.entries()) {
    const context = `policy.rules[${index}]`;
    if (!isRecord(candidate)) {
      throw new Error(`${context} must be an object`);
    }
    const id = requireString(candidate, "id", context);
    if (ruleIds.has(id)) {
      throw new Error(`duplicate policy rule id: ${id}`);
    }
    ruleIds.add(id);

    if (!isRecord(candidate.match)) {
      throw new Error(`${context}.match must be an object`);
    }
    requireString(candidate.match, "route", `${context}.match`);
    if (candidate.match.action !== undefined) {
      requireString(candidate.match, "action", `${context}.match`);
    }
    if (
      candidate.match.when !== undefined &&
      !isRecord(candidate.match.when)
    ) {
      throw new Error(`${context}.match.when must be an object`);
    }

    if (
      typeof candidate.class !== "string" ||
      !GOVERNANCE_CLASSES.has(candidate.class as GovernanceClass)
    ) {
      throw new Error(`${context}.class is invalid`);
    }
    const ruleClass = candidate.class as GovernanceClass;
    requireString(candidate, "rationale", context);
    if (!Array.isArray(candidate.citations)) {
      throw new Error(`${context}.citations must be an array`);
    }
    for (const [citationIndex, citation] of candidate.citations.entries()) {
      const citationContext = `${context}.citations[${citationIndex}]`;
      if (!isRecord(citation)) {
        throw new Error(`${citationContext} must be an object`);
      }
      requireString(citation, "source", citationContext);
      requireString(citation, "ref", citationContext);
      requireString(citation, "excerpt", citationContext);
    }

    if (candidate.presence !== undefined) {
      validatePresence(candidate.presence, `${context}.presence`);
    }
    if (
      (ruleClass === "human-required" || ruleClass === "attested") &&
      candidate.presence === undefined
    ) {
      throw new Error(`${context}.presence is required for ${ruleClass}`);
    }
    if (
      candidate.ai_use !== undefined &&
      candidate.ai_use !== "prohibited" &&
      candidate.ai_use !== "disclosed" &&
      candidate.ai_use !== "encouraged"
    ) {
      throw new Error(`${context}.ai_use is invalid`);
    }
    if (ruleClass === "attested" && candidate.ai_use === undefined) {
      throw new Error(`${context}.ai_use is required for attested rules`);
    }

    if (candidate.markings !== undefined) {
      if (!Array.isArray(candidate.markings)) {
        throw new Error(`${context}.markings must be an array`);
      }
      for (const [markingIndex, marking] of candidate.markings.entries()) {
        const markingContext = `${context}.markings[${markingIndex}]`;
        if (!isRecord(marking)) {
          throw new Error(`${markingContext} must be an object`);
        }
        requireString(marking, "selector", markingContext);
        const identifier = requireString(marking, "marking", markingContext);
        if (!knownMarkings.has(identifier)) {
          throw new Error(`unknown marking identifier: ${identifier}`);
        }
        if (
          !Array.isArray(marking.categories) ||
          !marking.categories.every((item) => typeof item === "string")
        ) {
          throw new Error(`${markingContext}.categories must be strings`);
        }
      }
    }

    if (candidate.page_marking !== undefined) {
      if (
        typeof candidate.page_marking !== "string" ||
        !knownMarkings.has(candidate.page_marking)
      ) {
        throw new Error(
          `unknown marking identifier: ${String(candidate.page_marking)}`,
        );
      }
    }
    if (
      ruleClass === "marking" &&
      (!Array.isArray(candidate.markings) ||
        candidate.markings.length === 0 ||
        typeof candidate.page_marking !== "string")
    ) {
      throw new Error(
        `${context} marking rules require markings and page_marking`,
      );
    }
    if (
      candidate.mask_when !== undefined &&
      candidate.mask_when !== "automation-suspected"
    ) {
      throw new Error(`${context}.mask_when must be automation-suspected`);
    }
    if (candidate.unmask !== undefined) {
      if (!isRecord(candidate.unmask)) {
        throw new Error(`${context}.unmask must be an object`);
      }
      requireString(candidate.unmask, "rule_id", `${context}.unmask`);
      if (candidate.unmask.class !== "human-required") {
        throw new Error(`${context}.unmask.class must be human-required`);
      }
      validatePresence(
        candidate.unmask.presence,
        `${context}.unmask.presence`,
      );
    }
  }

  return value as unknown as CountersignPolicy;
}

function validatePresence(value: unknown, context: string): void {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }
  if (value.uv !== "required" && value.uv !== "preferred") {
    throw new Error(`${context}.uv must be required or preferred`);
  }
  if (
    typeof value.max_age_s !== "number" ||
    !Number.isFinite(value.max_age_s) ||
    value.max_age_s <= 0
  ) {
    throw new Error(`${context}.max_age_s must be a positive number`);
  }
}

export function loadPolicy(paths: Partial<PolicyPaths> = {}): CountersignPolicy {
  const resolvedPaths = { ...DEFAULT_POLICY_PATHS, ...paths };
  const knownMarkings = new Set([
    ...loadVocabulary(resolvedPaths.categoriesPath),
    ...loadVocabulary(resolvedPaths.ldcsPath),
  ]);
  const policy = JSON.parse(
    readFileSync(resolvedPaths.policyPath, "utf8"),
  ) as unknown;
  return validatePolicy(policy, knownMarkings);
}

function patternMatches(pattern: string, actual: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean);
  const actualParts = actual.split("/").filter(Boolean);
  if (patternParts.length !== actualParts.length) {
    return false;
  }

  return patternParts.every(
    (part, index) =>
      part === "*" || part.startsWith(":") || part === actualParts[index],
  );
}

function actionMatches(pattern: string, actual: string): boolean {
  const [patternMethod, patternPath] = pattern.split(" ", 2);
  const [actualMethod, actualPath] = actual.split(" ", 2);
  return (
    patternMethod === actualMethod &&
    Boolean(patternPath) &&
    Boolean(actualPath) &&
    patternMatches(patternPath, actualPath)
  );
}

export function matchRule(
  route: string,
  action?: string,
  context: Record<string, unknown> = {},
  policy = loadPolicy(),
): PolicyRule | undefined {
  return policy.rules.find((rule) => {
    if (!patternMatches(rule.match.route, route)) {
      return false;
    }
    if (rule.match.action && (!action || !actionMatches(rule.match.action, action))) {
      return false;
    }
    return Object.entries(rule.match.when ?? {}).every(
      ([key, expected]) => context[key] === expected,
    );
  });
}

export function requiresPresence(rule: PolicyRule | undefined): rule is PolicyRule {
  return rule?.class === "human-required" || rule?.class === "attested";
}
