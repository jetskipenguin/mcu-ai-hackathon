# Live governed quiz verification — 2026-09-16

The tester reported: **“that worked - Quiz submitted. Human presence verified.”**

At 11:18 EDT, a GET of `http://localhost:3000/countersign/events` confirmed these
two events on the live demo server. This is separate from the earlier isolated
virtual-authenticator test.

## Observed server evidence

| Field | Presence request | Accepted submission |
|---|---|---|
| Timestamp (UTC) | `2026-09-16T15:17:29.309Z` | `2026-09-16T15:17:39.276Z` |
| Event ID | `evt_88ec9828487544c38f7a543af021ac90` | `evt_47adf1ea01fb4324aeb3b13e4d660f2b` |
| User | `stu-0011`, Capt J. Demo | Same |
| Route / action | `/quiz/1` / `POST /quiz/1/submit` | Same |
| Rule / class | `quiz-submit` / `human-required` | Same |
| Decision | `presence-requested` | `allowed` |
| Actor class | `unverified` | `human-verified` |
| Assertion ID | — | `asr_933fd3dd-02f7-48e4-9296-f796f96c5eee` |
| User presence (UP) | — | `true` |
| User verification (UV) | — | `true` |
| Challenge age | — | `9967 ms` |

The session IDs and form hashes match across the two events. The form hash is:

```text
sha256:d99ca163e3461df6c4f3984912d4a288125066dfc6922178f39b7b7d4b3be7cf
```

**Result:** live server acceptance of a fresh, verified action-bound assertion,
consistent with the success message reported by the tester.

## Recording still needed

The preceding instructions offered an agent continuation and a manual-submit
fallback; the tester's success report does not distinguish which clicked Submit.
UP/UV flags establish the verified assertion properties, not which physical
verification method was used. Capture a continuous run showing:

1. Nanobrowser finishing the quiz and clicking Submit on port 3000.
2. The OS presence prompt and the agent waiting.
3. The human using Touch ID.
4. The successful submission and matching provenance event.

The Comet-specific localhost sensor check also remains pending. Do not mark M6
or the full recorded A5 checkpoint complete from this server evidence alone.
