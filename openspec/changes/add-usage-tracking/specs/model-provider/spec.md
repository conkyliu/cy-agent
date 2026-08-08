# Change: add-usage-tracking

## ADDED Requirements

### Requirement: usage chunk 类型

`ProviderChunk` 协议 SHALL 包含可选的 `{ type: 'usage'; inputTokens: number; outputTokens: number }`，
表示单次模型请求的真实 token 用量。Provider 实现 MAY 在不支持用量上报时不发出该 chunk。

#### Scenario: 契约兼容

- **WHEN** 既有 Provider 不发出 usage chunk
- **THEN** 消费方 SHALL 正常工作，不产生任何错误或缺失事件

### Requirement: OpenAI 兼容端点用量获取

`OpenAICompatProvider` MUST 在流式请求体中携带 `stream_options: { include_usage: true }`，
并 MUST 解析流末尾 `choices` 为空、仅含 `usage` 字段的统计 chunk，
将 `prompt_tokens` / `completion_tokens` 映射为 `usage` chunk 的 input / output。

#### Scenario: 标准用量 chunk

- **WHEN** 端点在 `[DONE]` 前返回 `{ choices: [], usage: { prompt_tokens, completion_tokens } }`
- **THEN** Provider SHALL yield 一个 `usage` chunk（数值一一对应）

#### Scenario: 旧式端点无用量

- **WHEN** 端点忽略 `stream_options` 且流中不含 usage 字段
- **THEN** Provider SHALL 正常结束流，不发出 usage chunk，不抛错
