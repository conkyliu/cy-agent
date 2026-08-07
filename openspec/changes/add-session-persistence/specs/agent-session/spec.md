# Capability: agent-session (Delta: 会话恢复)

## ADDED Requirements

### Requirement: 会话历史恢复

`AgentSession` SHALL 支持通过 `initialMessages` 注入历史消息，
历史消息 MUST 追加在 system 消息之后，且运行时 MUST 拷贝消息对象，
使外部持久化层与会话内部状态互不影响。

#### Scenario: 恢复后继续对话

- **WHEN** 以 `systemPrompt` + `initialMessages` 创建会话并发起新一轮
- **THEN** 首次模型请求的消息序列 SHALL 为 system → 历史消息 → 新 user 消息

#### Scenario: 历史隔离

- **WHEN** 恢复后外部修改传入的历史消息对象
- **THEN** 会话内部消息 SHALL 不受影响
