# OpenClaw Setup Guide — Connecting to Meridian

Both OpenClaw and Meridian run on the same Oracle VM Ubuntu machine. OpenClaw connects to Meridian over localhost — no network routing, no firewall rules needed between them.

## Critical Rules (read before anything else)

1. **Use `api: "anthropic-messages"`** — never `openai-completions`. The OpenAI-compat format breaks tool calls (400 errors, known OpenClaw bug). Anthropic format gives you proper tool_use/tool_result structure and full session management.

2. **baseUrl must NOT end with `/v1`** — OpenClaw appends `/v1/messages` automatically. If your baseUrl already contains `/v1`, requests go to `/v1/v1/messages` → 404.

3. **`x-meridian-agent: openclaw` header is required** — OpenClaw sends a generic Chrome browser User-Agent for LLM calls, not an identifiable one. Without this header Meridian cannot detect OpenClaw and falls back to the wrong adapter (OpenCode), silently breaking passthrough mode and tool handling.

## Provider Configuration

In your OpenClaw config file (typically `~/.openclaw/config.yaml` or equivalent):

```yaml
models:
  providers:
    meridian:
      api: "anthropic-messages"
      baseUrl: "http://localhost:3456"   # NO trailing /v1 — OpenClaw appends /v1/messages itself
      headers:
        x-meridian-agent: "openclaw"              # REQUIRED — adapter detection
        x-openclaw-session-key: "my-openclaw-1"   # OPTIONAL — enables session continuity
```

Both services on the same VM — `localhost:3456` is all you need.

## Model Names

Meridian exposes these Claude models (use these as your model IDs):

| Model ID | Description |
|---|---|
| `claude-sonnet-4-6` | Claude Sonnet 4.6 — 200k context, fast |
| `claude-opus-4-7` | Claude Opus 4.7 — best quality |
| `claude-opus-4-6` | Claude Opus 4.6 — 1M context on Max |
| `claude-haiku-4-5` | Claude Haiku 4.5 — fastest |

## Web Tools — Disable in OpenClaw, Rely on Claude Code SDK

Do NOT configure OpenClaw's own web search or web fetch tools when using Meridian. Here is why:

- Meridian's OpenClaw adapter marks `WebSearch` and `WebFetch` as **native built-in tools** that run directly inside the Claude Code SDK subprocess
- If OpenClaw registers its own web tools (e.g. `web_browse`, `web_search`) in its tool definitions, those are also available — but Claude may use either
- If you simply do NOT define OpenClaw's web tools, Claude has no MCP web tool to call and will automatically use the SDK's built-in `WebSearch` / `WebFetch` instead
- The SDK's web tools use Anthropic's own web access infrastructure — no OpenClaw account or subscription needed for them

**What to do:** leave web search / web fetch out of your OpenClaw tool configuration entirely. Let Meridian's native tool mechanism handle it.

## Session Continuity

### With `x-openclaw-session-key` header (recommended)

Set a stable, unique value per agent instance in your provider headers:

```yaml
headers:
  x-meridian-agent: "openclaw"
  x-openclaw-session-key: "my-main-openclaw-agent"
```

This gives Meridian a reliable session key to look up cached sessions. All four lineage states work:

| State | When it fires |
|---|---|
| **Continuation** | Each new turn (OpenClaw adds N+1 messages) |
| **Compaction** | OpenClaw's own message summarisation kicks in (maxHistoryTokens hit) |
| **Undo** | User reverts a message in OpenClaw — Meridian forks the SDK session at the exact rollback UUID |
| **Diverged** | Completely new conversation — fresh SDK session |

### Without the header (fingerprint-only)

Meridian fingerprints by SHA-256 of `{workspace path}\n{first user message}`. Session continuity still works but is slightly weaker — two different projects starting with the same first message could collide. The header eliminates this.

## What Happens at Each Turn

```
OpenClaw → POST /v1/messages (Anthropic format, full history every turn)
         → Meridian detects adapter via x-meridian-agent header
         → Lineage check: continuation / compaction / undo / diverged
         → SDK session resumed or forked at rollback UUID
         → OpenClaw's tools registered as MCP passthrough
         → WebSearch / WebFetch allowed through as native SDK tools
         → Claude responds
         → Tool calls forwarded back to OpenClaw for execution
         → OpenClaw sends tool results in next turn
```

## Checklist

- [ ] `api: "anthropic-messages"` set (not `openai-completions`)
- [ ] `baseUrl` points to `http://<vm-ip>:3456` with no `/v1` suffix
- [ ] `x-meridian-agent: openclaw` in provider headers
- [ ] `x-openclaw-session-key` set to a stable unique string (recommended)
- [ ] Web search / web fetch tools NOT defined in OpenClaw tool config
- [ ] Meridian health check returns `"loggedIn": true` at `http://localhost:3456/health`

No firewall changes needed — both services are on the same VM and communicate over localhost only.
