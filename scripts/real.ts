import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
if (args.length === 0 || args.includes("--help")) {
  console.log('Usage: bun run real "Your prompt"\n       bun run real --check')
  process.exit(args.length === 0 ? 1 : 0)
}
if (args.some((arg) => arg.startsWith("--")) && !(args.length === 1 && args[0] === "--check")) {
  console.error("Pass one quoted prompt or --check. OpenCode options are managed by this launcher.")
  process.exit(1)
}
if (!process.env.DEEPSEEK_API_KEY?.trim()) {
  console.error("Set DEEPSEEK_API_KEY in .env first. Run bun run setup if the file is missing.")
  process.exit(1)
}

const root = fileURLToPath(new URL("../", import.meta.url))
const executable = path.join(
  root,
  "node_modules",
  "opencode-ai",
  "bin",
  process.platform === "win32" ? "opencode.exe" : "opencode",
)
for (const file of [
  executable,
  path.join(root, "opencode.real.example.json"),
  path.join(root, "governance.policy.json"),
]) {
  if (await Bun.file(file).exists()) continue
  console.error(`Missing ${path.basename(file)}. Run bun install and bun run setup first.`)
  process.exit(1)
}
const demo = path.join(root, ".probe", "real-provider")
await mkdir(demo, { recursive: true })
const env: Record<string, string | undefined> = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(demo, "config"),
  XDG_DATA_HOME: path.join(demo, "data"),
  XDG_CACHE_HOME: path.join(demo, "cache"),
  XDG_STATE_HOME: path.join(demo, "state"),
  OPENCODE_CONFIG_DIR: path.join(demo, "config", "opencode"),
  OPENCODE_CONFIG: path.join(root, "opencode.real.example.json"),
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
}
delete env.OPENCODE_CONFIG_CONTENT
delete env.OPENCODE_PURE
delete env.OPENCODE_DISABLE_MODELS_FETCH

// A removed catalog model otherwise becomes an opaque server error before the
// first governance hook or provider request. Check both configured models first.
const config = await Bun.file(path.join(root, "opencode.real.example.json")).json()
if (typeof config.model !== "string" || typeof config.small_model !== "string") {
  console.error("Set model and small_model in opencode.real.example.json to provider/model identifiers.")
  process.exit(1)
}
const catalog = Bun.spawn([executable, "models", "deepseek"], { cwd: root, env, stdout: "pipe", stderr: "pipe" })
const [catalogCode, catalogOutput] = await Promise.all([
  catalog.exited,
  new Response(catalog.stdout).text(),
  // Drain diagnostics but do not echo raw provider/configuration output.
  new Response(catalog.stderr).text(),
])
if (catalogCode !== 0) {
  console.error("Could not load OpenCode's DeepSeek model catalog. Check your connection and configuration.")
  process.exit(1)
}
const available = catalogOutput
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^deepseek\/[a-zA-Z0-9._-]+$/.test(line))
if (![config.model, config.small_model].every((model) => available.includes(model))) {
  console.error(
    "A configured model is missing from OpenCode's DeepSeek catalog. Update model and small_model in opencode.real.example.json.",
  )
  console.error(`Available models: ${available.join(", ") || "none"}`)
  process.exit(1)
}
if (args[0] === "--check") {
  console.log(
    "API key is available; local files exist; configured models are in OpenCode's catalog. No model request sent.",
  )
  console.log("This does not validate API-key validity, account model access, or policy contents.")
  process.exit(0)
}

const child = Bun.spawn([executable, "run", "--format", "json", "--title", "Governance demo", args.join(" ")], {
  cwd: root,
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.exitCode = await child.exited
