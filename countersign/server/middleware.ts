import type { NextFunction, Request, RequestHandler, Response } from "express";

import { appendProvenanceEvent } from "./log.js";
import type { PortalUser } from "./types.js";

export function matchGovernedRule(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  // TODO(track-a): match the request to the active policy rule.
  next();
}

export function compareCanonicalFormHash(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  // TODO(track-a): recompute submitted fields and compare the stored form hash.
  next();
}

export function verifyPresenceAssertion(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  // TODO(track-a): consume the challenge and verify its WebAuthn assertion.
  next();
}

export function enforcePresenceRequirements(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  // TODO(track-a): enforce UP, UV, challenge age, and rule max_age_s.
  next();
}

export function deriveActorClass(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  // TODO(track-a): derive actor_class in the order defined by the contract.
  next();
}

export function writeGovernedEvent(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  // TODO(track-a): append the single allowed or blocked action event.
  next();
}

const bypass: RequestHandler = (_request, _response, next) => next();

export function governedSubmission(enabled: boolean): RequestHandler[] {
  if (!enabled) {
    return [bypass];
  }

  return [
    matchGovernedRule,
    compareCanonicalFormHash,
    verifyPresenceAssertion,
    enforcePresenceRequirements,
    deriveActorClass,
    writeGovernedEvent,
  ];
}

export function governedPageVisit(enabled: boolean): RequestHandler {
  if (!enabled) {
    return bypass;
  }

  return async (request, response, next) => {
    try {
      const user = response.locals.user as PortalUser;
      const sessionId = response.locals.sessionId as string;
      await appendProvenanceEvent({
        session_id: sessionId,
        user,
        route: request.path,
        action: `GET ${request.path}`,
        rule_id: "scaffold-route-visit",
        class: "unrestricted",
        decision: "allowed",
        actor_class: "unverified",
        presence: null,
        attestation: null,
        signals: { score: 0.0, flags: [] },
        telemetry: null,
        form_hash: null,
        notes: "Scaffold route-visit event.",
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
