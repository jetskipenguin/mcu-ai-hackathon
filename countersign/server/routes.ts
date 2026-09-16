import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Router } from "express";

import { renderDashboard, renderPolicyReview } from "../../dashboard/index.js";
import { readProvenanceEvents } from "./log.js";
import { loadPolicy, validatePolicy } from "./policy.js";
import type { CountersignPolicy } from "./types.js";
import {
  createWebAuthnRouter,
  type GovernedAction,
  type GovernanceServices,
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

export function createCountersignRouter(
  enabled: boolean, services: GovernanceServices, actions: GovernedAction[],
): Router {
  const router = Router();
  router.use(createWebAuthnRouter(enabled, services, actions));

  router.get("/", (_request, response) => {
    response.type("html").send(renderDashboard());
  });

  router.get("/policy/review", (_request, response) => {
    response.type("html").send(renderPolicyReview(loadPolicy(), readDraftPolicy()));
  });

  router.get("/events", async (request, response) => {
    const events = await readProvenanceEvents(services.provenancePath);
    const since = typeof request.query.since === "string" ? request.query.since : null;
    const index = since
      ? events.findIndex((event) => event.event_id === since)
      : -1;
    response.json({ events: index >= 0 ? events.slice(index + 1) : events });
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
