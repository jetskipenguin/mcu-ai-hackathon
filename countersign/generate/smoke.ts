import { loadEnvironment } from "./environment.js";
import { complete, modelConfiguration } from "./llm.js";

async function main() {
  loadEnvironment();
  const model = modelConfiguration();
  const text = await complete('Return exactly this JSON object: {"ok":true,"probe":"countersign"}');
  const result = JSON.parse(text);
  if (result.ok !== true || result.probe !== "countersign") throw new Error("Provider did not return the requested smoke-test JSON.");
  console.log(JSON.stringify({ ok: true, ...model, checked_at: new Date().toISOString() }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Provider smoke test failed.");
  process.exitCode = 1;
});
