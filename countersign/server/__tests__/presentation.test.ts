import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../../../portal/app.js";
import { portalOrigin } from "../origin.js";
import type { PolicyStorePaths } from "../policy-store.js";
import { renderHero, renderShell } from "../ui.js";

const students = JSON.parse(readFileSync("portal/data/students.json", "utf8")) as Array<{
  id: string; name: string; email: string; ssn: string; dod_id: string; medical_note: string;
}>;
const quiz = JSON.parse(readFileSync("portal/data/quiz.json", "utf8")) as {
  title: string; notice: string;
  questions: Array<{ id: string; prompt: string; options: Record<string, string>; source_ref: string }>;
};
const forum = JSON.parse(readFileSync("portal/data/forum.json", "utf8")) as {
  title: string; faculty_prompt: string; faculty_prompt_post_id: string; synthetic_data_notice: string;
  posts: Array<{ post_id: string; subject: string; author: string; timestamp: string; body: string }>;
};
const routes = [
  { path: "/login", heading: "Explore the demo" },
  { path: "/quiz/1", heading: "Quiz demo" },
  { path: "/discussion/2", heading: "Discussion demo" },
  { path: "/record/1", heading: "Protected record demo" },
  { path: "/register", heading: "Passkey setup" },
  { path: "/countersign/", heading: "Activity log" },
  { path: "/countersign/policy/review", heading: "Policy review" },
];
const navGroups = {
  "Demo portal": [["/login", "Demo home"], ["/quiz/1", "Quiz"], ["/discussion/2", "Discussion"], ["/record/1", "Protected record"]],
  "Countersign console": [["/countersign/", "Activity log"], ["/countersign/policy/review", "Policy review"]],
};

