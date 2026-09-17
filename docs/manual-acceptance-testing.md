## Manual Acceptance Testing

The following must be performed by a human and not an agent.

### Tester-confirmed functional acceptance

Confirmation recorded on 2026-09-17 (UTC). The tester reported:

> I verified the quiz, discussion board post, and record all worked as expected both with and without governance enabled.

- [x] Quiz submission with governance enabled.
- [x] Quiz submission with governance disabled.
- [x] Discussion post with governance enabled.
- [x] Discussion post with governance disabled.
- [x] Record flow with governance enabled.
- [x] Record flow with governance disabled.

This records human-reported functional verification, not a new automated test run.
Recording, browser/device-specific evidence, reset/cancellation edge cases,
deployment acceptance, and presentation rehearsal remain separately tracked;
their detailed checkboxes are not completed by this general flow confirmation.

### Test that telemetry detects an agent
- Test the following with nanoagent chrome extension and with opencode BrowserOS MCP
- Start the application with countersign off
- Access the home page of the application in a fresh window
- Prompt the agent:

```
opencode:
View my student record on http://localhost:3000/ on openbrowser neo. Tell me what information the page has on it. I am Capt J Demo
```

- Expect that opencode returns the SSN, DoD ID and Medical info
- Restart the web server with countersign on
- Reprompt with same prompt
- Expect that opencode requests user authentication

### Test that quiz submission requires user authentication
- Test the following with nanoagent chrome extension and with opencode BrowserOS MCP
- Start the application with countersign off
- Access the home page of the application in a fresh window
- Prompt the agent:

```
opencode:
I am Capt J. Demo. Complete and submit the quiz for me on http://localhost:3000/
```

- Expect that the opencode submits the quiz
- Restart the web server with countersign on
- Reprompt with same prompt
- Expect that opencode requests user authentication

### Test discussion post-reset-post

All checks below are pending until performed and recorded by a human. Record
protocol/virtual-authenticator evidence separately from the physical Touch ID
checkpoint.

Automated protocol/race checks and Chrome virtual-authenticator post-reset-post
checks passed on 2026-09-16; see [reset evidence](build-log/discussion-reset-verification.md).
The human rehearsal checkboxes below remain separate.

- [ ] Keep both instances running: `npm run dev` at `http://localhost:3000` and
  `npm run dev:ungoverned` at `http://localhost:3001`. Do not restart either server
  during this sequence. Sign in as Capt J. Demo (`stu-0011`) on each; enroll a
  governed passkey if needed. Open `/countersign/?user=stu-0011` on port 3000 and
  retain the existing timeline as the before-reset reference.
- [ ] On `/discussion/2` in both modes, confirm **Demo controls** starts collapsed
  and contains the native **Reset discussion demo** form and required confirmation
  checkbox. Another signed-in learner must not see these controls.
- [ ] Publish an initial response on each instance. On port 3000, choose **Own
  work** or **AI-assisted** in **How was this response prepared?**, then select
  **Publish response** and complete WebAuthn; record the post, event, and assertion IDs.
  On port 3001, publish without attestation or presence proof and confirm there is
  no ordinary-post governance event. Peers become visible and the initial-response
  composer disappears. Retain seeded post IDs and any other learner's runtime
  post IDs for comparison after the second post.
- [ ] Leave another discussion tab open. Expand **Demo controls** on port 3000;
  submitting with the checkbox unchecked must be stopped by native validation.
  Check **I want to reset this discussion demo.** and select **Reset discussion
  demo**. Expect HTTP 303 to `/discussion/2?reset=1`, a reset notice, an empty
  initial-response composer, and no peer posts in the returned HTML. Reset itself
  must not request WebAuthn. Reload the other open tab.
- [ ] Confirm the port 3001 post is still present, then perform its own reset.
  Only Capt J. Demo's runtime-added posts on each reset instance are removed.
  Login and passkeys remain usable without reenrollment;
  policies, and the existing JSONL history are retained.
- [ ] Check the timeline for one `demo-discussion-reset` event per successful
  reset, including `COUNTERSIGN=off`. Each has action `POST /discussion/2/reset`,
  class `unrestricted`, decision `allowed`, null `presence`, `attestation`,
  `form_hash`, and `telemetry`, neutral legacy signals, and notes with mode and removed
  post IDs/count, but no post body or reset token. All old submission and review
  events remain visible.
- [ ] Publish again on both instances. The governed initial response must ask for
  a fresh attestation and WebAuthn proof and have a new assertion/event ID; the
  ungoverned response needs neither. Peers reappear, including seeded posts and
  other learners' retained runtime posts. The first demo response is absent from
  the discussion, while its old audit events and the reset event remain alongside
  the new governed submission in the timeline.
- [ ] For a clean independent-first measurement, start a fresh agent context.
  Reloading/resetting the page cannot erase peers a human or agent already saw.

#### Protocol / virtual-authenticator checks — separate evidence

- [ ] Exercise the JSON reset response and rejection cases in the
  [reset contract](contracts.md#demo-only-discussion-reset), including old-token
  replay after reset, another session/instance's token, missing confirmation,
  authentication, Origin, and media-type checks. Confirm rejected requests do not
  delete posts. A valid concurrent reset returns `409 reset_in_progress`; an
  unavailable audit returns `500 reset_not_recorded` with posts retained.
- [ ] Confirm reset revokes this user's pending/in-flight discussion proofs,
  including challenge options being generated. A stale submission reaching the
  final commit check returns `409 discussion_reset`, including one that matched
  unrestricted before reset. Quiz, record, registration, and other users'
  challenges remain usable. Record controlled race checks separately from UI
  rehearsal results.

#### Physical Touch ID checkpoint — separate from virtual checks

- [ ] Disable any DevTools virtual authenticator. In Comet, select the disclosure
  from the dropdown, let the agent reach Publish on the governed initial response, and confirm
  it waits at the physical Touch ID prompt. A human touches the sensor; the post
  publishes with `human-verified` and an assertion ID. Reset, then repeat with a
  fresh prompt and assertion ID while preserving the old timeline. Capture this
  physical-browser evidence separately; virtual-authenticator checks do not close
  the live Touch ID checkpoint.

### Presentation refresh and disclosure dropdown (A15)

Automated evidence is in [presentation verification](build-log/presentation-refresh-verification.md).
These manual checks remain separate:

- [ ] From Demo home, visit Quiz, Discussion, Protected record, Activity log, and
  Policy review. Both navigation groups remain available, the current page is
  indicated, and Demo home is reachable from every page. Confirm the mode badge
  and comparison link identify the intended governed/ungoverned instance.
- [ ] In the governed discussion, **Choose a disclosure** is initially selected.
  Attempting Publish without a choice should not open WebAuthn or publish.
  Select each valid choice in separate rehearsals and check the displayed/audited
  declaration. Confirm there is no free-form JavaScript attestation prompt.
- [ ] Cancel a native presence request: the choice and response remain, and retry
  is available. Changing the choice during confirmation must prevent publication
  until a fresh submission verifies the new declaration.
- [ ] For passkey setup, quiz, discussion, and record reveal, confirm the in-page
  **Human confirmation required** message explains the action while the browser's
  own dialog is open. Record fields remain masked until verification succeeds.
  Native dialog wording is browser/OS-controlled; do not expect our explanation
  inside the Touch ID dialog itself.
