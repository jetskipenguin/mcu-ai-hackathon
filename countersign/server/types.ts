export type GovernanceClass =
  | "human-required"
  | "attested"
  | "marking"
  | "unrestricted";

export type Decision =
  | "allowed"
  | "blocked"
  | "flagged"
  | "masked"
  | "unmasked"
  | "presence-requested"
  | "contradiction";

export type ActorClass =
  | "human-verified"
  | "agent-declared"
  | "automation-suspected"
  | "unverified";

export type Attestation = "own-work" | "ai-assisted" | null;

export interface PortalUser {
  id: string;
  name: string;
}

export interface PresenceProof {
  assertion_id: string;
  credential_id: string;
  up: boolean;
  uv: boolean;
  age_ms: number;
}

export interface ProvenanceEvent {
  ts: string;
  event_id: string;
  session_id: string;
  user: PortalUser;
  route: string;
  action: string;
  rule_id: string;
  class: GovernanceClass;
  decision: Decision;
  actor_class: ActorClass;
  presence: PresenceProof | null;
  attestation: Attestation;
  signals: { score: number; flags: string[] };
  telemetry: unknown | null;
  form_hash: string | null;
  notes: string;
}

export type NewProvenanceEvent = Omit<ProvenanceEvent, "ts" | "event_id">;

// Server-generated metadata saved with a published discussion post. Disclosures
// and advisory findings are distinct from the verified presence at submission.
export interface SubmissionProvenance {
  event_id: string;
  actor_class: ActorClass;
  attestation: Attestation;
  presence: PresenceProof | null;
  review_flags: Array<{
    decision: "contradiction" | "flagged";
    event_id: string;
    notes: string;
  }>;
}

export interface PolicyMatch {
  route: string;
  action?: string;
  when?: Record<string, unknown>;
}

export interface PolicyPresence {
  uv: "required" | "preferred";
  max_age_s: number;
}

export interface PolicyMarking {
  selector: string;
  marking: string;
  categories: string[];
}

export interface PolicyRule {
  id: string;
  match: PolicyMatch;
  class: GovernanceClass;
  presence?: PolicyPresence;
  ai_use?: "prohibited" | "disclosed" | "encouraged";
  markings?: PolicyMarking[];
  page_marking?: string;
  mask_when?: "automation-suspected";
  unmask?: {
    rule_id: string;
    class: "human-required";
    presence: PolicyPresence;
  };
  rationale: string;
  citations: Array<{ source: string; ref: string; excerpt: string }>;
}

export interface CountersignPolicy {
  version: string;
  app: string;
  defaults: {
    class: "unrestricted";
    signals: Record<string, number> & { suspect_threshold: number };
  };
  rules: PolicyRule[];
}
