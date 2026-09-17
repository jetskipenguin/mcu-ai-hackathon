# Demo recording session — capture works; start-cue timing corrected

Initial check: **2026-09-17T11:13:59Z**. User authorized guided recording of the real ChatGPT extension in Chrome, with physical fingerprint confirmation when needed. Follow-up captures began at **11:19:49Z**, **11:23:45Z**, and **12:30:41Z** after the user enabled recording permission.

## Current status

**Screen recording now works without restarting Ghostty.** Two silent Chrome-region calibration clips were saved in the gitignored cache. The inspected contact sheets show the real portal and the first clip's initial macOS recording-access dialog, but **do not establish a captured fingerprint prompt or successful reveal**. Neither clip is the ChatGPT-extension demonstration. No extension task, credential enrollment, policy change, or form submission has been initiated by the driver.

**Third calibration:** the actual server log confirms the user's record reveal succeeded at **12:30:31.036Z**, but the video began at **12:30:41Z**, about ten seconds later. This is a start-cue timing miss; it does not show that macOS suppresses the native prompt. The video starts with revealed synthetic fields and later contains Ghostty. Keep it private/ignored, not in the deck. No recording remains active from these three bounded tests.

- Both `http://localhost:3000/login` and `http://localhost:3001/login` returned HTTP 200.
- Chrome AppleScript control works. Chrome initially had no windows.
- Prepared one Chrome window at bounds `{20, 40, 1450, 910}`, with the ungoverned quiz (`http://localhost:3001/quiz/1`) and governed quiz (`http://localhost:3000/quiz/1`). Pages may require the user's normal demo login.
- The user still needs to confirm this is the Chrome profile with the intended extension and registered passkey. Do not replace it with an automated test profile.
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

Do not substitute any calibration clip for the extension demo or claim a captured physical-confirmation moment from it. A separately coordinated native-prompt test remains necessary.

### Actual verification corresponding to the third attempt

Source: `data/provenance.jsonl`, events around 2026-09-17T12:30Z.

- **12:30:26.071Z:** `presence-requested`, `POST /countersign/unmask`, rule `student-record.unmask`, event `evt_2f14717352484d98a1463b39115b586d`.
- **12:30:31.036Z:** `unmasked`, `POST /countersign/unmask/verify`, actor `human-verified`, event `evt_1128f65170124e3e876020d85a876b16`; assertion `asr_6b492f73-c323-4d9d-b052-92d301a2aab2`, UP=true, UV=true, age=4964ms.
- The reveal predates the recorded interval by **9.964 seconds**. This is real verification evidence, but not evidence that its native prompt was recorded. Do not splice it into a different future take.

## Required human action

1. Reload the governed **Protected record** tab so the values are hidden again, then scroll until **Verify presence to view** is visible. Confirm the intended profile and synthetic demo user. Leave scripting/Accessibility settings unchanged.
2. Do **not** click the verification button yet. Give an explicit **record** cue once positioned; then wait for a separate **GO — recording is active** message.
3. The driver should start a bounded background take using `python3 node_modules/.cache/demo-recording/record-take.py start <unique-name> --seconds 120`. It reports readiness only after observing video-file growth. Do not say GO before that succeeds. This helper was added after the third take; Python syntax and CLI checks passed, but its end-to-end readiness behavior still needs the next real take to validate it.
4. After **GO**, click the button, hold the native prompt on screen for about three seconds, then confirm physically. Stay in Chrome through the reveal, then reply **done**. The driver can stop only this take using the helper's `stop` operation; the recorder also stops automatically at its time limit. The driver cannot supply the fingerprint.
5. Inspect the actual prompt and resulting field reveal in the video before declaring the native-prompt test passed. Keep unrelated/private windows and notifications out of view; no microphone recording is planned.

## Next sequence

1. Run a short, bounded real-screen capture test. First confirm the selected Chrome region is safe; then verify whether the native authenticator prompt is recorded. Human interaction is required; do not substitute a virtual authenticator or fabricate a prompt.
2. Record the real extension's ungoverned submission, then its governed submission with an uninterrupted prompt → brief pause → physical confirmation → success sequence.
3. Capture the matching accepted-proof event from that governed run. A waiting prompt is not itself a logged blocked submission.
4. Keep raw recordings in a gitignored location until reviewed for unrelated/private screen content. Edit a roughly 90-second silent MP4 for live narration, retain a standalone backup, and embed the verified clip into slide 3.

No recording, physical-browser verification, or rehearsal checkbox is complete merely because these prerequisites were checked. Current tracked `docs/.DS_Store` changes are unrelated and must be preserved, not treated as recording output.
