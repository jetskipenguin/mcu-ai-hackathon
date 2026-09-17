import assert from "node:assert/strict";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../portal/app.ts";
import { appendProvenanceEvent, readProvenanceEvents } from "../../countersign/server/log.ts";

type ConfirmationPart = {
  text: string; visible: boolean; unobscured: boolean;
  bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
};
type Confirmation = {
  method: string; path: string; role: string | null; viewport: { width: number; height: number };
  parts: { status: ConfirmationPart; heading: ConfirmationPart; detail: ConfirmationPart };
  fields: Record<string, string>;
};

// Raw JavaScript avoids tsx's __name helper in serialized browser functions.
// Snapshot synchronously BEFORE calling the original, preserving this, arguments,
// the native promise, and Chrome's actual virtual-authenticator proof generation.
const confirmationProbe = `(() => {
  window.__humanConfirmationSnapshot = method => {
    const status = document.querySelector(location.pathname === "/record/1" ? "[data-record-status]" : "[data-countersign-status]");
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
      fields: Object.fromEntries([...document.querySelectorAll("[data-protected-record] [data-field]")].map(field => [field.dataset.field, field.textContent])),
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

function assertConfirmation(snapshot: Confirmation, method: string, path: string, action: string, explanation: RegExp) {
  assert.ok(snapshot, `Missing ${method} boundary snapshot for ${action}.`);
  assert.equal(snapshot.method, method);
  assert.equal(snapshot.path, path);
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

const maskedFields = Object.fromEntries(["name", "ssn", "dod-id", "medical"].map(field => [field, "[Hidden — verify presence to view]"]));

const root = process.cwd();
await mkdir(join(root, "node_modules/.cache"), { recursive: true });
const temporary = await mkdtemp(join(root, "node_modules/.cache/dashboard-state-"));
const provenancePath = join(temporary, "events.jsonl");
let server: Server | undefined;
let browser: Browser | undefined;
try {
  const policyPaths = { policyPath: join(temporary, "policy.json"), draftPath: join(temporary, "draft.json"),
    metadataPath: join(temporary, "draft.meta.json") };
  await Promise.all([
    copyFile(join(root, "countersign/policy/countersign.policy.json"), policyPaths.policyPath),
    copyFile(join(root, "countersign/policy/countersign.policy.draft.json"), policyPaths.draftPath),
    copyFile(join(root, "countersign/policy/countersign.policy.draft.meta.json"), policyPaths.metadataPath),
  ]);
  server = createApp({ countersignEnabled: true, credentialsPath: join(temporary, "credentials.json"),
    provenancePath, policyPaths, sessionSecret: "isolated-dashboard-browser-check" }).listen(0, "localhost");
  await once(server, "listening", { signal: AbortSignal.timeout(15_000) });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const target = `http://localhost:${address.port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 15_000 });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, serviceWorkers: "block" });
  await context.addInitScript(confirmationProbe);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  const errors: string[] = [];
  const dialogs: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { dialogs.push(`${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); });
  let failEvents = false;
  let delayEvents = 0;
  let eventRequests = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  let recordVerifications = 0;
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const isEvents = url.pathname === "/countersign/events";
    if (isEvents) {
      eventRequests++;
      maximumInFlight = Math.max(maximumInFlight, ++inFlight);
    }
    try {
      assert.equal(url.origin, "http://localhost:3000", "Only isolated localhost traffic is permitted.");
      assert.doesNotMatch(url.pathname, /^\/countersign\/policy\/(generate|approve)/);
      if (url.pathname === "/countersign/unmask/verify" && route.request().method() === "POST") recordVerifications++;
      if (isEvents && delayEvents) await new Promise(resolve => setTimeout(resolve, delayEvents));
      if (isEvents && failEvents) {
        await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"synthetic-test-failure"}' });
      } else {
        const response = await route.fetch({ url: target + url.pathname + url.search, maxRedirects: 0, timeout: 15_000 });
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location) {
          // Browser-followed redirects can bypass Playwright's route handler.
          // Explicit navigation re-enters it and cannot escape to the live app.
          const next = new URL(location, "http://localhost:3000");
          assert.equal(next.origin, "http://localhost:3000");
          await route.fulfill({ response, status: 200, contentType: "text/html",
            body: `<script>location.replace(${JSON.stringify(next.pathname + next.search + next.hash)})</script>` });
        } else await route.fulfill({ response });
      }
    } catch (error) {
      errors.push(`Isolated route: ${String(error)}`);
      await route.abort().catch(() => {});
    } finally { if (isEvents) inFlight--; }
  });
  const actors = ["human-verified", "agent-declared", "automation-suspected", "unverified"] as const;
  const seed = (index: number) => appendProvenanceEvent({
    session_id: `sess_synthetic_${index}`, user: { id: index % 2 ? "stu-ui-b" : "stu-ui-a", name: "Capt Synthetic Viewer" },
    route: "/quiz/1", action: "POST /quiz/1/submit", rule_id: "quiz-submit", class: "human-required",
    decision: index === 0 ? "allowed" : "blocked", actor_class: actors[index % 4],
    presence: index % 4 === 0 ? { assertion_id: "asr_synthetic_fixture", credential_id: "synthetic-public-id", up: true, uv: true, age_ms: 40 } : null,
    attestation: null, signals: { score: index % 4 === 2 ? 0.8 : 0, flags: [] }, telemetry: null, form_hash: null,
    notes: index === 0 ? '</script><img src=x onerror="window.xss=true"> Synthetic display fixture.' : "Synthetic display fixture.",
  }, provenancePath);

  const initial = [];
  for (let index = 0; index < 4; index++) initial.push(await seed(index));
  await page.goto("http://localhost:3000/countersign/");
  await page.waitForFunction(() => document.querySelectorAll("#events tr[data-event-id]").length === 4);
  assert.equal(await page.locator("#events tr.human-verified").count(), 1);
  assert.equal(await page.locator("#events tr.unverified").count(), 3);
  for (const [index, actor] of actors.entries()) {
    const evidence = await page.locator(`#events tr[data-event-id="${initial[index].event_id}"] pre`).textContent();
    assert.equal(JSON.parse(evidence!).actor_class, actor, "Historical actor labels remain intact in evidence.");
  }
  assert.equal(await page.locator("#user-filter option").count(), 3);
  await page.locator(`#events tr[data-event-id="${initial[0].event_id}"] a`).click();
  assert.equal(new URL(page.url()).searchParams.get("user"), "stu-ui-a");
  assert.equal(await page.locator("#events tr[data-event-id]").count(), 2);
  assert.doesNotMatch(await page.locator("#events").innerText(), /stu-ui-b/);
  const details = page.locator(`#events tr[data-event-id="${initial[0].event_id}"] details`);
  await details.locator("summary").click();
  await details.locator("summary").focus();
  const before = eventRequests;
  await page.waitForTimeout(2200);
  assert.ok(eventRequests >= before + 2, "one-second updates continue");
  assert.equal(await details.getAttribute("open"), "");
  assert.equal(await details.locator("summary").evaluate(element => element === document.activeElement), true);
  assert.equal(await page.locator("#events img").count(), 0);
  assert.equal(await page.evaluate(() => (window as any).xss), undefined);
  assert.match(await details.locator("pre").innerText(), /onerror/);
  await seed(4);
  await page.waitForFunction(() => document.querySelectorAll("#events tr[data-event-id]").length === 3);
  assert.equal(await details.getAttribute("open"), "");
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#events tr[data-event-id]").length === 3);
  assert.equal(await page.locator("#user-filter").inputValue(), "stu-ui-a");
  await page.locator("#user-filter").selectOption("stu-ui-b");
  assert.equal(await page.locator("#events tr[data-event-id]").count(), 2);
  assert.doesNotMatch(await page.locator("#events").innerText(), /stu-ui-a/);
  await page.getByRole("button", { name: "Show all users", exact: true }).click();
  assert.equal(await page.locator("#events tr[data-event-id]").count(), 5);
  await page.goto("http://localhost:3000/countersign/?user=unknown-synthetic");
  await page.getByText("No events for this user yet.", { exact: true }).waitFor();
  assert.equal(await page.locator("#user-filter").inputValue(), "unknown-synthetic");
  await page.getByRole("button", { name: "Show all users", exact: true }).click();
  console.log("PASS: presence-only colors with intact historical evidence, exact-ID drill-down for duplicate names, deep links, empty user, inert XSS text, live append, and persistent details/focus.");

  failEvents = true;
  await page.waitForFunction(() => document.querySelector("#timeline-status")!.textContent!.includes("HTTP 500"));
  assert.equal(await page.locator("#events tr[data-event-id]").count(), 5);
  failEvents = false;
  await page.waitForFunction(() => document.querySelector("#timeline-status")!.textContent!.startsWith("Showing"));
  delayEvents = 2200;
  maximumInFlight = 0;
  await page.waitForTimeout(4500);
  assert.equal(maximumInFlight, 1);
  delayEvents = 0;
  await page.waitForTimeout(2500);
  console.log("PASS: polling failures retain prior rows and recover; slow requests do not overlap.");

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal",
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto("http://localhost:3000/login");
  await page.getByRole("button", { name: "Continue as Capt J. Demo", exact: true }).click();
  await page.waitForURL("http://localhost:3000/register");
  await page.getByRole("button", { name: "Register passkey with Touch ID", exact: true }).click();
  await page.waitForURL("http://localhost:3000/quiz/1");
  const registrationCalls = await confirmations(page);
  assert.equal(registrationCalls.length, 1);
  assertConfirmation(registrationCalls[0], "create", "/register", "set up this passkey", /Follow your device’s passkey prompt\. Countersign never receives your fingerprint or other biometric data\./);
  for (const [index, answer] of ["c", "a", "d", "b", "c"].entries()) await page.locator(`input[name="answers[q${index + 1}]"][value="${answer}"]`).check();
  await page.getByRole("button", { name: "Submit quiz", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Quiz submitted"));
  const quizCalls = await confirmations(page);
  assert.equal(quizCalls.length, 2);
  assertConfirmation(quizCalls[1], "get", "/quiz/1", "submit this quiz", /Confirm with Touch ID or your device’s passkey prompt\. Nothing is submitted until you verify\./);
  const quiz = (await readProvenanceEvents(provenancePath)).find(event => event.user.id === "stu-0011" && event.rule_id === "quiz-submit" && event.decision === "allowed")!;
  assert.equal(quiz.actor_class, "human-verified");
  assert.ok(quiz.presence?.up && quiz.presence.uv && quiz.presence.assertion_id);
  await page.goto("http://localhost:3000/record/1");
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
  try {
    await page.getByRole("button", { name: "Verify presence to view", exact: true }).click();
    await page.waitForFunction('JSON.parse(sessionStorage.getItem("human-confirmation-calls") || "[]").length === 3', undefined, { timeout: 5_000 });
    const recordCalls = await confirmations(page);
    assertConfirmation(recordCalls[2], "get", "/record/1", "reveal this protected record", /The fields stay hidden until human verification succeeds\./);
    assert.deepEqual(recordCalls[2].fields, maskedFields, "Every sensitive field is masked before credentials.get.");
    // Allow painting while the unchanged native get() remains genuinely pending.
    // No application clicks or replacement credentials resolve this operation.
    await page.evaluate(`new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Pending-record paint check timed out")), 2000);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
    })`);
    const pending = await page.evaluate<Confirmation>('window.__humanConfirmationSnapshot("pending")');
    assertConfirmation(pending, "pending", "/record/1", "reveal this protected record", /The fields stay hidden until human verification succeeds\./);
    assert.deepEqual(pending.fields, maskedFields, "No sensitive field may reveal while the authenticator is pending.");
    assert.equal(await page.getByRole("button", { name: "Verify presence to view", exact: true }).isDisabled(), true);
    assert.equal(recordVerifications, 0, "No verification POST before the authenticator provides its proof.");
    assert.equal((await readProvenanceEvents(provenancePath)).some(event => event.decision === "unmasked"), false);
  } finally {
    // Re-enabling auto-presence does not resume an already-pending Chrome call.
    // End that probe by navigation while still paused, retaining the passkey;
    // the original happy path below then uses a fresh, real native assertion.
    try { await page.reload(); }
    finally { await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true }); }
  }
  assert.equal(recordVerifications, 0, "Navigating away from the pending call must not submit a proof.");
  const reloaded = await page.evaluate<Confirmation>('window.__humanConfirmationSnapshot("reloaded")');
  assert.deepEqual(reloaded.fields, maskedFields, "The abandoned ceremony must not reveal a reloaded view.");
  await page.getByRole("button", { name: "Verify presence to view", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-field="ssn"]')?.textContent?.includes("900-12-3411"));
  const revealCalls = await confirmations(page);
  assert.equal(revealCalls.length, 4);
  assertConfirmation(revealCalls[3], "get", "/record/1", "reveal this protected record", /The fields stay hidden until human verification succeeds\./);
  assert.deepEqual(revealCalls[3].fields, maskedFields);
  assert.equal(recordVerifications, 1);
  const reveal = (await readProvenanceEvents(provenancePath)).find(event => event.decision === "unmasked");
  assert.ok(reveal?.presence?.up && reveal.presence.uv && reveal.presence.assertion_id);
  await page.goto("http://localhost:3000/discussion/2");
  await page.locator('textarea[name="body"]').fill("Synthetic browser verification of the dashboard and finalized advisory composition contract.");
  await page.locator("select[data-countersign-attestation]").selectOption("own-work");
  await page.getByRole("button", { name: "Publish response", exact: true }).click();
  await page.getByText("Flagged for review", { exact: true }).waitFor();
  const discussionCalls = await confirmations(page);
  assert.equal(discussionCalls.length, 5);
  assertConfirmation(discussionCalls[4], "get", "/discussion/2", "publish this response", /Disclosure: Own work\. Confirm with Touch ID or your device’s passkey prompt\. Nothing is submitted until you verify\./);
  const discussion = (await readProvenanceEvents(provenancePath)).filter(event => event.user.id === "stu-0011" && event.action === "POST /discussion/2/post");
  assert.deepEqual(discussion.map(event => event.decision), ["presence-requested", "allowed", "contradiction"]);
  assert.deepEqual(discussion.map(event => event.attestation), ["own-work", "own-work", "own-work"]);
  const postId = new URL(page.url()).searchParams.get("posted");
  assert.ok(postId);
  assert.equal(await page.locator(`[data-post-id="${postId}"] [data-attestation]`).getAttribute("data-attestation"), discussion[1].attestation);
  assert.equal(await page.locator(`[data-post-id="${postId}"] [data-disclosure]`).innerText(), "Own work (declared)");
  assert.deepEqual(dialogs, [], "Disclosure uses a dropdown, never window.prompt.");
  assert.ok(discussion[1].telemetry);
  assert.doesNotMatch(discussion[1].notes, /Discarded/);
  console.log("PASS: fresh browser enrollment, quiz presence submission, record reveal, and own-work contradiction publication survive the finalized audit contract.");
  console.log("PASS: setup, quiz, record, and discussion explanations are visible before native credentials.create/get; all four record fields remain masked during a pending virtual-authenticator call.");

  await page.goto("http://localhost:3000/countersign/?user=stu-0011");
  const proofRow = page.locator(`#events tr[data-event-id="${quiz.event_id}"]`);
  await proofRow.locator("summary").click();
  assert.match(await proofRow.locator("pre").innerText(), new RegExp(quiz.presence!.assertion_id));
  await page.screenshot({ path: process.env.SCREENSHOT_PATH ?? join(root, "docs/build-log/dashboard-user-drilldown.png"), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
  console.log("PASS: dashboard links the real verified quiz decision to its assertion and preserves the new discussion review event.");
} finally {
  try { await browser?.close(); }
  finally {
    try {
      if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
