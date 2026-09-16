import { isRecord } from "./canonical.js";
import type { CompositionTelemetry, ProvenanceEvent, Telemetry } from "./types.js";

const counts = new Set(["final_length", "keystrokes", "input_events", "time_on_field_ms"]);
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export function normalizeTelemetry(input: unknown): { telemetry: Telemetry | null; discarded: boolean } {
  if (input == null) return { telemetry: null, discarded: false };
  let discarded = false;
  function sample(value: unknown): CompositionTelemetry | null {
    if (!isRecord(value)) { discarded = true; return null; }
    const result: Record<string, unknown> = {};
    for (const [key, metric] of Object.entries(value)) {
      let valid: boolean;
      if (counts.has(key)) valid = nonnegativeInteger(metric);
      else if (key === "field") valid = typeof metric === "string";
      else if (key === "single_event_fill") valid = typeof metric === "boolean";
      else if (key === "first_input_ts" || key === "last_input_ts") valid = metric === null || timestamp(metric);
      else if (key === "input_types") valid = isRecord(metric) && Object.values(metric).every(nonnegativeInteger);
      else { discarded = true; continue; }
      // Drop a malformed sample, rather than manufacture zeros or derive a
      // contradiction from only the remaining pieces of an invalid sample.
      if (!valid) { discarded = true; return null; }
      result[key] = key === "input_types" ? { ...(metric as Record<string, number>) } : metric;
    }
    if (!Object.keys(result).length) { discarded = true; return null; }
    return result as CompositionTelemetry;
  }
  const telemetry = Array.isArray(input) ? input.map(sample).filter((item): item is CompositionTelemetry => item !== null) : sample(input);
  return { telemetry: Array.isArray(telemetry) && !telemetry.length ? null : telemetry, discarded };
}

// Reads also normalize legacy advisory payloads, but never rewrite the JSONL.
export function normalizeEventTelemetry(event: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeTelemetry(event.class === "attested" ? event.telemetry : null);
  const discarded = normalized.discarded || (event.class !== "attested" && event.telemetry != null);
  return { ...event, telemetry: normalized.telemetry,
    notes: discarded && typeof event.notes === "string"
      ? [event.notes, "Discarded malformed or unsupported composition telemetry."].filter(Boolean).join(" ") : event.notes };
}

export function validateProvenanceEvent(value: unknown): ProvenanceEvent {
  const check = (condition: unknown, field: string): void => {
    if (!condition) throw new Error(`Invalid provenance field: ${field}.`);
  };
  if (!isRecord(value)) throw new Error("Invalid provenance event.");
  for (const field of ["event_id", "session_id", "action", "rule_id"]) {
    check(typeof value[field] === "string" && value[field] !== "", field);
  }
  check(timestamp(value.ts), "ts");
  check(typeof value.route === "string", "route");
  check(typeof value.notes === "string", "notes");
  check(isRecord(value.user) && typeof value.user.id === "string" && value.user.id !== "" && typeof value.user.name === "string", "user");
  check(["human-required", "attested", "marking", "unrestricted"].includes(value.class as string), "class");
  check(["allowed", "blocked", "flagged", "masked", "unmasked", "presence-requested", "contradiction"].includes(value.decision as string), "decision");
  check(["human-verified", "agent-declared", "automation-suspected", "unverified"].includes(value.actor_class as string), "actor_class");
  check([null, "own-work", "ai-assisted"].includes(value.attestation as string | null), "attestation");
  check(isRecord(value.signals) && typeof value.signals.score === "number" && Number.isFinite(value.signals.score) &&
    value.signals.score >= 0 && value.signals.score <= 1 && Array.isArray(value.signals.flags) &&
    value.signals.flags.every((flag) => typeof flag === "string"), "signals");
  if (value.presence !== null) {
    const proof = value.presence;
    check(isRecord(proof) && typeof proof.assertion_id === "string" && proof.assertion_id !== "" &&
      typeof proof.credential_id === "string" && proof.credential_id !== "" && proof.up === true &&
      typeof proof.uv === "boolean" && typeof proof.age_ms === "number" && Number.isFinite(proof.age_ms) && proof.age_ms >= 0, "presence");
  }
  check((value.actor_class === "human-verified") === (value.presence !== null), "actor_class/presence");
  check(value.form_hash === null || typeof value.form_hash === "string", "form_hash");
  const normalized = normalizeTelemetry(value.telemetry);
  check(!normalized.discarded && JSON.stringify(normalized.telemetry) === JSON.stringify(value.telemetry) &&
    (value.class === "attested" || value.telemetry === null), "telemetry");
  return value as unknown as ProvenanceEvent;
}
