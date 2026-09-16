import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../../../portal/app.js";
import { crawlPortal } from "../../generate/crawl.js";
import { generatePolicy, parseDraft } from "../../generate/index.js";
import { importVocabulary } from "../../generate/import-cui.js";
import { llmTransport } from "../../generate/llm.js";
import { loadRegistry } from "../../generate/vocabulary.js";
import { formHash } from "../canonical.js";
import { CredentialStore } from "../credentials.js";
import { DEFAULT_POLICY_PATHS } from "../policy.js";
import { PolicyStore, revision, type PolicyStorePaths } from "../policy-store.js";
import type { CountersignPolicy } from "../types.js";
import { authenticator } from "./authenticator.js";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "countersign-policy-workflow-"));
  const paths: PolicyStorePaths = {
    policyPath: join(directory, "active.json"), draftPath: join(directory, "draft.json"),
    metadataPath: join(directory, "draft-meta.json"), categoriesPath: join(directory, "categories.json"), ldcsPath: join(directory, "ldcs.json"),
  };
  // Model the scaffold-to-Registry migration in isolation. Runtime imports or
  // demo approvals must not change the meaning of these synthetic tests.
  const seed = JSON.parse(await readFile(DEFAULT_POLICY_PATHS.policyPath, "utf8")) as CountersignPolicy;
  for (const rule of seed.rules) {
    rule.citations = [];
    for (const marking of rule.markings ?? []) marking.marking = marking.categories.includes("PHI") ? "TEST-PHI" : "TEST-PII";
    if (rule.page_marking) rule.page_marking = "TEST-PII";
  }
  await Promise.all([
    writeFile(paths.policyPath, JSON.stringify(seed)),
    writeFile(paths.categoriesPath, JSON.stringify([
      { id: "TEST-PII", name: "Synthetic PII", description: "Synthetic identity definition.", placeholder: true },
      { id: "TEST-PHI", name: "Synthetic PHI", description: "Synthetic health definition.", placeholder: true },
    ])),
    writeFile(paths.ldcsPath, JSON.stringify([
      { id: "TEST-INTERNAL", name: "Synthetic internal", description: "Synthetic dissemination definition.", placeholder: true },
    ])),
  ]);
  const store = new PolicyStore(paths);
  const original = store.active();
  const draft = structuredClone(original);
  draft.version = "test-generated-draft";
  draft.defaults.signals.suspect_threshold = 0.8;
  for (const rule of draft.rules) { rule.rationale = `New rationale for ${rule.id}`; rule.citations = []; }
  draft.rules[0].presence!.max_age_s = 1;
  const device = authenticator();
  const credentialsPath = join(directory, "credentials.json");
  new CredentialStore(credentialsPath).add("stu-0011", device.credential);
  const clock = { now: Date.now() };
  const servers: ReturnType<ReturnType<typeof createApp>["listen"]>[] = [];
  t.after(async () => {
    for (const server of servers) await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  async function start(enabled: boolean) {
    // Blank SESSION_SECRET in a copied .env must still permit signed login.
    const app = createApp({ countersignEnabled: enabled, sessionSecret: "", policyPaths: paths,
      credentialsPath, provenancePath: join(directory, enabled ? "on.jsonl" : "off.jsonl"), now: () => clock.now });
    const server = app.listen(0, "localhost");
    servers.push(server);
    await once(server, "listening");
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/login`, { method: "POST", redirect: "manual",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: "stu-0011" }) });
    assert.equal(login.status, 303);
    const cookie = login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
    await login.text();
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/json", cookie, ...headers }, body: JSON.stringify(body),
    });
    return { base, cookie, post };
  }
  const save = (policy = draft) => store.saveDraft(policy, {
    generated_at: new Date().toISOString(), provider: "fixture", model: "fixture-model", source_urls: [],
    vocabulary: { categories: 2, ldcs: 1, placeholder: true },
  });
  return { directory, paths, store, original, draft, device, clock, start, save };
}

function environment(t: TestContext, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
}

test("crawler signs into the local ungoverned portal and captures the three real forms/fields", async (t) => {
  const h = await fixture(t);
  const source = await h.start(false);
  const pages = await crawlPortal({ baseUrl: source.base });
  assert.deepEqual(pages.map((page) => page.route), ["/quiz/1", "/discussion/2", "/record/1"]);
  assert.equal(pages[0].forms[0].action, "POST /quiz/1/submit");
  assert.equal(pages[0].forms[0].fields.length, 5);
  assert.deepEqual(pages[1].forms[0].fields, ["body"]);
  assert.deepEqual(pages[2].markedFields, ["name", "ssn", "dod-id", "medical"]);
  assert.match(pages[2].html, /900-12-3411/);
  assert.doesNotMatch(JSON.stringify(pages), /countersign_off_session|<script|<style/);
  await assert.rejects(crawlPortal({ baseUrl: "https://example.invalid" }), /localhost/);
  const protectedPortal = await h.start(true);
  await assert.rejects(crawlPortal({ baseUrl: protectedPortal.base }), /ungoverned instance/);
});

test("generation uses rendered HTML and bounded vocabulary, grounds citations, and changes only the draft", async (t) => {
  const h = await fixture(t);
  const source = await h.start(false);
  const before = await readFile(h.paths.policyPath, "utf8");
  const result = await generatePolicy({ store: h.store, baseUrl: source.base,
    model: { provider: "openai", model: "fixture-model", timeoutMs: 1000 },
    complete: async (prompt, options) => {
      const input = JSON.parse(prompt);
      assert.equal(input.pages.length, 3);
      assert.equal(input.vocabulary.categories.length, 2);
      assert.deepEqual(input.allowed_marking_identifiers, h.store.vocabulary().entries.map((entry) => entry.id));
      assert.match(options!.system!, /untrusted source data/);
      assert.ok(!prompt.includes(source.cookie));
      return `\`\`\`json\n${JSON.stringify(h.draft)}\n\`\`\``;
    } });
  assert.equal(await readFile(h.paths.policyPath, "utf8"), before);
  assert.equal(h.store.draft()!.version, h.draft.version);
  assert.equal(result.metadata.provider, "openai");
  assert.equal(result.metadata.vocabulary.placeholder, true);
  const record = result.draft.rules.find((rule) => rule.id === "student-record")!;
  assert.equal(record.citations.length, 2);
  for (const citation of record.citations) {
    assert.equal(citation.source, "scaffold-vocabulary");
    assert.equal(citation.excerpt, h.store.vocabulary().entries.find((entry) => entry.id === citation.ref)!.description);
  }
});

