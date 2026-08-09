# Capability: agent-session (Delta: 工具输出截断)

## ADDED Requirements

### Requirement: 工具输出统一截断

`AgentSession` SHALL 支持 `maxToolOutputChars` 配置（默认 32000）。工具成功执行
后，运行时 MUST 在结果进入事件流与上下文历史之前统一截断，且
`tool_execution_completed` 事件与历史消息 SHALL 使用同一截断结果。

#### Scenario: 超长输出被截断

- **WHEN** 工具返回的字符串结果超过 `maxToolOutputChars`
- **THEN** 存入历史的 tool 消息 SHALL 不超过该上限
- **AND** 结果 SHALL 保留原始输出的头部与尾部，中间为截断标记
  （含被省略的字符数）
- **AND** `tool_execution_completed` 事件携带的结果 SHALL 与历史消息一致

#### Scenario: 不超限输出原样保留

- **WHEN** 工具结果长度不超过 `maxToolOutputChars`
- **THEN** 结果 SHALL 原样进入事件流与历史，无任何标记

### Requirement: 截断安全性

截断实现 MUST 保证：
1. 截断标记本身计入最终长度，任何输入下结果都不超过上限；
2. 非字符串结果先序列化为 JSON 再截断；
3. 工具错误（`tool_execution_failed`）与用户拒绝路径 SHALL NOT 被截断逻辑
   改变行为。

#### Scenario: 极端上限

- **WHEN** `maxToolOutputChars` 小到无法容纳截断标记
- **THEN** 运行时 SHALL 硬切兜底而非抛错，会话正常继续
