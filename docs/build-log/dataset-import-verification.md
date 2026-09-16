# Dataset import and Registry-backed generation

Recorded 2026-09-16T17:56:54Z. Tasks: **A1, B4**, and M22 local dataset preparation.

## Inputs and provenance

The user supplied these files under gitignored `data/source/`:

| Source | SHA-256 |
|---|---|
| `public-reference-corpus-portal-2026-09-13.zip` | `9ec1cbc09f46cb0a7fe2b79befff818a1918c755225b0dee4604a8e13c63365c` |
| `8801-seminar12-synthetic-forum-dataset/8801-seminar12-synthetic-forum-dataset.json` | `55b7c1f90af1c45f2711ab59c0fdf65af619e02a4e4b2fd1b38dd14c45eee470` |
| `AY27_8670_Prerequisite_Coursebook___Instructor-Led_Moodle.pdf` | `8900bb491d83665b080b4c2aef6ec3f16f92e6dd0187b93694c149db5f4bf9be` |

The forum's companion PDF supplies its complete synthetic-data notice on page 1.
The coursebook is 220 pages. Raw PDFs, archives, full source JSON, and extracted
reference text remain ignored. The repository artifacts are normalized vocabulary,
derived MCQs, and the filtered synthetic forum fixture.

## CUI reference corpus

The archive contains the *Public CUI and Derivative Classification Reference
Corpus*, version 2026-09-13, built at `2026-09-13T23:39:26+00:00`.

Executed:

```sh
unzip -q -n data/source/public-reference-corpus-portal-2026-09-13.zip -d data/source
npm run cui:import -- --corpus data/source/public-reference-corpus
```

Result: **126 categories, 10 LDCs, 3 retained legacy identifiers**.

Source paths inside the extracted `public-reference-corpus/` directory:

| Path | Key fields / use |
|---|---|
| `build/reports/cui-registry-categories.json` | `source_id`, `category`, `category_marking`, `description`, `authority_and_sanctions_text`, banner variants, `provisional`, `last_reviewed`, `source_url`, `authority_status` |
| `build/reports/cui-limited-dissemination-controls.json` | `control`, `marking`, `portion_marking`, `last_reviewed`, `source_id`, `source_url` |
| `build/text/national-cui-registry/national-cui-registry-limited-dissemination.txt` | Exact LDC definitions and qualifying notes absent from the structured manifest |
| `build/text_chunks.jsonl` | 7,155 chunks; `chunk_id`, `source_id`, `title`, `publisher`, `source_kind`, `url`, `final_url`, `family`, `content_role`, `authority_status`, `public_status`, `public_release_basis`, hashes, `marking_labels`, `observed_terms`, `start`, `end`, `text` |

Normalization:

- Categories: `id ← source_id`, `name ← category`, `description ← description`,
  `authority ← authority_and_sanctions_text`; other original fields stay in `source`.
- All 126 source IDs are retained. Nine provisional categories have empty
  `category_marking`; two NATO entries contain the same external-instructions
  sentence. No abbreviation is invented and no category is discarded.
- LDCs: `id ← marking`, `name ← control`, `authority ← source_url`; definitions
  and notes are extracted between each control heading and marking in the text.
  Source IDs, URLs, portion markings, and review dates remain in `source`.
- Category IDs identify source entries, not complete CUI banners. Source banner
  alternatives remain metadata; the import does not determine Basic/Specified
  applicability. Parameterized LDC templates remain exactly as supplied.
- Two old category placeholders and one LDC placeholder are `legacy: true`,
  available only for active-policy migration and excluded from new draft choices.

This is public reference material containing no live CUI. Historical markings and
observed marking terms do not establish a document's current handling status.
Optional governing-document chunk retrieval remains B5 work; Registry definitions
are already attached verbatim to selected marking citations.

## Portal fixtures

### Quiz

Selected **Lesson 2 Reading: Fundamentals of National Defense**, original PDF
pages **4–23 of 220**. Five derived MCQs cite their exact sections/pages:

| Question | Topic | Source | Answer |
|---|---|---|---|
| q1 | Strategy's ends/ways/means | §2.c, PDF p. 5 | c |
| q2 | Economic instrument of national power | §2.d(4), PDF p. 6 | a |
| q3 | Deterrence | §3.a(2), PDF p. 13 | d |
| q4 | Nature versus character of war | §4.a–b, PDF pp. 15–16 | b |
| q5 | Operational level | §4.d(3), PDF p. 18 | c |

