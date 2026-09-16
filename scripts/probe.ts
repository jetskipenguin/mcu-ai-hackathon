import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const run = path.join(root, ".probe", new Date().toISOString().replace(/[:.]/g, "-"))
await mkdir(run, { recursive: true })
const marker = "GOVERNANCE_PROBE_SECRET_48291"
const fixedTitle = process.argv.includes("--fixed-title")
const executable = path.join(
  root,
  "node_modules",
  "opencode-ai",
  "bin",
  process.platform === "win32" ? "opencode.exe" : "opencode",
)
if (!(await Bun.file(executable).exists())) throw new Error("Run npm install first")

const results: {
  scenario: string
  passed: boolean
  exitCode: number
  timedOut: boolean
  requestsReceived: number
  protectedValueReceived: boolean
  hooks: { hook: string; decision: string }[]
}[] = []
for (const scenario of ["clean", "message-block", "system-block", "invalid-policy"]) {
  const directory = path.join(run, scenario)
  await mkdir(directory, { recursive: true })
  await copyFile(path.join(root, "plugin", "governance.ts"), path.join(directory, "governance.ts"))
  const audit = path.join(directory, "audit.jsonl")
  await Bun.write(audit, "")
  await Bun.write(
    path.join(directory, "governance.policy.json"),
    JSON.stringify({ bannedPhrases: scenario === "invalid-policy" ? [] : [marker.toLowerCase()] }),
  )
  const captured: { path: string; body: unknown }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return new Response("Not found", { status: 404 })
      const body = (await request.json()) as { stream?: boolean }
      captured.push({ path: new URL(request.url).pathname, body })
      await Bun.write(path.join(directory, "captured.json"), JSON.stringify(captured, null, 2))
      const base = { id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe" }
      if (body.stream) {
        const chunks = [
          {
            ...base,
            choices: [{ index: 0, delta: { role: "assistant", content: "LOCAL_PROBE_OK" }, finish_reason: null }],
          },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ]
        return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return Response.json({
        ...base,
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "LOCAL_PROBE_OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
  })
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: "governance/probe",
    small_model: "governance/probe",
    enabled_providers: ["governance"],
    plugin: [
      [
        pathToFileURL(path.join(directory, "governance.ts")).href,
        { policyPath: path.join(directory, "governance.policy.json"), auditPath: audit },
      ],
    ],
    share: "disabled",
    autoupdate: false,
    permission: "deny",
    provider: {
      governance: {
        npm: "@ai-sdk/openai-compatible",
        name: "Local governance probe",
        options: { baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "local-dummy-key" },
        models: { probe: { name: "Local fake model", limit: { context: 32000, output: 1024 } } },
      },
    },
    agent: {
      build: { prompt: scenario === "system-block" ? `System canary: ${marker}` : "Answer briefly. Do not use tools." },
    },
  }
  const configPath = path.join(directory, "opencode.json")
  await Bun.write(configPath, JSON.stringify(config, null, 2))
  await Bun.write(path.join(directory, "captured.json"), "[]")
  const env: Record<string, string | undefined> = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(directory, "config"),
    XDG_DATA_HOME: path.join(directory, "data"),
    XDG_CACHE_HOME: path.join(run, "cache"),
    XDG_STATE_HOME: path.join(directory, "state"),
    OPENCODE_CONFIG_DIR: path.join(directory, "config", "opencode"),
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  }
  // Pure mode suppresses the very external plugin this test needs.
  delete env.OPENCODE_PURE
  console.log(`Running ${scenario} ...`)
  const child = Bun.spawn(
    [
      executable,
      "run",
      "--format",
      "json",
      "--model",
      "governance/probe",
      ...(fixedTitle ? ["--title", "Governance compatibility probe"] : []),
      scenario === "message-block" ? `Reply briefly. Canary: ${marker}` : "Reply with LOCAL_PROBE_OK.",
    ],
    {
      cwd: directory,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 120_000)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  server.stop(true)
  await Bun.write(path.join(directory, "stdout.jsonl"), stdout)
  await Bun.write(path.join(directory, "stderr.txt"), stderr)
  const events = (await Bun.file(audit).text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const expectedHook =
    scenario === "system-block" ? "experimental.chat.system.transform" : "experimental.chat.messages.transform"
  const leaked = JSON.stringify(captured).includes(marker)
  const passed =
    !timedOut &&
    !leaked &&
    (scenario === "clean"
      ? exitCode === 0 &&
        captured.length > 0 &&
        stdout.includes("LOCAL_PROBE_OK") &&
        ["experimental.chat.messages.transform", "experimental.chat.system.transform"].every((hook) =>
          events.some((event) => event.hook === hook && event.decision === "allow"),
        )
      : scenario === "invalid-policy"
        ? captured.length === 0 && exitCode !== 0 && stdout.includes('"type":"error"')
        : (!fixedTitle || captured.length === 0) &&
          events.some((event) => event.hook === expectedHook && event.decision === "block") &&
          exitCode !== 0 &&
          (stdout.includes('"type":"error"') || stderr.includes("GOVERNANCE_BLOCKED")))
  const result = {
    scenario,
    passed,
    exitCode,
    timedOut,
    requestsReceived: captured.length,
    protectedValueReceived: leaked,
    hooks: events,
  }
  results.push(result)
  console.log(JSON.stringify(result, null, 2))
}
await Bun.write(path.join(run, "results.json"), JSON.stringify({ version: "1.18.31", fixedTitle, results }, null, 2))
console.log(`Evidence: ${run}`)
if (results.some((result) => !result.passed)) process.exitCode = 1
