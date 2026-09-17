# Demo recording session — real Chrome quiz footage and completed edit

## Current status — successful user-recorded footage

The user supplied two **real Desktop recordings of the ChatGPT extension in Chrome** and authorized trimming and embedding them into slide 3. The governed recording visibly captures the **native Touch ID prompt, Done, successful quiz submission, and the matching expanded audit event**. These supplied takes supersede the earlier calibration/start-cue blocker documented below.

| Source take (2026-09-17) | Duration | Content |
|---|---|---|
| 9:51:05 AM — governance off | 61.28 seconds | Real extension quiz completion/submission |
| 9:54:44 AM — governance on | 83.47 seconds | Human-confirmation boundary, native prompt/result, and same-run audit |

Original Desktop files are unchanged. Full-quality working copies remain private and gitignored in `node_modules/.cache/demo-recording/user-takes` as `ungoverned-original.mov` and `governed-original.mov`.

### Completed presentation edit

- [`Countersign-demo.mp4`](Countersign-demo.mp4): **75.5 seconds, 1920×1080, 30 fps, H.264, silent**. The video-enabled deck uses one offline MP4 on slide 3; click the video in Slide Show and narrate live. Keep this standalone file as the backup; the PDF is static-poster-only.
- Output timeline: **0–30 seconds governance off; 30–64.5 seconds governance on; 64.5–75.5 seconds matching audit**. This leaves **29.5 seconds** for introduction/wrap within slide 3's 1:45 allocation.
- Waiting intervals are trimmed, with **no retiming** of retained footage. The entire governed source interval **34–56.5 seconds** is contiguous real time; only the spatial zoom changes at **41.5 seconds**.
- The **last eight seconds** are explicitly labeled as a still from **78 seconds in the same governed source video**. Session data is omitted and the credential identifier is visibly masked. The actual assertion ID and UP/UV remain visible and unchanged; no prompt, success UI, or proof is fabricated or substituted from another run.
- [`demo-edit.json`](demo-edit.json) records reproducible cuts and source hashes; [`demo-video.json`](demo-video.json) records the actual output hash, duration, segments, and derived-asset treatment. [`edit-demo.py`](edit-demo.py) works from the ignored copies without app/model/screen-recording calls; see [rebuild instructions](README.md#optional-reproduce-the-media-edit).
- [`assets/demo-poster.png`](assets/demo-poster.png) is a real Touch ID frame plus a play caption; [`assets/demo-proof.png`](assets/demo-proof.png) is the same-run audit still with redaction/editor labels. The original five UI crops are unchanged, and slide 4 remains explicitly qualified as a **virtual-authenticator UI reference**.

### Matching runtime proof

The final expanded audit matches the real runtime quiz event:

- Action: `POST /quiz/1/submit`; rule: `quiz-submit`; actor: `human-verified`.
- Event: `evt_3ea776d201de4b59961e7123fa571fd3`.
- Assertion: `asr_20a3eda1-bc17-4d87-ba58-2e44c966eaf8`.
- **UP=true; UV=true; age=6775ms; verified at 2026-09-17T13:55:34.532Z.**

This completes the **B10 governed backup** for the current Chrome quiz demo. Full MP4 decode and isolated Chrome playback passed; the slide 3 embedded MP4 matches the standalone file byte-for-byte, and the actual eight-slide PDF/poster export passed package, relationship, layout, and visual checks. See [deck verification](verification.json) and [playback results](demo-playback.json). **A5/M6 Comet checks, B11 timed rehearsal, T2 final slide approval, and a full seven-minute pitch recording remain pending.** PowerPoint/Keynote playback on the presenting laptop is unverified.

## Historical calibration — superseded, not a current blocker

Initial check: **2026-09-17T11:13:59Z**. User authorized guided recording of the real ChatGPT extension in Chrome, with physical fingerprint confirmation when needed. Follow-up captures began at **11:19:49Z**, **11:23:45Z**, and **12:30:41Z** after the user enabled recording permission.

### Status before the supplied quiz recordings

**Screen recording now works without restarting Ghostty.** Two silent Chrome-region calibration clips were saved in the gitignored cache. The inspected contact sheets show the real portal and the first clip's initial macOS recording-access dialog, but **do not establish a captured fingerprint prompt or successful reveal**. Neither clip is the ChatGPT-extension demonstration. No extension task, credential enrollment, policy change, or form submission has been initiated by the driver.

**Third calibration:** the actual server log confirms the user's record reveal succeeded at **12:30:31.036Z**, but the video began at **12:30:41Z**, about ten seconds later. This is a start-cue timing miss; it does not show that macOS suppresses the native prompt. The video starts with revealed synthetic fields and later contains Ghostty. Keep it private/ignored, not in the deck. No recording remains active from these three bounded tests.

- Both `http://localhost:3000/login` and `http://localhost:3001/login` returned HTTP 200.
- Chrome AppleScript control works. Chrome initially had no windows.
- Prepared one Chrome window at bounds `{20, 40, 1450, 910}`, with the ungoverned quiz (`http://localhost:3001/quiz/1`) and governed quiz (`http://localhost:3000/quiz/1`). Pages may require the user's normal demo login.
- At this stage, the user still needed to confirm this was the Chrome profile with the intended extension and registered passkey. An automated test profile was not a substitute.
- macOS `CGPreflightScreenCaptureAccess()` initially returned **false**. An official `CGRequestScreenCaptureAccess()` request also returned **false**. After the user enabled access, a new preflight returned **true** without restarting Ghostty; no permission was changed automatically.
- Accessibility permission is also false, but is **not required for the current preparation step**. Do not ask for broader access unless a later operation actually needs it.
- The process ancestry identifies **Ghostty** as the terminal application hosting this OpenCode session. Opened System Settings at Privacy & Security → Screen & System Audio Recording.
- Native `/usr/sbin/screencapture` successfully recorded region `20,40,1430,870`, producing Retina video at **2860×1740**, approximately **60 fps**, with **no audio stream**.
- FFmpeg 7.1 is now available through pinned `imageio-ffmpeg==0.6.0`, installed only in `node_modules/.cache/recording-python`. Binary: `node_modules/.cache/recording-python/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`. App dependencies were not changed.
- Opened a protected-record tab for calibration, in the existing governed Chrome window/profile. The verification control was below the initially visible area. Chrome rejected AppleScript JavaScript execution used to attempt scrolling; **that setting was left disabled**. Do not enable scripting or Accessibility just to avoid a manual scroll.

### Private calibration files

Directory: `node_modules/.cache/demo-recording/` (gitignored).

| File | Result |
|---|---|
| `permission-test-01.mov` | 29.75 seconds; Chrome and initial recording-access dialog captured. |
| `permission-test-01-contact.png` | Two-second sampled contact sheet; no established fingerprint capture. |
| `permission-test-02.mov` | 44.82 seconds; Chrome captured. |
| `permission-test-02-contact.png` | Three-second sampled contact sheet; no established fingerprint capture. |
| `native-confirmation-test-03.mov` | 29.85 seconds; starts after the successful reveal, then includes Ghostty. Not usable as the native-prompt demonstration. |
| `native-confirmation-test-03-contact.png` | One-second sampled contact sheet confirms revealed fields from the beginning. |

Do not substitute any calibration clip for the extension demo or claim a captured physical-confirmation moment from it. At this point a separately coordinated native-prompt test was still necessary; the later supplied quiz recordings now provide the captured prompt/result evidence above.

### Actual verification corresponding to the third attempt

Source: `data/provenance.jsonl`, events around 2026-09-17T12:30Z.

- **12:30:26.071Z:** `presence-requested`, `POST /countersign/unmask`, rule `student-record.unmask`, event `evt_2f14717352484d98a1463b39115b586d`.
- **12:30:31.036Z:** `unmasked`, `POST /countersign/unmask/verify`, actor `human-verified`, event `evt_1128f65170124e3e876020d85a876b16`; assertion `asr_6b492f73-c323-4d9d-b052-92d301a2aab2`, UP=true, UV=true, age=4964ms.
- The reveal predates the recorded interval by **9.964 seconds**. This is real verification evidence, but not evidence that its native prompt was recorded. Do not splice it into a different future take.

### Historical manual GO workflow

These instructions were the proposed remedy for the missed start cue, **not a current prerequisite or blocker** for the completed user-recorded quiz demo. They remain here as calibration history; the supplied takes do not validate the helper's readiness behavior.

1. Reload the governed **Protected record** tab so the values are hidden again, then scroll until **Verify presence to view** is visible. Confirm the intended profile and synthetic demo user. Leave scripting/Accessibility settings unchanged.
2. Do **not** click the verification button yet. Give an explicit **record** cue once positioned; then wait for a separate **GO — recording is active** message.
3. The driver should start a bounded background take using `python3 node_modules/.cache/demo-recording/record-take.py start <unique-name> --seconds 120`. It reports readiness only after observing video-file growth. Do not say GO before that succeeds. This helper was added after the third take; Python syntax and CLI checks passed, but its end-to-end readiness behavior still needs the next real take to validate it.
4. After **GO**, click the button, hold the native prompt on screen for about three seconds, then confirm physically. Stay in Chrome through the reveal, then reply **done**. The driver can stop only this take using the helper's `stop` operation; the recorder also stops automatically at its time limit. The driver cannot supply the fingerprint.
5. Inspect the actual prompt and resulting field reveal in the video before declaring the native-prompt test passed. Keep unrelated/private windows and notifications out of view; no microphone recording is planned.

### Historical next sequence

This was the capture plan before the user supplied the two successful quiz takes. The current delivery uses the completed 75.5-second edit above.

1. Run a short, bounded real-screen capture test. First confirm the selected Chrome region is safe; then verify whether the native authenticator prompt is recorded. Human interaction is required; do not substitute a virtual authenticator or fabricate a prompt.
2. Record the real extension's ungoverned submission, then its governed submission with an uninterrupted prompt → brief pause → physical confirmation → success sequence.
3. Capture the matching accepted-proof event from that governed run. A waiting prompt is not itself a logged blocked submission.
4. Keep raw recordings in a gitignored location until reviewed for unrelated/private screen content. Edit a roughly 90-second silent MP4 for live narration, retain a standalone backup, and embed the verified clip into slide 3.

These calibration prerequisites alone did not complete any recording, physical-browser verification, or rehearsal checkbox. The later supplied footage separately completes the current Chrome governed backup, as recorded above. The tracked `docs/.DS_Store` changes observed during calibration were unrelated and must be preserved, not treated as recording output.
