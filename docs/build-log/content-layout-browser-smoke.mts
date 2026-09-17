// Optional local Playwright regression check. No install, live server, LLM call,
// passkey ceremony, or fixture mutation is needed. Run from the repository root:
// TMPDIR=$PWD/node_modules/.cache ./node_modules/.bin/tsx docs/build-log/content-layout-browser-smoke.mts --label=baseline
// Repeat with --label=after once the layout changes are ready. Every failure is
// collected; report.json and screenshots remain in ignored node_modules/.cache.
// Add --publish-evidence to retain representative screenshots in this directory.
// --quiz-only runs just the quiz cases when checking question-panel regressions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Browser, Page } from "playwright";
import { createApp } from "../../portal/app.ts";
import { appendProvenanceEvent } from "../../countersign/server/log.ts";
import { PolicyStore, revision, type PolicyStorePaths } from "../../countersign/server/policy-store.ts";

const root = process.cwd();
const cache = join(root, "node_modules/.cache");
const label = process.argv.find(value => value.startsWith("--label="))?.slice(8) ?? "baseline";
const publishEvidence = process.argv.includes("--publish-evidence");
const quizOnly = process.argv.includes("--quiz-only");
assert.match(label, /^[a-z0-9-]+$/i, "Use a simple evidence label, e.g. baseline or after.");
const widths = [1280, 801, 799, 390, 320];
const token = "DOM_ONLY_LAYOUT_PROBE_" + "W".repeat(320);
const inputPaths = {
  portal: "portal/app.ts", dashboard: "dashboard/index.ts",
  quiz: "portal/data/quiz.json", forum: "portal/data/forum.json", students: "portal/data/students.json",
  policyPath: "countersign/policy/countersign.policy.json",
  draftPath: "countersign/policy/countersign.policy.draft.json",
  metadataPath: "countersign/policy/countersign.policy.draft.meta.json",
  categoriesPath: "data/cui/categories.json", ldcsPath: "data/cui/ldcs.json",
};
const inputs = Object.fromEntries(await Promise.all(Object.entries(inputPaths).map(async ([key, path]) =>
  [key, await readFile(join(root, path), "utf8")])));
const quiz = JSON.parse(inputs.quiz) as {
  title: string; notice: string;
  questions: Array<{ id: string; prompt: string; options: Record<string, string>; source_ref: string }>;
};
const forum = JSON.parse(inputs.forum) as {
  title: string; faculty_prompt: string; faculty_prompt_post_id: string; synthetic_data_notice: string;
  posts: Array<{ post_id: string; subject: string; body: string; author: string; timestamp: string }>;
};
const students = JSON.parse(inputs.students) as Array<{
  id: string; name: string; email: string; ssn: string; dod_id: string; medical_note: string;
}>;
const active = JSON.parse(inputs.policyPath);
const draft = JSON.parse(inputs.draftPath);
const savedMetadata = JSON.parse(inputs.metadataPath);
// A manually migrated draft must not inherit provenance from an older revision.
const metadata = savedMetadata.draft_revision === revision(draft) ? savedMetadata : null;

type Kind = "quiz" | "discussion-peer" | "discussion-demo" | "policy" | "timeline" | "login" | "register" | "record";
type Finding = { kind: string; element: string; detail: string; excess?: number };
type Layout = {
  document: { client: number; scroll: number; bodyScroll: number };
  findings: Finding[];
  forum: Array<{ element: string; measureCh: number; lineHeightRatio: number }>;
  localScrollers: Array<{ element: string; client: number; scroll: number; overflowX: string }>;
};
type Snapshot = Layout & {
  mode: string; user: string; route: string; width: number; kind: Kind; phase: "actual" | "probe";
  checks: number; screenshots: string[];
};
const snapshots: Snapshot[] = [];
const setupErrors: string[] = [];

async function evaluateInPage<Input, Result>(page: Page, callback: (input: Input) => Result, input: Input): Promise<Awaited<Result>> {
  // tsx annotates nested function names with __name. Supply that identity helper
  // inside the serialized callback's scope, without changing page globals/CSS.
  return page.evaluate(`((__name) => (${callback.toString()})(${JSON.stringify(input)}))((value) => value)`);
}

