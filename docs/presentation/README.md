# Countersign — first-draft slide deck

- **[Editable PowerPoint](Countersign.pptx)** — eight 16:9 slides; native editable text, shapes, diagrams, and speaker notes. Slide 3 uses a single embedded, offline MP4; click the video in Slide Show to play.
- **[Standalone demo MP4 / playback backup](Countersign-demo.mp4)** — the completed 75.5-second, silent, real Chrome ChatGPT-extension quiz demo, governance off/on with native Touch ID and matching audit evidence; 1920×1080, 30 fps, H.264.
- **[PDF preview](Countersign.pdf)** — exported from the actual PPTX using LibreOffice, not separately recreated. Slide 3 is a static poster only; the PDF cannot play the video. This presentation export is intentionally tracked; the repo's `*.pdf` ignore rule remains in place for source/dataset documents.
- **[Contact sheet](Countersign-preview.png)** — all eight slides at a glance.
- **[Full-size slide previews](preview/)** — individual PNGs from the same PDF export.
- **[Pitch and complete delivery plan](../countersign-pitch.md)** — narrative, evidence boundaries, and Beautiful.ai brief.
- **[Recording and edit evidence](recording-session.md)** — current user-recorded footage, matching proof, and earlier calibration history. [`demo-edit.json`](demo-edit.json) records reproducible cuts and source hashes; [`demo-video.json`](demo-video.json) records the actual output hash, duration, and segments.

## Before presenting

