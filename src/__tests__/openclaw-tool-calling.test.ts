/**
 * OpenClaw tool calling integration tests.
 *
 * Verifies the full passthrough flow using OpenClaw's actual tool format:
 *   - Tool names: plain short names (`read`, `exec`) — no mcp__ prefix in the request
 *   - Parameters: `path` for read (OpenClaw's canonical name), `command` for exec
 *   - SDK registers them internally as `mcp__oc__read`, `mcp__oc__exec`
 *   - Proxy strips the `mcp__oc__` prefix before returning to the client
 *   - WebSearch runs natively inside the SDK; client receives text only, no tool_use block
 *
 * Detection: `x-meridian-agent: openclaw` header (OpenClaw sends a generic UA).
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"
import {
  messageStart,
  textBlockStart,
  toolUseBlockStart,
  inputJsonDelta,
  blockStop,
  messageDelta,
  messageStop,
  textDelta,
  parseSSE,
  assistantMessage,
  makeRequest,
} from "./helpers"

let mockMessages: any[] = []

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: () =>
    (async function* () {
      for (const msg of mockMessages) yield msg
    })(),
  createSdkMcpServer: () => ({
    type: "sdk",
    name: "test",
    instance: { tool: () => {}, registerTool: () => ({}) },
  }),
}))

mock.module("../logger", () => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: any, fn: any) => fn(),
}))

mock.module("../mcpTools", () => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { createProxyServer, clearSessionCache } = await import("../proxy/server")

// Passthrough MCP prefix the SDK uses internally
const PASSTHROUGH_PREFIX = "mcp__oc__"

// OpenClaw tool definitions — exact names and parameter schemas from OpenClaw docs
const READ_TOOL = {
  name: "read",
  description: "Read a file from the workspace",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
}

const EXEC_TOOL = {
  name: "exec",
  description: "Run shell commands in the workspace",
  input_schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
}

// Headers OpenClaw sends for every request
const OPENCLAW_HEADERS = {
  "Content-Type": "application/json",
  "x-meridian-agent": "openclaw",
  "x-openclaw-session-key": "test-session-openclaw",
}

function createTestApp() {
  const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
  return app
}

async function postNonStream(app: any, body: Record<string, unknown>): Promise<Response> {
  return app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: OPENCLAW_HEADERS,
    body: JSON.stringify(body),
  }))
}

async function postStream(app: any, body: Record<string, unknown>): Promise<string> {
  const response = await app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: OPENCLAW_HEADERS,
    body: JSON.stringify(body),
  }))
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let result = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

// ============================================================
// Non-streaming: read tool — two-turn flow
// ============================================================

describe("OpenClaw non-streaming: read tool two-turn flow", () => {
  beforeEach(() => {
    mockMessages = []
    clearSessionCache()
  })

  it("turn 1: strips mcp__oc__ prefix — client receives 'read' not 'mcp__oc__read'", async () => {
    mockMessages = [
      assistantMessage([
        { type: "text", text: "Let me read that file." },
        {
          type: "tool_use",
          id: "toolu_read1",
          name: `${PASSTHROUGH_PREFIX}read`,
          input: { path: "/etc/hosts" },
        },
      ]),
    ]

    const app = createTestApp()
    const response = await postNonStream(app, makeRequest({
      stream: false,
      tools: [READ_TOOL],
      messages: [{ role: "user", content: "What is in /etc/hosts?" }],
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.stop_reason).toBe("tool_use")

    const toolBlock = body.content.find((b: any) => b.type === "tool_use")
    expect(toolBlock).toBeDefined()
    expect(toolBlock.name).toBe("read")
    expect(toolBlock.id).toBe("toolu_read1")
    expect(toolBlock.input.path).toBe("/etc/hosts")
  })

  it("turn 2: accepts tool_result with file content and returns final text", async () => {
    const fileContent = "127.0.0.1 localhost\n::1 localhost"
    mockMessages = [
      assistantMessage([
        { type: "text", text: "The /etc/hosts file maps localhost to 127.0.0.1 and ::1." },
      ]),
    ]

    const app = createTestApp()
    const response = await postNonStream(app, makeRequest({
      stream: false,
      tools: [READ_TOOL],
      messages: [
        { role: "user", content: "What is in /etc/hosts?" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_read1", name: "read", input: { path: "/etc/hosts" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_read1", content: fileContent },
          ],
        },
      ],
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.stop_reason).toBe("end_turn")
    const textBlock = body.content.find((b: any) => b.type === "text")
    expect(textBlock?.text).toContain("localhost")
  })
})

// ============================================================
// Non-streaming: exec tool
// ============================================================

describe("OpenClaw non-streaming: exec tool", () => {
  beforeEach(() => {
    mockMessages = []
    clearSessionCache()
  })

  it("strips mcp__oc__ prefix — client receives 'exec' not 'mcp__oc__exec'", async () => {
    mockMessages = [
      assistantMessage([
        { type: "text", text: "Let me list those files." },
        {
          type: "tool_use",
          id: "toolu_exec1",
          name: `${PASSTHROUGH_PREFIX}exec`,
          input: { command: "ls -la /tmp" },
        },
      ]),
    ]

    const app = createTestApp()
    const response = await postNonStream(app, makeRequest({
      stream: false,
      tools: [EXEC_TOOL],
      messages: [{ role: "user", content: "List the files in /tmp" }],
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.stop_reason).toBe("tool_use")

    const toolBlock = body.content.find((b: any) => b.type === "tool_use")
    expect(toolBlock).toBeDefined()
    expect(toolBlock.name).toBe("exec")
    expect(toolBlock.id).toBe("toolu_exec1")
    expect(toolBlock.input.command).toBe("ls -la /tmp")
  })

  it("turn 2: accepts exec tool_result and returns final text", async () => {
    const commandOutput = "total 8\ndrwxrwxrwt 2 root root 4096 May 1 12:00 .\ndrwxr-xr-x 20 root root 4096 May 1 10:00 .."
    mockMessages = [
      assistantMessage([
        { type: "text", text: "The /tmp directory is currently empty aside from the standard entries." },
      ]),
    ]

    const app = createTestApp()
    const response = await postNonStream(app, makeRequest({
      stream: false,
      tools: [EXEC_TOOL],
      messages: [
        { role: "user", content: "List the files in /tmp" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_exec1", name: "exec", input: { command: "ls -la /tmp" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_exec1", content: commandOutput },
          ],
        },
      ],
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.stop_reason).toBe("end_turn")
    const textBlock = body.content.find((b: any) => b.type === "text")
    expect(textBlock?.text).toBeDefined()
  })
})

// ============================================================
// Streaming: exec tool — early termination on tool_use stop
// ============================================================

describe("OpenClaw streaming: exec tool early termination", () => {
  beforeEach(() => {
    mockMessages = []
    clearSessionCache()
  })

  it("stream ends cleanly after tool_use stop with prefix stripped", async () => {
    mockMessages = [
      messageStart(),
      toolUseBlockStart(0, `${PASSTHROUGH_PREFIX}exec`, "toolu_exec_stream"),
      inputJsonDelta(0, '{"command":"ls -la /tmp"}'),
      blockStop(0),
      messageDelta("tool_use"),
      messageStop(),
      // Turn 2 — SDK would continue here; proxy must cut off before this
      messageStart("msg_turn2"),
      textBlockStart(0),
      textDelta(0, "The tool returned passthrough, I cannot continue."),
      blockStop(0),
      messageDelta("end_turn"),
      messageStop(),
    ]

    const app = createTestApp()
    const raw = await postStream(app, makeRequest({
      stream: true,
      tools: [EXEC_TOOL],
      messages: [{ role: "user", content: "List the files in /tmp" }],
    }))
    const events = parseSSE(raw)

    // Tool_use block forwarded with prefix stripped
    const toolStarts = events.filter(
      (e) => e.event === "content_block_start" &&
        (e.data as any).content_block?.type === "tool_use"
    )
    expect(toolStarts.length).toBe(1)
    expect((toolStarts[0]?.data as any).content_block.name).toBe("exec")

    // message_delta with stop_reason:tool_use present before stop
    const toolUseDelta = events.find(
      (e) => e.event === "message_delta" &&
        (e.data as any).delta?.stop_reason === "tool_use"
    )
    expect(toolUseDelta).toBeDefined()

    // Stream ends with message_stop
    expect(events[events.length - 1]?.event).toBe("message_stop")

    // No turn-2 text leaked after tool_use stop
    const textDeltas = events.filter(
      (e) => e.event === "content_block_delta" &&
        (e.data as any).delta?.type === "text_delta"
    )
    expect(textDeltas.length).toBe(0)
  })
})

// ============================================================
// Streaming: read tool with realistic file path
// ============================================================

describe("OpenClaw streaming: read tool", () => {
  beforeEach(() => {
    mockMessages = []
    clearSessionCache()
  })

  it("forwards read tool_use with path input and stops cleanly", async () => {
    mockMessages = [
      messageStart(),
      toolUseBlockStart(0, `${PASSTHROUGH_PREFIX}read`, "toolu_read_stream"),
      inputJsonDelta(0, '{"path":"/etc/hosts"}'),
      blockStop(0),
      messageDelta("tool_use"),
      messageStop(),
    ]

    const app = createTestApp()
    const raw = await postStream(app, makeRequest({
      stream: true,
      tools: [READ_TOOL],
      messages: [{ role: "user", content: "What is in /etc/hosts?" }],
    }))
    const events = parseSSE(raw)

    const toolStarts = events.filter(
      (e) => e.event === "content_block_start" &&
        (e.data as any).content_block?.type === "tool_use"
    )
    expect(toolStarts.length).toBe(1)
    expect((toolStarts[0]?.data as any).content_block.name).toBe("read")

    expect(events[events.length - 1]?.event).toBe("message_stop")
  })
})

// ============================================================
// WebSearch: runs natively — no tool_use forwarded to client
// ============================================================

describe("OpenClaw: WebSearch runs natively", () => {
  beforeEach(() => {
    mockMessages = []
    clearSessionCache()
  })

  it("client receives text-only response when SDK handles WebSearch natively", async () => {
    // Simulate: SDK ran WebSearch internally, model incorporated results into text.
    // Client never sees a tool_use block for WebSearch.
    mockMessages = [
      assistantMessage([
        { type: "text", text: "The latest Python release is 3.13.2, released in February 2026." },
      ]),
    ]

    const app = createTestApp()
    // No web_search in tools — OpenClaw relies on native SDK WebSearch per setup guide
    const response = await postNonStream(app, makeRequest({
      stream: false,
      tools: [READ_TOOL],
      messages: [{ role: "user", content: "What is the latest Python release?" }],
    }))

    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.stop_reason).toBe("end_turn")

    // No tool_use in response — WebSearch was transparent to the client
    const toolBlocks = body.content.filter((b: any) => b.type === "tool_use")
    expect(toolBlocks.length).toBe(0)

    const textBlock = body.content.find((b: any) => b.type === "text")
    expect(textBlock?.text).toContain("Python")
  })
})
