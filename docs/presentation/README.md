# Countersign — first-draft slide deck

- **[Editable PowerPoint](Countersign.pptx)** — eight 16:9 slides; native editable text, shapes, diagrams, and speaker notes.
- **[PDF preview](Countersign.pdf)** — exported from the actual PPTX using LibreOffice, not separately recreated. This presentation export is intentionally tracked; the repo's `*.pdf` ignore rule remains in place for source/dataset documents.
- **[Contact sheet](Countersign-preview.png)** — all eight slides at a glance.
- **[Full-size slide previews](preview/)** — individual PNGs from the same PDF export.
- **[Pitch and complete delivery plan](../countersign-pitch.md)** — narrative, evidence boundaries, and Beautiful.ai brief.

## Before presenting

1. **Review slide 3.** It is a live-demo holding slide, not a video. Pre-open the governed and ungoverned quiz in the selected Chrome profile. The two mode pills contain localhost hyperlinks, which open the OS's default browser; use your prepared Chrome tabs if that default differs. Alternatively, replace the dark demo panel with a real local recording and label it recorded.
2. **Record the real extension/passkey interaction and its matching audit event.** No physical-confirmation or ChatGPT-extension recording is embedded. The actual extension demo remains a presenter task.
3. **Keep the evidence distinctions.** Slide 4's publication badges come from an isolated Chrome **virtual authenticator**; the slide labels them as an automated UI reference. Slide 6 shows real policy-review detail crops, not new generation or approval. Both cases are explained in the notes. Do not narrate either as the physical demo.
4. **Check the notes pane / Presenter View.** Each slide contains its duration, cumulative clock, spoken material from the pitch, and separate production/evidence instructions. Only the spoken material is narration; do not read the operator notes aloud. Slide 8 also holds the Q&A reference.
5. **Assign speakers and optionally add presenter names.** The deck intentionally does not invent team names, an official event logo, deployments, or endorsements.
6. **Rehearse the exported file on the presenting laptop.** Aim for **6:30**, leaving **0:30 recovery**, then **3:00 Q&A**. Verify projector readability, links, fonts, and any media you insert. The actual PowerPoint/Keynote stage run has not been performed by this build.

The PPT uses **Arial** for portability, the app's navy/mint/teal palette, and no special animation or external font dependency. It should remain editable in PowerPoint; Keynote can import the PPTX. If importing into a slide-design service, inspect the converted layout and notes instead of assuming they survived unchanged.

## Slide sequence

| Slide | Focus | Time |
|---|---|---|
| 1 | A valid session is not a human decision | 0:35 |
| 2 | Countersign and the human checkpoint | 0:35 |
| 3 | Same task. Different boundary. — demo slot | 1:45 |
| 4 | Participation versus authorship; protected-record inset | 0:45 |
| 5 | Editable new/existing-app integration diagram | 0:50 |
| 6 | AI drafts; people approve | 0:45 |
| 7 | Built training example; three potential higher-stakes uses | 0:45 |
| 8 | Choose one action. Require a countersign. | 0:30 |

## Rebuilding without changing app dependencies

The generators are presentation tooling only. Packages install into the gitignored cache; neither `package.json` nor `package-lock.json` is changed.

From the repository root:

```sh
npm install --prefix node_modules/.cache/presentation-tools --no-save --package-lock=false --ignore-scripts pptxgenjs@4.0.1
python3 -m pip install --target node_modules/.cache/presentation-python Pillow==12.3.0 PyMuPDF==1.28.2
node docs/presentation/build-deck.cjs
```

Then export the PPTX to `docs/presentation/Countersign.pdf` with PowerPoint/Keynote or a local LibreOffice installation. For LibreOffice, set `SOFFICE` to the installed executable:

```sh
"$SOFFICE" -env:UserInstallation="file://$PWD/node_modules/.cache/ppt-lo-profile" \
  --headless --convert-to pdf --outdir docs/presentation docs/presentation/Countersign.pptx
PYTHONPATH="$PWD/node_modules/.cache/presentation-python" python3 docs/presentation/render-preview.py
```

The build reads the committed pitch for speaker notes and writes the PPTX. It does not access `.env`, start the app, call an LLM, or modify policies. Text, native diagrams, links, and positions are defined in `build-deck.cjs`; **rerunning it overwrites manual edits to the generated PPTX**, so save an edited presentation under a new filename first.

The existing crops in `assets/` are sufficient for a normal rebuild. `prepare-assets.py` is optional and is only needed when replacing screenshots. Its `--capture-dir` input must contain the two named source PNGs from a new isolated capture; the original temporary capture directory is not required to rebuild the deck. `assets/sources.json` records each image's source hash, crop box, dimensions, and evidence limitation. Screenshots are cropped, not retouched or fabricated.

## Verification performed

- Generated an eight-slide PPTX with eight notes pages; parsed every package XML/relationship file and checked the ZIP.
- Verified all embedded media are PNG UI crops and no video is falsely represented as embedded.
- Verified the only external hyperlinks are the two intended `localhost` quiz pages.
- Rendered the **actual PPTX** with LibreOffice; checked the eight 16:9 PDF pages, expected headings, native object bounds, and rendered text bounds.
- Inspected the contact sheet and full-size slides. Enlarged the virtual-authenticator qualification and added padding around the approval-control crop after inspection.
- Verified 390 seconds of planned delivery + 30 seconds recovery = 7 minutes, with Q&A allocated separately.
- Current policy and disclosure screenshots were captured in an isolated app with temporary storage; no live model call or policy approval. The temporary server/browser were stopped and the temporary credential file removed.

Machine-readable deck checks: [`verification.json`](verification.json). Pre-commit packaging also passed `npm test` (129 tests), `npm run build`, JavaScript/Python syntax checks, and `git diff --check`. These checks do **not** substitute for physical-authenticator testing, media playback in the final slide application, or a timed human rehearsal.