1. **Play slide 3 in Slide Show.** Click the video itself to start the embedded MP4; narrate live and identify it as a **recorded demo**. Keep the standalone [MP4](Countersign-demo.mp4) ready as the playback backup. The embedded video plays offline; the PDF and PNG previews show only its poster.
2. **Use the completed recording inside the 1:45 demo budget.** Its 75.5 seconds leave **29.5 seconds** for introduction and wrap. A live or hybrid confirmation is optional; use the [pitch's handoff instructions](../countersign-pitch.md#optional-live-or-hybrid-delivery) only if choosing that format. A new recording is not a prerequisite for this delivery.
3. **Keep the evidence distinctions.** Slide 4's publication badges come from an isolated Chrome **virtual authenticator**; the slide labels them as an automated UI reference. Slide 6 shows real policy-review detail crops, not new generation or approval. Both cases are explained in the notes. Do not narrate either as the physical demo.
4. **Check the notes pane / Presenter View.** Each slide contains its duration, cumulative clock, spoken material from the pitch, and separate production/evidence instructions. Only the spoken material is narration; do not read the operator notes aloud. Slide 8 also holds the Q&A reference.
5. **Assign speakers and optionally add presenter names.** The deck intentionally does not invent team names, an official event logo, deployments, or endorsements.
6. **Rehearse the exported file on the presenting laptop.** Aim for **6:30**, leaving **0:30 recovery**, then **3:00 Q&A**. Verify projector readability, fonts, click-to-play, and the standalone fallback. **PowerPoint/Keynote playback on that laptop and the timed rehearsal remain unverified.** MP4 playback, video-enabled package checks, and the actual PDF/poster export passed the checks below.

The PPT uses **Arial** for portability, the app's navy/mint/teal palette, and no special animation or external font dependency. It should remain editable in PowerPoint; Keynote can import the PPTX. If importing into a slide-design service, inspect the converted layout and notes instead of assuming they survived unchanged.

## Slide sequence

| Slide | Focus | Time |
|---|---|---|
| 1 | A valid session is not a human decision | 0:35 |
| 2 | Countersign and the human checkpoint | 0:35 |
| 3 | Same task. Different boundary. — recorded demo + audit | 1:45 |
| 4 | Participation versus authorship; protected-record inset | 0:45 |
| 5 | Editable new/existing-app integration diagram | 0:50 |
| 6 | AI drafts; people approve | 0:45 |
| 7 | Built training example; three potential higher-stakes uses | 0:45 |
| 8 | Choose one action. Require a countersign. | 0:30 |

## Recorded demo timeline and evidence

| Video clock | Content |
|---|---|
| 0:00–0:30 | Governance off: real extension quiz submission |
| 0:30–1:04.5 | Governance on: preparation, native Touch ID prompt, Done, and successful submission |
| 1:04.5–1:15.5 | Matching audit; final eight seconds are an explicitly labeled still from the same recording at source time 78 seconds |

Waiting intervals are trimmed; retained motion footage is not retimed. **Governed source 34–56.5 seconds is contiguous real time**, with only a spatial zoom at 41.5 seconds. The final audit still omits session data and visibly masks the credential identifier; the real assertion ID and UP/UV evidence remain visible and unchanged. See the [recording session](recording-session.md#matching-runtime-proof) for the event match.

[`assets/demo-poster.png`](assets/demo-poster.png) is a real Touch ID frame with a play caption. [`assets/demo-proof.png`](assets/demo-proof.png) is the same-run audit still with visible redaction/editor labels, not fabricated UI. The original five UI crops are unchanged; slide 4 remains an **automated UI reference using a virtual authenticator**, separate from this physical-confirmation recording.

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

The build reads the current pitch for speaker notes, embeds the local MP4, and writes the PPTX. It does not access `.env`, start the app, call an LLM, or modify policies. Text, native diagrams, links, and positions are defined in `build-deck.cjs`; **rerunning it overwrites manual edits to the generated PPTX**, so save an edited presentation under a new filename first.

The existing MP4 and images in `assets/` are sufficient for a normal deck rebuild. `prepare-assets.py` is optional and is only needed when replacing the original UI screenshots. Its `--capture-dir` input must contain the two named source PNGs from a new isolated capture; the original temporary capture directory is not required to rebuild the deck. `assets/sources.json` records those five images' source hashes, crop boxes, dimensions, and evidence limitations. Those screenshots are cropped, not retouched or fabricated; the new demo assets' annotations/redaction are documented separately in `demo-video.json`.

### Optional: reproduce the media edit

Use Python 3.11+ and the private, gitignored source copies in `node_modules/.cache/demo-recording/user-takes`: `ungoverned-original.mov` and `governed-original.mov`. The original Desktop files remain unchanged. With the presentation-tool pins above installed, run:

```sh
python3 -m pip install --target node_modules/.cache/recording-python imageio-ffmpeg==0.6.0
PYTHONPATH="$PWD/node_modules/.cache/recording-python:$PWD/node_modules/.cache/presentation-python" \
  python3 docs/presentation/edit-demo.py --sources node_modules/.cache/demo-recording/user-takes
```

[`edit-demo.py`](edit-demo.py) checks the source hashes against `demo-edit.json`, regenerates the MP4 and poster/proof assets, and writes actual output metadata to `demo-video.json`. Rerun the deck build and export steps afterward. This media edit reads the ignored source copies; it makes no app, model, or screen-recording calls and does not change the originals.

## Verification status

The completed video-enabled deck and MP4 passed these checks:

- Generated an eight-slide PPTX with eight linked notes pages; parsed every package XML/relationship file and checked the ZIP.
- Verified exactly one internally embedded MP4 on slide 3, byte-for-byte matching the standalone video and manifest SHA-256. All other embedded media are PNGs; there are no external media links.
- Decoded all **2,265 frames**: **75.5 seconds, 1920×1080, H.264/yuv420p, 30 fps, no audio**. Source hashes match, and the source 34–56.5-second confirmation interval remains contiguous at real time.
- Played the entire exact MP4 in an isolated Chrome 152 browser at 1× speed, with no media errors, stalls, reported dropped frames, or sampled black frames; 40 seeks and eight edit-boundary crossings passed. This tested the video, not a new authenticator interaction.
- Rendered the **actual PPTX** with LibreOffice; checked the eight 16:9 PDF pages, expected headings, native object bounds, and rendered text bounds.
- Inspected the contact sheet and full-size slides. Added a matching static poster beneath the video so PDF export does not leave slide 3 blank; the actual re-export was checked. A minor clipped overview-table edge in the source framing does not affect the enlarged final assertion/UP/UV proof.
- Verified 390 seconds of planned delivery + 30 seconds recovery = 7 minutes, with Q&A allocated separately.
- Current policy and disclosure screenshots were captured in an isolated app with temporary storage; no live model call or policy approval. The temporary server/browser were stopped and the temporary credential file removed.

Machine-readable checks: [`verification.json`](verification.json) and [`demo-playback.json`](demo-playback.json). Video decoding/continuity can be rechecked with `PYTHONPATH="$PWD/node_modules/.cache/recording-python" python3 docs/presentation/verify-demo-video.py`. Earlier static-deck packaging also passed `npm test` (129 tests) and `npm run build`; the new media checks above are separate. **Presenting-laptop PowerPoint/Keynote playback, timed rehearsal, final slide approval, and a full seven-minute pitch recording remain outstanding.** Chrome footage does not complete the separate Comet checks.