// Geometry rather than exact CSS strings: catch escaping/clipped text, expanded
// min-content tracks, unreadable prose, and wrapped options under their radios.
// Only .timeline-scroll may scroll horizontally; pre may scroll vertically.
async function measure(page: Page): Promise<Layout> {
  return evaluateInPage(page, () => {
    const findings = new Map<string, Finding>();
    const describe = (element: Element): string => {
      const parts: string[] = [];
      for (let current: Element | null = element; current && parts.length < 5; current = current.parentElement) {
        if (current.id) { parts.unshift(`#${current.id}`); break; }
        const siblings = current.parentElement ? [...current.parentElement.children].filter(item => item.tagName === current!.tagName) : [];
        const classes = [...current.classList].slice(0, 2).map(value => `.${value}`).join("");
        parts.unshift(current.tagName.toLowerCase() + classes + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""));
      }
      return parts.join(" > ");
    };
    const add = (kind: string, element: Element, detail: string, excess = 0) => {
      const selector = describe(element);
      const key = `${kind}|${selector}`;
      if (!findings.has(key) || excess > (findings.get(key)!.excess ?? 0)) findings.set(key, { kind, element: selector, detail, excess });
    };
    const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const contentBounds = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      return {
        left: rect.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft),
        right: rect.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight),
      };
    };
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) add("document-overflow", doc,
      `document ${doc.scrollWidth}px > viewport ${doc.clientWidth}px`, doc.scrollWidth - doc.clientWidth);
    for (const element of document.querySelectorAll("html, body, main")) {
      if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(element).overflowX)) {
        add("global-overflow-workaround", element, `overflow-x=${getComputedStyle(element).overflowX}; contain content instead`);
      }
    }
    const boxes = document.querySelectorAll<HTMLElement>(
      "header, main, footer, main > *, article, .panel, fieldset, legend, .forum-text, .policy-grid, .policy-grid > section, pre, label, textarea, button, select, .timeline-scroll",
    );
    for (const element of boxes) {
      if (!visible(element)) continue;
      const parent = element.parentElement;
      const rect = element.getBoundingClientRect();
      if (parent && visible(parent) && getComputedStyle(parent).display !== "inline") {
        const bounds = contentBounds(parent);
        const excess = Math.max(bounds.left - rect.left, rect.right - bounds.right);
        if (excess > 1) add("box-escapes-parent", element,
          `box [${rect.left.toFixed(1)}, ${rect.right.toFixed(1)}] outside parent [${bounds.left.toFixed(1)}, ${bounds.right.toFixed(1)}]`, excess);
      }
      const css = getComputedStyle(element);
      if (element.tagName === "PRE" && element.scrollWidth > element.clientWidth + 1) {
        add("pre-horizontal-overflow", element, `pre ${element.scrollWidth}px > client ${element.clientWidth}px`, element.scrollWidth - element.clientWidth);
      }
      if ((["hidden", "clip"].includes(css.overflowX) && element.scrollWidth > element.clientWidth + 1) ||
          (["hidden", "clip"].includes(css.overflowY) && element.scrollHeight > element.clientHeight + 1) ||
          (parseInt(css.webkitLineClamp) > 0)) add("clipped-content", element, "Text is clipped or line-clamped rather than readable.");
    }
    // A fieldset's native legend straddles its painted border. Horizontal-only
    // overflow checks miss that: questions and answers must fit the card's
    // padded interior vertically too, including multiline legends.
    for (const fieldset of document.querySelectorAll('form[action="/quiz/1/submit"] fieldset')) {
      const panel = fieldset.closest(".quiz-question") ?? fieldset;
      const rect = panel.getBoundingClientRect();
      const css = getComputedStyle(panel);
      const top = rect.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop);
      const bottom = rect.bottom - parseFloat(css.borderBottomWidth) - parseFloat(css.paddingBottom);
      for (const child of fieldset.querySelectorAll("legend, label, small")) {
        const childRect = child.getBoundingClientRect();
        const excess = Math.max(top - childRect.top, childRect.bottom - bottom);
        if (excess > 1) add("quiz-card-vertical-containment", child,
          `box [${childRect.top.toFixed(1)}, ${childRect.bottom.toFixed(1)}] outside padded card [${top.toFixed(1)}, ${bottom.toFixed(1)}]`, excess);
      }
      const legend = fieldset.querySelector("legend");
      const firstOption = fieldset.querySelector("label");
      if (legend && firstOption && legend.getBoundingClientRect().bottom > firstOption.getBoundingClientRect().top + 1) {
        add("quiz-question-overlaps-options", legend, "Question must precede its answer options without overlap.");
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const boundarySelector = "pre, legend, label, .forum-text, p, h1, h2, h3, summary, dd, dt, button, td, th, article, fieldset, .panel, main, header, footer";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest("script, style, select, textarea") || !visible(parent)) continue;
      const boundary = parent.closest(boundarySelector);
      if (!boundary || !visible(boundary)) continue;
      const bounds = contentBounds(boundary);
      const range = document.createRange();
      // CSS pre-wrap intentionally hangs trailing spaces at a soft line break.
      // Measure painted words, not those invisible whitespace fragments.
      for (const word of node.textContent.matchAll(/\S+/gu)) {
        range.setStart(node, word.index!);
        range.setEnd(node, word.index! + word[0].length);
        for (const rect of range.getClientRects()) {
          if (rect.width < 0.5) continue;
          const excess = Math.max(bounds.left - rect.left, rect.right - bounds.right);
          if (excess > 1) add("text-escapes-panel", boundary,
            `text [${rect.left.toFixed(1)}, ${rect.right.toFixed(1)}] outside [${bounds.left.toFixed(1)}, ${bounds.right.toFixed(1)}]: ${word[0].slice(0, 85)}`, excess);
        }
      }
    }
    const canvas = document.createElement("canvas").getContext("2d")!;
    const prose = [...document.querySelectorAll<HTMLElement>(".forum-text")].filter(visible).map(element => {
      const css = getComputedStyle(element);
      canvas.font = `${css.fontSize} ${css.fontFamily}`;
      const bounds = contentBounds(element);
      const measureCh = (bounds.right - bounds.left) / canvas.measureText("0").width;
      const range = document.createRange();
      range.selectNodeContents(element);
      const tops = [...new Set([...range.getClientRects()].filter(rect => rect.width > 0.5).map(rect => rect.top))].sort((a, b) => a - b);
      const steps = tops.slice(1).map((top, index) => top - tops[index]).filter(step => step > 2);
      const lineHeight = parseFloat(css.lineHeight) || (steps.length ? Math.min(...steps) : element.getBoundingClientRect().height);
      const lineHeightRatio = lineHeight / parseFloat(css.fontSize);
      // 75ch target with 1ch measurement tolerance; 1.45 is a readability floor,
      // not an assertion of the implementation's exact chosen line-height.
      if (measureCh > 76) add("forum-line-length", element, `${measureCh.toFixed(1)}ch line measure; expected about 75ch or less`, measureCh - 75);
      if (lineHeightRatio < 1.45) add("forum-line-height", element, `${lineHeightRatio.toFixed(2)} line-height/font-size; expected >= 1.45`);
      return { element: describe(element), measureCh, lineHeightRatio };
    });
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const label = radio.labels?.[0];
      if (!label) continue;
      const texts = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      const lines = new Map<number, number>();
      while (texts.nextNode()) {
        if (!texts.currentNode.textContent?.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(texts.currentNode);
        for (const rect of range.getClientRects()) if (rect.width > 0.5) lines.set(rect.top, Math.min(lines.get(rect.top) ?? Infinity, rect.left));
      }
      const ordered = [...lines].sort(([a], [b]) => a - b);
      const radioRight = radio.getBoundingClientRect().right;
      if (ordered.slice(1).some(([, left]) => left < radioRight - 1)) add("quiz-hanging-indent", label,
        `${radio.name}=${radio.value}: continuation starts ${Math.min(...ordered.slice(1).map(([, left]) => left)).toFixed(1)}px, radio ends ${radioRight.toFixed(1)}px`);
    }
    for (const grid of document.querySelectorAll(".policy-grid")) {
      if (!visible(grid) || grid.children.length !== 2) continue;
      const [first, second] = [...grid.children].map(element => element.getBoundingClientRect());
      const stacked = doc.clientWidth <= 800;
      if (stacked ? second.top < first.bottom - 1 || Math.abs(first.left - second.left) > 1 :
        second.left < first.right - 1 || Math.abs(first.top - second.top) > 1) {
        add("policy-responsive-columns", grid, `Expected ${stacked ? "stacked" : "side-by-side"} panels at ${doc.clientWidth}px`);
      }
    }
    const localScrollers = [...document.querySelectorAll<HTMLElement>(".timeline-scroll")].map(element => {
      const css = getComputedStyle(element);
      if (!["auto", "scroll"].includes(css.overflowX)) add("timeline-local-scroller", element, `overflow-x=${css.overflowX}; evidence must remain locally scrollable`);
      return { element: describe(element), client: element.clientWidth, scroll: element.scrollWidth, overflowX: css.overflowX };
    });
    return { document: { client: doc.clientWidth, scroll: doc.scrollWidth, bodyScroll: document.body.scrollWidth },
      findings: [...findings.values()], forum: prose, localScrollers };
  }, undefined);
}

