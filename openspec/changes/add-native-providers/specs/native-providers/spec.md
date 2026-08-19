# Capability: model-provider (Delta: 原生多 Provider 支持)

## ADDED Requirements

### Requirement: Anthropic Claude 原生流式提供商

仓库 SHALL 提供 `AnthropicProvider`（`@cy-agent/anthropic-provider`），实现 `ProviderContract`，
对接 Anthropic `/v1/messages` 原生 Messages API。

#### Scenario: 独立 System 提示词抽取与工具转换
- **WHEN** 上下文中包含 `system` 消息与 `ToolBase` 定义
- **THEN** 提供商 SHALL 抽取所有 system 消息合并为顶层 `system` 字符串
- **AND** 工具列表 SHALL 映射为 `{ name, description, input_schema }` 结构

#### Scenario: Tool Result 与消息合并
- **WHEN** 历史消息中包含 `tool` 角色消息或连续相同角色消息
- **THEN** 提供商 SHALL 将 `tool` 消息转为 `user` 角色下的 `tool_result` 块
- **AND** 自动合并相邻相同角色消息，保证 `user` 与 `assistant` 严格交替

#### Scenario: SSE 流式分块与用量统计
- **WHEN** 服务端下发 `content_block_start` / `content_block_delta` / `message_delta`
- **THEN** 提供商 SHALL 分发 `tool_call_start`、`text` / `tool_call_chunk`、`tool_call_end`
- **AND** 解析 `message_start` / `message_delta` 中的 token usage 并在流结束时发出 `usage` chunk

---

### Requirement: Google Gemini 原生流式提供商

仓库 SHALL 提供 `GeminiProvider`（`@cy-agent/gemini-provider`），实现 `ProviderContract`，
对接 Gemini `models/{model}:streamGenerateContent?alt=sse` REST 端点。

#### Scenario: Gemini Contents 与 Function Calling 转换
- **WHEN** 上下文中包含 `tool` 角色消息与 `ToolBase` 快照
- **THEN** 提供商 SHALL 将 `tool` 结果转换为 `user` 角色下的 `functionResponse`
- **AND** 将工具快照映射为 `tools: [{ functionDeclarations: [...] }]`

#### Scenario: Function Call 解析与 Usage 统计
- **WHEN** 服务端下发带 `functionCall` 的 candidates 或 `usageMetadata`
- **THEN** 提供商 SHALL 产生标准 `tool_call_*` 序列
- **AND** 将 `promptTokenCount` 与 `candidatesTokenCount` 转化为 `usage` chunk

---

### Requirement: CLI 与桌面端智能路由

宿主环境（CLI 与 Electron 主进程）SHALL 支持显式指定 `--provider` / `CY_AGENT_PROVIDER`，
并在未显式指定时，根据模型名（`claude-*` / `gemini-*`）或环境变量（`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`）自动路由至对应的提供商实现。
