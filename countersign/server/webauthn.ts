import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { isRecord } from "./canonical.js";
import { portalOrigin } from "./origin.js";
import { CredentialStore } from "./credentials.js";
import { appendProvenanceEvent } from "./log.js";
import { loadPolicy, matchRule } from "./policy.js";
import type { PolicyStore } from "./policy-store.js";
import type { Attestation, PolicyRule, PortalUser, PresenceProof } from "./types.js";

export const RP = {
  rpName: "Countersign",
  // Read after server.ts loads .env; derive the RP ID from the exact browser origin.
  get rpID() { return new URL(RP.origin).hostname; },
  get origin() { return portalOrigin(true); },
} as const;

// A test seam for node:test mocks, not a runtime verification bypass.
export const simpleWebAuthn = {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
};

export const CHALLENGE_TTL_MS = 120_000;
export type PresenceFailure =
  | "no_assertion" | "expired" | "form_mismatch" | "verification_failed" | "uv_required";

export class PresenceError extends Error {
  constructor(readonly reason: PresenceFailure) {
    super(reason);
  }
}

export interface GovernedAction {
  route: string;
  action: string;
  context?: (user: PortalUser) => Record<string, unknown>;
}

interface RegistrationChallenge {
  user: string;
  challenge: string;
  created: number;
}

export interface ActionChallenge extends RegistrationChallenge {
  session_id: string;
  rule_id: string;
  action: string;
  form_hash: string;
  attestation: Attestation;
  generation: number;
}

export interface WebAuthnOptions {
  credentialsPath?: string;
  now?: () => number;
}

export class WebAuthnService {
  readonly credentials: CredentialStore;
  readonly now: () => number;
  private registrations = new Map<string, RegistrationChallenge>();
  private challenges = new Map<string, ActionChallenge>();
  private actionGenerations = new Map<string, number>();

  constructor(options: WebAuthnOptions = {}) {
    this.credentials = new CredentialStore(options.credentialsPath);
    this.now = options.now ?? (() => Date.now());
  }

  private generation(userId: string, action: string): number {
    return this.actionGenerations.get(JSON.stringify([userId, action])) ?? 0;
  }

  revokeActionChallenges(userId: string, action: string): void {
    this.actionGenerations.set(JSON.stringify([userId, action]), this.generation(userId, action) + 1);
    for (const [id, challenge] of this.challenges) {
      if (challenge.user === userId && challenge.action === action) this.challenges.delete(id);
    }
  }

  private prune(): void {
    for (const map of [this.registrations, this.challenges]) {
      for (const [id, value] of map) {
        if (this.now() - value.created > CHALLENGE_TTL_MS) map.delete(id);
      }
    }
  }

  async registrationOptions(user: PortalUser, sessionId: string) {
    this.prune();
    const options = await simpleWebAuthn.generateRegistrationOptions({
      rpName: RP.rpName,
      rpID: RP.rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.id,
      userDisplayName: user.name,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: this.credentials.forUser(user.id).map(({ id, transports }) => ({ id, transports })),
    });
    this.registrations.set(sessionId, {
      user: user.id, challenge: options.challenge, created: this.now(),
    });
    return options;
  }

  async register(user: PortalUser, sessionId: string, response: RegistrationResponseJSON) {
    const stored = this.registrations.get(sessionId);
    this.registrations.delete(sessionId);
    if (!stored || stored.user !== user.id) throw new PresenceError("no_assertion");
    if (this.now() - stored.created > CHALLENGE_TTL_MS) throw new PresenceError("expired");
    let result;
    try {
      result = await simpleWebAuthn.verifyRegistrationResponse({
        response,
        expectedChallenge: stored.challenge,
        expectedOrigin: RP.origin,
        expectedRPID: RP.rpID,
        requireUserPresence: true,
        requireUserVerification: true,
      });
    } catch {
      throw new PresenceError("verification_failed");
    }
    if (!result.verified || !result.registrationInfo.userVerified) {
      throw new PresenceError("verification_failed");
    }
    if (this.now() - stored.created > CHALLENGE_TTL_MS) throw new PresenceError("expired");
    const info = result.registrationInfo;
    this.credentials.add(user.id, {
      ...info.credential,
      credentialDeviceType: info.credentialDeviceType,
      credentialBackedUp: info.credentialBackedUp,
    });
    return { ok: true, credential_id: info.credential.id };
  }

  async challenge(
    user: PortalUser, sessionId: string, rule: PolicyRule,
    action: string, form_hash: string, attestation: Attestation,
  ) {
    this.prune();
    const credentials = this.credentials.forUser(user.id);
    if (credentials.length === 0) throw new PresenceError("no_assertion");
    const generation = this.generation(user.id, action);
    const options = await simpleWebAuthn.generateAuthenticationOptions({
      rpID: RP.rpID,
      allowCredentials: credentials.map(({ id, transports }) => ({ id, transports })),
      userVerification: rule.presence!.uv,
      timeout: 60_000,
    });
    if (generation !== this.generation(user.id, action)) throw new PresenceError("expired");
    const challenge_id = `chg_${randomUUID()}`;
    const created = this.now();
    this.challenges.set(challenge_id, {
      challenge: options.challenge, user: user.id, session_id: sessionId,
      rule_id: rule.id, action, form_hash, attestation, created, generation,
    });
    return { challenge_id, options, expires_at: created + CHALLENGE_TTL_MS };
  }

  consume(challengeId: string): ActionChallenge | undefined {
    const stored = this.challenges.get(challengeId);
    // Consume synchronously, before any async verification, even on failure.
    this.challenges.delete(challengeId);
    return stored;
  }

