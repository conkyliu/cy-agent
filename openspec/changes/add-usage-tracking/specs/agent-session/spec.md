# Change: add-usage-tracking

## ADDED Requirements

### Requirement: 轮次用量累计与上报

`AgentSession` SHALL 在单次 `run()` 内累计所有模型迭代的真实 token 用量
（input / output 分别求和），并 MUST 在 `session_completed` 之后发出
`usage_reported` 事件（携带累计值）。仅当提供商上报过非零用量时才发出该事件。

#### Scenario: 多迭代求和

- **WHEN** 一轮会话发生多次模型请求（工具调用回溯），且每次请求都上报 usage
- **THEN** `usage_reported` 的 inputTokens / outputTokens SHALL 为各次请求之和

#### Scenario: 提供商不上报用量

- **WHEN** Provider 未发出任何 usage chunk
- **THEN** 事件流 SHALL 不包含 `usage_reported`，其余行为不变

### Requirement: usage chunk 消费

`AgentSession` 消费 Provider 流时 MUST 识别 `usage` chunk 并累计，
且 SHALL NOT 将其作为独立 AgentEvent 转发（避免每个迭代刷屏，按轮次汇总）。

#### Scenario: 单请求用量

- **WHEN** Provider 在流末尾发出 `{ type: 'usage', inputTokens, outputTokens }`
- **THEN** 该值 SHALL 计入当前轮次累计，事件流中不出现逐 chunk 的用量事件
