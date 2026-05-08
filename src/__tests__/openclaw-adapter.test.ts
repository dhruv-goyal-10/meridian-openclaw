/**
 * Tests for the OpenClaw agent adapter and its transform.
 */
import { describe, it, expect } from "bun:test"
import { openClawAdapter, extractOpenClawCwd } from "../proxy/adapters/openclaw"
import { openClawTransforms, OPENCLAW_NATIVE_TOOLS } from "../proxy/transforms/openclaw"
import { createRequestContext } from "../proxy/transform"

// --- Adapter identity ---

describe("openClawAdapter — identity", () => {
  it("has name 'openclaw'", () => {
    expect(openClawAdapter.name).toBe("openclaw")
  })

  it("uses passthrough mode", () => {
    expect(openClawAdapter.usesPassthrough?.()).toBe(true)
  })
})

// --- Session ID ---

describe("openClawAdapter.getSessionId", () => {
  it("returns x-openclaw-session-key header value when present", () => {
    const ctx = {
      req: {
        header: (name: string) =>
          name === "x-openclaw-session-key" ? "my-session-123" : undefined,
      },
    }
    expect(openClawAdapter.getSessionId(ctx as any)).toBe("my-session-123")
  })

  it("returns undefined when no session header is present", () => {
    const ctx = { req: { header: () => undefined } }
    expect(openClawAdapter.getSessionId(ctx as any)).toBeUndefined()
  })
})

// --- CWD extraction ---

describe("extractOpenClawCwd", () => {
  it("extracts Workspace path from string system prompt", () => {
    const body = {
      system: "You are an autonomous agent.\nWorkspace: /home/user/projects/myapp\nSome other context.",
    }
    expect(extractOpenClawCwd(body)).toBe("/home/user/projects/myapp")
  })

  it("extracts Workspace path from array system prompt", () => {
    const body = {
      system: [
        { type: "text", text: "Safety guardrails: ...\nWorkspace: /Users/alice/workspace\nSkills: ..." },
      ],
    }
    expect(extractOpenClawCwd(body)).toBe("/Users/alice/workspace")
  })

  it("is case-insensitive for the Workspace label", () => {
    const body = { system: "workspace: /tmp/test" }
    expect(extractOpenClawCwd(body)).toBe("/tmp/test")
  })

  it("trims surrounding whitespace from the extracted path", () => {
    const body = { system: "Workspace:   /path/with/spaces   \nNext line" }
    expect(extractOpenClawCwd(body)).toBe("/path/with/spaces")
  })

  it("returns undefined when no Workspace line is present", () => {
    const body = { system: "You are an assistant. No workspace here." }
    expect(extractOpenClawCwd(body)).toBeUndefined()
  })

  it("returns undefined for empty body", () => {
    expect(extractOpenClawCwd({})).toBeUndefined()
    expect(extractOpenClawCwd(null)).toBeUndefined()
  })

  it("returns undefined when system is missing", () => {
    const body = { messages: [{ role: "user", content: "hello" }] }
    expect(extractOpenClawCwd(body)).toBeUndefined()
  })
})

describe("openClawAdapter.extractWorkingDirectory", () => {
  it("delegates to extractOpenClawCwd", () => {
    const body = { system: "Workspace: /opt/project" }
    expect(openClawAdapter.extractWorkingDirectory(body)).toBe("/opt/project")
  })
})

// --- Tool configuration ---

describe("openClawAdapter — tool blocking", () => {
  it("does NOT block WebSearch", () => {
    expect(openClawAdapter.getBlockedBuiltinTools()).not.toContain("WebSearch")
  })

  it("does NOT block WebFetch", () => {
    expect(openClawAdapter.getBlockedBuiltinTools()).not.toContain("WebFetch")
  })

  it("blocks SDK file-system tools", () => {
    const blocked = openClawAdapter.getBlockedBuiltinTools()
    expect(blocked).toContain("Read")
    expect(blocked).toContain("Write")
    expect(blocked).toContain("Edit")
    expect(blocked).toContain("Bash")
  })

  it("does NOT list WebSearch in incompatible tools", () => {
    expect(openClawAdapter.getAgentIncompatibleTools()).not.toContain("WebSearch")
  })

  it("lists Claude Code SDK-only tools as incompatible", () => {
    const incompatible = openClawAdapter.getAgentIncompatibleTools()
    expect(incompatible).toContain("CronCreate")
    expect(incompatible).toContain("EnterPlanMode")
    expect(incompatible).toContain("Agent")
  })
})

describe("OPENCLAW_NATIVE_TOOLS", () => {
  it("includes WebSearch", () => {
    expect(OPENCLAW_NATIVE_TOOLS).toContain("WebSearch")
  })

  it("includes WebFetch", () => {
    expect(OPENCLAW_NATIVE_TOOLS).toContain("WebFetch")
  })
})

// --- Transform pipeline ---

describe("openClawTransforms", () => {
  it("sets nativeBuiltinTools including WebSearch and WebFetch", () => {
    const ctx = createRequestContext({
      adapter: "openclaw",
      body: {},
      headers: new Headers(),
      model: "claude-sonnet-4-6",
      messages: [],
      stream: false,
      workingDirectory: "/tmp",
    })

    const transform = openClawTransforms[0]!
    const result = transform.onRequest!(ctx)

    expect(result.nativeBuiltinTools).toContain("WebSearch")
    expect(result.nativeBuiltinTools).toContain("WebFetch")
  })

  it("sets passthrough: true", () => {
    const ctx = createRequestContext({
      adapter: "openclaw",
      body: {},
      headers: new Headers(),
      model: "claude-sonnet-4-6",
      messages: [],
      stream: false,
      workingDirectory: "/tmp",
    })

    const transform = openClawTransforms[0]!
    const result = transform.onRequest!(ctx)

    expect(result.passthrough).toBe(true)
  })

  it("does not block WebSearch or WebFetch in blockedTools", () => {
    const ctx = createRequestContext({
      adapter: "openclaw",
      body: {},
      headers: new Headers(),
      model: "claude-sonnet-4-6",
      messages: [],
      stream: false,
      workingDirectory: "/tmp",
    })

    const transform = openClawTransforms[0]!
    const result = transform.onRequest!(ctx)

    expect(result.blockedTools).not.toContain("WebSearch")
    expect(result.blockedTools).not.toContain("WebFetch")
  })
})
