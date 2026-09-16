# OpenCode Governance

An OpenCode plugin that blocks configured banned phrases in conversation content,
system prompts, and tool definitions using case-insensitive substring matching.
The included launcher runs OpenCode with DeepSeek (`deepseek/deepseek-flash`).

## Set up the environment

Requires **Bun 1.4.2 or newer**, **Node.js**, and a **DeepSeek API key** with available
credit. These commands work on Windows and macOS from the project root.

```text
bun install
bun run setup
```

Setup creates `.env` and `governance.policy.json` without overwriting existing files.
OpenCode is installed locally; no global installation is needed.

Set your API key in `.env` (this file is gitignored):

```dotenv
DEEPSEEK_API_KEY=your-deepseek-api-key
```

Edit `governance.policy.json` to specify at least one nonblank banned phrase:

```json
{
  "bannedPhrases": ["Project Copper Secret", "ACCT-DEMO-48291"]
}
```

## Run it

Check setup and model availability without sending a model-generation request:

```text
bun run real --check
```

Send a prompt:

```text
bun run real "Hello there"
```

Try a phrase blocked by the example policy:

```text
bun run real "Please repeat project COPPER secret."
```

Blocked requests exit with an error. Check `governance.audit.jsonl` for the blocking
decision if OpenCode displays a generic error.

Each command starts a fresh session and reloads `.env` and the policy. The launcher
automatically uses a fixed session title to avoid the known automatic-title bypass.
