# Capability: tool-execution (Delta: Human-in-the-loop 授权)

## ADDED Requirements

### Requirement: 工具授权标记

`ToolContract` SHALL 支持可选的 `requiresApproval` 标记。
标记为 `true` 的工具（如写文件、执行 Shell）在执行前 MUST 获得用户显式授权；
未标记的工具行为保持不变。

#### Scenario: 需授权工具触发授权请求

- **WHEN** 模型调用 `requiresApproval === true` 的工具
- **THEN** 运行时 SHALL 先创建 Deferred Promise，再 yield `tool_approval_requested` 事件（携带 toolCallId、name、args）
- **AND** Agent Loop SHALL 挂起，等待宿主通过 `resolveApproval` 响应

### Requirement: 宿主授权响应

`AgentSession` SHALL 提供 `resolveApproval(toolCallId, approved)` 接口，
由宿主环境（CLI 提示符或 Electron 弹窗）响应用户决策。
对未知或已失效的 toolCallId，响应 SHALL 被静默忽略。

#### Scenario: 用户放行

- **WHEN** 宿主调用 `resolveApproval(toolCallId, true)`
- **THEN** 运行时 SHALL yield `tool_execution_started` 并执行 `tool.execute`
- **AND** 后续事件与消息追加流程与常规执行一致

#### Scenario: 用户拒绝

- **WHEN** 宿主调用 `resolveApproval(toolCallId, false)`
- **THEN** 运行时 SHALL 跳过真实执行
- **AND** SHALL 伪造结果 `"System: The user explicitly denied the execution of this tool."`，yield `tool_execution_completed` 并以 `role: 'tool'` 消息交还 LLM
- **AND** 会话 MUST NOT 中断

### Requirement: 授权挂起的取消安全性

等待授权期间会话被取消时，运行时 SHALL 通过 `AbortSignal` 解除挂起，
不追加任何工具结果消息，并清空所有挂起的 Deferred 防止内存泄漏。

#### Scenario: 等待授权期间取消

- **WHEN** 会话在挂起等待授权时调用 `cancel()`
- **THEN** 事件流 SHALL 以 `session_cancelled` 终结
- **AND** 上下文 SHALL 不包含该工具调用的任何 `tool` 消息
- **AND** 宿主的迟到授权响应 SHALL 不产生任何错误或副作用
