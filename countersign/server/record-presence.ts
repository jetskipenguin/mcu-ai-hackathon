import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from "@simplewebauthn/server";
import type { PolicyPresence, PortalUser, PresenceProof } from "./types.js";
import { RP, simpleWebAuthn } from "./webauthn.js";

type StoredCredential = Omit<WebAuthnCredential, "publicKey"> & { publicKey: string };
interface Challenge {
  challenge: string;
  userId: string;
  sessionId: string;
  created: number;
  ruleId: string;
}

export class PresenceError extends Error {}

// No bypass: both registration and record reveal use the real verifier. Tests
// substitute only the library's verifier, never a production HTTP switch.
export class RecordPresence {
  private credentials: Record<string, StoredCredential[]>;
  private registrations = new Map<string, Challenge>();
  private assertions = new Map<string, Challenge>();

  constructor(private path = resolve("data/credentials.json")) {
    this.credentials = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }

  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.credentials, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
  }

  private prune() {
    for (const entries of [this.registrations, this.assertions]) {
      for (const [key, value] of entries) {
        if (Date.now() - value.created > 120_000) entries.delete(key);
      }
    }
  }

  async registrationOptions(user: PortalUser, sessionId: string) {
    this.prune();
    const options = await simpleWebAuthn.generateRegistrationOptions({
      rpName: RP.rpName, rpID: RP.rpID,
      userID: new TextEncoder().encode(user.id), userName: user.id, userDisplayName: user.name,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required",
      },
      excludeCredentials: (this.credentials[user.id] ?? []).map(({ id, transports }) => ({ id, transports })),
    });
    this.registrations.set(sessionId, {
      challenge: options.challenge, userId: user.id, sessionId, created: Date.now(), ruleId: "registration",
    });
    return options;
  }

  async register(user: PortalUser, sessionId: string, response: RegistrationResponseJSON) {
    const stored = this.registrations.get(sessionId);
    this.registrations.delete(sessionId);
    this.check(stored, user, sessionId, "registration", 120);
    const result = await simpleWebAuthn.verifyRegistrationResponse({
      response, expectedChallenge: stored!.challenge, expectedOrigin: RP.origin,
      expectedRPID: RP.rpID, requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo) throw new PresenceError("verification_failed");
    const credential = result.registrationInfo.credential;
    if (Object.values(this.credentials).flat().some((item) => item.id === credential.id)) {
      throw new PresenceError("credential_already_registered");
    }
    (this.credentials[user.id] ??= []).push({
      ...credential, publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    });
    this.persist();
    return { ok: true, credential_id: credential.id };
  }

  async challenge(user: PortalUser, sessionId: string, ruleId: string, presence: PolicyPresence) {
    this.prune();
    const credentials = this.credentials[user.id] ?? [];
    if (!credentials.length) throw new PresenceError("registration_required");
    const options = await simpleWebAuthn.generateAuthenticationOptions({
      rpID: RP.rpID, timeout: 60_000, userVerification: presence.uv,
      allowCredentials: credentials.map(({ id, transports }) => ({ id, transports })),
    });
    const id = `chg_${randomUUID()}`;
    const created = Date.now();
    this.assertions.set(id, { challenge: options.challenge, userId: user.id, sessionId, ruleId, created });
    return { challenge_id: id, options, expires_at: created + 120_000 };
  }

  private check(stored: Challenge | undefined, user: PortalUser, sessionId: string, ruleId: string, maxAge: number) {
    if (!stored) throw new PresenceError("no_assertion");
    if (stored.userId !== user.id || stored.sessionId !== sessionId || stored.ruleId !== ruleId) {
      throw new PresenceError("binding_mismatch");
    }
    if (Date.now() - stored.created > Math.min(120, maxAge) * 1000) throw new PresenceError("expired");
  }

  async verify(user: PortalUser, sessionId: string, ruleId: string, presence: PolicyPresence,
    challengeId: string, response: AuthenticationResponseJSON): Promise<PresenceProof> {
    const stored = this.assertions.get(challengeId);
    this.assertions.delete(challengeId); // Consume before any validation, including failures.
    this.check(stored, user, sessionId, ruleId, presence.max_age_s);
    const credential = (this.credentials[user.id] ?? []).find((item) => item.id === response?.id);
    if (!credential) throw new PresenceError("verification_failed");
    const result = await simpleWebAuthn.verifyAuthenticationResponse({
      response, expectedChallenge: stored!.challenge, expectedOrigin: RP.origin,
      expectedRPID: RP.rpID, requireUserVerification: presence.uv === "required",
      credential: { ...credential, publicKey: Buffer.from(credential.publicKey, "base64url") },
    });
    // SimpleWebAuthn verifies UP, signature, origin, RP and the nonce.
    if (!result.verified) throw new PresenceError("verification_failed");
    if (presence.uv === "required" && !result.authenticationInfo.userVerified) throw new PresenceError("uv_required");
    credential.counter = result.authenticationInfo.newCounter;
    this.persist();
    return {
      assertion_id: `asr_${randomUUID()}`, credential_id: credential.id, up: true,
      uv: result.authenticationInfo.userVerified, age_ms: Date.now() - stored!.created,
    };
  }
}
