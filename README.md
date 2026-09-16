# OpenCode governance: hour-one compatibility probe

A minimal plugin and localhost fake model provider to answer two questions:

1. Do OpenCode's message/system transform hooks run?
2. Does throwing from a hook prevent protected content from reaching the provider?

This is the compatibility spike, not the full governance implementation. It uses
the synthetic value `GOVERNANCE_PROBE_SECRET_48291`, with case-sensitive substring
matching. No real credentials or sensitive input are needed.

## Findings

Tested on Windows with **OpenCode 1.18.31** (project-local npm package) and **Bun 1.4.2**.
This tests the published CLI, not the adjacent OpenCode source checkout or an
already-running OpenCode session.

| Mode | Clean input | Protected user message | Protected system prompt |
| --- | --- | --- | --- |
| Automatic title generation | Reaches fake provider | **Leaks through title-generation request**, then main turn blocks | Main turn blocks; clean title request can still reach provider |
| Explicit fixed session title | Reaches fake provider | Hook blocks; **zero provider requests** | Hook blocks; **zero provider requests** |

**Decision:** conditional GO for a fixed-title, single-turn hackathon demo on this
version. NO-GO for claiming these two hooks cover all outbound requests with
default behavior. Automatic title generation is a demonstrated bypass.

Throwing from the message hook can surface as a generic `UnknownError` / "Unexpected
server error" rather than the plugin's error text. The audit file establishes which
hook blocked. Improving the user-facing error is follow-up work.

## Run the tests (PowerShell)

Prerequisites: Node.js/npm and Bun on PATH. No global OpenCode installation is needed.

```powershell
Set-Location "C:\Users\Collin\Documents\MCU Hackathon\mcu-ai-hackathon"
npm ci --no-audit --no-fund
bun --version
& ".\node_modules\opencode-ai\bin\opencode.exe" --version
```

The OpenCode version should be `1.18.31`. Installation and first-run provider adapter
resolution need internet access. Model requests use only the localhost fake provider;
the generated config uses a dummy API key and selects it for both main and small models.

### Test 1: scoped demo path (expected PASS)

```powershell
bun run probe --fixed-title
$LASTEXITCODE
```

Expected script exit code: **0**. It runs three separate CLI sessions:

- `clean`: `passed: true`, at least one request, fake answer `LOCAL_PROBE_OK`, both hooks observed.
- `message-block`: `passed: true`, `requestsReceived: 0`, a message-hook block event.
- `system-block`: `passed: true`, `requestsReceived: 0`, a system-hook block event.
- Every scenario: `protectedValueReceived: false`, `timedOut: false`.

The child CLI's `exitCode: 1` in blocked scenarios is expected. It does not mean the
probe failed: stopping the CLI is the behavior being tested.

### Test 2: default title-generation coverage (expected FAIL)

```powershell
bun run probe
$LASTEXITCODE
```

Expected script exit code: **1**. In `message-block`, expect:

```text
passed: false
requestsReceived: 1
protectedValueReceived: true
```

The message hook still records a block. The failure proves that blocking the main
turn is insufficient: a separate title-generation request already contains the marker.
The receiver is local, so this demonstration sends no marker to a real model provider.

## Inspect the evidence

Each run prints an absolute `Evidence:` directory under `.probe/<timestamp>/`.
Open that directory in your editor. It contains:

```text
results.json                  Version, mode, per-scenario assertions
clean/
message-block/
system-block/
  audit.jsonl                 Hook names and allow/block decisions; no input values
  captured.json               Actual JSON bodies received by the local fake provider
  stdout.jsonl                OpenCode CLI JSON events
  stderr.txt                  CLI diagnostics
  opencode.json               Exact generated configuration
  governance.ts               Copy of plugin used for this run
```

In the default-mode failure, open `message-block/captured.json`: the system message
identifies the title generator and a user message contains the synthetic marker.
In fixed-title mode the same file must be `[]` for both blocked scenarios.

Capture files intentionally contain raw **synthetic test traffic**. Do not substitute
real secrets into this probe. `.probe/` and `node_modules/` are gitignored.

## Implementation

- `plugin/governance.ts`: self-contained plugin; recursively scans string values and
  keys, appends a minimal audit event, then throws on a match.
- `scripts/probe.ts`: creates isolated per-scenario config/data directories, starts a
  loopback OpenAI-compatible endpoint on an ephemeral port, launches the pinned CLI,
  captures requests, checks outcomes, and stops the endpoint. Each child has a
  two-minute timeout.
- `package.json` / `package-lock.json`: pin the CLI for reproducibility.

The probe uses an explicit plugin path rather than auto-installing it into your normal
OpenCode configuration. Every test launches a fresh process; existing sessions and
their configuration are not part of the test. If you later install or edit a plugin in
your normal configuration, quit and restart OpenCode for it to take effect.

## Scope of the result

Verified: clean single-turn requests, literal known values in user messages and agent
system prompts, hook rejection, and automatic-title behavior on the pinned CLI.

Not yet verified: subsequent tool-result turns, compaction, subagents, tool schemas,
other providers/transports, the V2 source-checkout runtime, or direct tool network
traffic. Fixed titles close the observed title-generation bypass only; they do not
establish universal outbound protection.
