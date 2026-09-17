import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import { governedPageVisit, governedSubmission } from "../countersign/server/middleware.js";
import { matchRule, requiresPresence } from "../countersign/server/policy.js";
import { createCountersignRouter } from "../countersign/server/routes.js";
import { createRecordGovernance, type RecordOptions } from "../countersign/server/records.js";
import { appendProvenanceEvent } from "../countersign/server/log.js";
import type { CountersignPolicy, PolicyRule, PortalUser, SubmissionProvenance } from "../countersign/server/types.js";
import { PolicyStore, type PolicyStorePaths } from "../countersign/server/policy-store.js";
import { RP, WebAuthnService, type GovernedAction, type WebAuthnOptions } from "../countersign/server/webauthn.js";

interface Student extends PortalUser {
  email: string;
  ssn: string;
  dod_id: string;
  medical_note: string;
}

interface QuizQuestion {
  id: string;
  prompt: string;
  options: Record<string, string>;
  source_ref: string;
}

interface QuizFixture {
  id: string;
  title: string;
  notice: string;
  questions: QuizQuestion[];
}

interface ForumPost {
  post_id: string;
  ifd: number;
  parent_id: string | null;
  depth: number;
  user_id: string;
  author: string;
  timestamp: string;
  subject: string;
  body: string;
  provenance?: SubmissionProvenance;
}

