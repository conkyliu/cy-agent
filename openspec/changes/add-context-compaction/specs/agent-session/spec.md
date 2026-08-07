# Capability: agent-session (Delta: LLM 驱动的上下文压缩)

## ADDED Requirements

### Requirement: 上下文压缩

`AgentSession` SHALL 支持 `compaction` 配置（`enabled` 默认启用、`threshold` 默认 0.8、
`keepRecentUnits` 默认 2）。每次请求模型前，若估算 token 超过
`maxInputTokens × threshold`，运行时 MUST 将受保护单元与最近 N 个单元之外的
历史交给 Provider 总结为一条摘要消息，**原地替换**内部历史，并 SHALL 发出
`context_compacted` 事件（携带被替换的消息条数）。

#### Scenario: 超阈值压缩

- **WHEN** 历史估算 token 超过压缩阈值且可压缩单元不少于两条
- **THEN** 运行时 SHALL 发起一次独立的摘要请求（仅携带转录本，不含工具定义）
- **AND** 内部历史中的旧消息 SHALL 被一条带 `[Context Summary]` 标记的
  user 角色摘要消息替换
- **AND** 事件流 SHALL 包含 `context_compacted`
- **AND** 后续模型请求 SHALL 携带摘要消息与最近保留的消息

### Requirement: 压缩安全约束

压缩 MUST 遵守：
1. 受保护单元（原始 systemPrompt）与最近 `keepRecentUnits` 个单元永不压缩；
2. 压缩产生的摘要以 user 角色存储，保证可被持久化层保存；
3. 可压缩单元不足两条时不触发（收益不足以支付额外模型请求）。

#### Scenario: 受保护单元不被压缩

- **WHEN** 触发压缩
- **THEN** system 消息与最近保留单元 SHALL 原样保留在历史中

### Requirement: 压缩失败回退

压缩是非关键路径：摘要请求失败、返回空文本或会话被取消时，运行时 MUST 静默
放弃压缩（不发出 `context_compacted`、不抛出 `session_error`），后续 SHALL 由
既有的预算裁剪兜底，会话正常继续。

#### Scenario: 摘要请求失败

- **WHEN** Provider 在摘要请求中抛出错误
- **THEN** 事件流 SHALL NOT 包含 `context_compacted`
- **AND** 运行时 SHALL 回退到裁剪并正常发出 `session_completed`
- **AND** 内部历史 SHALL 保持完整未被替换
