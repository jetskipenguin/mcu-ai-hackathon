# Policy generator and approval verification

Recorded 2026-09-16 at 13:14 EDT. Tasks: M16, B2, B4 implementation, B6; M22 remains blocked.

**Later update:** the datasets arrived and source-backed generation passed at
17:54 UTC. See [dataset import verification](dataset-import-verification.md).
This file records the earlier scaffold-vocabulary run; the draft files now hold
the newer Registry-backed result. Only M22's hackathon-portal registration remains
unconfirmed.

## Live OpenAI checks

The user selected OpenAI/GPT-6. An authenticated model-list request exposed
`gpt-6-astra`; `.env` configures that ID and `LLM_PROVIDER=openai`. The API key is
in the ignored local file; secret fields in `.env.example` are empty.

```text
npm run llm:smoke
  ok: true
  provider: openai
  model: gpt-6-astra
  checked_at: 2026-09-16T16:41:00.717Z

npm run generate
  ok: true
  generated_at: 2026-09-16T16:43:41.784Z
  draft_version: draft-synthetic-scaffold-presence-disclosure-record-protection-v1
  provider: openai
  model: gpt-6-astra
  source_urls:
    http://localhost:3001/quiz/1
    http://localhost:3001/discussion/2
    http://localhost:3001/record/1
  vocabulary: 2 categories, 1 LDC, placeholder=true
  draft_revision: b1e7877cb5a27437d18f9d0081ac8a7f9df3bc7793ffb7b3e7f209a6c503d3d6
```

The model produced the three expected rules with substantive rationales. Its
marking choices were restricted to the supplied identifiers; citations were
grounded in the actual supplied descriptions. The result and generation metadata
are in `countersign/policy/countersign.policy.draft.json` and the adjacent
`countersign.policy.draft.meta.json`. Generation left the active policy unchanged.

## Automated checks

```text
npm test
  72 passed; 0 failed, cancelled, skipped, or TODO

npm run build
  tsc -p tsconfig.json — exit 0
```

Six provider tests and ten generator/approval/import tests were added. They cover
provider request/configuration contracts, secret-safe errors, no silent provider
fallback, rendered local crawling, draft-only writes, invalid output preserving
prior files, citation/identifier validation, required demo rules, selective/full
approval, stale snapshots, authentication/origin/JSON guards, HTML escaping,
concurrent generation, immediate enforcement reload, and normalized vocabulary
import with active-policy compatibility. Existing quiz, discussion, and record
tests also pass. No new project dependencies were added; there is no separate
linter configured, and strict TypeScript compilation passed.

## Browser check

Executed with the existing temporary Playwright 1.58.2 tooling:

```sh
./node_modules/.bin/tsx /var/folders/wv/ktng7tvs3z15kmclhh537c7r0000gn/T/opencode/policy-browser-smoke.mts
```

The isolated test used temporary policy/credential/log files and a virtual
authenticator. It replayed the separately verified live GPT-6 draft rather than
making another model call or changing the live active policy.

```text
PASS: Generate draft crawls the local portal, displays rationale/citations and the placeholder notice, and leaves active policy intact.
PASS: per-rule approval preserves other rules/defaults; a stale second review tab is rejected.
PASS: selected-rule and approve-all controls activate the reviewed policy without restarting the app.
PASS: the approved policy still enforces quiz WebAuthn and record reveal, and its new marking header is immediately active.
```

Screenshot: [policy review with draft and explicit placeholder labeling](policy-review-draft.png).

## Remaining source-data blocker

The workspace contains no authoritative CUI archive/manifests/chunk JSONL,
approved coursebook chapter, or full synthetic forum JSON, and the docs provide
no download URL. No categories, LDCs, source quotations, or source-derived course
content were invented. The normalized importer is ready and tested with clearly
synthetic test-only data, but the actual 126-category/10-LDC import still requires
the source exports. See `data/cui/README.md`.

M16/B2/B6 implementation checks are complete. M22 and final authoritative
Registry-backed B4 output remain open in both tracking documents. Physical-agent
recordings and the other human demo checkpoints remain separately tracked.
