import { createHash } from "node:crypto";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
}

export function formHash(body: Record<string, unknown>): string {
  const fields = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "countersign"),
  );
  return `sha256:${createHash("sha256").update(JSON.stringify(sorted(fields))).digest("hex")}`;
}
