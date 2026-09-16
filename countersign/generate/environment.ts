import { existsSync } from "node:fs";

export function loadEnvironment(): void {
  if (!existsSync(".env")) return;
  if (typeof process.loadEnvFile !== "function") {
    throw new Error("Loading .env requires Node 20.12+; otherwise export the configuration variables before starting.");
  }
  // Node preserves variables already exported by the shell (including the
  // ungoverned script's COUNTERSIGN=off and PORT=3001).
  process.loadEnvFile();
}
