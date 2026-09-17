import assert from "node:assert/strict";
import test from "node:test";
import { portalOrigin } from "../origin.js";

test("origin configuration keeps localhost defaults and canonicalizes public HTTPS origins", () => {
  assert.equal(portalOrigin(true, {}), "http://localhost:3000");
  assert.equal(portalOrigin(false, {}), "http://localhost:3001");
  const env = { PUBLIC_ORIGIN: "https://203.0.113.10.sslip.io:443/", UNGOVERNED_ORIGIN: "https://off.203.0.113.10.sslip.io" };
  assert.equal(portalOrigin(true, env), "https://203.0.113.10.sslip.io");
  assert.equal(portalOrigin(false, env), env.UNGOVERNED_ORIGIN);
});

test("origin configuration rejects non-origin URLs and public addresses incompatible with this WebAuthn deployment", () => {
  for (const origin of ["http://demo.example", "https://203.0.113.10", "https://[::1]",
    "https://demo.example/path", "https://user:password@demo.example", "https://demo.example?query=1",
    "https://demo.example#fragment", "ftp://demo.example", "not a URL"]) {
    assert.throws(() => portalOrigin(true, { PUBLIC_ORIGIN: origin }));
    assert.throws(() => portalOrigin(false, { UNGOVERNED_ORIGIN: origin }));
  }
});