// These helpers inspect the server's small, quoted HTML contract. Browser DOM,
// accessible-name, keyboard, and painted-layout checks live in the smoke harness.
function decode(value: string): string {
  return value.replaceAll("&#039;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
function text(value: string): string { return decode(value.replace(/<[^>]*>/g, "")); }
function attr(attributes: string, name: string): string | undefined {
  const value = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
  return value === undefined ? undefined : decode(value);
}
function elements(html: string, tag: string) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))]
    .map(match => ({ attrs: match[1], body: match[2] }));
}
function markedText(html: string, marker: string): string {
  const matches = [...html.matchAll(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\s${marker}(?:="[^"]*")?[^>]*>([\\s\\S]*?)</\\1>`, "g"))];
  assert.equal(matches.length, 1, `Exactly one ${marker}`);
  return text(matches[0][2]);
}

async function setup(t: TestContext, enabled: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "countersign-presentation-"));
  const inputs: Record<keyof PolicyStorePaths, string> = {
    policyPath: "countersign/policy/countersign.policy.json",
    draftPath: "countersign/policy/countersign.policy.draft.json",
    metadataPath: "countersign/policy/countersign.policy.draft.meta.json",
    categoriesPath: "data/cui/categories.json", ldcsPath: "data/cui/ldcs.json",
  };
  // Every potentially writable store is local to this app; no live policy,
  // credentials, provenance, or source fixtures are updated by these tests.
  const copies = await Promise.all(Object.entries(inputs).map(async ([key, source]) => {
    const contents = await readFile(source, "utf8");
    const path = join(directory, `${key}.json`);
    await writeFile(path, contents);
    return { key, path, contents };
  }));
  const policyPaths = Object.fromEntries(copies.map(({ key, path }) => [key, path])) as unknown as PolicyStorePaths;
  const server = createApp({ countersignEnabled: enabled, policyPaths,
    credentialsPath: join(directory, "credentials.json"), provenancePath: join(directory, "events.jsonl"),
    sessionSecret: "isolated-presentation-test" }).listen(0, "127.0.0.1");
  t.after(async () => {
    try {
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      for (const copy of copies) assert.equal(await readFile(copy.path, "utf8"), copy.contents, `${copy.key} remains unchanged`);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = "";
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, {
    ...init, redirect: "manual", headers: { cookie, ...init.headers },
  });
  async function login(user = "stu-0011") {
    const response = await request("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user_id: user }) });
    assert.equal(response.status, 303, "Choosing a demo identity needs no password or real authentication");
    assert.equal(response.headers.get("location"), enabled ? "/register" : "/quiz/1");
    cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert.ok(cookie);
    await response.text();
  }
  async function page(path: string) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/);
    return response.text();
  }
  return { request, page, login };
}

function assertShell(html: string, enabled: boolean, path: string, heading: string, otherOrigin = portalOrigin(!enabled)) {
  assert.deepEqual(elements(html, "h1").map(item => text(item.body)), [heading]);
  const main = elements(html, "main");
  assert.equal(main.length, 1);
  assert.equal(attr(main[0].attrs, "id"), "main-content");
  assert.equal(attr(main[0].attrs, "tabindex"), "-1");
  const skip = elements(html, "a").filter(item => attr(item.attrs, "href") === "#main-content");
  assert.equal(skip.length, 1);
  assert.equal(text(skip[0].body), "Skip to content");
  assert.match(html, new RegExp(`data-governance="${enabled ? "on" : "off"}"`));
  assert.match(html, new RegExp(`Governance ${enabled ? "on" : "off"}<span\\b[^>]*class="sr-only"[^>]*> — COUNTERSIGN=${enabled ? "on" : "off"}</span>`));
  assert.equal((html.match(/<link\b[^>]*href="\/assets\/site\.css"[^>]*>/g) ?? []).length, 1);
  assert.match(text(elements(html, "title")[0].body), path.startsWith("/countersign/") ? /Countersign console — Countersign$/ : /Demo portal — Countersign$/);
  const header = elements(html, "header")[0].body;
  assert.equal(elements(header, "nav").length, 2);
  for (const [label, expected] of Object.entries(navGroups)) {
    const nav = elements(header, "nav").filter(item => attr(item.attrs, "aria-label") === label);
    assert.equal(nav.length, 1, label);
    assert.deepEqual(elements(nav[0].body, "a").map(item => [attr(item.attrs, "href"), text(item.body)]), expected);
  }
  assert.deepEqual(elements(header, "a").filter(item => attr(item.attrs, "aria-current") === "page")
    .map(item => attr(item.attrs, "href")), [path], "Only the current route is active, including utility registration");
  const switches = elements(html, "a").filter(item => /\bdata-instance-switch\b/.test(item.attrs));
  assert.equal(switches.length, 1);
  assert.equal(attr(switches[0].attrs, "href"), otherOrigin + (path === "/register" ? "/login" : path));
  assert.equal(text(switches[0].body), enabled ? "Compare without governance" : "Open governed demo");
  assert.ok(markedText(html, "data-synthetic-notice"));
}

function assertPresenceForm(html: string, action: string, enabled: boolean, rule: string, mode: string, button: string) {
  const forms = elements(html, "form").filter(item => attr(item.attrs, "action") === action);
  assert.equal(forms.length, 1, action);
  const form = forms[0];
  assert.equal(attr(form.attrs, "method"), "post");
  for (const [key, value] of Object.entries({ rule, class: mode, action: `POST ${action}` })) {
    assert.equal(attr(form.attrs, `data-countersign-${key}`), enabled ? value : undefined);
  }
  assert.deepEqual(elements(form.body, "button").map(item => text(item.body).trim()), [button]);
  assert.match(form.body, /<p\b[^>]*role="status"[^>]*data-countersign-status/);
  return form.body;
}

for (const enabled of [true, false]) {
  const mode = enabled ? "on" : "off";
  test(`presentation ${mode}: every route shares navigation, current state, mode, and local assets`, async t => {
    const h = await setup(t, enabled);
    await h.login();
    const hrefs = new Set<string>();
    const assets = new Set<string>(["/assets/site.css"]);
    for (const route of routes) {
      if (!enabled && route.path === "/register") continue;
      const html = await h.page(route.path);
      assertShell(html, enabled, route.path, route.heading);
      for (const link of elements(elements(html, "header")[0].body, "a")) hrefs.add(attr(link.attrs, "href")!);
      for (const tag of html.matchAll(/<(?:script|link|img)\b([^>]*)>/g)) {
        const source = attr(tag[1], "src") ?? (attr(tag[1], "rel") === "stylesheet" ? attr(tag[1], "href") : undefined);
        if (!source) continue;
        assert.match(source, /^\/assets\/(?!\/)/, "Presentation assets are served locally");
        assets.add(source);
      }
    }
    for (const href of hrefs) {
      assert.match(href, /^\/(?!\/)/, "Shared header routes stay on this instance");
      assert.equal((await h.request(href)).status, 200, `Supported header route: ${href}`);
    }
    const registration = await h.request("/register");
    assert.equal(registration.status, enabled ? 200 : 303);
    if (!enabled) assert.equal(registration.headers.get("location"), "/quiz/1");
    for (const asset of assets) {
      const response = await h.request(asset);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get("content-type") ?? "", asset.endsWith(".css") ? /^text\/css\b/ : /(?:java|ecma)script/);
      if (asset === "/assets/site.css") assert.equal(await response.text(), await readFile("countersign/client/site.css", "utf8"));
      else assert.ok((await response.text()).length);
    }
  });

  test(`presentation ${mode}: login overview and chooser retain the password-free demo workflow`, async t => {
    const h = await setup(t, enabled);
    for (const signedIn of [false, true]) {
      if (signedIn) await h.login();
      const html = await h.page("/login");
      assertShell(html, enabled, "/login", routes[0].heading);
      const cards = [...html.matchAll(/<[a-z][\w-]*\b[^>]*class="[^"]*\bactivity-card\b[^"]*"[^>]*>[\s\S]*?<a\b([^>]*)>/g)];
      assert.deepEqual(cards.map(card => attr(card[1], "href")).sort(),
        (signedIn ? ["/quiz/1", "/discussion/2", "/record/1"] : ["#demo-users", "#demo-users", "#demo-users"]).sort());
      assert.match(html, /id="demo-users"/);
      assert.match(html, /class="[^"]*\buser-grid\b/);
      const forms = elements(html, "form").filter(item => attr(item.attrs, "action") === "/login");
      assert.equal(forms.length, students.length);
      for (const [index, student] of students.entries()) {
        assert.equal(attr(forms[index].attrs, "method"), "post");
        assert.ok(forms[index].body.includes(`name="user_id" value="${student.id}"`));
        assert.deepEqual(elements(forms[index].body, "button").map(item => text(item.body)), [`Continue as ${student.name}`]);
        assert.ok(text(forms[index].body).includes(student.email));
      }
      assert.doesNotMatch(html, /type="password"/);
    }
  });

  test(`presentation ${mode}: quiz and discussion retain complete source text and action hooks`, async t => {
    const h = await setup(t, enabled);
    await h.login();
    const quizHtml = await h.page("/quiz/1");
    assert.equal(markedText(quizHtml, "data-source-title"), quiz.title);
    assert.equal(markedText(quizHtml, "data-source-notice"), quiz.notice);
    const quizForm = assertPresenceForm(quizHtml, "/quiz/1/submit", enabled, "quiz-submit", "human-required", "Submit quiz");
    const fieldsets = elements(quizForm, "fieldset");
    assert.equal(fieldsets.length, quiz.questions.length);
    assert.equal((quizForm.match(/class="[^"]*\bquiz-question\b[^"]*"[^>]*>\s*<fieldset\b/g) ?? []).length, quiz.questions.length);
    for (const [index, question] of quiz.questions.entries()) {
      const body = fieldsets[index].body;
      assert.equal(text(elements(body, "legend")[0].body), `${index + 1}. ${question.prompt}`);
      assert.equal(text(elements(body, "small")[0].body), `Source: ${question.source_ref}`);
      const labels = elements(body, "label");
      assert.deepEqual(labels.map(item => text(item.body).trim()), Object.values(question.options));
      assert.deepEqual(labels.map(label => {
        const input = label.body.match(/<input\b([^>]*)>/)?.[1];
        assert.ok(input);
        assert.match(input, /\brequired\b/);
        assert.doesNotMatch(input, /\bdisabled\b/);
        return [attr(input, "type"), attr(input, "name"), attr(input, "value")];
      }), Object.keys(question.options).map(value => ["radio", `answers[${question.id}]`, value]));
    }
    const discussion = await h.page("/discussion/2");
    assert.equal(markedText(discussion, "data-source-title"), forum.title);
    assert.equal(markedText(discussion, "data-synthetic-notice"), forum.synthetic_data_notice);
    assert.ok(decode(discussion).includes(forum.faculty_prompt));
    assert.doesNotMatch(discussion, /data-post-id=/);
    const compose = assertPresenceForm(discussion, "/discussion/2/post", enabled, "discussion-initial-post", "attested", "Publish response");
    assert.equal(text(elements(compose, "label")[0].body), "Your initial response");
    assert.equal(attr(elements(compose, "label")[0].attrs, "for"), "body");
    const textarea = elements(compose, "textarea")[0];
    assert.equal(attr(textarea.attrs, "id"), "body");
    assert.equal(attr(textarea.attrs, "name"), "body");
    assert.match(textarea.attrs, /\brequired\b/);
    const disclosures = elements(compose, "select").filter(item => /\bdata-countersign-attestation\b/.test(item.attrs));
    assert.equal(disclosures.length, enabled ? 1 : 0, "Only governed discussion requires a disclosure");
    if (enabled) {
      assert.equal(attr(disclosures[0].attrs, "name"), "countersign[attestation]", "Disclosure stays outside business form fields");
      assert.match(disclosures[0].attrs, /\brequired\b/);
      assert.deepEqual(elements(disclosures[0].body, "option").map(item => [attr(item.attrs, "value"), text(item.body)]),
        [["", "Choose a disclosure"], ["own-work", "Own work"], ["ai-assisted", "AI-assisted"]]);
      assert.match(elements(disclosures[0].body, "option")[0].attrs, /\bselected\b/);
      assert.ok(elements(disclosures[0].body, "option").slice(1).every(item => !/\bselected\b/.test(item.attrs)), "No preselected declaration");
      const id = attr(disclosures[0].attrs, "id");
      assert.ok(elements(compose, "label").some(item => attr(item.attrs, "for") === id && text(item.body) === "How was this response prepared?"));
    }
    const reset = elements(discussion, "form").find(item => attr(item.attrs, "action") === "/discussion/2/reset")!;
    assert.equal(attr(reset.attrs, "method"), "post");
    assert.match(reset.body, /name="reset_token" value="[^"]+"/);
    assert.match(reset.body, /name="confirmation" value="reset-discussion" required/);
    assert.equal(text(elements(reset.body, "button")[0].body), "Reset discussion demo");
    await h.login("stu-0003");
    const peerHtml = await h.page("/discussion/2");
    const posts = forum.posts.filter(post => post.post_id !== forum.faculty_prompt_post_id);
    assert.equal(posts.length, 30);
    const articles = elements(peerHtml, "article").filter(item => attr(item.attrs, "data-post-id"));
    assert.deepEqual(articles.map(item => attr(item.attrs, "data-post-id")), posts.map(post => post.post_id));
    for (const [index, post] of posts.entries()) {
      const article = articles[index].body;
      assert.equal(text(elements(article, "h2")[0].body), post.subject);
      assert.match(article, /class="[^"]*\bpost-meta\b/);
      assert.equal(text(elements(article, "strong")[0].body), post.author);
      assert.equal(text(elements(article, "time")[0].body), post.timestamp);
      const prose = elements(article, "p").find(item => attr(item.attrs, "class")?.split(/\s+/).includes("forum-text"));
      assert.ok(prose);
      assert.equal(text(prose.body), post.body);
    }
  });

  test(`presentation ${mode}: protected fields cannot leak through shell metadata and record hooks remain`, async t => {
    const h = await setup(t, enabled);
    for (const student of students) {
      await h.login(student.id);
      const response = await h.request("/record/1");
      assert.equal(response.status, 200);
      const html = await response.text();
      assertShell(html, enabled, "/record/1", "Protected record demo");
      if (enabled) {
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.ok(response.headers.get("Countersign-Marking"));
        for (const person of students) for (const value of [person.name, person.ssn, person.dod_id, person.medical_note]) {
          assert.ok(!decode(html).includes(value), `Protected value omitted from the entire response: ${person.id}`);
        }
        assert.match(html, /data-protected-record/);
        const reveal = elements(html, "button").find(item => /\bdata-record-reveal\b/.test(item.attrs));
        assert.ok(reveal);
        assert.equal(attr(reveal.attrs, "type"), "button");
        assert.equal(text(reveal.body), "Verify presence to view");
        assert.match(html, /data-record-register/);
        assert.match(html, /data-record-status/);
      }
      for (const [field, value] of Object.entries({ name: student.name, ssn: student.ssn, "dod-id": student.dod_id, medical: student.medical_note })) {
        const rendered = elements(html, "dd").find(item => attr(item.attrs, "data-field") === field);
        assert.ok(rendered);
        if (enabled) assert.match(text(rendered.body), /hidden/i);
        else assert.equal(text(rendered.body), value);
      }
    }
    if (enabled) {
      await h.login();
      const registration = await h.page("/register");
      assert.ok(text(elements(registration, "main")[0].body).includes("Capt J. Demo"));
      const form = elements(registration, "form").find(item => /\bdata-countersign-register\b/.test(item.attrs));
      assert.ok(form);
      assert.equal(text(elements(form.body, "button")[0].body), "Register passkey with Touch ID");
      assert.match(form.body, /role="status"[^>]*data-countersign-status/);
    }
  });
}

