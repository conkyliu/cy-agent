# Change: add-tool-approval

## Why

`bootstrap-agent-runtime` 仅预留了 `ToolExecutionPolicy` 程序化挂起点，
缺少面向用户的显式授权能力。写文件、执行 Shell 等高危工具必须经用户确认，
需要实现 Human-in-the-loop（HITL）授权挂起机制，为 Phase 3 的权限对话框奠定基础。

## What Changes

- `packages/protocol`：`AgentEvent` 新增 `tool_approval_requested` 事件（携带 toolCallId / name / args）。
- `packages/agent`：
  - `ToolContract` 新增 `requiresApproval?: boolean` 字段。
  - `AgentSession` 新增 `resolveApproval(toolCallId, approved)` 接口，供宿主（CLI / Electron）响应授权。
  - Agent Loop 工具调度实现 Deferred Async Control：创建 Deferred → yield 授权事件 → 挂起等待 → 按响应执行或伪造拒绝结果。
  - 取消时自动解除挂起并清空挂起的 Deferred，防止内存泄漏。

## Impact

- Affected specs: `tool-execution`（新增 HITL 授权要求）
- Affected code: `packages/protocol/src/events.ts`、`packages/agent/src/contracts/tool.ts`、`packages/agent/src/session.ts`
- 兼容性：未设置 `requiresApproval` 的工具行为不变（`tool_execution_started` 时机调整为通过策略与授权检查之后）。
