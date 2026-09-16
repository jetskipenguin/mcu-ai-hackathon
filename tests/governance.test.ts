import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import governance from "../plugin/governance"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture(policy: unknown = { bannedPhrases: [" Project Copper Secret ", "ACCT-DEMO-48291"] }) {
  const directory = await mkdtemp(path.join(tmpdir(), "governance-test-"))
  directories.push(directory)
  await Bun.write(path.join(directory, "governance.policy.json"), JSON.stringify(policy))
  return directory
}

test("blocks mixed-case messages and nested tool results, without mutating input or logging phrases", async () => {
  const directory = await fixture()
  const hooks = await governance({ directory })
  const output = { messages: [{ parts: [{ state: { output: "Result: project COPPER secret is confidential" } }] }] }
  const before = JSON.stringify(output)
  await expect(hooks["experimental.chat.messages.transform"]({}, output)).rejects.toThrow("GOVERNANCE_BLOCKED")
  expect(JSON.stringify(output)).toBe(before)
  const audit = await Bun.file(path.join(directory, "governance.audit.jsonl")).text()
  expect(audit).toContain('"decision":"block"')
  expect(audit.toLowerCase()).not.toContain("project copper secret")
})

test("allows clean values including nulls, numbers and booleans", async () => {
  const hooks = await governance({ directory: await fixture() })
  await expect(
    hooks["experimental.chat.messages.transform"]({}, { messages: [null, 42, true, { text: "Public project" }] }),
  ).resolves.toBeUndefined()
  await expect(hooks["experimental.chat.system.transform"]({}, { system: ["Be helpful"] })).resolves.toBeUndefined()
  await expect(
    hooks["tool.definition"]({}, { description: "Read a file", parameters: { type: "object" } }),
  ).resolves.toBeUndefined()
})

test("blocks system prompts, tool descriptions, schema values and keys", async () => {
  const hooks = await governance({ directory: await fixture() })
  await expect(
    hooks["experimental.chat.system.transform"]({}, { system: ["Account: acct-demo-48291"] }),
  ).rejects.toThrow("GOVERNANCE_BLOCKED")
  for (const output of [
    { description: "Use PROJECT COPPER SECRET", parameters: {} },
    { description: "Read", parameters: { example: "acct-DEMO-48291" } },
    { description: "Read", parameters: { "PROJECT COPPER SECRET": "value" } },
  ])
    await expect(hooks["tool.definition"]({}, output)).rejects.toThrow("GOVERNANCE_BLOCKED")
})

test("literal substring matching does not interpret regex characters", async () => {
  const hooks = await governance({ directory: await fixture({ bannedPhrases: ["a.b"] }) })
  await expect(hooks["experimental.chat.system.transform"]({}, { system: ["prefix A.B suffix"] })).rejects.toThrow(
    "GOVERNANCE_BLOCKED",
  )
  await expect(hooks["experimental.chat.system.transform"]({}, { system: ["axb"] })).resolves.toBeUndefined()
})

test.each(
  [
    null,
    [],
    {},
    { bannedPhrases: [] },
    { bannedPhrases: [""] },
    { bannedPhrases: ["  "] },
    { bannedPhrases: [1] },
    { bannedPhrases: ["valid"], typo: true },
  ].map((policy) => ({ policy })),
)("rejects invalid policy at hook time: %j", async ({ policy }) => {
  const hooks = await governance({ directory: await fixture(policy) })
  await expect(hooks["experimental.chat.system.transform"]({}, { system: ["Clean input"] })).rejects.toThrow(
    "GOVERNANCE_POLICY_INVALID",
  )
})

test("missing and malformed policies reject without including raw values in errors", async () => {
  const directory = await fixture()
  const missing = await governance({ directory }, { policyPath: "missing.json" })
  await expect(missing["experimental.chat.messages.transform"]({}, { messages: [] })).rejects.toThrow(
    "GOVERNANCE_POLICY_INVALID",
  )
  await Bun.write(path.join(directory, "governance.policy.json"), '{"bannedPhrases": SECRET_BROKEN_JSON}')
  const malformed = await governance({ directory })
  await expect(malformed["tool.definition"]({}, { description: "Read", parameters: {} })).rejects.toThrow(
    "GOVERNANCE_POLICY_INVALID: cannot read policy JSON; check policyPath and file syntax",
  )
})

test("supports custom paths and reloads policy only on a new plugin instance", async () => {
  const directory = await fixture()
  const policyPath = path.join(directory, "custom.json")
  await Bun.write(policyPath, JSON.stringify({ bannedPhrases: ["first"] }))
  const hooks = await governance({ directory }, { policyPath, auditPath: "custom-audit.jsonl" })
  await Bun.write(policyPath, JSON.stringify({ bannedPhrases: ["second"] }))
  await expect(hooks["experimental.chat.system.transform"]({}, { system: ["FIRST"] })).rejects.toThrow(
    "GOVERNANCE_BLOCKED",
  )
  const reloaded = await governance({ directory }, { policyPath, auditPath: "custom-audit.jsonl" })
  await expect(reloaded["experimental.chat.system.transform"]({}, { system: ["SECOND"] })).rejects.toThrow(
    "GOVERNANCE_BLOCKED",
  )
  expect(await Bun.file(path.join(directory, "custom-audit.jsonl")).exists()).toBe(true)
})

test("names every searched location when no policy file exists", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "governance-test-"))
  directories.push(directory)
  const hooks = await governance({ directory })
  await expect(hooks["experimental.chat.system.transform"]({}, { system: ["Clean input"] })).rejects.toThrow(
    /GOVERNANCE_POLICY_INVALID: no policy file found; looked in .*governance\.policy\.json and .*governance\.policy\.json/,
  )
})