async function semantics(page: Page, kind: Kind, enabled: boolean, seed: unknown) {
  const result = await evaluateInPage(page, ({ kind, enabled, quiz, forum, students, active, draft, metadata, seed }) => {
    const findings: Finding[] = [];
    let checks = 0;
    const check = (condition: boolean, detail: string) => {
      checks++;
      if (!condition) findings.push({ kind: "semantic-preservation", element: kind, detail });
    };
    const same = (actual: unknown, expected: unknown, detail: string) => check(JSON.stringify(actual) === JSON.stringify(expected), detail);
    const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
    const parse = (element: Element | null | undefined) => { try { return JSON.parse(element?.textContent ?? ""); } catch { return null; } };
    if (kind === "quiz") {
      same(text("h1"), quiz.title, "Full quiz title");
      same(text(".notice"), quiz.notice, "Full quiz source notice");
      const form = document.querySelector<HTMLFormElement>('form[action="/quiz/1/submit"]');
      check(form?.method === "post", "Quiz submission method/action preserved");
      const fieldsets = [...document.querySelectorAll("fieldset")];
      same(fieldsets.length, quiz.questions.length, "Question count preserved");
      for (const [index, question] of quiz.questions.entries()) {
        const fieldset = fieldsets[index];
        same(fieldset?.querySelector("legend")?.textContent, `${index + 1}. ${question.prompt}`, `Full legend for ${question.id}`);
        same(fieldset?.querySelector("small")?.textContent, `Source: ${question.source_ref}`, `Full source for ${question.id}`);
        const radios = [...(fieldset?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])];
        same(radios.map(input => [input.name, input.value]), Object.keys(question.options).map(value => [`answers[${question.id}]`, value]), `Radio names/values for ${question.id}`);
        for (const input of radios) {
          check(input.required && !input.disabled && input.form === form, `Required, enabled, associated radio ${input.name}=${input.value}`);
          same(input.labels?.length, 1, `Exactly one form label for ${input.name}=${input.value}`);
          same(input.labels?.[0]?.textContent?.trim(), question.options[input.value], `Full associated option text for ${input.name}=${input.value}`);
        }
      }
    }
    if (kind.startsWith("discussion")) {
      same(text("h1"), forum.title, "Full imported discussion title");
      same(text(".panel .forum-text"), forum.faculty_prompt, "Full faculty prompt including paragraph separators");
      same(document.querySelector<HTMLElement>(".panel .forum-text")?.innerText, forum.faculty_prompt, "Faculty paragraphs remain visibly separated");
      same(text("footer"), forum.synthetic_data_notice, "Full synthetic-data footer");
      const posts = forum.posts.filter(post => post.post_id !== forum.faculty_prompt_post_id);
      same([...document.querySelectorAll<HTMLElement>("[data-post-id]")].map(element => element.dataset.postId),
        kind === "discussion-peer" ? posts.map(post => post.post_id) : [], "Seeded peer visibility and source order");
      if (kind === "discussion-peer") for (const post of posts) {
        const article = document.querySelector(`[data-post-id="${post.post_id}"]`);
        same(article?.querySelector("h2")?.textContent, post.subject, `Full subject ${post.post_id}`);
        same(article?.querySelector("strong")?.textContent, post.author, `Full author ${post.post_id}`);
        same(article?.querySelector("time")?.textContent, post.timestamp, `Full timestamp ${post.post_id}`);
        same(article?.querySelector(".forum-text")?.textContent, post.body, `Full imported body ${post.post_id}`);
        same(article?.querySelector<HTMLElement>(".forum-text")?.innerText, post.body, `Visible paragraph separation ${post.post_id}`);
      }
      if (kind === "discussion-demo") {
        const input = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
        check(Boolean(input?.required && input.labels?.[0]?.textContent === "Your initial response" &&
          input.form?.getAttribute("action") === "/discussion/2/post" && input.form.method === "post"), "Initial response retains its required labeled form");
        check(document.body.innerText.includes("Peer posts are hidden until you publish"), "Independent-first notice remains visible");
      }
    }
    if (kind === "policy") {
      const details = [...document.querySelectorAll("details")];
      const complete = details.find(element => element.querySelector("summary")?.textContent === "Complete active / draft JSON");
      const generation = details.find(element => element.querySelector("summary")?.textContent === "Generation provenance");
      check(Boolean(complete?.open), "Complete JSON expanded");
      check(metadata ? Boolean(generation?.open) : !generation,
        metadata ? "Matching generation provenance expanded" : "Stale generation provenance is not displayed");
      const pres = complete?.querySelectorAll("pre");
      same(parse(pres?.[0]), active, "Full active JSON (not a shortened preview)");
      same(parse(pres?.[1]), draft, "Full real Registry draft JSON");
      same(parse(generation?.querySelector("pre")), metadata, "Full matching generation metadata");
      for (const rule of draft.rules) {
        const card = document.querySelector(`[data-rule="${rule.id}"]`);
        same(card?.querySelector("p")?.textContent, rule.rationale, `Full rationale for ${rule.id}`);
        same(parse(card?.querySelectorAll("pre")[1]), rule, `Full draft rule/citations for ${rule.id}`);
      }
    }
    if (kind === "timeline") {
      same(parse(document.querySelector("#events details[open] pre")), seed, "Expanded evidence retains every seeded field and complete Registry text");
      const scroller = document.querySelector<HTMLElement>(".timeline-scroll");
      check(Boolean(scroller), "Timeline retains its local horizontal scroll container");
      if (document.documentElement.clientWidth <= 800) check(Boolean(scroller && scroller.scrollWidth > scroller.clientWidth),
        "Wide evidence scrolls locally at narrow viewports");
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        const original = scroller.scrollLeft;
        scroller.scrollLeft = scroller.scrollWidth;
        check(scroller.scrollLeft > 0, "Evidence is actually reachable using local scrolling");
        scroller.scrollLeft = original;
      }
      const filter = document.querySelector<HTMLSelectElement>("#user-filter");
      check(filter?.labels?.[0]?.textContent === "Show user", "Timeline filter keeps its accessible label");
    }
    if (kind === "login") {
      const forms = [...document.querySelectorAll<HTMLFormElement>('form[action="/login"]')];
      same(forms.length, students.length, "All selectable imported identities remain available");
      for (const [index, student] of students.entries()) {
        same(forms[index]?.querySelector<HTMLInputElement>('input[name="user_id"]')?.value, student.id, `Login identity ${student.id}`);
        same(forms[index]?.querySelector("button")?.textContent, `Continue as ${student.name}`, `Full login button ${student.id}`);
        check(Boolean(forms[index]?.innerText.includes(student.email)), `Full email ${student.id}`);
      }
    }
    if (kind === "register") check(text("h1") === "Register a passkey for Capt J. Demo" &&
      text("form button") === "Register passkey with Touch ID", "Registration explanation and button stay readable; no ceremony performed");
    if (kind === "record") {
      const demo = students.find(student => student.id === "stu-0011")!;
      for (const [field, value] of Object.entries({ name: demo.name, ssn: demo.ssn, "dod-id": demo.dod_id, medical: demo.medical_note })) {
        const rendered = text(`[data-field="${field}"]`);
        check(enabled ? Boolean(rendered?.includes("Hidden") || rendered?.includes("hidden")) : rendered === value,
          enabled ? `Protected ${field} remains masked without presence` : `Full fabricated ${field}`);
      }
    }
    return { findings, checks };
  }, { kind, enabled, quiz, forum, students, active, draft, metadata, seed });
  if (kind === "quiz") {
    // The browser's accessible-name computation must still agree with the
    // fixture, including when production adds a text span to each option.
    for (const [index, question] of quiz.questions.entries()) {
      result.checks++;
      if (await page.getByRole("group", { name: `${index + 1}. ${question.prompt}`, exact: true }).count() !== 1) {
        result.findings.push({ kind: "semantic-preservation", element: question.id, detail: "Fieldset accessible name must be the full question" });
      }
      for (const option of Object.values(question.options)) {
        result.checks++;
        if (await page.getByRole("radio", { name: option, exact: true }).count() !== 1) {
          result.findings.push({ kind: "semantic-preservation", element: question.id, detail: `Missing uniquely labeled radio: ${option}` });
        }
      }
    }
  }
  return result;
}

