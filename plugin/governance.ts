import { appendFileSync } from "node:fs"

// Synthetic canary only. This probe is deliberately not a production policy engine.
const protectedValue = "GOVERNANCE_PROBE_SECRET_48291"

function contains(value: unknown): boolean {
  if (typeof value === "string") return value.includes(protectedValue)
  if (Array.isArray(value)) return value.some(contains)
  if (value && typeof value === "object")
    return Object.entries(value).some(([key, item]) => contains(key) || contains(item))
  return false
}

function inspect(hook: string, value: unknown) {
  const blocked = contains(value)
  const audit = process.env.GOVERNANCE_PROBE_AUDIT
  if (!audit) throw new Error("Governance probe requires GOVERNANCE_PROBE_AUDIT")
  appendFileSync(audit, `${JSON.stringify({ hook, decision: blocked ? "block" : "allow" })}\n`)
  if (blocked) throw new Error("GOVERNANCE_BLOCKED: protected demo value detected")
}

export default async () => ({
  "experimental.chat.messages.transform": async (_input: unknown, output: { messages: unknown[] }) => {
    inspect("experimental.chat.messages.transform", output.messages)
  },
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
    inspect("experimental.chat.system.transform", output.system)
  },
})
