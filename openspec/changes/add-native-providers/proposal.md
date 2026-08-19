# Change: add-native-providers

## Why

此前 `cy-agent` 仅支持基于 OpenAI Chat Completions 协议的兼容端点。随着 Anthropic Claude 与 Google Gemini 等模型的发展，引入它们的原生 Messages API 与 REST 协议支持，能够更好地发挥不同模型提供商的原生流式 Tool Use、独立 System Prompt 与准确 Token 用量统计能力。

## What Changes

- 新增 `packages/anthropic-provider`（`@cy-agent/anthropic-provider`）：
  - `AnthropicProvider`：实现 `ProviderContract.generateStream`。
  - 请求：Anthropic Messages API（`/v1/messages`，`stream: true`），顶层 `system` 字段与原生 `tools: [{ name, description, input_schema }]`。
  - SSE 解析：解析 `content_block_start`（`tool_use`）、`content_block_delta`（`text_delta` / `input_json_delta`）、`content_block_stop`、`message_delta`（token usage）。
  - `toAnthropicMessages` / `toAnthropicTools`：统一消息协议转 Anthropic 格式，自动合并同角色相邻轮次，将 `tool` 结果转为 `user` 角色下的 `tool_result` 块。
- 新增 `packages/gemini-provider`（`@cy-agent/gemini-provider`）：
  - `GeminiProvider`：实现 `ProviderContract.generateStream`。
  - 请求：Gemini REST API（`:streamGenerateContent?alt=sse`），支持 `systemInstruction` 与 `functionDeclarations`。
  - SSE 解析：解析 `candidates.parts`（text / `functionCall`）与 `usageMetadata`。
  - `toGeminiContents` / `toGeminiTools`：统一消息协议转 Gemini `contents`（`user` / `model` / `functionResponse`）。
- CLI 与桌面端集成：
  - `packages/cli`：新增 `--provider` 参数，支持根据模型前缀（`claude-*` / `gemini-*`）与环境变量（`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`）自动推断。
  - `packages/desktop`：主进程根据环境变量与配置动态实例化对应 Provider。

## Impact

- Affected specs: `model-provider`
- Affected code: `packages/anthropic-provider/**`, `packages/gemini-provider/**`, `packages/cli/**`, `packages/desktop/**`
- 依赖：零第三方运行时 SDK，基于原生 fetch + SSE 解析。
