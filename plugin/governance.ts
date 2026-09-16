import { appendFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const policyFile = "governance.policy.json"
const auditFile = "governance.audit.jsonl"
// OpenCode passes the directory it was launched in, not the project's. Defaults are
// therefore resolved next to this file as a fallback, so a copy of the plugin under
// .opencode/plugins finds its policy no matter where OpenCode runs from.
const pluginDirectory = path.dirname(fileURLToPath(import.meta.url))

function contains(value: unknown, phrases: string[]): boolean {
  if (typeof value === "string") return phrases.some((phrase) => value.toLowerCase().includes(phrase))
  if (Array.isArray(value)) return value.some((item) => contains(item, phrases))
  if (value && typeof value === "object")
    return Object.entries(value).some(([key, item]) => contains(key, phrases) || contains(item, phrases))
  return false
}

export default async (input: { directory: string }, options: Record<string, unknown> = {}) => {
  // TODO: We want to fail if there is a broken configuration, it makes debugging much easier.
  // OpenCode skips plugins that reject during initialization. Keep hooks registered
  // and reject inside them instead, so a broken policy cannot silently disable us.
  const loaded = await loadPolicy(input?.directory, options).catch((error: unknown) => ({
    error:
      error instanceof Error && error.message.startsWith("GOVERNANCE_")
        ? error
        : new Error(`GOVERNANCE_CONFIG_INVALID: cannot initialize policy or audit file (${String(error)})`),
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

async function loadPolicy(opencodeDirectory: string, options: Record<string, unknown>) {
  const policyOption = options.policyPath
  const auditOption = options.auditPath
  if (
    (policyOption !== undefined && typeof policyOption !== "string") ||
    (auditOption !== undefined && typeof auditOption !== "string")
  )
    throw new Error("GOVERNANCE_CONFIG_INVALID: policyPath and auditPath must be strings")
  if (typeof opencodeDirectory !== "string" || opencodeDirectory.length === 0)
    throw new Error("GOVERNANCE_CONFIG_INVALID: OpenCode did not pass a working directory")

  // Explicit options are relative to the directory OpenCode runs in. Defaults prefer that
  // directory too, so launching OpenCode in the project keeps using the project's policy.
  const candidates = [path.join(opencodeDirectory, policyFile), path.join(pluginDirectory, policyFile)]
  const policyPath =
    typeof policyOption === "string"
      ? path.resolve(opencodeDirectory, policyOption)
      : candidates.find((candidate) => existsSync(candidate))
  if (policyPath === undefined)
    throw new Error(`GOVERNANCE_POLICY_INVALID: no policy file found; looked in ${candidates.join(" and ")}`)

  const auditPath =
    typeof auditOption === "string"
      ? path.resolve(opencodeDirectory, auditOption)
      : path.join(path.dirname(policyPath), auditFile)
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