test("presentation: ungoverned HTML quiz result keeps the shared shell and quiz navigation", async t => {
  const h = await setup(t, false);
  await h.login();
  const response = await h.request("/quiz/1/submit", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    body: new URLSearchParams(Object.fromEntries(quiz.questions.map(question => [`answers[${question.id}]`, "a"]))) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/);
  const html = await response.text();
  assertShell(html, false, "/quiz/1", "Quiz submitted");
  assert.match(html, /Your submission was accepted\./);
});

test("presentation: shared renderer escapes data while preserving trusted body markup", () => {
  const payload = `<img src=x onerror="alert('demo')"> & source`;
  const escaped = "&lt;img src=x onerror=&quot;alert(&#039;demo&#039;)&quot;&gt; &amp; source";
  const hero = renderHero({ eyebrow: payload, title: payload, description: payload, meta: payload });
  assert.equal(hero.split(escaped).length - 1, 4);
  const html = renderShell({ title: payload, active: "home", enabled: false, body: hero, footer: payload });
  assert.ok(html.includes(`<title>${escaped}`));
  assert.equal(markedText(html, "data-synthetic-notice"), payload);
  assert.ok(html.includes(hero));
  assert.doesNotMatch(html, /<img\b/);
});

test("presentation: published user prose is escaped without truncating text or paragraphs", async t => {
  const h = await setup(t, false);
  await h.login();
  const body = `<img src=x onerror="alert('demo')"> & exact source\n\nSecond paragraph <script>window.injected = true</script>.`;
  const response = await h.request("/discussion/2/post", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
  assert.equal(response.status, 200);
  const { post_id } = await response.json();
  const html = await h.page("/discussion/2");
  const article = elements(html, "article").find(item => attr(item.attrs, "data-post-id") === post_id);
  assert.ok(article);
  const prose = elements(article.body, "p").find(item => attr(item.attrs, "class")?.split(/\s+/).includes("forum-text"));
  assert.ok(prose);
  assert.equal(text(prose.body), body);
  assert.doesNotMatch(article.body, /<(?:img|script)\b/);
});

test("presentation: mode links honor configured origins on every page and restore the environment", async t => {
  const previous = { PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN, UNGOVERNED_ORIGIN: process.env.UNGOVERNED_ORIGIN };
  try {
    process.env.PUBLIC_ORIGIN = "https://governed.example.invalid:443/";
    process.env.UNGOVERNED_ORIGIN = "https://ungoverned.example.invalid:8443/";
    for (const enabled of [true, false]) {
      const h = await setup(t, enabled);
      await h.login();
      for (const route of routes) {
        if (!enabled && route.path === "/register") continue;
        assertShell(await h.page(route.path), enabled, route.path, route.heading,
          enabled ? "https://ungoverned.example.invalid:8443" : "https://governed.example.invalid");
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
