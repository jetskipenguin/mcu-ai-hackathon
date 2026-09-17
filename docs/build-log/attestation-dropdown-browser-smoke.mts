// Optional local regression check using the already-installed Playwright/Chrome:
// TMPDIR=$PWD/node_modules/.cache ./node_modules/.bin/tsx docs/build-log/attestation-dropdown-browser-smoke.mts
// Real server verification of Chrome virtual-authenticator proofs, NOT physical
// Touch ID evidence. All state is temporary; no live app, LLM, or dependency install.
import assert from "node:assert/strict";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createApp } from "../../portal/app.ts";
import { formHash } from "../../countersign/server/canonical.ts";
import { readProvenanceEvents } from "../../countersign/server/log.ts";
import type { ProvenanceEvent, SubmissionProvenance } from "../../countersign/server/types.ts";

const root = process.cwd();
const cache = join(root, "node_modules/.cache");
const timeout = 15_000;
const selector = "select[data-countersign-attestation]";
const action = "POST /discussion/2/post";
const body = '  Synthetic dropdown regression: "quoted" content, café, and Ω.\nA second line preserves the exact content hash.  ';
type Disclosure = "own-work" | "ai-assisted";
type Challenge = {
  request: { rule_id: string; action: string; form_hash: string; attestation: Disclosure };
  response?: { challenge_id: string; options: { challenge: string } };
};
type Submission = {
  request: {
    body: string;
    countersign?: {
      challenge_id: string; attestation: Disclosure; telemetry: unknown;
      assertion: { id: string; response: { clientDataJSON: string } };
    };
    [key: string]: unknown;
  };
  response?: { ok: boolean; post_id: string; provenance: SubmissionProvenance };
};
type Harness = {
  page: Page; origin: string; challenges: Challenge[]; submissions: Submission[];
  enrollment: string[]; removedSsrControls: () => number;
  events: () => Promise<ProvenanceEvent[]>;
  gateNextChallenge: () => { reached: Promise<void>; release: () => void };
};
type ConfirmationPart = {
  text: string; visible: boolean; unobscured: boolean;
  bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
};
type Confirmation = {
  method: string; path: string; role: string | null; viewport: { width: number; height: number };
  parts: { status: ConfirmationPart; heading: ConfirmationPart; detail: ConfirmationPart };
};

// Observe the call boundary without delaying, replacing, or altering the native
// credential operation. Raw init script avoids tsx's injected __name references.
const confirmationProbe = `(() => {
  window.__humanConfirmationSnapshot = method => {
    const status = document.querySelector("[data-countersign-status]");
    const part = element => {
      const rect = element?.getBoundingClientRect();
      const hit = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        text: element?.textContent || "",
        visible: Boolean(element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })),
        unobscured: Boolean(hit && element.contains(hit)),
        bounds: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
      };
    };
    return {
      method, path: location.pathname, role: status?.getAttribute("role") ?? null,
      viewport: { width: innerWidth, height: innerHeight },
      parts: { status: part(status), heading: part(status?.querySelector(":scope > strong")), detail: part(status?.querySelector(":scope > span")) },
    };
  };
  for (const method of ["create", "get"]) {
    const original = navigator.credentials?.[method];
    if (!original) continue;
    Object.defineProperty(navigator.credentials, method, { configurable: true, value: function (...args) {
      const snapshots = JSON.parse(sessionStorage.getItem("human-confirmation-calls") || "[]");
      snapshots.push(window.__humanConfirmationSnapshot(method));
      sessionStorage.setItem("human-confirmation-calls", JSON.stringify(snapshots));
      return Reflect.apply(original, this, args);
    }});
  }
})()`;

async function confirmations(page: Page): Promise<Confirmation[]> {
  return page.evaluate('JSON.parse(sessionStorage.getItem("human-confirmation-calls") || "[]")');
}