  checkAge(stored: ActionChallenge, rule: PolicyRule): number {
    const age = this.now() - stored.created;
    if (stored.generation !== this.generation(stored.user, stored.action) ||
        age < 0 || age > CHALLENGE_TTL_MS || age > rule.presence!.max_age_s * 1000) {
      throw new PresenceError("expired");
    }
    return age;
  }

  async verify(stored: ActionChallenge, rule: PolicyRule, assertion: AuthenticationResponseJSON) {
    const credential = this.credentials.forUser(stored.user).find((item) => item.id === assertion.id);
    if (!credential) throw new PresenceError("verification_failed");
    const userHandle = assertion.response?.userHandle;
    if (userHandle && userHandle !== Buffer.from(stored.user).toString("base64url")) {
      throw new PresenceError("verification_failed");
    }
    let result;
    try {
      result = await simpleWebAuthn.verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: stored.challenge,
        expectedOrigin: RP.origin,
        expectedRPID: RP.rpID,
        // The demo treats counter regression as advisory (webauthn-notes §3.3).
        // Signature, challenge, RP, origin, UP, and UV verification remain on.
        credential: { ...credential, counter: 0 },
        requireUserVerification: rule.presence!.uv === "required",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "User verification required, but user could not be verified") {
        throw new PresenceError("uv_required");
      }
      throw new PresenceError("verification_failed");
    }
    if (!result.verified) throw new PresenceError("verification_failed");
    const info = result.authenticationInfo;
    if (rule.presence!.uv === "required" && !info.userVerified) {
      throw new PresenceError("uv_required");
    }
    const age_ms = this.checkAge(stored, rule);
    const notes = this.credentials.updateCounter(stored.user, credential.id, info.newCounter);
    const presence: PresenceProof = {
      assertion_id: `asr_${randomUUID()}`,
      credential_id: credential.id,
      up: true, // SimpleWebAuthn rejects missing UP; advancedFIDOConfig is not used.
      uv: info.userVerified,
      age_ms,
    };
    return { presence, notes };
  }
}

export interface GovernanceServices {
  webAuthn: WebAuthnService;
  provenancePath?: string;
  policies?: PolicyStore;
}

export function createWebAuthnRouter(
  enabled: boolean, services: GovernanceServices, actions: GovernedAction[],
): Router {
  const router = Router();
  const { webAuthn, provenancePath } = services;
  const endpoints = ["/webauthn/register/options", "/webauthn/register/verify", "/challenge"];
  router.post(endpoints, (request, response, next) => {
    if (!enabled) {
      response.status(404).json({ error: "countersign_disabled", message: "Countersign is off." });
    } else if (!response.locals.user || !response.locals.sessionId) {
      response.status(401).json({ error: "login_required", message: "Choose a demo user." });
    } else if (!request.is("application/json")) {
      response.status(415).json({ error: "json_required", message: "Send a JSON request." });
    } else if (request.get("origin") && request.get("origin") !== RP.origin) {
      response.status(403).json({ error: "origin_mismatch", message: `Use ${RP.origin}.` });
    } else {
      response.set("Cache-Control", "no-store");
      next();
    }
  });

  router.post("/webauthn/register/options", async (_request, response) => {
    response.json(await webAuthn.registrationOptions(response.locals.user, response.locals.sessionId));
  });

  router.post("/webauthn/register/verify", async (request, response) => {
    try {
      response.json(await webAuthn.register(response.locals.user, response.locals.sessionId, request.body));
    } catch (error) {
      if (!(error instanceof PresenceError)) throw error;
      response.status(400).json({ error: error.reason, message: "Passkey registration failed. Try registering again." });
    }
  });

  router.post("/challenge", async (request, response) => {
    const body = isRecord(request.body) ? request.body : {};
    const user = response.locals.user as PortalUser;
    const sessionId = response.locals.sessionId as string;
    const policy = services.policies?.active() ?? loadPolicy();
    const action = actions.find((item) => item.action === body.action);
    const rule = action && matchRule(action.route, action.action, action.context?.(user), policy);
    if (!action || !rule || rule.id !== body.rule_id || !rule.presence ||
        (rule.class !== "human-required" && rule.class !== "attested")) {
      response.status(400).json({ error: "invalid_action", message: "No presence rule matches this action." });
      return;
    }
    const attestation = body.attestation ?? null;
    if (typeof body.form_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(body.form_hash) ||
        (rule.class === "attested" ? attestation !== "own-work" && attestation !== "ai-assisted" : attestation !== null)) {
      response.status(400).json({ error: "invalid_binding", message: "Provide a form hash and the rule's attestation." });
      return;
    }
    if (webAuthn.credentials.forUser(user.id).length === 0) {
      response.status(409).json({ error: "registration_required", message: "Register a passkey at /register before submitting." });
      return;
    }
    let challenge;
    try {
      challenge = await webAuthn.challenge(user, sessionId, rule, action.action, body.form_hash, attestation as Attestation);
    } catch (error) {
      if (!(error instanceof PresenceError)) throw error;
      response.status(409).json({ error: error.reason, message: "Action changed while requesting presence. Reload and try again." });
      return;
    }
    await appendProvenanceEvent({
      session_id: sessionId, user, route: action.route, action: action.action,
      rule_id: rule.id, class: rule.class, decision: "presence-requested",
      actor_class: "unverified",
      presence: null, attestation: attestation as Attestation,
      signals: { score: 0, flags: [] },
      telemetry: null, form_hash: body.form_hash, notes: "Fresh action-bound presence requested.",
    }, provenancePath);
    response.json(challenge);
  });
  return router;
}
