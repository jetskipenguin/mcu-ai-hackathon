import { Router, type Response, type RequestHandler } from "express";
import { appendProvenanceEvent } from "./log.js";
import { loadPolicy, matchRule } from "./policy.js";
import { RecordPresence, PresenceError } from "./record-presence.js";
import type { CountersignPolicy, Decision, NewProvenanceEvent, PresenceProof } from "./types.js";
import { WebAuthnService } from "./webauthn.js";

export interface RecordOptions {
  enabled: boolean;
  fieldsForUser: (userId: string) => Record<string, string>;
  credentialsPath?: string;
  webAuthn?: WebAuthnService;
  writeEvent?: (event: NewProvenanceEvent) => Promise<unknown>;
  readPolicy?: () => CountersignPolicy;
}

export function createRecordGovernance(options: RecordOptions) {
  const router = Router();
  const presence = new RecordPresence(options.webAuthn ?? new WebAuthnService({ credentialsPath: options.credentialsPath }));
  const writeEvent = options.writeEvent ?? appendProvenanceEvent;
  const readPolicy = options.readPolicy ?? loadPolicy;

  function recordRule() {
    const rule = matchRule("/record/1", "GET /record/1", {}, readPolicy());
    if (rule?.class !== "marking" || rule.mask_when !== "always" || rule.unmask?.presence.uv !== "required") {
      throw new Error("Student record requires default masking and human authentication");
    }
    return rule;
  }

  function headers(response: Response) {
    response.set("Cache-Control", "no-store");
    const rule = recordRule();
    response.set("Countersign-Marking", `${rule.page_marking}; categories=PII,PHI`);
  }

  async function log(response: Response, action: string, decision: Decision,
    proof: PresenceProof | null = null, notes = "", unmask = false) {
    const rule = recordRule();
    await writeEvent({
      session_id: response.locals.sessionId, user: response.locals.user,
      route: "/record/1", action, rule_id: unmask ? rule.unmask!.rule_id : rule.id,
      class: unmask ? "human-required" : "marking", decision,
      actor_class: proof ? "human-verified" : "unverified", presence: proof,
      signals: { score: 0, flags: [] }, attestation: null,
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

  const visit: RequestHandler = async (_request, response, next) => {
    if (options.enabled) {
      headers(response);
      await log(response, "GET /record/1", "masked", null, "Protected content is masked by default; human authentication required.");
    }
    next();
  };

  // Older clients may still request this endpoint. It never releases plaintext.
  router.post("/record-fields", authenticated, async (_request, response) => {
    headers(response);
    await log(response, "POST /countersign/record-fields", "masked");
    response.json({ masked: true });
  });

  router.post("/unmask", authenticated, async (request, response) => {
    headers(response);
    const rule = recordRule().unmask!;
    // This endpoint has one fixed action and no editable form: a challenge can
    // only authorize this session user's record, never a quiz or another record.
    if (request.body?.rule_id !== rule.rule_id || request.body?.action !== "POST /countersign/unmask/verify") {
      await log(response, "POST /countersign/unmask", "blocked", null, "binding_mismatch", true);
      response.status(400).json({ error: "binding_mismatch" });
      return;
    }
    try {
      const challenge = await presence.challenge(response.locals.user, response.locals.sessionId, rule.rule_id, rule.presence);
      await log(response, "POST /countersign/unmask", "presence-requested", null, "", true);
      response.json(challenge);
    } catch (error) {
      if (!(error instanceof PresenceError)) throw error;
      await log(response, "POST /countersign/unmask", "blocked", null, error.message, true);
      response.status(409).json({ error: error.message, message: "Register a passkey before verifying presence." });
    }
  });

  router.post("/unmask/verify", authenticated, async (request, response) => {
    headers(response);
    const rule = recordRule().unmask!;
    let proof: PresenceProof;
    let notes: string;
    try {
      const result = await presence.verify(response.locals.user, response.locals.sessionId, rule.rule_id,
        rule.presence, request.body?.challenge_id, request.body?.assertion);
      proof = result.presence;
      notes = result.notes;
    } catch (error) {
      const reason = error instanceof PresenceError ? error.message : "verification_failed";
      await log(response, "POST /countersign/unmask/verify", "blocked", null, reason, true);
      response.status(403).json({ error: "countersign_required", reason });
      return;
    }
    await log(response, "POST /countersign/unmask/verify", "unmasked", proof, notes, true);
    response.json({ ok: true, fields: options.fieldsForUser(response.locals.user.id) });
  });

  return { router, visit };
}
