/**
 * OpenClaw agent adapter.
 *
 * OpenClaw is an autonomous agent that embeds the working directory as
 * "Workspace: /path" in the system prompt. It manages its own tool execution
 * loop (passthrough mode). WebSearch and WebFetch run natively via the SDK.
 *
 * Required OpenClaw provider config (openclaw/docs/concepts/model-providers.md):
 *   api: "anthropic-messages"          ← must NOT use openai-completions (tool call 400s)
 *   baseUrl: "http://host:port"        ← do NOT include /v1 (OpenClaw appends it itself)
 *   headers:
 *     x-meridian-agent: "openclaw"     ← required: selects this adapter
 *     x-openclaw-session-key: "<id>"   ← optional: stable session ID for continuity
 *
 * Detection: OpenClaw sends a generic browser User-Agent for LLM API calls,
 * so UA-based detection is unreliable. Use x-meridian-agent or
 * x-openclaw-session-key headers (configured in provider headers) instead.
 */

import type { Context } from "hono"
import type { AgentAdapter } from "../adapter"
import { normalizeContent } from "../messages"

const MCP_SERVER_NAME = "openclaw"

const ALLOWED_MCP_TOOLS: readonly string[] = [
  `mcp__${MCP_SERVER_NAME}__read`,
  `mcp__${MCP_SERVER_NAME}__write`,
  `mcp__${MCP_SERVER_NAME}__edit`,
  `mcp__${MCP_SERVER_NAME}__bash`,
  `mcp__${MCP_SERVER_NAME}__glob`,
  `mcp__${MCP_SERVER_NAME}__grep`,
]

/**
 * Extract working directory from OpenClaw's "Workspace: /path" system prompt format.
 */
export function extractOpenClawCwd(body: any): string | undefined {
  if (!body) return undefined
  let systemText = ""
  if (typeof body.system === "string") {
    systemText = body.system
  } else if (Array.isArray(body.system)) {
    systemText = body.system
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n")
  }
  if (!systemText) return undefined
  const match = systemText.match(/\bWorkspace:\s*([^\n]+)/i)
  return match?.[1]?.trim() || undefined
}

export const openClawAdapter: AgentAdapter = {
  name: "openclaw",

  getSessionId(c: Context): string | undefined {
    return c.req.header("x-openclaw-session-key")
  },

  extractWorkingDirectory(body: any): string | undefined {
    return extractOpenClawCwd(body)
  },

  extractClientWorkingDirectory(body: any): string | undefined {
    return extractOpenClawCwd(body)
  },

  normalizeContent(content: any): string {
    return normalizeContent(content)
  },

  /**
   * Block SDK file-system tools — OpenClaw provides its own via MCP.
   * WebSearch and WebFetch are intentionally absent so they run natively.
   */
  getBlockedBuiltinTools(): readonly string[] {
    return ["Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep", "NotebookEdit", "TodoWrite"]
  },

  /**
   * Claude Code SDK tools that OpenClaw cannot execute.
   * WebSearch is intentionally omitted — it runs natively via the SDK.
   */
  getAgentIncompatibleTools(): readonly string[] {
    return [
      "CronCreate", "CronDelete", "CronList",
      "EnterPlanMode", "ExitPlanMode",
      "EnterWorktree", "ExitWorktree",
      "Monitor", "PushNotification",
      "RemoteTrigger", "ScheduleWakeup",
      "AskUserQuestion", "Skill",
      "Agent", "TaskOutput", "TaskStop",
    ]
  },

  getMcpServerName(): string {
    return MCP_SERVER_NAME
  },

  getAllowedMcpTools(): readonly string[] {
    return ALLOWED_MCP_TOOLS
  },

  usesPassthrough(): boolean {
    return true
  },

  prefersStreaming(body: any): boolean {
    return body?.stream === true
  },
}
