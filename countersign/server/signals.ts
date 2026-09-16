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
}

export interface SignalResult {
  score: number;
  flagged: boolean;
  actor_class: ActorClass;
}

export function scoreSignals(
  signals: ClientSignals,
  weights: CountersignPolicy["defaults"]["signals"],
): SignalResult {
  const indicators: Record<string, number> = {
    webdriver: Number(signals.webdriver),
    fill_without_focus: Number(
      signals.fields_filled > 0 && !signals.focus_before_fill,
    ),
    uniform_timing: Number(
      signals.fields_filled > 1 && signals.fill_span_ms < 250,
    ),
    hidden_during_input: Number(signals.visibility_hidden_during_input),
  };

  const weightedSum = Object.entries(indicators).reduce(
    (sum, [name, indicator]) => sum + (weights[name] ?? 0) * indicator,
    0,
  );
  const futureScore = Math.min(1, Math.max(0, weightedSum));
  void futureScore;

  // TODO(track-a): return the weighted score and its flags after signal tuning.
  return { score: 0.0, flagged: false, actor_class: "unverified" };
}
