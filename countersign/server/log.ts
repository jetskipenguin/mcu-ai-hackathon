import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { NewProvenanceEvent, ProvenanceEvent } from "./types.js";

export const PROVENANCE_PATH = resolve(process.cwd(), "data/provenance.jsonl");

export async function appendProvenanceEvent(
  input: NewProvenanceEvent,
  filePath = PROVENANCE_PATH,
): Promise<ProvenanceEvent> {
  const event: ProvenanceEvent = {
    ...input,
    ts: new Date().toISOString(),
    event_id: `evt_${randomUUID().replaceAll("-", "")}`,
  };

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

  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProvenanceEvent);
}
