# A15 — presentation refresh and disclosure controls

Verified **2026-09-17T02:30:25Z** on `feat/presentation-refresh`, based on
`277f1d1`. This is the user-requested presentation work and its dropdown,
human-confirmation-message, and plain-copy follow-ups.

## Delivered

- One shared server-rendered shell (`countersign/server/ui.ts`) and stylesheet
  (`countersign/client/site.css`) for the demo and console. Local SVG icons,
  system fonts, navy/mint colors, consistent cards/buttons, visible focus, and
  responsive layouts; no new dependencies or external assets.
- Every page distinguishes **Demo portal** (Demo home, Quiz, Discussion,
  Protected record) from **Countersign console** (Activity log, Policy review).
  Grouped navigation, one active-page indicator, passkey/user utilities, and a
  keyboard skip link provide routes between the pages. The governance badge and
  comparison link identify the instance; comparison URLs respect configured
  origins. `/login` now explains the activities and offers the existing demo
  identity chooser. Routes, forms, and API identifiers are unchanged.
- Questions remain completely inside padded cards. The full quiz/forum source
  text, citations, paragraph breaks, and synthetic notice remain present. JSON
  wraps inside its panels; the wide timeline scrolls locally.
- A required **How was this response prepared?** dropdown replaces the
  free-form discussion prompt. **Own work** and **AI-assisted** map to the
  existing enums; an empty placeholder is selected initially. Its
  `countersign[attestation]` name is excluded from business-field serialization.
  The declaration remains independently bound to the WebAuthn challenge and
  submission envelope. The client injects the same accessible control on
  annotated attested forms without server-rendered controls.
- Editing the disclosure during verification prevents publication and requires
  a fresh challenge on retry. Cancellation preserves the choice and restores
  the submit button. Ungoverned discussion has no disclosure control/ceremony.
- **Human confirmation required — [action]** appears in the existing status
  region and is scrolled into view before the native credential request. The
  message identifies setup, quiz submission, publication (with disclosure), or
  record reveal. It adds no extra confirmation click. WebAuthn has no custom
  per-action OS-dialog message parameter; no native dialog is imitated or
  modified, and RP identity/proof requirements are unchanged.
- UI copy uses ordinary labels and instructions. Slogans such as “Three
  activities. Three boundaries.” and paired contrast headlines were removed.
  Imported source text and policy rationales were not rewritten.

## Automated suite

```sh
TMPDIR="$PWD/node_modules/.cache" npm test
npm run build
node --check countersign/client/countersign.js
git diff --check
```

**129 tests passed; zero failures, skips, or TODOs.** TypeScript build, client
syntax, and whitespace checks passed. There is no separate lint script.
Twelve new presentation tests cover both modes, route navigation, local assets,
escaping, configured origin links, complete source text, form controls, masked
record omission, and the ungoverned HTML quiz-result page.

An initial presentation assertion counted trailing whitespace before a
decorative SVG as part of a button label. It now trims that whitespace; the full
label and source-content assertions remain. No production behavior was weakened.

## Browser verification

Optional local Playwright with **Chrome 152.0.7977.83**; no package changes.

```sh
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/content-layout-browser-smoke.mts \
  --label=presentation-final --publish-evidence --evidence-prefix=presentation

TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/attestation-dropdown-browser-smoke.mts

SCREENSHOT_PATH="$PWD/node_modules/.cache/presentation-dashboard-flow.png" \
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/dashboard-browser-smoke.mts

SCREENSHOT_DIR="$PWD/node_modules/.cache/attestation-reset-smoke" \
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/discussion-reset-browser-smoke.mts
```

All four scripts passed:

- **75 route/viewport cases, 150 actual/long-token snapshots**, both modes at
  1280, 801, 799, 390, and 320 CSS pixels; zero findings/setup errors. Includes
  desktop and mobile login/setup/record, initial and seeded-peer discussion,
  quiz, expanded policy, and expanded timeline evidence. Verifies complete
  source text, panel containment, control labels, mode/current navigation, and
  keyboard skip-link focus. Real navigation round trips cross between portal
  and console and return home successfully.