interface ForumFixture {
  id: string;
  ifd: number;
  title: string;
  faculty_prompt: string;
  faculty_prompt_post_id: string;
  synthetic_data_notice: string;
  roster: Array<{ user_id: string; name: string; tier: string }>;
  posts: ForumPost[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as T;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(
  title: string,
  body: string,
  enabled: boolean,
  footer = "Synthetic demonstration data only.",
): string {
  const scripts = enabled
    ? `<script src="/assets/vendor/simplewebauthn-browser.umd.min.js"></script>
       <script type="module" src="/assets/countersign.js"></script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - MCU Learning Portal</title>
  <style>
    :root { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; overflow-wrap: anywhere; color: #1c2720; background: #ede9dc; }
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; }
    header { background: #24382b; color: #f8f3e2; padding: 1rem max(1rem, calc((100% - 960px) / 2)); }
    nav { margin-top: .65rem; display: flex; flex-wrap: wrap; gap: 1rem; }
    nav a { color: #e4d28d; }
    main { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 3rem; }
    article, fieldset, .panel { min-width: 0; background: #fffdf6; border: 1px solid #bbb6a7; padding: 1rem; margin: 0 0 1rem; }
    fieldset { min-inline-size: 0; padding: 1.25rem; }
    legend { max-width: 100%; padding: 0 .25rem; font-weight: bold; }
    .quiz-question { padding: 1.25rem; }
    .quiz-question > fieldset { border: 0; padding: 0; margin: 0; background: transparent; }
    .quiz-question legend { padding: 0; margin-bottom: .75rem; }
    label { display: block; margin: .55rem 0; }
    .quiz-option { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: .6rem; }
    .quiz-option input { margin: .35em 0 0; }
    fieldset small { display: block; margin-top: 1rem; }
    button, textarea, select { max-width: 100%; font: inherit; }
    textarea { width: 100%; min-height: 12rem; padding: .75rem; }
    button { padding: .65rem 1rem; background: #24382b; color: white; border: 0; cursor: pointer; }
    .mode { float: right; font-family: ui-monospace, monospace; color: #e4d28d; }
    .notice { border-left: .35rem solid #a16c20; padding: .75rem 1rem; background: #fff7dc; }
    .provenance-tag { display: inline-block; border: 1px solid #bbb6a7; padding: .2rem .45rem; margin: 0 .4rem .4rem 0; font-family: sans-serif; font-size: .85rem; }
    .post-provenance details { margin: .35rem 0 1rem; overflow-wrap: anywhere; }
    .forum-text { max-width: 75ch; white-space: pre-wrap; }
    .record dt { font-weight: bold; margin-top: .8rem; }
    .record dd { margin: .2rem 0 .7rem; }
    [data-marking] { outline: 1px dotted #8a5c13; outline-offset: .15rem; }
    footer { padding: 1rem; text-align: center; background: #ddd6c4; font-size: .9rem; }
    footer p { max-width: 75ch; margin: 0 auto; }
    @media (max-width: 600px) { main { padding-top: 1rem; } .mode { float: none; display: block; margin-bottom: .5rem; } }
  </style>
</head>
<body>
  <header>
    <span class="mode">COUNTERSIGN=${enabled ? "on" : "off"}</span>
    <strong>MCU Learning Portal</strong>
    <nav>
      <a href="/quiz/1">Quiz</a>
      <a href="/discussion/2">Discussion</a>
       <a href="/record/1">Student record</a>
      ${enabled ? '<a href="/register">Register passkey</a>' : ""}
      <a href="/countersign/">Countersign</a>
      <a href="/login">Switch user</a>
    </nav>
  </header>
  <main>${body}</main>
  <footer><p>${escapeHtml(footer)}</p></footer>
  ${scripts}
</body>
</html>`;
}

function requireUser(): RequestHandler {
  return (request, response, next) => {
    if (response.locals.user) {
      next();
      return;
    }
    if (request.accepts("html")) {
      response.redirect(303, "/login");
      return;
    }
    response.status(401).json({ error: "login_required", message: "Choose a demo user." });
  };
}

function markingFor(rule: PolicyRule | undefined, field: string): string {
  return (
    rule?.markings?.find((item) => item.selector === `[data-field=${field}]`)
      ?.marking ?? ""
  );
}

function presenceAttributes(enabled: boolean, action: GovernedAction, user: PortalUser, readPolicy: () => CountersignPolicy): string {
  if (!enabled) return "";
  const rule = matchRule(action.route, action.action, action.context?.(user), readPolicy());
  if (!requiresPresence(rule)) return "";
  return `data-countersign-rule="${escapeHtml(rule.id)}" data-countersign-class="${escapeHtml(rule.class)}" data-countersign-action="${escapeHtml(action.action)}"`;
}

function postProvenance(provenance: SubmissionProvenance | undefined): string {
  if (!provenance) return '<p class="post-provenance" data-provenance="unrecorded">Provenance not recorded.</p>';
  const actorLabels: Record<SubmissionProvenance["actor_class"], string> = {
    "human-verified": "Human presence verified at submit",
    "agent-declared": "Agent declared; presence not verified",
    "automation-suspected": "Automation suspected; presence not verified",
    "unverified": "Presence not verified",
  };
  const disclosure = provenance.attestation === "ai-assisted" ? "AI-assisted (disclosed)"
    : provenance.attestation === "own-work" ? "Own work (declared)" : "AI use not attested";
  const proof = provenance.presence;
  return `<section class="post-provenance" aria-label="Submission provenance" data-actor-class="${escapeHtml(provenance.actor_class)}" data-attestation="${escapeHtml(provenance.attestation ?? "")}">
    <span class="provenance-tag" data-disclosure>${disclosure}</span>
    <span class="provenance-tag" data-presence-status>${actorLabels[provenance.actor_class]}</span>
    ${provenance.review_flags.length ? `<aside class="notice" data-review-flag>
      <strong>Flagged for review</strong>
      <ul>${provenance.review_flags.map((flag) => `<li>${escapeHtml(flag.notes)}</li>`).join("")}</ul>
      <p>Published for faculty review. Composition signals do not establish authorship.</p>
    </aside>` : ""}
    <details>
      <summary>Provenance details</summary>
      <p>Actor class: <code>${escapeHtml(provenance.actor_class)}</code></p>
      <p>Submission event: <code>${escapeHtml(provenance.event_id)}</code></p>
      ${proof ? `<p>Assertion: <code>${escapeHtml(proof.assertion_id)}</code><br>
        UP: ${proof.up}; UV: ${proof.uv}; age at submission: ${proof.age_ms} ms</p>` : ""}
      ${provenance.review_flags.map((flag) => `<p>Review event (${escapeHtml(flag.decision)}): <code>${escapeHtml(flag.event_id)}</code></p>`).join("")}
    </details>
  </section>`;
}

export interface AppOptions extends WebAuthnOptions {
  countersignEnabled?: boolean;
  sessionSecret?: string;
  recordOptions?: Pick<RecordOptions, "credentialsPath" | "writeEvent">;
  provenancePath?: string;
  policyPaths?: Partial<PolicyStorePaths>;
}

export function createApp(options: AppOptions = {}): express.Express {
  const enabled =
    options.countersignEnabled ?? process.env.COUNTERSIGN !== "off";
  const sessionSecret =
    options.sessionSecret || process.env.SESSION_SECRET || randomUUID();
  const students = readJson<Student[]>("portal/data/students.json");
  const quiz = readJson<QuizFixture>("portal/data/quiz.json");
  const forum = readJson<ForumFixture>("portal/data/forum.json");
  const posts = [...forum.posts];
  const postedUsers = new Set(posts.map((post) => post.user_id));
  const seededPostIds = new Set(posts.map((post) => post.post_id));
  const demoUserId = "stu-0011";
  const resetInstance = randomUUID();
  let discussionGeneration = 0;
  let discussionResetting = false;
  const resetToken = (sessionId: string) => createHmac("sha256", sessionSecret)
    .update(JSON.stringify([resetInstance, enabled, sessionId, discussionGeneration, "discussion-demo-reset"]))
    .digest("base64url");
  const webAuthn = new WebAuthnService({
    ...options, credentialsPath: options.credentialsPath ?? options.recordOptions?.credentialsPath,
  });
  const policies = new PolicyStore(options.policyPaths);
  const readPolicy = () => policies.active();
  const services = { webAuthn, policies, provenancePath: options.provenancePath };
  const quizAction: GovernedAction = { route: "/quiz/1", action: "POST /quiz/1/submit" };
  const discussionAction: GovernedAction = {
    route: "/discussion/2", action: "POST /discussion/2/post",
    context: (user) => ({ is_initial_post: !postedUsers.has(user.id) }),
  };
  // Cookies are hostname-scoped, not port-scoped. Keep the two demos isolated.
  const cookiePrefix = enabled ? "countersign" : "countersign_off";
  const app = express();
  const records = createRecordGovernance({
    ...options.recordOptions,
    webAuthn,
    readPolicy,
    writeEvent: options.recordOptions?.writeEvent ?? ((event) => appendProvenanceEvent(event, options.provenancePath)),
    enabled,
    fieldsForUser(userId) {
      const student = students.find((candidate) => candidate.id === userId)!;
      return { name: student.name, ssn: student.ssn, "dod-id": student.dod_id, medical: student.medical_note };
    },
  });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(sessionSecret));
  app.use((request, response, next) => {
    const userId = request.signedCookies[`${cookiePrefix}_user`] as
      | string
      | undefined;
    const sessionId = request.signedCookies[`${cookiePrefix}_session`] as
      | string
      | undefined;
    const user = students.find((candidate) => candidate.id === userId);
    if (user && sessionId) {
      response.locals.user = { id: user.id, name: user.name } satisfies PortalUser;
      response.locals.sessionId = sessionId;
    }
    next();
  });

  app.use(
    "/assets",
    express.static(resolve(process.cwd(), "countersign/client")),
  );
  app.use("/countersign", records.router, createCountersignRouter(enabled, services, [quizAction, discussionAction]));

  app.get("/", (_request, response) => response.redirect(302, "/login"));

  app.get("/login", (_request, response) => {
    const choices = students
      .map(
        (student) => `<form method="post" action="/login" class="panel">
          <input type="hidden" name="user_id" value="${escapeHtml(student.id)}">
          <strong>${escapeHtml(student.name)}</strong><br>
          <small>${escapeHtml(student.id)} &middot; ${escapeHtml(student.email)}</small><br><br>
          <button type="submit">Continue as ${escapeHtml(student.name)}</button>
        </form>`,
      )
      .join("");
    response
      .type("html")
      .send(
        page(
          "Fake SSO login",
          `<h1>Choose a synthetic user</h1><p>No password is required for this mock portal.</p>${choices}`,
          enabled,
        ),
      );
  });

  app.post("/login", (request, response) => {
    const user = students.find((candidate) => candidate.id === request.body.user_id);
    if (!user) {
      response.status(400).json({ error: "unknown_user", message: "Unknown demo user." });
      return;
    }
    const cookieOptions = {
      signed: true,
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
    };
    response.cookie(`${cookiePrefix}_user`, user.id, cookieOptions);
    response.cookie(`${cookiePrefix}_session`, `sess_${randomUUID()}`, cookieOptions);
    response.redirect(303, enabled && webAuthn.credentials.forUser(user.id).length === 0 ? "/register" : "/quiz/1");
  });

  app.get("/register", requireUser(), (_request, response) => {
    if (!enabled) {
      response.redirect(303, "/quiz/1");
      return;
    }
    const user = response.locals.user as PortalUser;
    response.type("html").send(page("Register passkey", `
      <h1>Register a passkey for ${escapeHtml(user.name)}</h1>
      <p>Use Touch ID on this Mac to register in the browser profile you will use for the demo.</p>
      <p>If your passkey is unavailable in another browser, register an additional one here.</p>
      <form data-countersign-register>
        <button type="submit">Register passkey with Touch ID</button>
        <p role="status" data-countersign-status></p>
      </form>`, enabled));
  });

  app.get(
    "/quiz/1",
    requireUser(),
    governedPageVisit(enabled, options.provenancePath),
    (_request, response) => {
      // Paint the card outside the fieldset so its accessible legend sits inside
      // the padding instead of straddling the fieldset's native top border.
      const questions = quiz.questions
        .map(
          (question, index) => `<div class="panel quiz-question"><fieldset>
            <legend>${index + 1}. ${escapeHtml(question.prompt)}</legend>
            ${Object.entries(question.options)
              .map(
                ([value, label]) => `<label class="quiz-option"><input required type="radio" name="answers[${escapeHtml(question.id)}]" value="${escapeHtml(value)}"> <span>${escapeHtml(label)}</span></label>`,
              )
              .join("")}
            <small>Source: ${escapeHtml(question.source_ref)}</small>
          </fieldset></div>`,
        )
        .join("");
      response.type("html").send(
        page(
          quiz.title,
          `<h1>${escapeHtml(quiz.title)}</h1>
           <p class="notice">${escapeHtml(quiz.notice)}</p>
            <form method="post" action="/quiz/1/submit" ${presenceAttributes(enabled, quizAction, response.locals.user, readPolicy)}>
             ${questions}
             <button type="submit">Submit quiz</button>
             <p role="status" data-countersign-status></p>
           </form>`,
          enabled,
        ),
      );
    },
  );

  app.post(
    "/quiz/1/submit",
    requireUser(),
    ...governedSubmission(enabled, quizAction, services),
    (request, response) => {
      if (request.is("application/json")) {
        response.json({
          ok: true,
          message: response.locals.presence ? "Quiz submitted. Human presence verified." : "Quiz submitted.",
          assertion_id: response.locals.presence?.assertion_id ?? null,
        });
        return;
      }
      response.type("html").send(
        page(
          "Quiz submitted",
          "<h1>Quiz submitted</h1><p>Your submission was accepted.</p>",
          enabled,
        ),
      );
    },
  );

  app.get(
    "/discussion/2",
    requireUser(),
    governedPageVisit(enabled, options.provenancePath),
    (_request, response) => {
      const user = response.locals.user as PortalUser;
      response.set("Cache-Control", "no-store");
      const hasPosted = postedUsers.has(user.id);
      const resetControls = user.id === demoUserId ? `<details class="panel" data-demo-controls>
        <summary>Demo controls</summary>
        <p>Reset Capt J. Demo's discussion on this ${enabled ? "governed" : "ungoverned"} instance for another rehearsal.
        This removes only this student's runtime-added responses and hides peers again on reload.
        Seeded posts, passkeys, and audit history are retained. A reset entry is added to the audit.</p>
        <form method="post" action="/discussion/2/reset">
          <input type="hidden" name="reset_token" value="${escapeHtml(resetToken(response.locals.sessionId))}">
          <label><input type="checkbox" name="confirmation" value="reset-discussion" required> I want to reset this discussion demo.</label>
          <button type="submit">Reset discussion demo</button>
        </form>
      </details>` : "";
      const postMarkup = hasPosted
        ? posts
            .filter((post) => post.post_id !== forum.faculty_prompt_post_id)
            .map(
              (post) => `<article id="${escapeHtml(post.post_id)}" data-post-id="${escapeHtml(post.post_id)}">
                <h2>${escapeHtml(post.subject)}</h2>
                <p><strong>${escapeHtml(post.author)}</strong> &middot; <time>${escapeHtml(post.timestamp)}</time></p>
                ${enabled ? postProvenance(post.provenance) : ""}
                <p class="forum-text">${escapeHtml(post.body)}</p>
              </article>`,
            )
            .join("")
        : '<p class="notice">Peer posts are hidden until you publish your initial response (independent_first).</p>';
      const form = hasPosted
        ? ""
        : `<form method="post" action="/discussion/2/post" ${presenceAttributes(enabled, discussionAction, user, readPolicy)}>
            <label for="body"><strong>Your initial response</strong></label>
            <textarea id="body" name="body" required></textarea>
            <button type="submit">Publish response</button>
            <p role="status" data-countersign-status></p>
          </form>`;
      response.type("html").send(
        page(
          forum.title,
           `<h1>${escapeHtml(forum.title)}</h1>
            <section class="panel"><h2>Faculty prompt</h2><p class="forum-text">${escapeHtml(forum.faculty_prompt)}</p></section>
            ${enabled ? '<p class="notice">Presence verification confirms a human was present at submission. Authorship disclosures and composition signals are recorded separately.</p>' : ""}
            ${_request.query.reset === "1" && !hasPosted ? '<p class="notice" role="status">Discussion demo reset. Submit a new initial response to reveal peers again.</p>' : ""}
            ${resetControls}
            ${form}
           <section><h2>Peer discussion</h2>${postMarkup}</section>`,
          enabled,
          forum.synthetic_data_notice,
        ),
      );
    },
  );

  app.post(
    "/discussion/2/post",
    requireUser(),
    (_request, response, next) => {
      if (response.locals.user.id === demoUserId && discussionResetting) {
        response.status(409).json({ error: "discussion_reset", message: "Discussion reset is in progress. Reload and try again." });
        return;
      }
      response.locals.discussionGeneration = discussionGeneration;
      next();
    },
    ...governedSubmission(enabled, discussionAction, services),
    (request, response) => {
      const user = response.locals.user as PortalUser;
      // Governance/logging can await I/O. A pre-reset request must not publish
      // into the next run, including one that matched unrestricted before reset.
      if (user.id === demoUserId && (discussionResetting || response.locals.discussionGeneration !== discussionGeneration)) {
        response.status(409).json({ error: "discussion_reset", message: "Discussion was reset. Reload and submit a new initial response." });
        return;
      }
      const body = typeof request.body.body === "string" ? request.body.body.trim() : "";
      if (!body) {
        response.status(400).json({ error: "body_required", message: "Post body is required." });
        return;
      }
      const post: ForumPost = {
        post_id: `post_${randomUUID()}`,
        ifd: 2,
        parent_id: null,
        depth: 0,
        user_id: user.id,
        author: user.name,
        timestamp: new Date().toISOString(),
        subject: "Initial response",
        body,
        // Only the middleware's logged result is authoritative. Never accept
        // provenance badges or review flags supplied in the request body.
        provenance: response.locals.submissionProvenance,
      };
      posts.push(post);
      postedUsers.add(user.id);
      // A fragment-only change would leave the pre-publication DOM in place.
      const redirect = `/discussion/2?posted=${post.post_id}#${post.post_id}`;
      if (request.is("application/json")) {
        response.json({
          ok: true,
          post_id: post.post_id,
          message: "Discussion response published.",
          redirect,
          provenance: post.provenance ?? null,
        });
        return;
      }
      response.redirect(303, redirect);
    },
  );

  app.post("/discussion/2/reset", requireUser(), async (request, response) => {
    response.set("Cache-Control", "no-store");
    const user = response.locals.user as PortalUser;
    if (user.id !== demoUserId) {
      response.status(403).json({ error: "demo_user_required", message: "Only Capt J. Demo's rehearsal response can be reset." });
      return;
    }
    if (request.get("origin") && request.get("origin") !== (enabled ? RP.origin : "http://localhost:3001")) {
      response.status(403).json({ error: "origin_mismatch", message: "Reset from this portal instance's discussion page." });
      return;
    }
    if (!request.is("application/json") && !request.is("application/x-www-form-urlencoded")) {
      response.status(415).json({ error: "unsupported_content_type" });
      return;
    }
    const supplied = Buffer.from(typeof request.body?.reset_token === "string" ? request.body.reset_token : "");
    const expected = Buffer.from(resetToken(response.locals.sessionId));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.status(403).json({ error: "invalid_reset_token", message: "Reload the discussion page before resetting." });
      return;
    }
    if (request.body?.confirmation !== "reset-discussion") {
      response.status(400).json({ error: "confirmation_required", message: "Confirm the demo reset." });
      return;
    }
    if (discussionResetting) {
      response.status(409).json({ error: "reset_in_progress", message: "A reset is already in progress." });
      return;
    }
    discussionResetting = true;
    try {
      const removed = posts.filter(post => post.user_id === demoUserId && !seededPostIds.has(post.post_id));
      // Administrative reset is audited even with COUNTERSIGN=off. Record first:
      // a failed write must never silently remove the rehearsal's visible state.
      await appendProvenanceEvent({
        session_id: response.locals.sessionId, user, route: "/discussion/2", action: "POST /discussion/2/reset",
        rule_id: "demo-discussion-reset", class: "unrestricted", decision: "allowed",
        actor_class: "unverified",
        presence: null, attestation: null, signals: { score: 0, flags: [] }, telemetry: null, form_hash: null,
        notes: `Demo discussion reset; COUNTERSIGN=${enabled ? "on" : "off"}; removed_posts=${removed.length}; removed_post_ids=${JSON.stringify(removed.map(post => post.post_id))}. Passkeys and prior audit retained.`,
      }, options.provenancePath);
      webAuthn.revokeActionChallenges(demoUserId, discussionAction.action);
      discussionGeneration++;
      for (let index = posts.length - 1; index >= 0; index--) {
        if (posts[index].user_id === demoUserId && !seededPostIds.has(posts[index].post_id)) posts.splice(index, 1);
      }
      if (posts.some(post => post.user_id === demoUserId)) postedUsers.add(demoUserId);
      else postedUsers.delete(demoUserId);
      const redirect = "/discussion/2?reset=1";
      if (request.is("application/json")) response.json({ ok: true, removed_posts: removed.length, redirect });
      else response.redirect(303, redirect);
    } catch {
      response.status(500).json({ error: "reset_not_recorded", message: "Reset could not be recorded. No posts were removed; try again." });
    } finally {
      discussionResetting = false;
    }
  });

