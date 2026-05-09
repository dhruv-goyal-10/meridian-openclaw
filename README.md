<p align="center">
  <img src="assets/banner.svg" alt="Meridian" width="800"/>
</p>

---

# Meridian — OpenClaw Fork

This is a fork of [rynfar/meridian](https://github.com/rynfar/meridian) with first-class support for [OpenClaw](https://openclaw.ai) as an agent. The fork adds a dedicated OpenClaw adapter, fixes transparent native web tool execution, and ships documentation specific to running Meridian + OpenClaw on an Ubuntu VM.

For everything else — general Meridian features, other agents (OpenCode, ForgeCode, Cline, etc.), plugins, Docker, and the full API reference — see the [upstream README](https://github.com/rynfar/meridian#readme).

---

## What This Fork Adds

### OpenClaw Adapter

A dedicated adapter (`src/proxy/adapters/openclaw.ts`) detects OpenClaw via the `x-meridian-agent: openclaw` request header and applies the correct passthrough configuration:

- OpenClaw's tools (`read`, `exec`, `write`, `edit`, `apply_patch`) are registered as passthrough MCP tools — Claude calls them and Meridian forwards each `tool_use` block back to OpenClaw for execution
- `WebSearch` and `WebFetch` are marked as native built-in tools — they run transparently inside the SDK subprocess with no `tool_use` block ever reaching OpenClaw

### Transparent WebSearch and WebFetch

Three bugs in the upstream passthrough path prevented native web tools from working:

1. **`tools: []` removed WebSearch/WebFetch from Claude's context** — fixed by passing `nativeBuiltinTools` as the SDK `tools` array so only those two tools are exposed, keeping the rest of the ~25k-token built-in catalog out of the request
2. **Native tool_use blocks were forwarded to the client** — fixed by filtering `WebSearch`/`WebFetch` from the response in both the streaming and non-streaming paths, so the SDK's internal execution stays invisible and the model's final text answer flows through cleanly
3. **`maxTurns: 3` crashed mid-chain** — fixed by bumping `computePassthroughMaxTurns` with `+min(n×4, 9)` per native tool, giving OpenClaw `maxTurns: 11` — enough for a search + 4–6 URL fetches + final answer without hitting the turn limit

### Result

OpenClaw asks a question → Claude searches and fetches multiple sources internally → OpenClaw receives a final text answer. No web tool configuration needed on the OpenClaw side.

Cross-sector validation (live):

| Query | Meridian result | Accurate? |
|---|---|---|
| NQ + ES futures price | 28,872 / 7,408 (Yahoo Finance) | ✅ |
| Bitcoin price | $79k–$81k range | ✅ |
| NBA playoff scores | Correct schedule + series leads | ✅ |
| Claude Opus 4.7 release | Correct pricing and features | ✅ |
| Top global headlines | Matched BBC / NPR live | ✅ |

---

## Documentation

| Guide | What it covers |
|---|---|
| [**docs/meridian-setup.md**](docs/meridian-setup.md) | Cloning this fork, installing Bun, authenticating with Claude Max, running Meridian on an Ubuntu VM |
| [**docs/openclaw-setup.md**](docs/openclaw-setup.md) | Configuring OpenClaw's provider — `api: "anthropic-messages"`, adapter detection headers, session continuity, tool configuration |
| [**docs/openclaw-native-web-tools.md**](docs/openclaw-native-web-tools.md) | Technical deep-dive: root causes of the three web tool bugs, exact code changes, `maxTurns` breakdown, and recommended AGENTS.md prompt for live-data accuracy |

Start with the Meridian setup guide, then the OpenClaw guide.

---

## Quick Start

```bash
# Clone this fork
git clone https://github.com/dhruv-goyal-10/meridian-openclaw.git meridian
cd meridian

# Install dependencies
bun install

# Authenticate with Claude Max (one time)
./node_modules/@anthropic-ai/claude-code/bin/claude.exe login

# Start
bun run ./bin/cli.ts
```

Meridian runs on `http://127.0.0.1:3456`. In OpenClaw's provider config:

```yaml
models:
  providers:
    meridian:
      api: "anthropic-messages"
      baseUrl: "http://localhost:3456"
      headers:
        x-meridian-agent: "openclaw"
        x-openclaw-session-key: "my-agent-1"
```

---

## License

MIT — same as the upstream project.
