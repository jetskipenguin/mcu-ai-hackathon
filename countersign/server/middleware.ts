import type { Request, RequestHandler, Response } from "express";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { formHash, isRecord } from "./canonical.js";
import { appendProvenanceEvent } from "./log.js";
import { loadPolicy, matchRule, requiresPresence } from "./policy.js";
import type { ActorClass, Attestation, NewProvenanceEvent, PolicyRule, PortalUser, PresenceProof, SubmissionProvenance } from "./types.js";
import {
  PresenceError,
  type ActionChallenge,
  type GovernedAction,
  type GovernanceServices,
  type PresenceFailure,
} from "./webauthn.js";

interface SubmissionState {
  rule?: PolicyRule;
  formHash: string;
  challenge?: ActionChallenge;
  assertion?: AuthenticationResponseJSON;
  presence: PresenceProof | null;
  attestation: Attestation;
  actorClass: ActorClass;
  threshold: number;
  notes: string;
}

const bypass: RequestHandler = (_request, _response, next) => next();

export function governedSubmission(
  enabled: boolean, action: GovernedAction, services: GovernanceServices,
): RequestHandler[] {
  if (!enabled) return [bypass];
  const { webAuthn, provenancePath } = services;
  const stateFor = (response: Response) => response.locals.governance as SubmissionState;

  function eventFor(request: Request, response: Response): NewProvenanceEvent {
    const state = stateFor(response);
    return {
      session_id: response.locals.sessionId,
      user: response.locals.user,
      route: action.route,
      action: action.action,
      rule_id: state.rule?.id ?? "default-unrestricted",
      class: state.rule?.class ?? "unrestricted",
      decision: "allowed",
      actor_class: state.actorClass,
      presence: state.presence,
      attestation: state.attestation,
      signals: response.locals.signals ?? { score: 0, flags: [] },
      telemetry: state.rule?.class === "attested" ? request.body?.countersign?.telemetry ?? null : null,
      form_hash: state.formHash,
      notes: state.notes,
    };
  }

  function actorFor(request: Request, response: Response): ActorClass {
    if (stateFor(response).presence) return "human-verified";
    if (request.get("Countersign-Agent") || response.locals.agentDeclared) return "agent-declared";
    if ((response.locals.signals?.score ?? 0) >= stateFor(response).threshold) return "automation-suspected";
    return "unverified";
  }

  async function blocked(request: Request, response: Response, reason: PresenceFailure) {
    stateFor(response).actorClass = actorFor(request, response);
    await appendProvenanceEvent({
      ...eventFor(request, response), decision: "blocked", notes: reason,
    }, provenancePath);
    response.status(403).json({ error: "countersign_required", reason });
  }

  const matchGovernedRule: RequestHandler = (_request, response, next) => {
    const policy = loadPolicy();
    const user = response.locals.user as PortalUser;
    response.locals.governance = {
      rule: matchRule(action.route, action.action, action.context?.(user), policy),
      formHash: formHash(isRecord(_request.body) ? _request.body : {}),
      presence: null, attestation: null, actorClass: "unverified", notes: "",
      threshold: policy.defaults.signals.suspect_threshold,
    } satisfies SubmissionState;
    next();
  };

  const compareCanonicalFormHash: RequestHandler = async (request, response, next) => {
    const state = stateFor(response);
    if (!requiresPresence(state.rule)) return next();
    const cs = isRecord(request.body?.countersign) ? request.body.countersign : {};
    const stored = typeof cs.challenge_id === "string" ? webAuthn.consume(cs.challenge_id) : undefined;
    if (!stored || !isRecord(cs.assertion)) return blocked(request, response, "no_assertion");
    if (stored.user !== response.locals.user.id || stored.session_id !== response.locals.sessionId) {
      return blocked(request, response, "verification_failed");
    }
    try {
      webAuthn.checkAge(stored, state.rule);
    } catch (error) {
      if (!(error instanceof PresenceError)) throw error;
      return blocked(request, response, error.reason);
    }
    if (stored.rule_id !== state.rule.id || stored.action !== action.action ||
        stored.form_hash !== state.formHash || stored.attestation !== (cs.attestation ?? null)) {
      return blocked(request, response, "form_mismatch");
    }
    state.challenge = stored;
    state.assertion = cs.assertion as unknown as AuthenticationResponseJSON;
    state.attestation = stored.attestation;
    next();
  };

  const verifyPresenceAssertion: RequestHandler = async (request, response, next) => {
    const state = stateFor(response);
    if (!requiresPresence(state.rule)) return next();
    try {
      const result = await webAuthn.verify(state.challenge!, state.rule, state.assertion!);
      state.presence = result.presence;
      state.notes = result.notes;
    } catch (error) {
      if (!(error instanceof PresenceError)) throw error;
      return blocked(request, response, error.reason);
    }
    next();
  };

  const enforcePresenceRequirements: RequestHandler = async (request, response, next) => {
    const state = stateFor(response);
    if (requiresPresence(state.rule)) {
      try {
        state.presence!.age_ms = webAuthn.checkAge(state.challenge!, state.rule);
      } catch (error) {
        if (!(error instanceof PresenceError)) throw error;
        state.presence = null;
        return blocked(request, response, error.reason);
      }
    }
    next();
  };

  const deriveActorClass: RequestHandler = (request, response, next) => {
    stateFor(response).actorClass = actorFor(request, response);
    next();
  };

  const writeGovernedEvent: RequestHandler = async (request, response, next) => {
    const event = eventFor(request, response);
    const allowed = await appendProvenanceEvent(event, provenancePath);
    const provenance: SubmissionProvenance = {
      event_id: allowed.event_id,
      actor_class: allowed.actor_class,
      attestation: allowed.attestation,
      presence: allowed.presence,
      review_flags: [],
    };
    // The contract explicitly calls for separate advisory attestation decisions.
    // They never stop the portal action from executing.
    if (event.class === "attested") {
      const fields = Array.isArray(event.telemetry) ? event.telemetry : [event.telemetry];
      const contradiction = fields.some((field) => isRecord(field) &&
        (field.single_event_fill === true ||
          (typeof field.keystrokes === "number" && typeof field.final_length === "number" &&
            field.keystrokes < field.final_length * 0.1)));
      if (event.attestation === "own-work" && contradiction) {
        const review = await appendProvenanceEvent({ ...event, decision: "contradiction", notes: "Attestation and composition telemetry disagree." }, provenancePath);
        provenance.review_flags.push({ decision: "contradiction", event_id: review.event_id, notes: review.notes });
      }
      if (stateFor(response).rule?.ai_use === "prohibited" && event.attestation === "ai-assisted") {
        const review = await appendProvenanceEvent({ ...event, decision: "flagged", notes: "AI assistance disclosed under an AI-prohibited policy." }, provenancePath);
        provenance.review_flags.push({ decision: "flagged", event_id: review.event_id, notes: review.notes });
      }
    }
    response.locals.submissionProvenance = provenance;
    response.locals.presence = event.presence;
    next();
  };

  return [matchGovernedRule, compareCanonicalFormHash, verifyPresenceAssertion,
    enforcePresenceRequirements, deriveActorClass, writeGovernedEvent];
}

export function governedPageVisit(enabled: boolean, provenancePath?: string): RequestHandler {
  if (!enabled) return bypass;
  return async (request, response, next) => {
    await appendProvenanceEvent({
      session_id: response.locals.sessionId,
      user: response.locals.user,
      route: request.path,
      action: `GET ${request.path}`,
      rule_id: "scaffold-route-visit",
      class: "unrestricted",
      decision: "allowed",
      actor_class: "unverified",
      presence: null, attestation: null,
      signals: { score: 0, flags: [] },
      telemetry: null, form_hash: null,
      notes: "Portal page visit; record masking is separate Track A work.",
    }, provenancePath);
    next();
  };
}
