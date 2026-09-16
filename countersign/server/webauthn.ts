import { Router } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

export const RP = {
  rpName: "Countersign",
  rpID: "localhost",
  origin: "http://localhost:3000",
} as const;

export const simpleWebAuthn = {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
};

const PLACEHOLDER_CHALLENGE = Buffer.from(
  "countersign-placeholder-challenge-0001",
).toString("base64url");

export function placeholderChallengeResponse(
  userVerification: "required" | "preferred" = "required",
): Record<string, unknown> {
  return {
    challenge_id: "chg_placeholder_not_persisted",
    options: {
      challenge: PLACEHOLDER_CHALLENGE,
      timeout: 60_000,
      rpId: RP.rpID,
      allowCredentials: [],
      userVerification,
    },
    expires_at: Date.now() + 120_000,
  };
}

export function createWebAuthnRouter(): Router {
  const router = Router();

  router.post("/webauthn/register/options", (_request, response) => {
    // TODO(track-a): issue and persist per-user registration options.
    response.json({
      challenge: PLACEHOLDER_CHALLENGE,
      rp: { name: RP.rpName, id: RP.rpID },
      user: {
        id: Buffer.from("stu-placeholder").toString("base64url"),
        name: "stu-placeholder",
        displayName: "Placeholder User",
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: [],
    });
  });

  router.post("/webauthn/register/verify", (_request, response) => {
    // TODO(track-a): verify registration and persist the credential.
    response.json({ ok: true, credential_id: "cred_placeholder" });
  });

  router.post("/challenge", (request, response) => {
    // TODO(track-a): generate and persist a single-use, action-bound challenge.
    const userVerification =
      request.body?.rule_id === "discussion-initial-post"
        ? "preferred"
        : "required";
    response.json(placeholderChallengeResponse(userVerification));
  });

  return router;
}
