// Optional manual browser check; uses the same locally installed Playwright as
// dashboard-browser-smoke.mts, not a production dependency or presence bypass.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../../portal/app.ts";
import { readProvenanceEvents } from "../../countersign/server/log.ts";

const root = process.cwd();
await mkdir(join(root, "node_modules/.cache"), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const enabled of [true, false]) {
    const mode = enabled ? "governed" : "ungoverned";
    const origin = `http://localhost:${enabled ? 3000 : 3001}`;
    const temporary = await mkdtemp(join(root, "node_modules/.cache/discussion-reset-"));
    const credentialsPath = join(temporary, "credentials.json");
    const provenancePath = join(temporary, "events.jsonl");
    const server = createApp({ countersignEnabled: enabled, credentialsPath, provenancePath,
      sessionSecret: "isolated-discussion-reset-browser" }).listen(0, "localhost");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const target = `http://localhost:${address.port}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let resets = 0; let registrations = 0; let attestations = 0;
    await context.route(`${origin}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/discussion/2/reset" && route.request().method() === "POST") resets++;
      if (url.pathname === "/countersign/webauthn/register/verify") registrations++;
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
      await page.goto(origin + "/discussion/2");
      const publish = async (text: string, attestation: string) => {
        await page.locator('textarea[name="body"]').fill(text);
        if (enabled) page.once("dialog", async dialog => { attestations++; await dialog.accept(attestation); });
        await page.getByRole("button", { name: "Publish response", exact: true }).click();
        await page.waitForURL(url => url.searchParams.has("posted"));
        await page.waitForLoadState("networkidle");
        assert.equal(await page.locator("[data-post-id]").count(), 31);
        return new URL(page.url()).searchParams.get("posted")!;
      };
      const firstId = await publish("First synthetic response in the reset browser check.", "own-work");
      const before = await readProvenanceEvents(provenancePath);
      const firstProof = before.find(event => event.action === "POST /discussion/2/post" && event.decision === "allowed")?.presence;
      const priorLog = await readFile(provenancePath, "utf8").catch(() => "");
      const credentialFile = await readFile(credentialsPath, "utf8").catch(() => "");
      assert.equal(await page.locator("[data-demo-controls]").getAttribute("open"), null);
      await page.locator("[data-demo-controls] > summary").click();
      const oldToken = await page.locator('input[name="reset_token"]').inputValue();
      await page.getByRole("button", { name: "Reset discussion demo", exact: true }).click();
      assert.equal(await page.locator('input[name="confirmation"]').evaluate((element: HTMLInputElement) => element.validity.valueMissing), true);
      assert.equal(resets, 0, "native confirmation blocks accidental reset");
      await page.locator('input[name="confirmation"]').check();
      await page.getByRole("button", { name: "Reset discussion demo", exact: true }).click();
      await page.waitForURL(origin + "/discussion/2?reset=1");
      await page.waitForLoadState("networkidle");
      assert.equal(resets, 1);
      assert.equal(await page.locator("[data-post-id]").count(), 0);
      assert.equal(await page.locator('textarea[name="body"]').inputValue(), "");
      assert.match(await page.locator("main").innerText(), /Discussion demo reset/);
      assert.equal(await readFile(credentialsPath, "utf8").catch(() => ""), credentialFile);
      assert.ok((await readFile(provenancePath, "utf8")).startsWith(priorLog));
      const resetEvents = (await readProvenanceEvents(provenancePath)).filter(event => event.rule_id === "demo-discussion-reset");
      assert.equal(resetEvents.length, 1);
      assert.match(resetEvents[0].notes, new RegExp(`COUNTERSIGN=${enabled ? "on" : "off"}`));
      if (enabled) {
        const status = await page.evaluate(async () => (await fetch("/discussion/2/post", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Synthetic no-proof attempt." }) })).status);
        assert.equal(status, 403);
      }
      await page.screenshot({ path: join(root, `docs/build-log/discussion-reset-${mode}.png`), fullPage: true });
      if (enabled) {
        await page.goto(origin + "/quiz/1");
        for (const [index, answer] of ["c", "a", "d", "b", "c"].entries()) await page.locator(`input[name="answers[q${index + 1}]"][value="${answer}"]`).check();
        await page.getByRole("button", { name: "Submit quiz", exact: true }).click();
        await page.waitForFunction(() => document.body.innerText.includes("Quiz submitted"));
        await page.goto(origin + "/record/1");
        await page.getByRole("button", { name: "Verify presence to view", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-field="ssn"]')?.textContent?.includes("900-12-3411"));
        const events = await readProvenanceEvents(provenancePath);
        assert.ok(events.some(event => event.rule_id === "quiz-submit" && event.decision === "allowed" && event.presence?.uv));
        assert.ok(events.some(event => event.decision === "unmasked" && event.presence?.uv));
        await page.goto(origin + "/discussion/2");
        console.log("PASS: quiz submission and record reveal still verify presence after a discussion reset.");
      }
      const secondId = await publish("Second synthetic response after reset, using a new initial-post ceremony.", "ai-assisted");
      assert.notEqual(secondId, firstId);
      assert.equal(await page.locator(`[data-post-id="${firstId}"]`).count(), 0);
      const replayStatus = await page.evaluate(async token => (await fetch("/discussion/2/reset", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ reset_token: token, confirmation: "reset-discussion" }) })).status, oldToken);
      assert.equal(replayStatus, 403);
      const after = await readProvenanceEvents(provenancePath);
      if (enabled) {
        assert.equal(attestations, 2);
        assert.equal(registrations, 1);
        const accepted = after.filter(event => event.action === "POST /discussion/2/post" && event.decision === "allowed");
        assert.equal(accepted.length, 2);
        assert.equal(accepted[1].attestation, "ai-assisted");
        assert.equal(accepted[1].actor_class, "human-verified");
        assert.ok(accepted[1].presence?.up);
        assert.notEqual(accepted[1].presence!.assertion_id, firstProof!.assertion_id);
      } else {
        assert.equal(attestations, 0);
        assert.equal(registrations, 0);
        assert.deepEqual(after.map(event => event.rule_id), ["demo-discussion-reset"]);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS (${mode}): native confirmation, post-reset-post without restart/re-enrollment, hidden peers, retained audit, stale-token rejection, and ${enabled ? "fresh attestation/assertion" : "maintenance-only audit"}.`);
    } finally {
      await context.close();
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await rm(temporary, { recursive: true, force: true });
    }
  }
} finally { await browser.close(); }
