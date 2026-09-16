import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { formHash } from "./canonical.js";
import type { PolicyPresence, PolicyRule, PortalUser } from "./types.js";
import { PresenceError as WebAuthnError, WebAuthnService } from "./webauthn.js";

const RECORD_ACTION = "POST /countersign/unmask/verify";
const RECORD_HASH = formHash({});

export class PresenceError extends Error {}

// Keep the record endpoint's binding/error contract while sharing registration,
// credential persistence, and cryptographic verification with governed forms.
export class RecordPresence {
  constructor(private webAuthn: WebAuthnService) {}

  private rule(id: string, presence: PolicyPresence): PolicyRule {
    return {
      id, match: { route: "/record/1", action: RECORD_ACTION },
      class: "human-required", presence, rationale: "Reveal this user's record.", citations: [],
    };
  }

  async challenge(user: PortalUser, sessionId: string, ruleId: string, presence: PolicyPresence) {
    if (!this.webAuthn.credentials.forUser(user.id).length) throw new PresenceError("registration_required");
    return this.webAuthn.challenge(user, sessionId, this.rule(ruleId, presence), RECORD_ACTION, RECORD_HASH, null);
  }

  async verify(user: PortalUser, sessionId: string, ruleId: string, presence: PolicyPresence,
    challengeId: string, response: AuthenticationResponseJSON) {
    const stored = this.webAuthn.consume(challengeId);
    if (!stored) throw new PresenceError("no_assertion");
    if (stored.user !== user.id || stored.session_id !== sessionId || stored.rule_id !== ruleId ||
        stored.action !== RECORD_ACTION || stored.form_hash !== RECORD_HASH || stored.attestation !== null) {
      throw new PresenceError("binding_mismatch");
    }
    const rule = this.rule(ruleId, presence);
    try {
      this.webAuthn.checkAge(stored, rule);
      return await this.webAuthn.verify(stored, rule, response);
    } catch (error) {
      if (error instanceof WebAuthnError) throw new PresenceError(error.reason);
      throw error;
    }
  }
}
