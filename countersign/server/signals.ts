import type { ActorClass, CountersignPolicy } from "./types.js";

export interface ClientSignals {
  webdriver: boolean;
  pointer_events_before_input: number;
  keydown_events: number;
  fields_filled: number;
  fill_span_ms: number;
  visibility_hidden_during_input: boolean;
  focus_before_fill: boolean;
  agent_header_declared: boolean;
  document_hidden: boolean;
  document_has_focus: boolean;
}

export interface SignalResult {
  score: number;
  flagged: boolean;
  actor_class: ActorClass;
  flags: string[];
}

export function scoreSignals(
  signals: Partial<ClientSignals>,
  weights: CountersignPolicy["defaults"]["signals"],
  route = "",
): SignalResult {
  const indicators: Record<string, number> = {
    webdriver: Number(signals.webdriver === true),
    fill_without_focus: Number(
      (signals.fields_filled ?? 0) > 0 && signals.focus_before_fill === false,
    ),
    uniform_timing: Number(
      (signals.fields_filled ?? 0) > 1 && (signals.fill_span_ms ?? Infinity) < 250,
    ),
    hidden_during_input: Number(signals.visibility_hidden_during_input === true),
    // Read-only agents need not fill a form or expose navigator.webdriver.
    // Hidden AND unfocused protected-record reads are soft evidence, not proof:
    // a human opening a background tab can trigger this too (and step up).
    background_record_read: Number(
      route === "/record/1" && signals.document_hidden === true &&
      signals.document_has_focus === false,
    ),
  };

  const weightedSum = Object.entries(indicators).reduce(
    (sum, [name, indicator]) => sum + (weights[name] ?? 0) * indicator,
    0,
  );
  const score = Math.min(1, Math.max(0, weightedSum));
  const declared = signals.agent_header_declared === true;
  const flagged = declared || score >= weights.suspect_threshold;
  return {
    score,
    flagged,
    actor_class: declared ? "agent-declared" : flagged ? "automation-suspected" : "unverified",
    flags: [
      ...Object.entries(indicators).filter(([, value]) => value === 1)
        .map(([name]) => name.replaceAll("_", "-")),
      ...(declared ? ["agent-declared"] : []),
    ],
  };
}
