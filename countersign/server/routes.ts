import { Router } from "express";

import { renderDashboard, renderPolicyReview } from "../../dashboard/index.js";
import { readProvenanceEvents } from "./log.js";
import { PolicyError, PolicyStore, revision } from "./policy-store.js";
import { generatePolicy } from "../generate/index.js";
import { modelConfiguration } from "../generate/llm.js";
import { isRecord } from "./canonical.js";
import {
  createWebAuthnRouter,
  type GovernedAction,
  type GovernanceServices,
  RP,
} from "./webauthn.js";

export function createCountersignRouter(
  enabled: boolean, services: GovernanceServices, actions: GovernedAction[],
): Router {
  const router = Router();
  const policies = services.policies ?? new PolicyStore();
  let generating = false;
  router.use(createWebAuthnRouter(enabled, services, actions));

  router.get("/", (_request, response) => {
    response.type("html").send(renderDashboard());
  });

  router.get("/policy/review", (_request, response) => {
    const active = policies.active();
    let draft = null;
    let draftError = "";
    try { draft = policies.draft(); }
    catch (error) { draftError = error instanceof Error ? error.message : "The draft is invalid."; }
    const vocabulary = policies.vocabulary();
    let model = "Model configuration incomplete";
    try { const configured = modelConfiguration(); model = `${configured.provider} / ${configured.model}${configured.region ? ` / ${configured.region}` : ""}`; } catch { /* Show the setup state without secrets. */ }
    response.set("Cache-Control", "no-store").type("html").send(renderPolicyReview(active, draft, {
      enabled, signedIn: Boolean(response.locals.user), draftError, model, metadata: policies.metadata(draft),
      activeRevision: revision(active), draftRevision: draft ? revision(draft) : "",
      vocabulary: { categories: vocabulary.categories.length, ldcs: vocabulary.ldcs.length, placeholder: vocabulary.placeholder },
    }));
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
    response.set("Cache-Control", "no-store").json(policies.active());
  });

  router.get("/policy/draft", (_request, response) => {
    let draft;
    try { draft = policies.draft(); }
    catch (error) {
      response.status(422).json({ error: "invalid_draft", message: error instanceof Error ? error.message : "Invalid draft." });
      return;
    }
    if (!draft) {
      response.status(404).json({
        error: "not_found",
        message: "No draft policy exists.",
      });
      return;
    }
    response.set("Cache-Control", "no-store").json(draft);
  });

  router.post(["/policy/generate", "/policy/approve"], (request, response, next) => {
    if (!enabled) response.status(404).json({ error: "countersign_disabled", message: "Use the governed portal for policy management." });
    else if (!response.locals.user) response.status(401).json({ error: "login_required", message: "Sign in at /login before managing policy." });
    else if (!request.is("application/json")) response.status(415).json({ error: "json_required", message: "Send a JSON request." });
    else if (request.get("origin") && request.get("origin") !== RP.origin) response.status(403).json({ error: "origin_mismatch", message: "Use http://localhost:3000." });
    else next();
  });

  router.post("/policy/generate", async (_request, response) => {
    if (generating) {
      response.status(409).json({ error: "generation_in_progress", message: "A policy draft is already being generated." });
      return;
    }
    generating = true;
    try {
      const result = await generatePolicy({ store: policies });
      response.json({ ok: true, draft_version: result.draft.version, ...result.metadata });
    } catch (error) {
      response.status(502).json({ error: "generation_failed", message: error instanceof Error ? error.message : "Policy generation failed." });
    } finally { generating = false; }
  });

  router.post("/policy/approve", (request, response) => {
    try {
      if (!isRecord(request.body)) throw new PolicyError("invalid_selection", "Send an approval object.");
      response.json(policies.approve(request.body));
    } catch (error) {
      response.status(error instanceof PolicyError ? error.status : 422).json({
        error: error instanceof PolicyError ? error.code : "invalid_draft",
        message: error instanceof Error ? error.message : "Policy approval failed.",
      });
    }
  });

  return router;
}