test("invalid model output and provider failure preserve the previous draft and active policy", async (t) => {
  const h = await fixture(t);
  const source = await h.start(false);
  h.save();
  const oldDraft = await readFile(h.paths.draftPath, "utf8");
  const oldActive = await readFile(h.paths.policyPath, "utf8");
  const options = { store: h.store, baseUrl: source.base, model: { provider: "openai" as const, model: "fixture-model", timeoutMs: 1000 } };
  await assert.rejects(generatePolicy({ ...options, complete: async () => "not JSON" }));
  await assert.rejects(generatePolicy({ ...options, complete: async () => { throw new Error("Provider failed"); } }), /Provider failed/);
  assert.equal(await readFile(h.paths.draftPath, "utf8"), oldDraft);
  assert.equal(await readFile(h.paths.policyPath, "utf8"), oldActive);
});

test("generation corrects unknown marking IDs once and saves only a fully validated result", async (t) => {
  const h = await fixture(t);
  const source = await h.start(false);
  h.save();
  const oldActive = await readFile(h.paths.policyPath, "utf8");
  const oldDraft = await readFile(h.paths.draftPath, "utf8");
  const oldMetadata = await readFile(h.paths.metadataPath, "utf8");
  const invalid = structuredClone(h.draft);
  invalid.rules[2].markings![0].marking = "UNKNOWN-TEST-IDENTIFIER";
  let calls = 0;
  const result = await generatePolicy({ store: h.store, baseUrl: source.base,
    model: { provider: "deepseek", model: "fixture-model", timeoutMs: 1000 },
    complete: async (prompt, options) => {
      calls++;
      assert.deepEqual(JSON.parse(prompt).allowed_marking_identifiers, h.store.vocabulary().entries.map((entry) => entry.id));
      if (calls === 1) return JSON.stringify(invalid);
      assert.equal(calls, 2);
      assert.match(options!.system!, /previous attempt failed/);
      assert.equal(await readFile(h.paths.draftPath, "utf8"), oldDraft);
      assert.equal(await readFile(h.paths.metadataPath, "utf8"), oldMetadata);
      return JSON.stringify(h.draft);
    } });
  assert.equal(calls, 2);
  assert.equal(result.metadata.provider, "deepseek");
  assert.equal(await readFile(h.paths.policyPath, "utf8"), oldActive);
});

