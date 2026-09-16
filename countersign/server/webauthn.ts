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
