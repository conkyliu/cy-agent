# Capability: model-provider (Delta: OpenAI 兼容实现)

## ADDED Requirements

### Requirement: OpenAI 兼容流式提供商

仓库 SHALL 提供 `OpenAICompatProvider`，实现 `ProviderContract`，
通过 Chat Completions 流式接口对接 OpenAI 及任何 OpenAI 兼容端点
（可配置 `baseUrl` / `apiKey` / `model`），零第三方运行时依赖。

#### Scenario: 配置端点与鉴权

- **WHEN** 创建提供商并发起生成
- **THEN** 请求 SHALL 发往 `<baseUrl>/chat/completions`，携带 `Bearer` 鉴权头与 `stream: true`
- **AND** `AbortSignal` SHALL 仅在存在时透传给底层请求

### Requirement: SSE 解析与 Chunk 转换

提供商 SHALL 逐行解析 SSE `data:` 帧：文本增量转为 `text` chunk；
`tool_calls` 增量 SHALL 按 index 累积，在收到函数名时发出 `tool_call_start`，
参数增量逐段发出 `tool_call_chunk`，并在流结束时为每个未闭合调用补发 `tool_call_end`。
解析 MUST 容忍注释行、空行与单帧损坏的 JSON。

#### Scenario: 增量工具调用组装

- **WHEN** 服务端分多帧下发同一工具调用的 id/name 与 arguments 片段
- **THEN** 提供商 SHALL 输出 start → 多个 chunk → end 的标准序列，且参数拼接后为完整 JSON

#### Scenario: 损坏帧容错

- **WHEN** 流中出现无法解析的 JSON 帧或 SSE 注释
- **THEN** 提供商 SHALL 跳过该帧并继续处理后续数据

### Requirement: 消息与工具的线上格式转换

提供商 SHALL 将统一 `Message` 协议转换为 OpenAI 线上格式：
带 `toolCalls` 的助手消息转为 `tool_calls` 数组，`tool` 消息携带 `tool_call_id`；
`ToolBase` 快照 SHALL 转为 function-calling 工具定义（含 JSON Schema）。

#### Scenario: 工具结果上下文回传

- **WHEN** 会话上下文中包含助手工具调用与 tool 结果消息
- **THEN** 请求体 SHALL 正确映射为 `tool_calls` 与 `role: 'tool'` + `tool_call_id` 结构

### Requirement: HTTP 错误上报

非 2xx 响应 MUST 抛出携带状态码与响应片段（截断至 500 字符）的错误，
由 `AgentSession` 归类为 Provider 级错误并触发 `session_error`。

#### Scenario: 无效凭证

- **WHEN** API 返回 401
- **THEN** `generateStream` SHALL 抛出包含 "401" 与响应正文片段的错误
