# Registry vocabulary

The lists contain **126 National CUI Registry categories and 10 limited
dissemination controls**, imported from the supplied
`public-reference-corpus-portal-2026-09-13.zip` on 2026-09-16. The archive identifies
itself as the *Public CUI and Derivative Classification Reference Corpus*, version
2026-09-13 (the hackathon's CUI Tagging Dataset).

## Reproduce the import

Raw inputs belong in the gitignored `data/source/` folder. From the repository root:

```sh
unzip -q -n data/source/public-reference-corpus-portal-2026-09-13.zip -d data/source
npm run cui:import -- --corpus data/source/public-reference-corpus
npm run generate
```

The extracted corpus supplies:

- `build/reports/cui-registry-categories.json`: categories, descriptions,
  authorities, source URLs, banner alternatives, and review dates.
- `build/reports/cui-limited-dissemination-controls.json`: LDC names, markings,
  portion markings, and source URLs.
- `build/text/national-cui-registry/national-cui-registry-limited-dissemination.txt`:
  the LDC definitions and qualifying notes omitted from the structured manifest.
- `build/text_chunks.jsonl`: 7,155 reference chunks; optional B5 retrieval input.

## Mapping and compatibility

Each entry has `{ id, name, description, authority, source }`:

- **Category `id` is the manifest's exact `source_id`.** Nine provisional
  categories have no abbreviation, and two NATO entries share instruction text
  in `category_marking`. Using source IDs preserves all 126 distinct categories
  without inventing abbreviations. `source` retains the original marking/banner
  fields, provisional status, review date, and URL.
- **LDC `id` is the manifest's exact `marking`.** Whitespace, case, and template
  parameters are retained. Definitions include the Registry's qualifying notes;
  `source` retains the portion marking, source ID/URL, and review date.
- `description` is attached verbatim to each selected identifier's policy citation.
  Policy identifiers identify vocabulary entries; they are not independently a
  complete CUI banner or a Basic/Specified classification determination.

The importer validates counts, unique IDs, required definitions, and absence of
incoming placeholders. Two original category placeholders and one original LDC
placeholder remain **`legacy: true`** for active-policy compatibility. They are
excluded from the generator's 126/10 choices. Generate and approve a new policy
through the review page to activate its source-backed identifiers.

Normalized JSON input also remains supported:

```sh
npm run cui:import -- --categories path/to/categories.json --ldcs path/to/ldcs.json
```

The dataset contains no live CUI. Historical markings describe original documents,
not their current handling status. The corpus is reference material; the portal's
student records and forum remain synthetic. Source hashes, schema notes, and
verification are in [the import evidence](../../docs/build-log/dataset-import-verification.md).
