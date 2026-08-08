# Tasks: add-usage-tracking

## 1. 协议

- [x] 1.1 `AgentEvent` 新增 `usage_reported`（inputTokens / outputTokens）
- [x] 1.2 `ProviderChunk` 新增 `usage` 类型（可选，提供商可不发）

## 2. Provider（openai-provider）

- [x] 2.1 请求体携带 `stream_options: { include_usage: true }`
- [x] 2.2 解析流末尾 `choices` 为空、仅含 `usage` 的统计 chunk，映射为 `usage` chunk
- [x] 2.3 旧式端点无 usage 时静默容忍，不抛错

## 3. 会话集成（agent）

- [x] 3.1 `streamModel` 返回累计的 input / output tokens
- [x] 3.2 `run()` 跨迭代求和，完成后（仅当 >0）yield `usage_reported`
- [x] 3.3 usage chunk 不作为独立事件转发，仅累计

## 4. CLI

- [x] 4.1 渲染器补 `usage_reported` 分支（dim 用量行），穷尽检查通过

## 5. 测试与验证

- [x] 5.1 provider：include_usage 请求 + usage chunk 解析 + 无 usage 容忍
- [x] 5.2 session：多迭代求和 + 无用量不上报
- [x] 5.3 renderer：用量渲染断言
- [x] 5.4 全量 build/typecheck/test 通过（78 个测试）
- [x] 5.5 DeepSeek 实测：终端输出 `⋯ Tokens: 921 in / 21 out`
