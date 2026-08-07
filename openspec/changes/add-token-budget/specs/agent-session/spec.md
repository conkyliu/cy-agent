# Capability: agent-session (Delta: 上下文窗口预算)

## ADDED Requirements

### Requirement: 上下文预算裁剪

`AgentSession` SHALL 支持 `contextBudget.maxInputTokens` 配置（默认 128000）。
每次请求模型前，运行时 MUST 估算消息历史 token 数，超预算时裁剪
**发送给模型的副本**（内部历史完整保留），并 SHALL 发出 `context_trimmed` 事件。

#### Scenario: 超预算裁剪

- **WHEN** 历史估算 token 超过预算
- **THEN** 发送给模型的消息 SHALL 从最旧历史开始整单元移除直至落入预算
- **AND** 事件流 SHALL 包含 `context_trimmed`（携带移除条数与剩余估算值）
- **AND** `getMessages()` 返回的内部历史 SHALL 保持完整

### Requirement: 裁剪安全约束

裁剪 MUST 遵守两条不可破坏的约束：
1. system 消息所在单元与包含最新用户输入的单元永不裁剪；
2. `assistant(toolCalls)` 与其紧随的 `tool` 结果消息为不可分割单元，
   严禁拆散（否则 API 因 tool_call_id 无关联而报 400）。

#### Scenario: 工具组完整性

- **WHEN** 需裁剪的历史中包含 assistant(toolCalls) + tool 结果组
- **THEN** 该组 SHALL 整体保留或整体移除，不得出现残缺状态

### Requirement: 零依赖 token 估算

token 估算 MUST 为纯函数启发式实现（不引入 tokenizer 依赖）：
英文约 4 字符/token，CJK 约 2 字符/token，每条消息附加固定开销；
估算宁可偏高以保证裁剪后真实 token 数在预算内。

#### Scenario: CJK 密度

- **WHEN** 等长的 CJK 文本与拉丁文本分别估算
- **THEN** CJK 文本的估算 token 数 SHALL 更高