test("marking correction stops after one retry and preserves draft, metadata, and active policy on failure", async (t) => {
  const h = await fixture(t);
  const source = await h.start(false);
  h.save();
  const paths = [h.paths.policyPath, h.paths.draftPath, h.paths.metadataPath];
  const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  const invalid = structuredClone(h.draft);
  invalid.rules[2].page_marking = "UNKNOWN-TEST-IDENTIFIER";
  const weakened = structuredClone(h.draft);
  weakened.rules[0].class = "unrestricted";
  for (const second of [invalid, weakened]) {
    let calls = 0;
    await assert.rejects(generatePolicy({ store: h.store, baseUrl: source.base,
      model: { provider: "deepseek", model: "fixture-model", timeoutMs: 1000 },
      complete: async () => JSON.stringify(++calls === 1 ? invalid : second),
    }), /validation failed after one marking-correction retry/);
    assert.equal(calls, 2);
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, "utf8"))), before);
  }
});

test("draft validation rejects unknown IDs, fabricated citations, and a disabled quiz wall", async (t) => {
  const h = await fixture(t);
  const vocabulary = h.store.vocabulary();
  const unknown = structuredClone(h.draft);
  unknown.rules[2].markings![0].marking = "UNKNOWN-TEST-IDENTIFIER";
  assert.throws(() => parseDraft(JSON.stringify(unknown), vocabulary, []), /unknown marking/);
  const fabricated = structuredClone(h.draft);
  fabricated.rules[2].citations = [{ source: "cui-registry", ref: vocabulary.entries[0].id, excerpt: "Fabricated authority claim" }];
  assert.throws(() => parseDraft(JSON.stringify(fabricated), vocabulary, []), /ungrounded/);
  const weakened = structuredClone(h.draft);
  weakened.rules[0].class = "unrestricted";
  assert.throws(() => h.save(weakened), /Quiz submission must require/);
});

test("partial approval preserves unselected rules/defaults; approve-all replaces them", async (t) => {
  const h = await fixture(t);
  h.save();
  const first = h.store.approve({ rule_ids: ["quiz-submit"], active_revision: revision(h.original), draft_revision: revision(h.draft) });
  assert.deepEqual(first.approved_rule_ids, ["quiz-submit"]);
  assert.deepEqual(h.store.active().rules[0], h.draft.rules[0]);
  assert.deepEqual(h.store.active().rules[1], h.original.rules[1]);
  assert.deepEqual(h.store.active().defaults, h.original.defaults);
  assert.throws(() => h.store.approve({ all: true, active_revision: revision(h.original) }), /changed/);
  h.store.approve({ all: true });
  assert.deepEqual(h.store.active(), h.draft);
  for (const input of [{}, { all: false }, { rule_ids: [] }, { rule_ids: ["unknown"] }, { rule_ids: ["quiz-submit", "quiz-submit"] }, { all: true, rule_ids: ["quiz-submit"] }]) {
    assert.throws(() => h.store.approve(input));
  }
});

test("approval hot-reloads the existing server's quiz age enforcement without restarting", async (t) => {
  const h = await fixture(t);
  const portal = await h.start(true);
  const fields = { answers: { q1: "b", q2: "d", q3: "a", q4: "c", q5: "b" } };
  const issued = await portal.post("/countersign/challenge", { rule_id: "quiz-submit", action: "POST /quiz/1/submit", form_hash: formHash(fields) });
  const challenge = await issued.json();
  h.save();
  const approved = await portal.post("/countersign/policy/approve", { rule_ids: ["quiz-submit"] });
  assert.equal(approved.status, 200);
  h.clock.now += 2000;
  const result = await portal.post("/quiz/1/submit", { ...fields, countersign: {
    challenge_id: challenge.challenge_id, assertion: h.device.assertion(challenge.options.challenge),
  } });
  assert.equal(result.status, 403);
  assert.equal((await result.json()).reason, "expired");
  const policy = await (await fetch(`${portal.base}/countersign/policy`)).json();
  assert.equal(policy.rules[0].presence.max_age_s, 1);
});

