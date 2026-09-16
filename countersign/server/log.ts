import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { NewProvenanceEvent, ProvenanceEvent } from "./types.js";
import { isRecord } from "./canonical.js";
import { normalizeEventTelemetry, validateProvenanceEvent } from "./provenance.js";

export const PROVENANCE_PATH = resolve(process.cwd(), "data/provenance.jsonl");

export async function appendProvenanceEvent(
  input: NewProvenanceEvent,
  filePath = PROVENANCE_PATH,
): Promise<ProvenanceEvent> {
  const event = validateProvenanceEvent(normalizeEventTelemetry({
    ...input,
    ts: new Date().toISOString(),
    event_id: `evt_${randomUUID().replaceAll("-", "")}`,
  }));

  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export async function readProvenanceEvents(
  filePath = PROVENANCE_PATH,
): Promise<ProvenanceEvent[]> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const events: ProvenanceEvent[] = [];
  const lines = contents.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); }
    catch {
      // A poll can catch appendFile mid-line. Retry that incomplete final record
      // on the next poll, but never silently skip a malformed completed line.
      if (index === lines.length - 1 && !contents.endsWith("\n")) break;
      throw new Error(`Invalid provenance record at line ${index + 1}.`);
    }
    try { events.push(validateProvenanceEvent(isRecord(value) ? normalizeEventTelemetry(value) : value)); }
    catch { throw new Error(`Invalid provenance record at line ${index + 1}.`); }
  }
  return events;
}
