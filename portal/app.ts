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
import { WebAuthnService, type GovernedAction, type WebAuthnOptions } from "../countersign/server/webauthn.js";
import { portalOrigin } from "../countersign/server/origin.js";
import { icon, renderHero, renderShell, type PageId } from "../countersign/server/ui.js";

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
  active: PageId,
  title: string,
  body: string,
  enabled: boolean,
  footer = "Synthetic demonstration data only.",
): string {
  const scripts = enabled
    ? `<script src="/assets/vendor/simplewebauthn-browser.umd.min.js"></script>
       <script type="module" src="/assets/countersign.js"></script>`
    : "";
  return renderShell({ active, title, body, enabled, footer, scripts });
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
  const origin = portalOrigin(enabled);
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
    const destination = (route: string) => response.locals.user ? route : "#demo-users";
    const choices = students
      .map(
        (student) => `<form method="post" action="/login" class="panel user-card${student.id === demoUserId ? " is-featured" : ""}">
          <input type="hidden" name="user_id" value="${escapeHtml(student.id)}">
          <div class="user-name"><strong>${escapeHtml(student.name)}</strong>${student.id === demoUserId ? '<span class="badge badge-success">Start here</span>' : '<span class="badge">Seeded peer</span>'}</div>
          <small>${escapeHtml(student.id)} &middot; ${escapeHtml(student.email)}</small>
          <button type="submit" class="${student.id === demoUserId ? "button-primary" : "button-secondary"}">Continue as ${escapeHtml(student.name)}</button>
        </form>`,
      )
      .join("");
    response
      .type("html")
      .send(
        page(
          "home", "Demo home",
          `${renderHero({ eyebrow: "Countersign / interactive demonstration", title: "Explore the demo",
            description: "Try a quiz, publish a discussion response, or open a protected record. See how Countersign verifies human presence and records what happened.",
            icon: "shield", meta: enabled ? "Governed experience · fresh presence checks enabled" : "Baseline experience · presence checks disabled" })}
           <div class="section-heading"><div><p class="eyebrow">01 / The demo portal</p><h2>Explore the demo activities</h2></div><p>These activities make up the example app.</p></div>
           <div class="activity-grid" id="demo-activities">
             <section class="panel activity-card"><div class="activity-icon">${icon("quiz")}</div><h3>Quiz demo</h3><span class="badge">Require the human</span><p>A five-question assessment. ${enabled ? "Submitting requires a fresh human-presence check." : "Submit without a human-presence check in this baseline."}</p><a href="${destination("/quiz/1")}">Explore the quiz ${icon("arrow")}</a></section>
             <section class="panel activity-card"><div class="activity-icon">${icon("discussion")}</div><h3>Discussion demo</h3><span class="badge badge-purple">Record the disclosure</span><p>${enabled ? "Choose Own work or AI-assisted, then verify presence to publish. Your disclosure is saved with the action’s evidence." : "Publish a response without a presence check or authorship disclosure in this baseline."}</p><a href="${destination("/discussion/2")}">Explore the discussion ${icon("arrow")}</a></section>
             <section class="panel activity-card"><div class="activity-icon">${icon("record")}</div><h3>Protected record demo</h3><span class="badge">Protect the data</span><p>${enabled ? "Synthetic sensitive fields stay masked until a human verifies presence for this view." : "Read the synthetic fields immediately, without the governed view’s presence check."}</p><a href="${destination("/record/1")}">Explore the record ${icon("arrow")}</a></section>
           </div>
           <div class="section-heading" id="demo-users"><div><p class="eyebrow">02 / Enter the example app</p><h2>Choose a demo user</h2></div><p>Synthetic identities only. No password required.</p></div>
           <p class="form-note">Start with Capt J. Demo for a fresh discussion. ${enabled ? "First-time users will set up a passkey before opening the quiz." : "This baseline skips passkey setup and governance."} The password-free chooser is provided for this demonstration.</p>
           <div class="user-grid">${choices}</div>
           <section class="panel console-intro"><div class="section-heading"><div><p class="eyebrow">03 / The Countersign console</p><h2>Review activity and policy</h2></div>${icon("timeline")}</div><p class="muted">Use the console to inspect action records and review the rules governing the demo portal.</p><div class="action-row"><a class="button button-secondary" href="/countersign/">Open activity log ${icon("arrow")}</a><a class="button button-secondary" href="/countersign/policy/review">Review policies ${icon("policy")}</a></div></section>`,
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
    response.type("html").send(page("register", "Passkey setup", `
      ${renderHero({ eyebrow: "Demo portal / one-time setup", title: "Passkey setup", description: "Register a passkey in the browser you will use for the demo. Your device handles the fingerprint or PIN check. Your biometric data stays on the device.", icon: "key" })}
      <div class="setup-layout"><section class="panel"><span class="panel-label">${icon("key")}Your countersign</span><h2>Register a passkey for ${escapeHtml(user.name)}</h2>
        <p class="muted">Use Touch ID on this Mac to register in the browser profile you will use for the demo.</p>
        <form data-countersign-register><button type="submit" class="button-primary">Register passkey with Touch ID</button><p role="status" data-countersign-status></p></form>
        <p class="form-note">If your passkey is unavailable in another browser, register an additional one here.</p>
      </section><aside class="panel"><p class="eyebrow">What happens next</p><h2>Using your passkey</h2><ol class="steps"><li>Register this browser’s passkey using your device prompt.</li><li>Complete a demo activity as you normally would.</li><li>Verify your presence when the policy requires it.</li></ol><a href="/login">Back to demo home</a></aside></div>`, enabled));
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
          "quiz", "Quiz demo",
          `${renderHero({ eyebrow: "Demo portal / 01 · Require the human", title: "Quiz demo", description: enabled
            ? "Complete the assessment. Submitting on the governed instance requires a fresh human-presence check through your device."
            : "The same assessment, without a presence check. Use this baseline to compare what changes when Countersign is enabled.", icon: "quiz", meta: enabled ? "Human-required submission" : "Baseline · no presence check" })}
           <div class="reading-column"><section class="panel"><span class="panel-label">Source-based assessment</span><h2 class="source-heading" data-source-title>${escapeHtml(quiz.title)}</h2>
           <p class="notice source-notice" data-source-notice>${escapeHtml(quiz.notice)}</p></section>
            <form class="quiz-form" method="post" action="/quiz/1/submit" ${presenceAttributes(enabled, quizAction, response.locals.user, readPolicy)}>
             ${questions}
             <div class="panel"><div class="action-row"><button type="submit" class="button-primary">Submit quiz ${icon("arrow")}</button><p>${enabled ? "Your device will ask you to verify presence." : "This baseline submits without human verification."}</p></div>
             <p role="status" data-countersign-status></p>
             </div></form></div>`,
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
          "quiz", "Quiz submitted",
          `${renderHero({ eyebrow: "Demo portal / submission complete", title: "Quiz submitted", description: "Your submission was accepted.", icon: "check" })}
           <section class="panel"><h2>${response.locals.presence ? "Human presence verified" : "Baseline submission complete"}</h2><p class="muted">${response.locals.presence ? "A fresh presence assertion is attached to this governed action. Inspect the activity log to see the evidence." : "No presence proof was required on this ungoverned instance."}</p><div class="action-row"><a class="button button-primary" href="/discussion/2">Try the discussion ${icon("arrow")}</a><a class="button button-secondary" href="/countersign/">Open activity log</a><a href="/quiz/1">Back to quiz</a></div></section>`,
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
          <button type="submit" class="button-danger">Reset discussion demo</button>
        </form>
      </details>` : "";
      const postMarkup = hasPosted
        ? posts
            .filter((post) => post.post_id !== forum.faculty_prompt_post_id)
            .map(
              (post) => `<article id="${escapeHtml(post.post_id)}" data-post-id="${escapeHtml(post.post_id)}">
                <h2>${escapeHtml(post.subject)}</h2>
                <p class="post-meta"><strong>${escapeHtml(post.author)}</strong><span aria-hidden="true">&middot;</span><time>${escapeHtml(post.timestamp)}</time></p>
                ${enabled ? postProvenance(post.provenance) : ""}
                <p class="forum-text">${escapeHtml(post.body)}</p>
              </article>`,
            )
            .join("")
        : '<p class="notice">Peer posts are hidden until you publish your initial response.</p>';
      const form = hasPosted
        ? ""
        : `<form method="post" action="/discussion/2/post" class="panel discussion-composer" ${presenceAttributes(enabled, discussionAction, user, readPolicy)}>
            <span class="panel-label">${icon("discussion")}Your contribution</span><h2>Write an initial response</h2>
            <p class="form-note">Publish an initial response to unlock the peer discussion.</p>
            <label for="body"><strong>Your initial response</strong></label>
            <textarea id="body" name="body" required placeholder="Write your response to the discussion prompt…"></textarea>
            ${enabled ? `<div class="attestation-control"><label for="discussion-attestation">How was this response prepared?</label>
              <select id="discussion-attestation" name="countersign[attestation]" data-countersign-attestation required aria-describedby="attestation-help">
                <option value="" disabled selected>Choose a disclosure</option><option value="own-work">Own work</option><option value="ai-assisted">AI-assisted</option>
              </select><p id="attestation-help" class="form-note">Choose the description that matches how you prepared this response. This disclosure is recorded with your presence check.</p></div>` : ""}
            <button type="submit" class="button-primary">Publish response ${icon("arrow")}</button>
            <p role="status" data-countersign-status></p>
          </form>`;
      response.type("html").send(
        page(
          "discussion", "Discussion demo",
           `${renderHero({ eyebrow: "Demo portal / 02 · Record the disclosure", title: "Discussion demo", description: enabled
             ? "Write a response and choose Own work or AI-assisted. Publishing requires a presence check; the activity log records your disclosure and the verification evidence."
             : "Publish a response without a presence check or authorship disclosure. This is the ungoverned baseline of the same discussion.", icon: "discussion", meta: enabled ? "Disclosure recorded with verified presence" : "Baseline · no attestation ceremony" })}
            ${_request.query.reset === "1" && !hasPosted ? '<p class="notice" role="status">Discussion demo reset. Submit a new initial response to reveal peers again.</p>' : ""}
            <div class="${hasPosted ? "reading-column" : "setup-layout"}"><section class="panel"><span class="panel-label">Discussion prompt</span><h2 class="source-heading" data-source-title>${escapeHtml(forum.title)}</h2><p class="forum-text">${escapeHtml(forum.faculty_prompt)}</p></section>${form}</div>
            <div class="reading-column">${enabled ? '<p class="notice">Presence verification confirms a human was present at submission. Authorship disclosures and composition signals are recorded separately.</p>' : ""}
            <section><div class="section-heading"><div><p class="eyebrow">The conversation</p><h2>Peer discussion</h2></div><p>${hasPosted ? "Initial response recorded · peer discussion available" : "Peer posts become available after you publish."}</p></div>${postMarkup}</section>
            ${resetControls}</div>`,
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
    if (request.get("origin") && request.get("origin") !== origin) {
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
          "record", "Protected record demo",
          `${renderHero({ eyebrow: "Demo portal / 03 · Protect the data", title: "Protected record demo", description: enabled
            ? "These synthetic fields stay masked until a human verifies presence for this view. Try the ungoverned instance to compare access without that check."
            : "This baseline exposes the synthetic record to the session, without requiring a fresh human-presence check.", icon: "record", meta: enabled ? "Masked by default · fresh verification to reveal" : "Baseline · fields visible without verification" })}
           <p class="notice">All values on this page are fabricated.</p>
           <div class="record-layout"><section class="panel"><span class="panel-label">${icon("record")}Synthetic student record</span><h2>Protected information</h2>
           <dl class="record" ${enabled ? 'data-protected-record' : ""}>
             <dt>Name</dt><dd data-field="name" data-marking="${escapeHtml(markingFor(rule, "name"))}" data-categories="PII">${value(student.name)}</dd>
             <dt>SSN</dt><dd data-field="ssn" data-marking="${escapeHtml(markingFor(rule, "ssn"))}" data-categories="PII">${value(student.ssn)}</dd>
             <dt>DoD ID</dt><dd data-field="dod-id" data-marking="${escapeHtml(markingFor(rule, "dod-id"))}" data-categories="PII">${value(student.dod_id)}</dd>
             <dt>Medical / limited-duty note</dt><dd data-field="medical" data-marking="${escapeHtml(markingFor(rule, "medical"))}" data-categories="PHI">${value(student.medical_note)}</dd>
           </dl></section>
           ${enabled ? `<aside class="panel record-aside"><div class="activity-icon">${icon("key")}</div><h2>Verify to view this record</h2>
             <p role="status" data-record-status>Protected information (PII, PHI, and CUI-marked content) is hidden by default. Human authentication is required to view it.</p>
             <div class="action-row"><button type="button" class="button-primary" data-record-reveal>Verify presence to view</button><button type="button" class="button-secondary" data-record-register>Register a passkey</button></div>
             <p class="form-note">A fresh check is required after hiding or reloading this view. Verification does not grant permanent access.</p>
           </aside>` : `<aside class="panel"><span class="badge badge-warning">Governance off</span><h2>Ungoverned record access</h2><p class="muted">The four fabricated fields are readable immediately. On the governed instance, a human must verify presence to view them.</p><a class="button button-secondary" href="${escapeHtml(portalOrigin(true))}/record/1">Open governed record ${icon("arrow")}</a></aside>`}</div>`,
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
