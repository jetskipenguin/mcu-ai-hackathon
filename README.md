# OpenCode governance: hour-one compatibility probe

A minimal OpenCode plugin and a localhost fake model provider, built to answer two
questions:

1. Do OpenCode's message/system transform hooks run?
2. Does throwing from a hook keep protected content from reaching the provider?

Two source files: `plugin/governance.ts` (the plugin) and `scripts/probe.ts` (the test
harness). The probe uses one synthetic marker, `GOVERNANCE_PROBE_SECRET_48291`, matched as
a case-sensitive substring. No real credentials or sensitive input are involved.

**Result:** conditional GO for a fixed-title, single-turn demo; NO-GO for default behavior,
because automatic title generation is a separate request that the hooks do not cover.

## Development environment

- Windows, with **Bun 1.4.2** on PATH.
- **OpenCode 1.18.31** is pinned as a local dependency, so no global install is needed.
- The first `bun install` needs internet access for provider adapter resolution.

```powershell
bun install
bun run lint
& ".\node_modules\opencode-ai\bin\opencode.exe" --version   # expect 1.18.31
```

## Run the probe tests

Each invocation starts a loopback OpenAI-compatible endpoint on an ephemeral port,
launches the pinned CLI in its own config and data directory, records what the endpoint
receives, and asserts the outcome. Three scenarios run per invocation: `clean`,
`message-block`, and `system-block`.

```powershell
bun run probe --fixed-title   # scoped demo path - expect exit code 0
bun run probe                 # default title generation - expect exit code 1
```

- With `--fixed-title`: every scenario `passed: true`; both blocked scenarios report
  `requestsReceived: 0`; `clean` receives the fake answer `LOCAL_PROBE_OK` with both hooks
  observed; all scenarios report `protectedValueReceived: false`.
- Without it: `message-block` reports `passed: false`, `requestsReceived: 1`,
  `protectedValueReceived: true` - a title-generation request carrying the marker reaches
  the local endpoint before the main turn is blocked.
- A child CLI `exitCode: 1` for a blocked scenario is expected; stopping the CLI is the
  behavior under test.
- Throwing from the message hook can surface as a generic `UnknownError` instead of the
  plugin's error text, so use `audit.jsonl` to see which hook blocked.
- Every run prints an `Evidence:` directory under `.probe/<timestamp>/` containing
  `results.json` and, per scenario, `audit.jsonl` (hook decisions), `captured.json` (the
  bodies the endpoint received), `stdout.jsonl`, `stderr.txt`, and the generated
  `opencode.json`. In the default-mode failure `message-block/captured.json` shows the
  marker; with `--fixed-title` it is `[]` for both blocked scenarios. These files hold
  synthetic test traffic only - do not put real secrets in this probe. `.probe/`
