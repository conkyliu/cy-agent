# Capability: model-provider

## ADDED Requirements

### Requirement: 统一提供商契约

任何接入的模型提供商 MUST 实现 `ProviderContract`：
通过 `generateStream(options)` 返回 `AsyncGenerator<ProviderChunk>`，
在内部将大模型原始流转换为标准 chunk 序列，屏蔽各家 API 差异。

#### Scenario: 流式生成输入

- **WHEN** `AgentSession` 请求模型生成
- **THEN** 提供商 SHALL 收到当前完整消息列表、注册表工具快照与 `AbortSignal`
- **AND** 提供商 SHALL 以 `ProviderChunk` 序列吐出文本与工具调用片段

### Requirement: 标准 Chunk 协议

`ProviderChunk` SHALL 支持四种类型：`text`、`tool_call_start`、`tool_call_chunk`、`tool_call_end`。
工具调用参数 MUST 以增量（delta）方式累积，直至 `tool_call_end` 视为完整 JSON。

#### Scenario: 增量参数累积

- **WHEN** 提供商依次吐出 `tool_call_start`、多个 `tool_call_chunk` 与 `tool_call_end`
- **THEN** 运行时 SHALL 将所有 delta 拼接为完整的工具参数 JSON 字符串

### Requirement: 取消信号传递

提供商 MUST 接收并尊重 `AbortSignal`：在信号触发时尽快终止底层网络请求并结束流。

#### Scenario: 取消时终止流

- **WHEN** 会话取消触发 `AbortSignal`
- **THEN** 提供商的生成流 SHALL 终止（正常结束或抛出中止错误）
- **AND** 运行时 SHALL 不将其视为 Provider 级错误

### Requirement: Provider 级错误处理

Provider 级错误（API Key 无效、网络超时等）MUST 中断会话并以 `session_error` 事件上报，
由 UI 层负责提示。

#### Scenario: 无效凭证

- **WHEN** 提供商在生成过程中抛出非取消类错误
- **THEN** 事件流 SHALL 以 `session_error` 终结，且事件携带原始错误信息
