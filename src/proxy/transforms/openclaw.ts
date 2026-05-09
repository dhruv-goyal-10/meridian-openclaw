import type { Transform, RequestContext } from "../transform"

const MCP_SERVER_NAME = "openclaw"

const BLOCKED_BUILTIN_TOOLS: readonly string[] = [
  "Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep", "NotebookEdit", "TodoWrite",
]

// NOTE: WebSearch intentionally omitted — it runs natively via the SDK.
const INCOMPATIBLE_TOOLS: readonly string[] = [
  "CronCreate", "CronDelete", "CronList",
  "EnterPlanMode", "ExitPlanMode",
  "EnterWorktree", "ExitWorktree",
  "Monitor", "PushNotification",
  "RemoteTrigger", "ScheduleWakeup",
  "AskUserQuestion", "Skill",
  "Agent", "TaskOutput", "TaskStop",
]

export const OPENCLAW_NATIVE_TOOLS: readonly string[] = ["WebSearch", "WebFetch"]

const ALLOWED_MCP_TOOLS: readonly string[] = [
  `mcp__${MCP_SERVER_NAME}__read`,
  `mcp__${MCP_SERVER_NAME}__write`,
  `mcp__${MCP_SERVER_NAME}__edit`,
  `mcp__${MCP_SERVER_NAME}__exec`,
  `mcp__${MCP_SERVER_NAME}__apply_patch`,
]

export const openClawTransforms: Transform[] = [
  {
    name: "openclaw-core",
    adapters: ["openclaw"],
    onRequest(ctx: RequestContext): RequestContext {
      return {
        ...ctx,
        blockedTools: BLOCKED_BUILTIN_TOOLS,
        incompatibleTools: INCOMPATIBLE_TOOLS,
        allowedMcpTools: ALLOWED_MCP_TOOLS,
        nativeBuiltinTools: OPENCLAW_NATIVE_TOOLS,
        sdkAgents: {},
        passthrough: true,
        prefersStreaming: ctx.body?.stream === true,
      }
    },
  },
]
