# A14 — imported-content layout verification

Verified 2026-09-17 UTC on `cleanup_text`, starting from merged commit `6a3f63e`.
The initial results below predate the sync to `6aebb39`. Layout work was renamed
from A13 to A14 during integration because upstream assigned A13 to deployment.

## Presentation-only fixes

- Expanded complete-policy JSON inherited unbounded preformatted lines inside
  automatic-minimum grid tracks. Policy comparisons now use shrinkable tracks
  and children; all JSON views wrap and retain local vertical scrolling.
- Portal text has readable line spacing and emergency wrapping for long tokens.
  Discussion paragraphs retain their original newlines and have a 75ch maximum
  measure. The complete synthetic-data footer also has a bounded measure.
- Quiz questions sit inside padded cards rather than straddling native fieldset
  borders, including multiline legends. The fieldset/legend semantics are
  preserved inside the visual card. Answer labels use separate
  radio/text columns, so continuation lines align with the answer rather than
  the radio. Names, values, required attributes, labels, and form actions remain
  intact. Form controls use the surrounding typography.
- The timeline keeps its own horizontal scroll container and a readable table
  minimum width; no document-level overflow hiding or text truncation is used.

Application edits are confined to styles and presentation markup in
`portal/app.ts` and `dashboard/index.ts`. Fixtures, Registry vocabulary, active
and draft policies, client submission logic, server enforcement, and dependency
manifests are unchanged.

## Commands and results

```sh
TMPDIR="$PWD/node_modules/.cache" npm test
npm run build
git diff --check
```

**112 tests passed**, with no failures, skips, or TODOs. TypeScript build and
whitespace checks passed. The repository has no separate lint script.

```sh
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/content-layout-browser-smoke.mts --label=legend-after --publish-evidence

SCREENSHOT_PATH="$PWD/node_modules/.cache/content-layout-dashboard-flow.png" \
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/dashboard-browser-smoke.mts
```

Both passed using locally installed optional Playwright and Chrome
**152.0.7977.83**. No dependencies were added. `SCREENSHOT_PATH` lets the existing
dashboard harness run without overwriting its earlier milestone screenshot.

### Layout matrix

- Widths: **1280, 801, 799, 390, and 320 CSS pixels**.
- Both governed and ungoverned modes: quiz, initial discussion, all 30 seeded
  peer posts, policy review with complete JSON and generation metadata expanded,
  and the timeline with expanded evidence.
- Mobile also covers login, record, and governed registration pages.
- **60 route/viewport cases, 120 actual/long-token-probe snapshots: zero
  findings and zero setup errors.** Document width equals viewport width.
- Checks cover horizontal and vertical quiz-card boundaries, question/answer
  separation, responsive policy columns, readable
  discussion line spacing/measure, quiz answer indentation, and locally
  scrollable timeline evidence. Probes add a long token only to the browser DOM,
  never to fixture files.
- Semantic checks preserve the complete quiz text and associated radio labels,
  discussion text/paragraphs/order, independent-first omission, synthetic-data
  notice, policy citations/JSON/metadata, and expanded audit evidence.
- Sources and policy copies are checked unchanged after the run. Apps, sessions,
  and logs are isolated; there are no real LLM calls or live policy approvals.

Detailed reports and all screenshots remain in ignored
`node_modules/.cache/content-layout-legend-after-66NmBx/`. The earlier baseline run
reproduced the layout defects before the CSS changes; it remains in
`node_modules/.cache/content-layout-baseline-eN4OS7/`.

### Screenshot follow-up: native legends on panel borders

The user's 8:24 PM screenshot exposed a gap in the first layout pass: horizontal
wrapping passed, but native legends still straddled their fieldsets' painted
top borders. This was not caching. The visual border/background now belong to a
padded wrapper, with the accessible fieldset and legend entirely inside it.

Before that correction, the added vertical-containment regression failed on all
five questions at every tested width in both modes:

```sh
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/content-layout-browser-smoke.mts --label=legend-before --quiz-only
```

Expected red result: **20 snapshots failed**, 100 vertical-containment findings,
zero setup errors. Report: `node_modules/.cache/content-layout-legend-before-2r10FN/`.
After the correction, the full 60-case/120-snapshot run passed, as did all 112
tests, build, and the virtual-authenticator smoke test again. Desktop and mobile
quiz screenshots were visually inspected.

At **2026-09-17T00:35:29Z**, HTTP checks against both running local instances
confirmed `/quiz/1` returns five corrected cards and the corresponding `on`/`off`
mode after an isolated demo login. Both dev watchers picked up the change; no
additional manual restart was necessary. The governed page visit is ordinarily
audited; no submissions, resets, enrollment, or policy changes were performed
against the live instances.

### Submission and dashboard regressions

The existing dashboard smoke test passed fresh enrollment, governed quiz
submission with `human-verified` and assertion metadata, record reveal, and
discussion publication with its advisory contradiction event. Exact-user
filtering, expanded evidence/focus across polling, and polling-error recovery
also passed.

These checks use a **Chrome virtual authenticator**, not physical Touch ID or
Comet. A5/A11 and the recorded human integration checkpoints remain separate.

## Post-sync verification — 2026-09-17T00:49:56Z

Before committing, `git pull --rebase --autostash origin main` advanced the base
to `6aebb39`, bringing upstream default masking and Docker/EC2 deployment work.
Documentation conflicts were resolved by retaining both work streams; A13 stays
assigned to deployment and this layout work is A14. The deployment entry was
also mirrored into `TASKS.md` to keep it aligned with the existing plan.

The browser harnesses now respect two upstream changes: historical agent labels
retain their original evidence but use unverified presentation, and generation
metadata is displayed only when its revision matches the current draft. The
manually migrated saved draft has stale generation metadata, so this run checks
that the provenance panel is absent rather than falsely attaching it to the
new draft. No policy or metadata files were rewritten. The layout harness now
rejects all POSTs except login, including obsolete signal/automatic-field calls.

Re-ran `TMPDIR="$PWD/node_modules/.cache" npm test` (**112 passed**, no skips),
`npm run build`, and `git diff --check`, plus:

```sh
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/content-layout-browser-smoke.mts --label=post-sync --publish-evidence

SCREENSHOT_PATH="$PWD/node_modules/.cache/content-layout-dashboard-flow.png" \
TMPDIR="$PWD/node_modules/.cache" ./node_modules/.bin/tsx \
  docs/build-log/dashboard-browser-smoke.mts
```

Both passed: **60 layout cases / 120 snapshots, zero findings/setup errors**;
fresh virtual enrollment, quiz submission, default-masked record reveal,
discussion publication, historical evidence, filtering, and polling recovery
remain functional. The retained screenshots below are refreshed from this run.
Full report: `node_modules/.cache/content-layout-post-sync-rp9Sac/report.json`.
The final layout diff does not modify datasets, policies, enforcement/client
logic, deployment configuration, or dependency manifests relative to the synced
base. EC2 infrastructure was not provisioned or tested in this task.

## Retained screenshots

- [Desktop quiz: every question fully inside its card](content-layout-quiz-desktop.png)
- [Mobile quiz: wrapped choices and citations](content-layout-quiz-mobile.png)
- [Desktop policy: contained complete JSON comparison](content-layout-policy-desktop.png)
- [Desktop discussion: full imported post with readable paragraphs](content-layout-discussion-peer-desktop.png)
