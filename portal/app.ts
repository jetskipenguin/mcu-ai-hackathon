import { randomUUID } from "node:crypto";
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
import type { PolicyRule, PortalUser } from "../countersign/server/types.js";
import { WebAuthnService, type GovernedAction, type WebAuthnOptions } from "../countersign/server/webauthn.js";

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
}

interface ForumFixture {
  id: string;
  ifd: number;
  title: string;
  faculty_prompt: string;
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
    :root { font-family: Georgia, "Times New Roman", serif; color: #1c2720; background: #ede9dc; }
    body { margin: 0; }
    header { background: #24382b; color: #f8f3e2; padding: 1rem max(1rem, calc((100% - 960px) / 2)); }
    nav { margin-top: .65rem; display: flex; flex-wrap: wrap; gap: 1rem; }
    nav a { color: #e4d28d; }
    main { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 3rem; }
    article, fieldset, .panel { background: #fffdf6; border: 1px solid #bbb6a7; padding: 1rem; margin: 0 0 1rem; }
    fieldset { padding: 1.25rem; }
    label { display: block; margin: .55rem 0; }
    textarea { box-sizing: border-box; width: 100%; min-height: 12rem; padding: .75rem; }
    button { padding: .65rem 1rem; background: #24382b; color: white; border: 0; cursor: pointer; }
    .mode { float: right; font-family: ui-monospace, monospace; color: #e4d28d; }
    .notice { border-left: .35rem solid #a16c20; padding: .75rem 1rem; background: #fff7dc; }
    .record dt { font-weight: bold; margin-top: .8rem; }
    .record dd { margin: .2rem 0 .7rem; }
    [data-marking] { outline: 1px dotted #8a5c13; outline-offset: .15rem; }
    footer { padding: 1rem; text-align: center; background: #ddd6c4; font-size: .9rem; }
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
  <footer>${escapeHtml(footer)}</footer>
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

function presenceAttributes(enabled: boolean, action: GovernedAction, user: PortalUser): string {
  if (!enabled) return "";
  const rule = matchRule(action.route, action.action, action.context?.(user));
  if (!requiresPresence(rule)) return "";
  return `data-countersign-rule="${escapeHtml(rule.id)}" data-countersign-class="${escapeHtml(rule.class)}" data-countersign-action="${escapeHtml(action.action)}"`;
}

export interface AppOptions extends WebAuthnOptions {
  countersignEnabled?: boolean;
  sessionSecret?: string;
  recordOptions?: Pick<RecordOptions, "credentialsPath" | "writeEvent">;
  provenancePath?: string;
}

export function createApp(options: AppOptions = {}): express.Express {
  const enabled =
    options.countersignEnabled ?? process.env.COUNTERSIGN !== "off";
  const sessionSecret =
    options.sessionSecret ?? process.env.SESSION_SECRET ?? randomUUID();
  const students = readJson<Student[]>("portal/data/students.json");
  const quiz = readJson<QuizFixture>("portal/data/quiz.json");
  const forum = readJson<ForumFixture>("portal/data/forum.json");
  const posts = [...forum.posts];
  const postedUsers = new Set(posts.map((post) => post.user_id));
  const webAuthn = new WebAuthnService({
    ...options, credentialsPath: options.credentialsPath ?? options.recordOptions?.credentialsPath,
  });
  const services = { webAuthn, provenancePath: options.provenancePath };
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
  app.use(records.attachSignals);
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
      const questions = quiz.questions
        .map(
          (question, index) => `<fieldset>
            <legend>${index + 1}. ${escapeHtml(question.prompt)}</legend>
            ${Object.entries(question.options)
              .map(
                ([value, label]) => `<label><input required type="radio" name="answers[${escapeHtml(question.id)}]" value="${escapeHtml(value)}"> ${escapeHtml(label)}</label>`,
              )
              .join("")}
            <small>Source: ${escapeHtml(question.source_ref)}</small>
          </fieldset>`,
        )
        .join("");
      response.type("html").send(
        page(
          quiz.title,
          `<h1>${escapeHtml(quiz.title)}</h1>
           <p class="notice">${escapeHtml(quiz.notice)}</p>
            <form method="post" action="/quiz/1/submit" ${presenceAttributes(enabled, quizAction, response.locals.user)}>
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
      const hasPosted = postedUsers.has(user.id);
      const postMarkup = hasPosted
        ? posts
            .map(
              (post) => `<article>
                <h2>${escapeHtml(post.subject)}</h2>
                <p><strong>${escapeHtml(post.author)}</strong> &middot; <time>${escapeHtml(post.timestamp)}</time></p>
                <p>${escapeHtml(post.body)}</p>
              </article>`,
            )
            .join("")
        : '<p class="notice">Peer posts are hidden until you publish your initial response (independent_first).</p>';
      const form = hasPosted
        ? ""
        : `<form method="post" action="/discussion/2/post" ${presenceAttributes(enabled, discussionAction, user)}>
            <label for="body"><strong>Your initial response</strong></label>
            <textarea id="body" name="body" required></textarea>
            <button type="submit">Publish response</button>
            <p role="status" data-countersign-status></p>
          </form>`;
      response.type("html").send(
        page(
          forum.title,
          `<h1>${escapeHtml(forum.title)}</h1>
           <section class="panel"><h2>Faculty prompt</h2><p>${escapeHtml(forum.faculty_prompt)}</p></section>
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
    ...governedSubmission(enabled, discussionAction, services),
    (request, response) => {
      const user = response.locals.user as PortalUser;
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
      };
      posts.push(post);
      postedUsers.add(user.id);
      if (request.is("application/json")) {
        response.json({
          ok: true,
          post_id: post.post_id,
          message: "Discussion response published.",
          redirect: "/discussion/2",
        });
        return;
      }
      response.redirect(303, "/discussion/2");
    },
  );

  app.get(
    "/record/1",
    requireUser(),
    records.visit,
    (_request, response) => {
      const student = students.find((candidate) => candidate.id === response.locals.user.id)!;
      const rule = matchRule("/record/1", "GET /record/1");
      const value = (raw: string) => enabled ? "[Hidden — verify presence to view]" : escapeHtml(raw);
      response.type("html").send(
        page(
          "Student record",
          `<h1>Student record</h1>
           <p class="notice">All values on this page are fabricated.</p>
           ${enabled ? `<section class="notice">
             <p role="status" data-record-status>${response.locals.recordSignals?.flagged ? "Automation suspected. Sensitive content hidden — verify presence to view." : "Sensitive content hidden while browser signals are checked."}</p>
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
