# Capability: agent-session (Delta: 可指定会话 ID)

## ADDED Requirements

### Requirement: 恢复会话保留原 ID

`AgentSessionOptions` SHALL 支持可选 `id` 字段。宿主恢复存档会话时 MUST 传入
原会话 ID，使后续持久化写回同一存档文件；未提供时运行时 SHALL 自动生成 UUID。

#### Scenario: 提供 ID

- **WHEN** 以 `id: "archived-1"` 构造 `AgentSession`
- **THEN** `session.id` SHALL 等于 `"archived-1"`
- **AND** 该会话每轮存档 SHALL 覆盖同一存档文件，不产生分裂副本

#### Scenario: 缺省 ID

- **WHEN** 未提供 `id`
- **THEN** 运行时 SHALL 生成非空的唯一 ID
