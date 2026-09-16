import { Router, type Request, type Response, type RequestHandler } from "express";
import { appendProvenanceEvent } from "./log.js";
import { loadPolicy, matchRule } from "./policy.js";
import { RecordPresence, PresenceError } from "./record-presence.js";
import { scoreSignals, type ClientSignals, type SignalResult } from "./signals.js";
import type { Decision, NewProvenanceEvent, PortalUser, PresenceProof } from "./types.js";
import { WebAuthnService } from "./webauthn.js";

export interface RecordOptions {
  enabled: boolean;
  fieldsForUser: (userId: string) => Record<string, string>;
  credentialsPath?: string;
  webAuthn?: WebAuthnService;
  writeEvent?: (event: NewProvenanceEvent) => Promise<unknown>;
}

export function createRecordGovernance(options: RecordOptions) {
  const router = Router();
  const presence = new RecordPresence(options.webAuthn ?? new WebAuthnService({ credentialsPath: options.credentialsPath }));
  const writeEvent = options.writeEvent ?? appendProvenanceEvent;
  const sessions = new Map<string, SignalResult & { user: PortalUser; first_seen: string }>();

  function observe(request: Request, response: Response, route: string, signals: Partial<ClientSignals> = {}) {
    const sessionId = response.locals.sessionId as string;
    const previous = sessions.get(sessionId);
    const result = scoreSignals({
      ...signals,
      agent_header_declared: Boolean(request.get("Countersign-Agent")) || signals.agent_header_declared === true,
    }, loadPolicy().defaults.signals, route);
    // A later clean sample or navigation cannot erase previously observed evidence.
    const declared = result.actor_class === "agent-declared" || previous?.actor_class === "agent-declared";
    result.score = Math.max(previous?.score ?? 0, result.score);
    result.flagged ||= previous?.flagged ?? false;
    result.actor_class = declared ? "agent-declared" : result.flagged ? "automation-suspected" : "unverified";
    result.flags = [...new Set([...(previous?.flags ?? []), ...result.flags])];
    sessions.set(sessionId, { ...result, user: response.locals.user, first_seen: previous?.first_seen ?? new Date().toISOString() });
    return result;
  }

  function recordRule() {
    const rule = matchRule("/record/1", "GET /record/1");
    if (rule?.class !== "marking" || !rule.unmask) throw new Error("Student record protection policy is missing");
    return rule;
  }

  function headers(response: Response) {
    response.set("Cache-Control", "no-store");
    const rule = recordRule();
    response.set("Countersign-Marking", `${rule.page_marking}; categories=PII,PHI`);
  }

  async function log(response: Response, action: string, decision: Decision, signals: SignalResult,
    proof: PresenceProof | null = null, notes = "", unmask = false) {
    const rule = recordRule();
    await writeEvent({
      session_id: response.locals.sessionId, user: response.locals.user,
      route: "/record/1", action, rule_id: unmask ? rule.unmask!.rule_id : rule.id,
      class: unmask ? "human-required" : "marking", decision,
      actor_class: proof ? "human-verified" : signals.actor_class, presence: proof,
      signals: { score: signals.score, flags: signals.flags }, attestation: null,
      telemetry: null, form_hash: null, notes,
    });
  }

  const authenticated: RequestHandler = (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (!options.enabled) {
      response.status(404).json({ error: "countersign_disabled" });
    } else if (!response.locals.user) {
      response.status(401).json({ error: "login_required" });
    } else {
      next();
    }
  };

  const visit: RequestHandler = async (request, response, next) => {
    if (options.enabled) {
      headers(response);
      const signals = observe(request, response, "/record/1");
      response.locals.recordSignals = signals;
      await log(response, "GET /record/1", "masked", signals, null, "Initial HTML contains placeholders only; signal evaluation pending.");
    }
    next();
  };

  router.post("/signals", authenticated, async (request, response) => {
    const route = typeof request.body?.route === "string" ? request.body.route : "";
    const signals = observe(request, response, route, request.body?.signals ?? {});
    if (signals.flagged) {
      await writeEvent({
        session_id: response.locals.sessionId, user: response.locals.user, route,
        action: "POST /countersign/signals", rule_id: "session-signals", class: "unrestricted",
        decision: "flagged", actor_class: signals.actor_class, presence: null, attestation: null,
        signals: { score: signals.score, flags: signals.flags }, telemetry: null, form_hash: null,
        notes: "Advisory automation evidence; no action blocked by score.",
      });
    }
    response.json(signals);
  });

  router.get("/sessions/flagged", authenticated, (_request, response) => {
    response.json({ sessions: [...sessions].filter(([, value]) => value.flagged)
      .map(([session_id, value]) => ({ session_id, ...value })) });
  });

  router.post("/record-fields", authenticated, async (request, response) => {
    headers(response);
    const sample = request.body?.signals;
    const signals = observe(request, response, "/record/1", sample ?? {});
    // Missing/failed JavaScript must never release the initial record payload.
    const complete = sample && typeof sample.webdriver === "boolean" &&
      typeof sample.document_hidden === "boolean" && typeof sample.document_has_focus === "boolean";
    const masked = !complete || signals.flagged;
    await log(response, "POST /countersign/record-fields", masked ? "masked" : "allowed", signals);
    response.json({ ...signals, masked,
      ...(masked ? {} : { fields: options.fieldsForUser(response.locals.user.id) }) });
  });

  router.post("/unmask", authenticated, async (request, response) => {
    headers(response);
    const rule = recordRule().unmask!;
    const signals = observe(request, response, "/record/1");
    // This endpoint has one fixed action and no editable form: a challenge can
    // only authorize this session user's record, never a quiz or another record.
    if (request.body?.rule_id !== rule.rule_id || request.body?.action !== "POST /countersign/unmask/verify") {
      await log(response, "POST /countersign/unmask", "blocked", signals, null, "binding_mismatch", true);
      response.status(400).json({ error: "binding_mismatch" });
      return;
    }
    try {
      const challenge = await presence.challenge(response.locals.user, response.locals.sessionId, rule.rule_id, rule.presence);
      await log(response, "POST /countersign/unmask", "presence-requested", signals, null, "", true);
      response.json(challenge);
    } catch (error) {
      if (!(error instanceof PresenceError)) throw error;
      await log(response, "POST /countersign/unmask", "blocked", signals, null, error.message, true);
      response.status(409).json({ error: error.message, message: "Register a passkey before verifying presence." });
    }
  });

  router.post("/unmask/verify", authenticated, async (request, response) => {
    headers(response);
    const rule = recordRule().unmask!;
    const signals = observe(request, response, "/record/1");
    let proof: PresenceProof;
    let notes: string;
    try {
      const result = await presence.verify(response.locals.user, response.locals.sessionId, rule.rule_id,
        rule.presence, request.body?.challenge_id, request.body?.assertion);
      proof = result.presence;
      notes = result.notes;
    } catch (error) {
      const reason = error instanceof PresenceError ? error.message : "verification_failed";
      await log(response, "POST /countersign/unmask/verify", "blocked", signals, null, reason, true);
      response.status(403).json({ error: "countersign_required", reason });
      return;
    }
    await log(response, "POST /countersign/unmask/verify", "unmasked", signals, proof, notes, true);
    response.json({ ok: true, fields: options.fieldsForUser(response.locals.user.id) });
  });

  const attachSignals: RequestHandler = (_request, response, next) => {
    const observed = options.enabled && sessions.get(response.locals.sessionId);
    if (observed) {
      response.locals.signals = { score: observed.score, flags: observed.flags };
      response.locals.agentDeclared = observed.actor_class === "agent-declared";
    }
    next();
  };

  return { router, visit, attachSignals };
}