await mkdir(cache, { recursive: true });
const output = await mkdtemp(join(cache, `content-layout-${label}-`));
await mkdir(join(output, "screenshots"));
let browser: Browser | undefined;
try {
  let playwright: typeof import("playwright");
  try { playwright = await import("playwright"); }
  catch { throw new Error("Optional local Playwright is unavailable. No dependencies were installed or changed."); }
  browser = await playwright.chromium.launch({ channel: "chrome", headless: true });
  console.log(`Evidence: ${relative(root, output)}; Chrome ${browser.version()}`);
  for (const enabled of [true, false]) {
    const mode = enabled ? "governed" : "ungoverned";
    const origin = `http://localhost:${enabled ? 3000 : 3001}`;
    const state = await mkdtemp(join(output, `state-${mode}-`));
    const policyPaths = Object.fromEntries(await Promise.all(
      (["policyPath", "draftPath", "metadataPath", "categoriesPath", "ldcsPath"] as const).map(async key => {
        const path = join(state, `${key}.json`);
        await writeFile(path, inputs[key]);
        return [key, path];
      }),
    )) as unknown as PolicyStorePaths;
    const store = new PolicyStore(policyPaths);
    assert.ok(store.draft(), "Use a valid saved draft.");
    assert.deepEqual(store.metadata(store.draft()), metadata, "Only matching generation metadata is usable.");
    assert.equal(store.vocabulary().placeholder, false, "Use the imported Registry, not scaffold vocabulary.");
    const provenancePath = join(state, "events.jsonl");
    const seed = await appendProvenanceEvent({
      session_id: "sess_layout_evidence", user: { id: "stu-layout-evidence", name: "Capt Synthetic Layout Evidence" },
      route: "/discussion/2", action: "GET /discussion/2", rule_id: "discussion-initial-post", class: "attested",
      decision: "allowed", actor_class: "unverified", presence: null, attestation: null,
      signals: { score: 0, flags: [] }, telemetry: null, form_hash: null,
      notes: "Synthetic layout-only evidence; no presence ceremony.\n\n" + draft.rules.map((rule: { rationale: string }) => rule.rationale).join("\n\n") +
        "\n\n" + draft.rules.flatMap((rule: { citations: Array<{ excerpt: string }> }) => rule.citations.map(citation => citation.excerpt)).join("\n\n"),
    }, provenancePath);
    const server = createApp({ countersignEnabled: enabled, credentialsPath: join(state, "credentials.json"),
      provenancePath, policyPaths, sessionSecret: "isolated-content-layout-browser-check" }).listen(0, "localhost");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const target = `http://localhost:${address.port}`;
    try {
      for (const user of (quizOnly ? ["stu-0011"] : ["stu-0011", "stu-0003"])) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await context.route("**/*", async route => {
          const request = route.request();
          const url = new URL(request.url());
          // Everything goes to this ephemeral app, including browser-followed
          // redirects. The write allowlist also prevents accidental generation,
          // approval, submission, enrollment, or reset during layout checks.
          if (url.origin !== origin || (request.method() !== "GET" &&
              !(request.method() === "POST" && url.pathname === "/login"))) {
            errors.push(`Unexpected request blocked: ${request.method()} ${url.origin}${url.pathname}`);
            await route.abort("blockedbyclient"); return;
          }
          const response = await route.fetch({ url: target + url.pathname + url.search, maxRedirects: 0 });
          const location = response.headers().location;
          if (response.status() >= 300 && response.status() < 400 && location) {
            const next = new URL(location, origin);
            assert.equal(next.origin, origin);
            await route.fulfill({ response, status: 200, contentType: "text/html",
              body: `<script>location.replace(${JSON.stringify(next.pathname + next.search + next.hash)})</script>` });
          } else await route.fulfill({ response });
        });
        try {
          await page.goto(origin + "/login");
          await page.locator('form[action="/login"]').filter({ has: page.locator(`input[name="user_id"][value="${user}"]`) }).locator("button").click();
          await page.waitForURL(origin + (enabled ? "/register" : "/quiz/1"));
          for (const width of widths) {
            await page.setViewportSize({ width, height: 1000 });
            const cases: Array<[Kind, string]> = quizOnly ? [["quiz", "/quiz/1"]] : user === "stu-0003" ? [["discussion-peer", "/discussion/2"]] : [
              ["quiz", "/quiz/1"], ["discussion-demo", "/discussion/2"], ["policy", "/countersign/policy/review"],
              ["timeline", "/countersign/?user=stu-layout-evidence"],
              ...(width <= 390 ? [["login", "/login"], ...(enabled ? [["register", "/register"]] : []), ["record", "/record/1"]] as Array<[Kind, string]> : []),
            ];
            for (const [kind, route] of cases) {
              try {
                await page.goto(origin + route, { waitUntil: "networkidle" });
                if (kind === "policy") {
                  if (metadata) await page.getByText("Generation provenance", { exact: true }).click();
                  await page.getByText("Complete active / draft JSON", { exact: true }).click();
                }
                if (kind === "timeline") {
                  await page.locator(`#events tr[data-event-id="${seed.event_id}"] summary`).click();
                }
                if (kind === "discussion-demo") await page.locator("[data-demo-controls] > summary").click();
                const preserved = await semantics(page, kind, enabled, seed);
                for (const phase of ["actual", "probe"] as const) {
                  if (phase === "probe") await page.evaluate(({ kind, token }) => {
                    const selectors: Record<string, string[]> = {
                      quiz: ["legend", 'label:has(input[type="radio"]) span, label:has(input[type="radio"])', "fieldset small"],
                      "discussion-peer": [".panel .forum-text", "article .forum-text"],
                      "discussion-demo": [".panel .forum-text", "[data-demo-controls] p"],
                      policy: ["main > details pre", "main > details:last-of-type section:nth-child(1) pre", "main > details:last-of-type section:nth-child(2) pre", ".policy-rule pre"],
                      timeline: ["#events details[open] pre"], login: ["form small"], register: ["main p"], record: ['[data-field="medical"]'],
                    };
                    for (const selector of selectors[kind]) {
                      let target = document.querySelector(selector);
                      // Use the option's text span when present; leave form
                      // labeling and input names/values untouched by the probe.
                      if (target?.tagName === "LABEL") target = target.querySelector("span") ?? target;
                      if (!target) throw new Error(`Missing DOM probe target: ${selector}`);
                      target.append(document.createTextNode("\n" + token));
                      target.setAttribute("data-content-layout-probe", "");
                    }
                  }, { kind, token });
                  await page.evaluate(() => { window.scrollTo(0, 0); });
                  const layout = await measure(page);
                  if (phase === "actual") layout.findings.push(...preserved.findings);
                  else {
                    const retained = await page.locator("[data-content-layout-probe]").evaluateAll((elements, token) =>
                      elements.length > 0 && elements.every(element => element.textContent?.includes(token)), token);
                    if (!retained) layout.findings.push({ kind: "probe-preservation", element: kind, detail: "DOM-only long token must remain complete" });
                  }
                  layout.findings.push(...errors.splice(0).map(detail => ({ kind: "browser-error", element: kind, detail })));
                  const screenshot = join(output, "screenshots", `${mode}-${kind}-${width}-${phase}.png`);
                  await page.screenshot({ path: screenshot });
                  if (publishEvidence && enabled && phase === "actual" && kind === "quiz" && (width === 390 || width === 1280)) {
                    await page.screenshot({ path: join(root, `docs/build-log/content-layout-quiz-${width === 390 ? "mobile" : "desktop"}.png`), fullPage: width === 1280 });
                  }
                  const snapshot: Snapshot = { ...layout, mode, user, route, kind, width, phase,
                    checks: phase === "actual" ? preserved.checks : 1, screenshots: [relative(root, screenshot)] };
                  snapshots.push(snapshot);
                  const groups = [...new Set(snapshot.findings.map(finding => finding.kind))].join(", ") || "all checks pass";
                  console.log(`${snapshot.findings.length ? "FAIL" : "PASS"} ${mode} ${kind} ${width}px ${phase}: doc ${layout.document.scroll}/${layout.document.client}px; ${snapshot.findings.length} findings (${groups})`);
                  if (phase === "actual" && ["policy", "discussion-peer", "timeline"].includes(kind)) {
                    const focus = kind === "policy" ? page.getByText("Complete active / draft JSON", { exact: true }) :
                      kind === "discussion-peer" ? page.locator("article").first() : page.locator(".timeline-scroll");
                    await focus.scrollIntoViewIfNeeded();
                    const focused = join(output, "screenshots", `${mode}-${kind}-${width}-expanded.png`);
                    await page.screenshot({ path: focused });
                    snapshot.screenshots.push(relative(root, focused));
                    if (publishEvidence && enabled && width === 1280 && (kind === "policy" || kind === "discussion-peer")) {
                      await page.screenshot({ path: join(root, `docs/build-log/content-layout-${kind}-desktop.png`) });
                    }
                  }
                }
              } catch (error) {
                setupErrors.push(`${mode} ${user} ${route} ${width}px: ${error instanceof Error ? error.stack : error}`);
                console.error(`ERROR ${mode} ${kind} ${width}px: ${error instanceof Error ? error.message : error}`);
              }
            }
          }
        } catch (error) { setupErrors.push(`${mode} ${user} setup: ${error instanceof Error ? error.stack : error}`); }
        finally { await context.close(); }
      }
      for (const key of Object.keys(policyPaths) as Array<keyof PolicyStorePaths>) {
        assert.equal(await readFile(policyPaths[key], "utf8"), inputs[key], `Isolated policy/vocabulary copy unchanged: ${key}`);
      }
    } finally {
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await rm(state, { recursive: true, force: true });
    }
  }
} catch (error) { setupErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)); }
finally {
  const browserVersion = browser?.version();
  await browser?.close();
  for (const [key, path] of Object.entries(inputPaths)) {
    if (await readFile(join(root, path), "utf8") !== inputs[key]) setupErrors.push(`Input changed during run: ${path}; rerun against a stable source tree.`);
  }
  const expectedSnapshots = quizOnly ? 20 : 120;
  if (snapshots.length !== expectedSnapshots) setupErrors.push(`Expected ${expectedSnapshots} actual/probe snapshots across ${expectedSnapshots / 2} route/viewport cases; collected ${snapshots.length}.`);
  const failed = snapshots.filter(snapshot => snapshot.findings.length);
  const report = {
    label, browserVersion, widths, startedFrom: Object.fromEntries(Object.entries(inputPaths).map(([key, path]) =>
      [path, createHash("sha256").update(inputs[key]).digest("hex")])),
    fixture: { quizQuestions: quiz.questions.length, peerPosts: forum.posts.length - 1,
      draftVersion: draft.version, generation: metadata, injectedTokenLength: token.length },
    summary: { cases: snapshots.length / 2, snapshots: snapshots.length, failedSnapshots: failed.length,
      semanticChecks: snapshots.reduce((sum, snapshot) => sum + snapshot.checks, 0),
      findings: failed.reduce((sum, snapshot) => sum + snapshot.findings.length, 0), setupErrors }, snapshots,
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`\n${label}: ${snapshots.length} snapshots, ${failed.length} failing, ${report.summary.findings} findings, ${setupErrors.length} setup errors.`);
  for (const error of setupErrors) console.error(error);
  console.log(`Full measurements and all failures: ${relative(root, join(output, "report.json"))}`);
  if (failed.length || setupErrors.length) process.exitCode = 1;
}
