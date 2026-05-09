# OpenClaw — Native WebSearch & WebFetch

Changes made in this fork to make `WebSearch` and `WebFetch` run transparently inside the Claude Code SDK subprocess, so OpenClaw never has to implement or handle web tools itself.

## What Was Broken

The Claude Code SDK exposes `WebSearch` and `WebFetch` as built-in tools. The intent was for them to run natively — Claude searches or fetches a URL inside the SDK process, incorporates the result, and returns a final text answer. OpenClaw should never see a `tool_use` block for either.

Three separate bugs prevented this:

1. **`tools: []` stripped WebSearch/WebFetch from the model context.** The passthrough path set `tools: []` to remove the ~25k-token built-in catalog from upstream requests. This correctly removes `Read`, `Write`, `Bash`, etc., but it also silently removes `WebSearch` and `WebFetch`, so Claude had no web tools to call at all.

2. **Native tool_use blocks were forwarded to the client.** When WebSearch did fire (after fix 1), the proxy did not recognise it as a native tool and forwarded the `tool_use` block to OpenClaw with `stop_reason: "tool_use"`. OpenClaw has no WebSearch implementation and would stall.

3. **`maxTurns: 3` was too low for web research chains.** A minimal chain — WebSearch (turn 1) → WebFetch (turn 2) → final answer (turn 3) — fits exactly at 3. Any retry or second fetch crashed with `"Reached maximum number of turns (3)"` before the final answer could be generated.

## What Was Fixed

### `src/proxy/query.ts` — expose native tools to the model

```typescript
// Before
tools: [],

// After
tools: nativeBuiltinTools?.length ? [...nativeBuiltinTools] : [],
```

For OpenClaw, this passes `--tools "WebSearch,WebFetch"` to the SDK subprocess, making both tools visible in Claude's context while still excluding the rest of the catalog.

`computePassthroughMaxTurns` now accepts `nativeBuiltinTools` and adds `min(n * 4, 9)` to the base budget:

```
OpenClaw (WebSearch + WebFetch): 3 base + 8 native = 11 turns
```

This supports: 1 search + up to 6 fetches + 1 answer, or 2 searches + 4 fetches — without burning the budget mid-chain.

### `src/proxy/server.ts` — filter native tool_use from both paths

**Non-streaming path** — native tool_use blocks are skipped before entering `contentBlocks`:
```typescript
if (passthrough && b.type === "tool_use" && nativeBuiltinToolsSet.has((b as any).name)) {
  continue  // transparent — result already incorporated into model's next turn
}
```

Without this, a WebSearch `tool_use` in `contentBlocks` would trigger `isPassthroughTurn2`, suppressing the actual text answer.

**Streaming path** — native tool_use blocks are added to `skipBlockIndices` but NOT to `streamedToolUseIds`:
```typescript
if (passthrough && nativeBuiltinToolsSet.has(block.name)) {
  if (eventIndex !== undefined) skipBlockIndices.add(eventIndex)
  continue
}
```

Without this, a WebSearch `tool_use` in `streamedToolUseIds` would trigger the early stream termination, again suppressing the answer.

### `src/proxy/adapters/openclaw.ts` + `src/proxy/transforms/openclaw.ts` — dead code fix

`ALLOWED_MCP_TOOLS` listed `bash`, `glob`, `grep` — tools that OpenClaw does not expose. Corrected to match OpenClaw's actual tool names:

```typescript
const ALLOWED_MCP_TOOLS = [
  "mcp__openclaw__read",
  "mcp__openclaw__write",
  "mcp__openclaw__edit",
  "mcp__openclaw__exec",
  "mcp__openclaw__apply_patch",
]
```

Note: this array is dead code for OpenClaw (it always uses passthrough mode, which takes a different branch in `query.ts`). The fix keeps it accurate for documentation purposes.

## How It Works Now

```
OpenClaw sends: "What is the NQ price today?"
  ↓
Meridian → SDK subprocess
  tools: ["WebSearch", "WebFetch"]   ← both visible
  maxTurns: 11                       ← room to chain
  ↓
Claude (turn 1): calls WebSearch("NQ futures price May 2026")
  SDK executes internally → returns {title, url} list
Claude (turn 2): calls WebFetch("https://finance.yahoo.com/quote/NQ=F/")
  SDK executes internally → returns page content as markdown
Claude (turn 3): reads real price from fetched content → generates text answer
  ↓
Meridian filters: WebSearch and WebFetch tool_use blocks stripped
  ↓
OpenClaw receives: text answer with live price, stop_reason: "end_turn"
```

OpenClaw never sees `tool_use` for either web tool. From its perspective, Claude just answered.

## Recommended OpenClaw AGENTS.md Instruction

The SDK's `WebSearch` returns only `{title, url}` — no snippet content. Without guidance, the model sometimes answers from training memory instead of fetching the page. Add this to your `AGENTS.md` to ensure it always fetches:

```markdown
## Web Research Rules

**When to search:**
- Use web_search whenever the answer requires real-time data, current prices,
  recent events, or facts you are not certain about.
- Run a second web_search only if the first returned zero useful results.

**When to fetch:**
- After web_search, always run web_fetch on the most relevant URL before
  answering if the snippets do not contain the specific data needed.
- Fetch a second URL only if the first returned empty content or a paywall.
- If a page fails, try prefixing the URL with https://r.jina.ai/ for a
  clean readable version.

**How to answer:**
- Base your answer on fetched content, not on training memory, when live
  data is available.
- Cite the source URL inline after the relevant fact.
```

## Test Coverage

Integration tests in `src/__tests__/openclaw-tool-calling.test.ts` cover:

- Non-streaming: read and exec tool two-turn flows with `mcp__oc__` prefix stripped
- Streaming: early termination on `tool_use` stop, no turn-2 content leaked
- WebSearch transparency: client receives text-only response, no tool_use block

Cross-sector validation (live, run manually):

| Query | Result |
|---|---|
| NQ + ES futures price | Correct live prices from Yahoo Finance |
| Bitcoin price | Correct range matching live sources |
| NBA playoff scores | Correct schedule and series standings |
| Claude AI release | Opus 4.7 details with accurate pricing |
| Top global headlines | Matched BBC and NPR current headlines |