test("policy management is authenticated, JSON-only, same-origin, and disabled on the ungoverned app", async (t) => {
  const h = await fixture(t);
  h.save();
  const on = await h.start(true);
  const off = await h.start(false);
  for (const action of ["approve", "generate"]) {
    const path = `/countersign/policy/${action}`;
    assert.equal((await on.post(path, { all: true }, { cookie: "" })).status, 401);
    assert.equal((await on.post(path, { all: true }, { origin: "http://localhost:3001" })).status, 403);
    assert.equal((await on.post(path, { all: true }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await off.post(path, { all: true })).status, 404);
  }
  assert.deepEqual(h.store.active(), h.original);
});

test("policy review escapes model text, shows citations/placeholders, and reports invalid drafts", async (t) => {
  const h = await fixture(t);
  h.draft.rules[0].rationale = '<script>window.bad = true</script>';
  h.save();
  const on = await h.start(true);
  const html = await (await fetch(`${on.base}/countersign/policy/review`, { headers: { cookie: on.cookie } })).text();
  assert.match(html, /&lt;script&gt;window.bad/);
  assert.doesNotMatch(html, /<script>window.bad/);
  assert.match(html, /Approve selected|Approve all/);
  assert.match(html, /Scaffold vocabulary only/);
  await writeFile(h.paths.draftPath, "not JSON");
  const invalid = await (await fetch(`${on.base}/countersign/policy/review`, { headers: { cookie: on.cookie } })).text();
  assert.match(invalid, /invalid draft cannot be approved/);
  assert.equal((await on.post("/countersign/policy/approve", { all: true })).status, 422);
  assert.deepEqual(h.store.active(), h.original);
});

test("HTTP generation uses the configured adapter, rejects concurrent requests, and leaves active policy intact", async (t) => {
  const h = await fixture(t);
  const on = await h.start(true);
  const off = await h.start(false);
  environment(t, { LLM_PROVIDER: "openai", OPENAI_MODEL: "fixture-model", OPENAI_API_KEY: "test-key-only", GENERATOR_BASE_URL: off.base });
  let started!: () => void;
  let release!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(llmTransport, "fetch", async () => {
    started(); await wait;
    return Response.json({ choices: [{ message: { content: JSON.stringify(h.draft) } }] });
  });
  const first = on.post("/countersign/policy/generate", {});
  await start;
  assert.equal((await on.post("/countersign/policy/generate", {})).status, 409);
  release();
  const result = await first;
  assert.equal(result.status, 200);
  assert.equal((await result.json()).model, "fixture-model");
  assert.deepEqual(h.store.active(), h.original);
  assert.equal(h.store.draft()!.version, h.draft.version);
});

test("Registry import validates normalized source counts/definitions and preserves active legacy references", async (t) => {
  const h = await fixture(t);
  const categoriesSource = join(h.directory, "source-categories.json");
  const ldcsSource = join(h.directory, "source-ldcs.json");
  // Explicitly synthetic importer test data, never installed as runtime vocabulary.
  const categories = Array.from({ length: 126 }, (_, index) => ({ id: `TEST-CATEGORY-${index}`, name: `Synthetic category ${index}`, description: `Synthetic test definition ${index}.` }));
  const ldcs = Array.from({ length: 10 }, (_, index) => ({ id: `TEST-LDC-${index}`, name: `Synthetic LDC ${index}`, description: `Synthetic test LDC definition ${index}.` }));
  await writeFile(categoriesSource, JSON.stringify(categories.slice(0, 1)));
  await writeFile(ldcsSource, JSON.stringify(ldcs));
  assert.throws(() => importVocabulary(categoriesSource, ldcsSource, h.paths), /126 categories/);
  await writeFile(categoriesSource, JSON.stringify(categories));
  const imported = importVocabulary(categoriesSource, ldcsSource, h.paths);
  assert.equal(imported.retained_legacy_identifiers, 3);
  const vocabulary = loadRegistry(h.paths);
  assert.equal(vocabulary.categories.length, 126);
  assert.equal(vocabulary.ldcs.length, 10);
  assert.equal(vocabulary.placeholder, false);
  assert.ok(vocabulary.allIdentifiers.has(h.original.rules[2].markings![0].marking));
  assert.ok(!vocabulary.entries.some((entry) => entry.placeholder || entry.legacy));
  assert.deepEqual(h.store.active(), h.original);
  assert.throws(() => parseDraft(JSON.stringify(h.draft), vocabulary, []), /unknown marking/);
});