The quiz retains `q1`–`q5`, options `a`–`d`, and the existing form/action contract.
Submission verifies presence and records acceptance; no grading feature was added.

### Discussion

Imported with the CLI (also exposed as `npm run forum:import -- <source-json>`):

```sh
./node_modules/.bin/tsx portal/import-forum.ts data/source/8801-seminar12-synthetic-forum-dataset/8801-seminar12-synthetic-forum-dataset.json
```

The full JSON has two topics, 62 posts, 10 learners, one faculty advisor, and
11,018 supplied word-count units. Filtering `ifd === 2` produces **31 records**:
the root faculty prompt, one faculty follow-up, and 29 learner posts (10 initial
responses plus 19 replies). Their supplied word counts sum to 5,724.

Preserved source post fields: `post_id`, `ifd`, `parent_id`, `depth`, `author`,
`service`, `specialty`, `role`, `design_tier`, `timestamp`, `subject`, `word_count`,
`char_count`, `classification`, and `body`. Here `classification` means
substantive/short, not a security marking. Timestamps and body text are preserved.

The importer adds stable user IDs, appends `stu-0011` as the eleventh learner, and
keeps `fac-0001` separate. Original roster fields remain; `source_dataset` and
`course` retain metadata. `faculty_prompt_post_id: "2-000"` prevents rendering the
opening prompt twice. All **30 other posts**, including the faculty follow-up,
are withheld server-side until the initial submission in both modes. Historical
posts have no invented assertions, attestations, or submission provenance.

## Live model result

`npm run generate` passed:

```text
generated_at: 2026-09-16T17:54:06.439Z
provider: openai
model: gpt-6-astra
draft_version: draft-2026-09-16-registry-scoped-demo-governance
vocabulary: 126 categories, 10 LDCs, placeholder=false
draft_revision: 3d5be54ec30cb450a7755c4f9d1d8cbff3d201d5ff5d884302f709e48b1438e3
```

The crawl used `/quiz/1`, `/discussion/2`, and `/record/1` at
`http://localhost:3001`. The resulting record rule selects General Privacy for
name/SSN/DoD ID, Health Information for the medical note, and Student Records for
the page. Three exact Registry definitions are attached. Generation left the live
active policy unchanged; activation uses the existing review/approval controls.

## Verification

- **`npm test`: 82 passed**, zero failures, cancellations, skips, or TODOs.
  Includes source-to-fixture reproduction, complete thread/identity preservation,
  independent-first non-disclosure, source metadata/definition fidelity, migration
  compatibility, and existing cryptographic/enforcement regressions.
- **`npm run build`: passed.** Strict TypeScript compilation; no separate linter
  is configured. No project dependencies were added.
- **`git diff --check`: passed.** `git ls-files --others --exclude-standard data/source`
  returns only the drop-folder README; raw sources remain ignored.
- **`git diff --exit-code -- countersign/policy/countersign.policy.json`: passed.**

Browser command:

```sh
./node_modules/.bin/tsx /var/folders/wv/ktng7tvs3z15kmclhh537c7r0000gn/T/opencode/policy-browser-smoke.mts
```

Chrome with a virtual platform authenticator and temporary policy/credential/log
stores passed:

1. Generation UI replay of the independently obtained live GPT-6 result; 126/10
   vocabulary, source definitions, and draft-only writes.
2. Per-rule, selected-rule, and full approval; stale-tab rejection; hot reload.
3. The new five-question quiz's WebAuthn submission and record reveal under the
   approved source-backed policy, including its updated marking header.
4. Attested discussion publication: no peer posts before submission, all 30 source
   posts once afterward plus the new post, full synthetic notice, and no invented
   source-post presence proofs.

An initial browser-test attempt expected an attestation button; the application
uses a native prompt. The harness was corrected to accept `ai-assisted` in that
prompt, and the complete rerun passed. No application fix was needed.

Screenshot: [Registry-backed policy review](policy-review-registry.png).

## Tracking

A1 and B4 are complete in both `TASKS.md` and `countersign-plan.md`. M22's local
preparation subcheck is complete; **registration of all three datasets on the
hackathon portal remains unconfirmed**. Physical Comet/Touch ID and recorded-demo
checks are still tracked separately from these automated checks.
