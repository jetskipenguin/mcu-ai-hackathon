import { appendFileSync } from "node:fs"
import path from "node:path"

function contains(value: unknown, phrases: string[]): boolean {
  if (typeof value === "string") return phrases.some((phrase) => value.toLowerCase().includes(phrase))
  if (Array.isArray(value)) return value.some((item) => contains(item, phrases))
  if (value && typeof value === "object")
    return Object.entries(value).some(([key, item]) => contains(key, phrases) || contains(item, phrases))
  return false
}

export default async (input: { directory: string }, options: Record<string, unknown> = {}) => {
  // OpenCode skips plugins that reject during initialization. Keep hooks registered
  // and reject inside them instead, so a broken policy cannot silently disable us.
  const loaded = await loadPolicy(input.directory, options).catch((error: unknown) => ({
    error:
      error instanceof Error && error.message.startsWith("GOVERNANCE_")
        ? error
        : new Error("GOVERNANCE_CONFIG_INVALID: cannot initialize policy or audit file"),
  }))

  function inspect(hook: string, value: unknown) {
    if ("error" in loaded) throw loaded.error
    const blocked = contains(value, loaded.phrases)
    appendFileSync(loaded.auditPath, `${JSON.stringify({ hook, decision: blocked ? "block" : "allow" })}\n`)
    if (blocked) throw new Error("GOVERNANCE_BLOCKED: configured banned phrase detected")
  }

  return {
    "experimental.chat.messages.transform": async (_input: unknown, output: { messages: unknown[] }) => {
      inspect("experimental.chat.messages.transform", output.messages)
    },
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      inspect("experimental.chat.system.transform", output.system)
    },
    "tool.definition": async (_input: unknown, output: { description: string; parameters: unknown }) => {
      inspect("tool.definition", output)
    },
  }
}

async function loadPolicy(directory: string, options: Record<string, unknown>) {
  if (
    (options.policyPath !== undefined && typeof options.policyPath !== "string") ||
    (options.auditPath !== undefined && typeof options.auditPath !== "string")
  )
    throw new Error("GOVERNANCE_CONFIG_INVALID: policyPath and auditPath must be strings")

  const policyPath = path.resolve(directory, (options.policyPath as string | undefined) ?? "governance.policy.json")
  const auditPath = path.resolve(directory, (options.auditPath as string | undefined) ?? "governance.audit.jsonl")
  const policy: unknown = await Bun.file(policyPath)
    .json()
    .catch(() => {
      // JSON parser errors can contain policy values; do not expose the original error.
      throw new Error("GOVERNANCE_POLICY_INVALID: cannot read policy JSON; check policyPath and file syntax")
    })
  if (
    !policy ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    !("bannedPhrases" in policy) ||
    !Array.isArray(policy.bannedPhrases) ||
    Object.keys(policy).some((key) => key !== "bannedPhrases") ||
    policy.bannedPhrases.length === 0 ||
    !policy.bannedPhrases.every((phrase): phrase is string => typeof phrase === "string" && phrase.trim().length > 0)
  )
    throw new Error("GOVERNANCE_POLICY_INVALID: expected only bannedPhrases, a nonempty array of nonblank strings")

  const phrases = [...new Set(policy.bannedPhrases.map((phrase) => phrase.trim().toLowerCase()))]
  appendFileSync(
    auditPath,
    `${JSON.stringify({ hook: "policy.load", decision: "loaded", phraseCount: phrases.length })}\n`,
  )

  return { phrases, auditPath }
}
