# A7–A8 record protection verification

Verified 2026-09-16 using BrowserOS neo against the running governed portal at `http://localhost:3000`.

## Reproduction

1. Open the portal in a background BrowserOS tab.
2. Select the synthetic demo student and follow **Student record**.
3. Read the page through BrowserOS's normal page-content tool.

Before the change, all four record fields were returned. After the change:

> Automation suspected. Sensitive content hidden — verify presence to view.

Name, SSN, DoD ID, and medical note each contain `[Hidden — verify presence to view]`.

The initial HTML was separately checked: none of those field values were embedded. The response included `Cache-Control: no-store` and `Countersign-Marking` (using the repository's existing placeholder vocabulary). The most recent record event was:

```json
{
  "action": "GET /record/1",
  "decision": "masked",
  "actor_class": "automation-suspected",
  "signals": {
    "score": 0.6,
    "flags": ["background-record-read"]
  }
}
```

Observed BrowserOS signals: ordinary Chrome user agent, `webdriver=false`, document hidden, no focus. Detection therefore uses the background record-read heuristic, not a claimed BrowserOS fingerprint. Human background tabs can trigger it; foreground automation or falsified signals can evade it. Server-side withholding closes the initial-HTML race, not all possible agent reads.

## Checks

- `npm run build`: passed.
- `npm test`: 10 passed, 0 failed, 7 pre-existing quiz/WebAuthn TODOs.
- `git diff --check`: passed.
- New tests cover initial HTML, missing signals, threshold masking, sticky evidence, foreground human access, correct student binding, unauthenticated access, ungoverned behavior, forged assertions, session binding, replay, expiry, UV, and provenance metadata.
- A real ES256-signed WebAuthn assertion exercises the actual SimpleWebAuthn verifier; missing UP/UV, wrong origin, and invalid signature are rejected.

Physical passkey enrollment and Touch ID / Windows Hello confirmation remain a human rehearsal step. Quiz/discussion enforcement is still scaffolded; these record tests do not certify that demo flow.
