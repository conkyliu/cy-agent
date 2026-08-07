# Change: add-context-compaction

## Why

add-token-budget 的裁剪是**有损**的：旧历史被直接丢弃，长会话中模型会遗忘
早期目标与决策。需要在裁剪之上提供信息保真度更高的策略：预算将满时先让模型
把旧历史总结为一条摘要消息（Compaction），压缩失败再回退到裁剪。

## What Changes

- `packages/protocol`：新增 `context_compacted` 事件（`removedMessages`）。
- `packages/agent` 新增 `context/compaction.ts`：
  - `buildTranscript`：消息转总结转录本，工具调用只保留名称摘要。
  - `createSummaryMessage`：摘要以 `role: 'user'` + `[Context Summary]` 标记前缀
    构造（可被持久化层保存，也不会被预算模块误保护）。
  - `SUMMARIZATION_PROMPT`：要求保留目标/决策/文件路径/未决问题。
- `AgentSession`：新增 `compaction` 选项（`enabled` 默认 true、`threshold` 默认 0.8、
  `keepRecentUnits` 默认 2）。每次模型请求前估算超阈值时：跳过受保护单元（原始
  systemPrompt）与最近 N 个单元，把中间消息交给 Provider 总结，摘要**原地替换**
  内部历史（可被持久化），并 yield `context_compacted`。
- 失败兜底：Provider 报错 / 空摘要 / 取消时静默返回，交由既有裁剪兜底，会话不中断。
- `packages/cli`：渲染器补 `context_compacted` 分支（never 穷尽检查同步覆盖）。

## Impact

- Affected specs: `agent-session`（压缩需求）、`cli`（渲染新事件）
- Affected code: protocol/events.ts、agent/context/compaction.ts、agent/session.ts、
  agent/index.ts、cli/renderer.ts
- 行为变化：压缩默认启用。既有裁剪测试需显式 `compaction: { enabled: false }`。
