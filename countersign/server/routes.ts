import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Router } from "express";

import { renderDashboard, renderPolicyReview } from "../../dashboard/index.js";
import { readProvenanceEvents } from "./log.js";
import { loadPolicy, validatePolicy } from "./policy.js";
import { scoreSignals, type ClientSignals } from "./signals.js";
import type { CountersignPolicy } from "./types.js";
import {
  createWebAuthnRouter,
  placeholderChallengeResponse,
} from "./webauthn.js";

const DRAFT_PATH = resolve(
  process.cwd(),
  "countersign/policy/countersign.policy.draft.json",
);
const CATEGORIES_PATH = resolve(process.cwd(), "data/cui/categories.json");
const LDCS_PATH = resolve(process.cwd(), "data/cui/ldcs.json");

function readDraftPolicy(): CountersignPolicy | null {
  let raw: string;
  try {
    raw = readFileSync(DRAFT_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const categoryItems = JSON.parse(
    readFileSync(CATEGORIES_PATH, "utf8"),
  ) as Array<{ id: string }>;
  const ldcItems = JSON.parse(readFileSync(LDCS_PATH, "utf8")) as Array<{
    id: string;
  }>;
  const knownMarkings = new Set([
    ...categoryItems.map((item) => item.id),
    ...ldcItems.map((item) => item.id),
  ]);
  return validatePolicy(JSON.parse(raw) as unknown, knownMarkings);
}

export function createCountersignRouter(): Router {
  const router = Router();
  router.use(createWebAuthnRouter());

  router.get("/", (_request, response) => {
    response.type("html").send(renderDashboard());
  });

  router.get("/policy/review", (_request, response) => {
    response.type("html").send(renderPolicyReview(loadPolicy(), readDraftPolicy()));
  });

  router.post("/signals", (request, response) => {
    const policy = loadPolicy();
    const signals = (request.body?.signals ?? {}) as ClientSignals;
    response.json(scoreSignals(signals, policy.defaults.signals));
  });

  router.post("/unmask", (_request, response) => {
    // TODO(track-a): persist an unmask challenge bound to the current user.
    response.json(placeholderChallengeResponse("required"));
  });

  router.post("/unmask/verify", (_request, response) => {
    // TODO(track-a): verify presence before returning any marked field values.
    response.status(501).json({
      error: "not_implemented",
      message: "Unmask verification is implemented by Track A.",
    });
  });

  router.get("/events", async (request, response) => {
    const events = await readProvenanceEvents();
    const since = typeof request.query.since === "string" ? request.query.since : null;
    const index = since
      ? events.findIndex((event) => event.event_id === since)
      : -1;
    response.json({ events: index >= 0 ? events.slice(index + 1) : events });
  });

  router.get("/sessions/flagged", (_request, response) => {
    // TODO(track-a): aggregate sessions whose deterministic score is flagged.
    response.json({ sessions: [] });
  });

  router.get("/policy", (_request, response) => {
    response.json(loadPolicy());
  });

  router.get("/policy/draft", (_request, response) => {
    const draft = readDraftPolicy();
    if (!draft) {
      response.status(404).json({
        error: "not_found",
        message: "No draft policy exists.",
      });
      return;
    }
    response.json(draft);
  });

  router.post("/policy/approve", (_request, response) => {
    // TODO(track-b): approve selected rules and atomically replace the active policy.
    response.json({ ok: true, active_version: loadPolicy().version });
  });

  return router;
}