  app.get(
    "/record/1",
    requireUser(),
    records.visit,
    (_request, response) => {
      const student = students.find((candidate) => candidate.id === response.locals.user.id)!;
      const rule = matchRule("/record/1", "GET /record/1", {}, readPolicy());
      const value = (raw: string) => enabled ? "[Hidden — verify presence to view]" : escapeHtml(raw);
      response.type("html").send(
        page(
          "Student record",
          `<h1>Student record</h1>
           <p class="notice">All values on this page are fabricated.</p>
           ${enabled ? `<section class="notice">
              <p role="status" data-record-status>Protected information (PII, PHI, and CUI-marked content) is hidden by default. Human authentication is required to view it.</p>
             <button type="button" data-record-reveal>Verify presence to view</button>
             <button type="button" data-record-register>Register a passkey</button>
           </section>` : ""}
           <dl class="panel record" ${enabled ? 'data-protected-record' : ""}>
             <dt>Name</dt><dd data-field="name" data-marking="${escapeHtml(markingFor(rule, "name"))}" data-categories="PII">${value(student.name)}</dd>
             <dt>SSN</dt><dd data-field="ssn" data-marking="${escapeHtml(markingFor(rule, "ssn"))}" data-categories="PII">${value(student.ssn)}</dd>
             <dt>DoD ID</dt><dd data-field="dod-id" data-marking="${escapeHtml(markingFor(rule, "dod-id"))}" data-categories="PII">${value(student.dod_id)}</dd>
             <dt>Medical / limited-duty note</dt><dd data-field="medical" data-marking="${escapeHtml(markingFor(rule, "medical"))}" data-categories="PHI">${value(student.medical_note)}</dd>
           </dl>`,
          enabled,
        ),
      );
    },
  );

  app.use(
    (error: unknown, request: Request, response: Response, _next: NextFunction) => {
      console.error(error);
      if (request.accepts("json")) {
        response.status(500).json({
          error: "internal_error",
          message: "The scaffold could not complete the request.",
        });
        return;
      }
      response
        .status(500)
        .type("text")
        .send("The scaffold could not complete the request.");
    },
  );

  return app;
}
