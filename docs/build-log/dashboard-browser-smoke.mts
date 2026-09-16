import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../../portal/app.ts";
import { appendProvenanceEvent, readProvenanceEvents } from "../../countersign/server/log.ts";

const root = process.cwd();
await mkdir(join(root, "node_modules/.cache"), { recursive: true });
const temporary = await mkdtemp(join(root, "node_modules/.cache/dashboard-state-"));
const provenancePath = join(temporary, "events.jsonl");
const server = createApp({ countersignEnabled: true, credentialsPath: join(temporary, "credentials.json"),
  provenancePath, sessionSecret: "isolated-dashboard-browser-check" }).listen(0, "localhost");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const target = `http://localhost:${address.port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
let failEvents = false;
let delayEvents = 0;
let eventRequests = 0;
let inFlight = 0;
let maximumInFlight = 0;
await context.route("http://localhost:3000/**", async route => {
  const url = new URL(route.request().url());
  const isEvents = url.pathname === "/countersign/events";
  if (isEvents) {
    eventRequests++;
    maximumInFlight = Math.max(maximumInFlight, ++inFlight);
  }
  try {
    if (isEvents && delayEvents) await new Promise(resolve => setTimeout(resolve, delayEvents));
    if (isEvents && failEvents) {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"synthetic-test-failure"}' });
    } else {
      const response = await route.fetch({ url: target + url.pathname + url.search, maxRedirects: 0 });
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

try {
  const initial = [];
  for (let index = 0; index < 4; index++) initial.push(await seed(index));
  await page.goto("http://localhost:3000/countersign/");
  await page.waitForFunction(() => document.querySelectorAll("#events tr[data-event-id]").length === 4);
  for (const actor of actors) assert.equal(await page.locator(`#events tr.${actor}`).count(), 1);
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
  console.log("PASS: all actor colors, exact-ID drill-down for duplicate names, deep links, empty user, inert XSS text, live append, and persistent details/focus.");

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
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal",
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto("http://localhost:3000/login");
  await page.getByRole("button", { name: "Continue as Capt J. Demo", exact: true }).click();
  await page.waitForURL("http://localhost:3000/register");
  await page.getByRole("button", { name: "Register passkey with Touch ID", exact: true }).click();
  await page.waitForURL("http://localhost:3000/quiz/1");
  for (const [index, answer] of ["c", "a", "d", "b", "c"].entries()) await page.locator(`input[name="answers[q${index + 1}]"][value="${answer}"]`).check();
  await page.getByRole("button", { name: "Submit quiz", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Quiz submitted"));
  const quiz = (await readProvenanceEvents(provenancePath)).find(event => event.user.id === "stu-0011" && event.rule_id === "quiz-submit" && event.decision === "allowed")!;
  assert.equal(quiz.actor_class, "human-verified");
  assert.ok(quiz.presence?.up && quiz.presence.uv && quiz.presence.assertion_id);
  await page.goto("http://localhost:3000/record/1");
  await page.getByRole("button", { name: "Verify presence to view", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-field="ssn"]')?.textContent?.includes("900-12-3411"));
  await page.goto("http://localhost:3000/discussion/2");
  await page.locator('textarea[name="body"]').fill("Synthetic browser verification of the dashboard and finalized advisory composition contract.");
  page.once("dialog", dialog => dialog.accept("own-work"));
  await page.getByRole("button", { name: "Publish response", exact: true }).click();
  await page.getByText("Flagged for review", { exact: true }).waitFor();
  const discussion = (await readProvenanceEvents(provenancePath)).filter(event => event.user.id === "stu-0011" && event.action === "POST /discussion/2/post");
  assert.deepEqual(discussion.map(event => event.decision), ["presence-requested", "allowed", "contradiction"]);
  assert.ok(discussion[1].telemetry);
  assert.doesNotMatch(discussion[1].notes, /Discarded/);
  console.log("PASS: fresh browser enrollment, quiz presence submission, record reveal, and own-work contradiction publication survive the finalized audit contract.");

  await page.goto("http://localhost:3000/countersign/?user=stu-0011");
  const proofRow = page.locator(`#events tr[data-event-id="${quiz.event_id}"]`);
  await proofRow.locator("summary").click();
  assert.match(await proofRow.locator("pre").innerText(), new RegExp(quiz.presence!.assertion_id));
  await page.screenshot({ path: join(root, "docs/build-log/dashboard-user-drilldown.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: dashboard links the real verified quiz decision to its assertion and preserves the new discussion review event.");
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  await rm(temporary, { recursive: true, force: true });
}