function assertConfirmation(snapshot: Confirmation, method: string, action: string, explanation: RegExp) {
  assert.ok(snapshot, `Missing ${method} boundary snapshot for ${action}.`);
  assert.equal(snapshot.method, method);
  assert.equal(snapshot.path, method === "create" ? "/register" : "/discussion/2");
  assert.equal(snapshot.role, "status");
  assert.equal(snapshot.parts.heading.text, `Human confirmation required — ${action}`);
  assert.match(snapshot.parts.detail.text, explanation);
  for (const [name, part] of Object.entries(snapshot.parts)) {
    const description = `${action}: ${name} must be visible before the native credential call (${JSON.stringify(part)}).`;
    assert.ok(part.visible && part.unobscured, description);
    assert.ok(part.bounds && part.bounds.width > 0 && part.bounds.height > 0, description);
    assert.ok(part.bounds.left >= -1 && part.bounds.top >= -1 &&
      part.bounds.right <= snapshot.viewport.width + 1 && part.bounds.bottom <= snapshot.viewport.height + 1, description);
  }
}

function assertDisclosureConfirmation(snapshot: Confirmation, method: string, choice: Disclosure) {
  const label = choice === "own-work" ? "Own work" : "AI-assisted";
  assertConfirmation(snapshot, method, "publish this response", new RegExp(`^Disclosure: ${label}\\. Confirm with Touch ID or your device’s passkey prompt\\. Nothing is submitted until you verify\\.$`));
}

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

await mkdir(cache, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout });

async function scenario(name: string, run: (h: Harness) => Promise<void>, options: { enabled?: boolean; fallback?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const origin = `http://localhost:${enabled ? 3000 : 3001}`;
  const temporary = await mkdtemp(join(cache, "attestation-dropdown-"));
  let server: Server | undefined;
  let context: BrowserContext | undefined;
  let gate: { reached: ReturnType<typeof signal>; released: ReturnType<typeof signal> } | undefined;
  const releases: Array<() => void> = [];
  const errors: string[] = [];
  const dialogs: string[] = [];
  try {
    const policyPaths = {
      policyPath: join(temporary, "policy.json"), draftPath: join(temporary, "draft.json"),
      metadataPath: join(temporary, "draft.meta.json"),
    };
    await Promise.all([
      copyFile(join(root, "countersign/policy/countersign.policy.json"), policyPaths.policyPath),
      copyFile(join(root, "countersign/policy/countersign.policy.draft.json"), policyPaths.draftPath),
      copyFile(join(root, "countersign/policy/countersign.policy.draft.meta.json"), policyPaths.metadataPath),
    ]);
    const provenancePath = join(temporary, "events.jsonl");
    server = createApp({ countersignEnabled: enabled, policyPaths, provenancePath,
      credentialsPath: join(temporary, "credentials.json"), sessionSecret: "isolated-attestation-dropdown" }).listen(0, "localhost");
    await once(server, "listening", { signal: AbortSignal.timeout(timeout) });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const target = `http://localhost:${address.port}`;
    context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(timeout);
    await context.addInitScript(confirmationProbe);
    const page = await context.newPage();
    const challenges: Challenge[] = [];
    const submissions: Submission[] = [];
    const enrollment: string[] = [];
    let removedSsrControls = 0;
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", async dialog => {
      dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });
    await context.route("**/*", async route => {
      try {
        const request = route.request();
        const url = new URL(request.url());
        assert.equal(url.origin, origin, "All browser traffic must stay on the isolated localhost router.");
        assert.doesNotMatch(url.pathname, /^\/countersign\/policy\/(generate|approve)/, "No LLM or policy mutation.");
        if (url.pathname === "/register" || url.pathname.startsWith("/countersign/webauthn/register/")) enrollment.push(url.pathname);
        const challenge = request.method() === "POST" && url.pathname === "/countersign/challenge"
          ? { request: request.postDataJSON() } as Challenge : undefined;
        const submission = request.method() === "POST" && url.pathname === "/discussion/2/post"
          ? { request: request.postDataJSON() } as Submission : undefined;
        if (challenge) challenges.push(challenge);
        if (submission) submissions.push(submission);
        const response = await route.fetch({ url: target + url.pathname + url.search, maxRedirects: 0, timeout });
        if (challenge) {
          assert.equal(response.status(), 200, `Challenge issuance: ${await response.text()}`);
          challenge.response = await response.json();
          if (gate) {
            const current = gate;
            gate = undefined;
            current.reached.resolve(); // Server has issued/logged it; the client has not received it.
            await within(current.released.promise, "release gated challenge response");
          }
        }
        if (submission && enabled) {
          assert.equal(response.status(), 200, `Discussion submission: ${await response.text()}`);
          submission.response = await response.json();
        }
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location) {
          // Following a network redirect can bypass routing and hit a live :3000.
          // A document navigation re-enters this catch-all router instead.
          const next = new URL(location, origin);
          assert.equal(next.origin, origin);
          await route.fulfill({ response, status: 200, contentType: "text/html",
            body: `<script>location.replace(${JSON.stringify(next.pathname + next.search + next.hash)})</script>` });
        } else if (options.fallback && request.method() === "GET" && url.pathname === "/discussion/2") {
          const html = await response.text();
          const withoutControl = html.replace(/<div class="attestation-control">[\s\S]*?<\/div>/g, "");
          if (html.includes("data-countersign-attestation")) {
            assert.doesNotMatch(withoutControl, /data-countersign-attestation/);
            removedSsrControls++;
          }
          // Remove SSR markup before parsing, hence before the module initializes.
          await route.fulfill({ response, body: withoutControl });
        } else await route.fulfill({ response });
      } catch (error) {
        errors.push(`Isolated route: ${String(error)}`);
        await route.abort().catch(() => {});
      }
    });
    if (enabled) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal",
        hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    }
    await page.goto(origin + "/login");
    await page.getByRole("button", { name: "Continue as Capt J. Demo", exact: true }).click();
    if (enabled) {
      await page.waitForURL(origin + "/register");
      await page.getByRole("button", { name: "Register passkey with Touch ID", exact: true }).click();
    }
    await page.waitForURL(origin + "/quiz/1");
    const registrationCalls = await confirmations(page);
    assert.equal(registrationCalls.length, enabled ? 1 : 0);
    if (enabled) assertConfirmation(registrationCalls[0], "create", "set up this passkey", /Follow your device’s passkey prompt\. Countersign never receives your fingerprint or other biometric data\./);
    await page.goto(origin + "/discussion/2");
    await run({ page, origin, challenges, submissions, enrollment,
      removedSsrControls: () => removedSsrControls,
      events: async () => (await readProvenanceEvents(provenancePath)).filter(event => event.action === action),
      gateNextChallenge() {
        assert.equal(gate, undefined);
        gate = { reached: signal(), released: signal() };
        releases.push(gate.released.resolve);
        return { reached: gate.reached.promise, release: gate.released.resolve };
      },
    });
    assert.deepEqual(dialogs, [], "Disclosure must never open window.prompt or another JavaScript dialog.");
    assert.deepEqual(errors, []);
    assert.equal(enrollment.filter(path => path.endsWith("/register/verify")).length, enabled ? 1 : 0,
      "Retries use the existing real virtual credential without re-enrollment.");
    if (!enabled) assert.deepEqual(enrollment, []);
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    if (errors.length || dialogs.length) console.error({ errors, dialogs });
    throw error;
  } finally {
    for (const release of releases) release();
    try { await context?.close(); }
    finally {
      try {
        if (server) await within(new Promise<void>((resolve, reject) => {
          server!.close(error => error ? reject(error) : resolve());
          server!.closeAllConnections();
        }), "close isolated server");
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
  }
}

async function assertControl(page: Page) {
  const select = page.locator(selector);
  assert.equal(await select.count(), 1, "SSR and injected controls must not duplicate each other.");
  assert.equal(await page.getByRole("combobox", { name: "How was this response prepared?", exact: true }).count(), 1);
  assert.equal(await page.getByLabel("How was this response prepared?", { exact: true }).getAttribute("id"), await select.getAttribute("id"));
  assert.equal(await select.getAttribute("name"), "countersign[attestation]");
  assert.equal(await select.inputValue(), "", "No disclosure may be preselected.");
  assert.equal(await select.evaluate((element: HTMLSelectElement) => element.required && element.validity.valueMissing), true);
  assert.deepEqual(await select.locator("option").evaluateAll(options => options.map(option => ({
    value: (option as HTMLOptionElement).value, text: option.textContent,
    disabled: (option as HTMLOptionElement).disabled, selected: (option as HTMLOptionElement).selected,
  }))), [
    { value: "", text: "Choose a disclosure", disabled: true, selected: true },
    { value: "own-work", text: "Own work", disabled: false, selected: false },
    { value: "ai-assisted", text: "AI-assisted", disabled: false, selected: false },
  ]);
  const describedBy = await select.getAttribute("aria-describedby");
  assert.ok(describedBy);
  assert.match(await page.locator(`[id="${describedBy}"]`).innerText(), /This disclosure is recorded with your presence check/);
}

async function assertUnpublished(h: Harness, expectedChoices: Disclosure[]) {
  assert.equal(h.submissions.length, 0, "No discussion POST may be sent on invalidation/cancellation.");
  assert.equal(await h.page.locator("[data-post-id]").count(), 0);
  // Inspect a fresh server rendering too: a stale DOM alone cannot prove no post.
  const posts = await h.page.evaluate(async () => {
    const response = await fetch("/discussion/2");
    if (!response.ok) throw new Error(`Discussion reload returned ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), "text/html").querySelectorAll("[data-post-id]").length;
  });
  assert.equal(posts, 0, "Peer posts remain locked; nothing was published server-side.");
  const events = await h.events();
  assert.deepEqual(events.map(event => event.decision), expectedChoices.map(() => "presence-requested"));
  assert.deepEqual(events.map(event => event.attestation), expectedChoices);
  assert.equal(h.challenges.length, expectedChoices.length);
  for (const event of events) assert.equal(event.form_hash, formHash({ body }));
  assert.equal(await h.page.getByRole("button", { name: "Publish response", exact: true }).isEnabled(), true);
}

async function publishAndVerify(h: Harness, choice: Disclosure) {
  const { page } = h;
  await page.getByRole("button", { name: "Publish response", exact: true }).click();
  await page.waitForURL(url => url.searchParams.has("posted"));
  const postId = new URL(page.url()).searchParams.get("posted");
  assert.ok(postId);
  await page.locator(`[data-post-id="${postId}"]`).waitFor();
  const nativeCalls = await confirmations(page);
  assertDisclosureConfirmation(nativeCalls.at(-1)!, "get", choice);
  assert.equal(h.submissions.length, 1, "Exactly one publication, even after a retry.");
  const submission = h.submissions[0];
  const { countersign, ...fields } = submission.request;
  assert.ok(countersign);
  assert.deepEqual(fields, { body }, "Business fields contain the exact body and no named attestation/countersign field.");
  assert.deepEqual(Object.keys(countersign).sort(), ["assertion", "attestation", "challenge_id", "telemetry"]);
  const expectedHash = formHash({ body });
  assert.equal(formHash(submission.request), expectedHash, "The complete canonical hash is content-only.");
  const issued = h.challenges.at(-1)!;
  assert.ok(issued.response);
  assert.deepEqual(issued.request, { rule_id: "discussion-initial-post", action, form_hash: expectedHash, attestation: choice });
  assert.equal(countersign.attestation, choice);
  assert.equal(countersign.challenge_id, issued.response.challenge_id);
  const clientData = JSON.parse(Buffer.from(countersign.assertion.response.clientDataJSON, "base64url").toString("utf8"));
  assert.equal(clientData.type, "webauthn.get");
  assert.equal(clientData.origin, h.origin);
  assert.equal(clientData.challenge, issued.response.options.challenge, "Virtual proof signs the freshly issued challenge.");
  const events = await h.events();
  const requested = events.filter(event => event.decision === "presence-requested");
  assert.equal(requested.length, h.challenges.length);
  for (const [index, event] of requested.entries()) {
    assert.equal(event.attestation, h.challenges[index].request.attestation);
    assert.equal(event.form_hash, expectedHash);
    assert.equal(h.challenges[index].request.form_hash, expectedHash);
  }
  const accepted = events.filter(event => event.decision === "allowed");
  assert.equal(accepted.length, 1);
  const evidence = accepted[0];
  assert.equal(evidence.attestation, choice);
  assert.equal(evidence.form_hash, expectedHash);
  assert.equal(evidence.actor_class, "human-verified");
  assert.ok(evidence.presence?.up && evidence.presence.uv && evidence.presence.assertion_id);
  assert.equal(evidence.presence.credential_id, countersign.assertion.id);
  assert.ok(evidence.telemetry);
  assert.equal(events.some(event => event.decision === "blocked"), false);
  assert.equal(submission.response?.ok, true);
  assert.equal(submission.response.post_id, postId);
  assert.equal(submission.response.provenance.event_id, evidence.event_id);
  assert.equal(submission.response.provenance.attestation, choice);
  assert.equal(submission.response.provenance.presence?.assertion_id, evidence.presence.assertion_id);
  const post = page.locator(`[data-post-id="${postId}"]`);
  assert.equal(await post.locator(".forum-text").textContent(), body.trim());
  assert.equal(await post.locator("[data-attestation]").getAttribute("data-attestation"), evidence.attestation);
  assert.equal(await post.locator("[data-disclosure]").innerText(), choice === "own-work" ? "Own work (declared)" : "AI-assisted (disclosed)");
  assert.ok((await post.textContent())!.includes(evidence.presence.assertion_id));
}

try {
  await scenario("empty disclosure blocks native, requestSubmit, and validation-bypassing submit events without challenge/POST", async h => {
    await assertControl(h.page);
    await h.page.locator('textarea[name="body"]').fill(body);
    await h.page.getByRole("button", { name: "Publish response", exact: true }).click();
    await h.page.locator('form[action="/discussion/2/post"]').evaluate((form: HTMLFormElement) => form.requestSubmit());
    // dispatchEvent bypasses native constraint validation, exercising readAttestation.
    // HTMLFormElement.submit() bypasses all submit listeners, so it is not this API.
    const defaultAllowed = await h.page.locator('form[action="/discussion/2/post"]').evaluate(form =>
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    assert.equal(defaultAllowed, false);
    await h.page.waitForFunction(() => document.querySelector("[data-countersign-status]")?.textContent?.includes("Choose Own work or AI-assisted"));
    assert.equal(await h.page.locator(selector).inputValue(), "");
    await assertUnpublished(h, []);
    assert.deepEqual((await confirmations(h.page)).map(call => call.method), ["create"], "An empty disclosure must not invoke credentials.get.");
  });

  for (const choice of ["own-work", "ai-assisted"] as const) {
    await scenario(`${choice}: issued binding, signed challenge, envelope, audited enum, UI disclosure, and exact content-only SHA-256`, async h => {
      await assertControl(h.page);
      await h.page.locator('textarea[name="body"]').fill(body);
      await h.page.locator(selector).selectOption(choice);
      await publishAndVerify(h, choice);
    });
  }

  await scenario("changed disclosure while challenge response is gated aborts publication; changed choice retries with a fresh challenge", async h => {
    await h.page.locator('textarea[name="body"]').fill(body);
    await h.page.locator(selector).selectOption("own-work");
    const gate = h.gateNextChallenge();
    try {
      await h.page.getByRole("button", { name: "Publish response", exact: true }).click();
      await within(gate.reached, "server issues the held challenge");
      assert.equal(h.challenges[0].request.attestation, "own-work");
      assert.equal(await h.page.getByRole("button", { name: "Publish response", exact: true }).isDisabled(), true);
      assert.equal(h.submissions.length, 0);
      assert.equal((await confirmations(h.page)).filter(call => call.method === "get").length, 0);
      const waiting = await h.page.evaluate<Confirmation>('window.__humanConfirmationSnapshot("pending")');
      assertDisclosureConfirmation(waiting, "pending", "own-work");
      await h.page.locator(selector).selectOption("ai-assisted");
    } finally { gate.release(); }
    await h.page.waitForFunction(() => document.querySelector("[data-countersign-status]")?.textContent?.includes("Your disclosure changed during confirmation"));
    assert.equal(await h.page.locator(selector).inputValue(), "ai-assisted");
    await assertUnpublished(h, ["own-work"]);
    const firstCalls = await confirmations(h.page);
    assert.equal(firstCalls.length, 2);
    assertDisclosureConfirmation(firstCalls[1], "get", "own-work");
    await publishAndVerify(h, "ai-assisted");
    assert.equal(h.challenges.length, 2);
    assert.notEqual(h.challenges[1].response!.challenge_id, h.challenges[0].response!.challenge_id);
  });

  await scenario("one canceled credential call retains disclosure, restores submit, publishes nothing, and retries with a fresh virtual proof", async h => {
    await h.page.locator('textarea[name="body"]').fill(body);
    await h.page.locator(selector).selectOption("ai-assisted");
    // Installed after actual registration. Restore the original property before
    // rejecting once; retry must use Chrome's genuine virtual authenticator.
    await h.page.evaluate(`(() => {
      const original = navigator.credentials.get;
      const descriptor = Object.getOwnPropertyDescriptor(navigator.credentials, "get");
      window.__dropdownCancellation = { calls: 0, restored: false };
      Object.defineProperty(navigator.credentials, "get", { configurable: true, value: function () {
        window.__dropdownCanceledConfirmation = window.__humanConfirmationSnapshot("get");
        window.__dropdownCancellation.calls++;
        if (descriptor) Object.defineProperty(navigator.credentials, "get", descriptor);
        else delete navigator.credentials.get;
        window.__dropdownCancellation.restored = navigator.credentials.get === original;
        return Promise.reject(new DOMException("Synthetic one-time cancellation", "NotAllowedError"));
      }});
    })()`);
    await h.page.getByRole("button", { name: "Publish response", exact: true }).click();
    await h.page.waitForFunction(() => document.querySelector("[data-countersign-status]")?.textContent?.includes("A human must confirm this action. You can try again."));
    assert.deepEqual(await h.page.evaluate("window.__dropdownCancellation"), { calls: 1, restored: true });
    assertDisclosureConfirmation(await h.page.evaluate<Confirmation>("window.__dropdownCanceledConfirmation"), "get", "ai-assisted");
    assert.equal(await h.page.locator(selector).inputValue(), "ai-assisted");
    assert.equal(await h.page.locator('textarea[name="body"]').inputValue(), body);
    await assertUnpublished(h, ["ai-assisted"]);
    await publishAndVerify(h, "ai-assisted");
    assert.equal(h.challenges.length, 2);
    assert.notEqual(h.challenges[1].response!.challenge_id, h.challenges[0].response!.challenge_id);
  });

  await scenario("client fallback injects one accessible, required, unselected disclosure and submits the selected enum", async h => {
    assert.equal(h.removedSsrControls(), 1, "SSR control was removed before client initialization.");
    await assertControl(h.page);
    assert.equal(await h.page.locator(selector).getAttribute("id"), "countersign-attestation");
    await h.page.locator('textarea[name="body"]').fill(body);
    await h.page.locator(selector).selectOption("own-work");
    await publishAndVerify(h, "own-work");
  }, { fallback: true });

  await scenario("ungoverned publication has no disclosure selector, JavaScript prompt, challenge, or enrollment", async h => {
    assert.equal(await h.page.locator(selector).count(), 0);
    assert.equal(await h.page.locator('[name="countersign[attestation]"]').count(), 0);
    assert.equal(await h.page.locator('script[src="/assets/countersign.js"]').count(), 0);
    assert.deepEqual(h.enrollment, []);
    await h.page.locator('textarea[name="body"]').fill(body);
    await h.page.getByRole("button", { name: "Publish response", exact: true }).click();
    await h.page.waitForURL(url => url.searchParams.has("posted"));
    const postId = new URL(h.page.url()).searchParams.get("posted");
    assert.ok(postId);
    await h.page.locator(`[data-post-id="${postId}"]`).waitFor();
    assert.equal(h.submissions.length, 1);
    // Native URL-encoded forms normalize textarea line endings to CRLF.
    assert.deepEqual(h.submissions[0].request, { body: body.replaceAll("\n", "\r\n") });
    assert.equal(h.challenges.length, 0);
    assert.deepEqual(await h.events(), []);
    assert.equal(await h.page.locator(selector).count(), 0);
    assert.equal(await h.page.locator(`[data-post-id="${postId}"] [data-attestation]`).count(), 0);
    assert.deepEqual(await confirmations(h.page), [], "Ungoverned publication never invokes a native credential method.");
  }, { enabled: false });
  console.log("PASS: required setup/publication status, heading, and explanation are visible in the viewport before native credentials.create/get; gated disclosure text matches the issued choice.");
  console.log("PASS: 7 isolated dropdown scenarios; virtual WebAuthn proofs only, not physical Touch ID verification.");
} finally { await browser.close(); }
