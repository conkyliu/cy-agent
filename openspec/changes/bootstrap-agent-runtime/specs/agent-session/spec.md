# Capability: agent-session

## ADDED Requirements

### Requirement: 会话生命周期事件流

`AgentSession` SHALL 以基于 `AsyncGenerator` 的单向事件流驱动完整生命周期，
依次产出 `session_started`、中间事件（`text_chunk` / `tool_execution_*`），
并以 `session_completed`、`session_cancelled` 或 `session_error` 之一终结。

#### Scenario: 纯文本完成

- **WHEN** 模型在首轮即输出纯文本且不含工具调用
- **THEN** 事件流 SHALL 为 `session_started` → 若干 `text_chunk` → `session_completed`
- **AND** `session_completed.finalMessages` SHALL 包含完整的 `user` 与 `assistant` 消息

#### Scenario: 禁止并发运行

- **WHEN** 同一 `AgentSession` 在运行中被再次调用 `run`
- **THEN** 第二次调用 SHALL 以 "already running" 错误失败，且不影响第一次运行

### Requirement: Agent Loop 递归回溯

当模型输出包含工具调用时，`AgentSession` SHALL 执行工具，
将工具结果以 `role: 'tool'` 消息追加到上下文，并携带新上下文重新请求模型，
直至模型输出不含工具调用的最终文本。

#### Scenario: 工具调用后回到模型

- **WHEN** 模型首轮返回一个工具调用
- **THEN** 会话 SHALL 产出 `tool_execution_started` 与 `tool_execution_completed` 事件
- **AND** 第二轮模型请求的消息列表 SHALL 包含对应的 `tool` 角色结果消息

#### Scenario: 迭代上限保护

- **WHEN** 工具调用循环超过 `maxIterations`（默认 20）
- **THEN** 会话 SHALL 以 `session_error` 终结，避免死循环

### Requirement: 会话取消机制

取消 SHALL 基于原生 `AbortController` / `AbortSignal` 实现，
信号 MUST 传播至 Provider 流与正在执行的工具；
取消后未完成的助手消息 SHALL 被标记 `interrupted`，会话恢复可用状态。

#### Scenario: 流式生成中被取消

- **WHEN** 消费者在模型流式输出期间调用 `cancel()`
- **THEN** 事件流 SHALL 以 `session_cancelled` 终结
- **AND** 上下文中 SHALL 存在一条 `interrupted: true` 的助手消息保留已生成的部分文本
- **AND** 会话 SHALL 恢复为可再次运行的状态