- **Seven isolated disclosure scenarios:** native and programmatic empty
  selection; both enum choices through challenge, envelope, audit, and rendered
  provenance; exact content-only hash; selection changes during an awaited
  challenge; credential cancellation and retry; injected fallback control; and
  ordinary ungoverned publication. No JavaScript prompt/dialog is used.
- Before actual virtual `credentials.create/get`, instrumented browser checks
  confirm the action-specific status, heading, and explanation are visible,
  unobscured, and inside the viewport. Native calls still receive their original
  receiver and arguments. All four protected fields remain masked while a real
  virtual-authenticator request is pending; no verification POST or `unmasked`
  event occurs during the wait.
- Fresh enrollment, quiz proof, record reveal, discussion publication and
  advisory findings, dashboard filtering/polling/focus/error recovery, and both
  post-reset-post flows remain functional. Reset retains passkeys/audit and
  still requires fresh declarations/assertions afterward.

The cancellation/pending-authenticator probe ends by navigation because simply
re-enabling virtual presence does not resume a held Chrome call. A fresh reveal
then verifies normally. Native form line endings are checked using their CRLF
encoding. These were harness corrections, not server bypasses.

Full layout measurements and transient screenshots remain in ignored
`node_modules/.cache/content-layout-presentation-final-Zf9olG/`. Apps, sessions,
credentials, policies, and logs used in browser scenarios are isolated. There
were no live LLM calls or policy approvals by these verification commands.

## Local checks and scope

HTTP checks on both `localhost:3000` and `localhost:3001` confirmed the new
heading/copy, both navigation groups, appropriate mode, the shared CSS asset,
and discussion controls. Dev watchers already serve the changes. Only a fresh
demo login and page reads were used against live instances; no submissions,
resets, enrollment, or approvals were triggered by this HTTP check.

Existing/concurrent checklist and active/draft policy edits were preserved and
are outside this presentation implementation. Dataset fixtures, server-side
WebAuthn verification, middleware, record enforcement, and dependency manifests
were not changed by A15. The one server route edit supplies the current mode to
the console renderer. Human-owned pitch/spec documents were left alone.

**Physical Comet/Touch ID and the recorded presentation still require human
rehearsal.** Virtual proofs and viewport checks do not certify the OS dialog's
appearance or close those manual checkpoints.

## Pre-PR sorting integration — 2026-09-17T02:57:14Z

`main` added column sorting in `08d7a55` after the initial branch push. Its
dashboard conflict was resolved by retaining the shared shell and all upstream
sorting behavior, moving the sort-button styling into the shared CSS. The
caption and instructions now describe the selectable order accurately. The
published feature commits were retained rather than rebased or force-pushed.

Re-ran the full suite (**129 passed**), build, whitespace checks, and strict
TypeScript checking of `dashboard-browser-smoke.mts`. The dashboard browser
script now verifies all six sortable columns in both directions using pointer
and keyboard activation, one correct `aria-sort`, and initial append order.
Existing user filtering, polling/focus/error recovery, virtual enrollment,
quiz/discussion proofs, and pending/revealed record checks also pass.

```sh
SCREENSHOT_PATH="$PWD/node_modules/.cache/presentation-sorting-dashboard.png" \
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/dashboard-browser-smoke.mts

TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/content-layout-browser-smoke.mts --label=presentation-sorting
```

The second command passed **75 cases / 150 snapshots**, including navigation
round trips, with zero findings or setup errors. Post-integration measurements
and screenshots: `node_modules/.cache/content-layout-presentation-sorting-WmFZKc/`.
The retained screenshots below predate the sort-header integration; no other
presentation changes were needed. The three user-modified policy JSON files
remain local and outside this PR.

## Screenshots

- [Demo home](presentation-login-desktop.png)
- [Quiz](presentation-quiz-desktop.png) · [mobile quiz](presentation-quiz-mobile.png)
- [Discussion with disclosure dropdown](presentation-discussion-demo-desktop.png)
- [Seeded peer discussion](presentation-discussion-peer-desktop.png)
- [Protected record](presentation-record-desktop.png)
- [Passkey setup](presentation-register-desktop.png)
- [Activity log](presentation-timeline-desktop.png)
- [Policy comparison](presentation-policy-desktop.png)
