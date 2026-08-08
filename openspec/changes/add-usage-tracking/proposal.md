# Change: add-usage-tracking

## Why

终端与宿主无法感知每轮会话的真实 token 消耗，费用不可观测；
且现有上下文预算（add-token-budget）依赖启发式估算（误差可达 30%+），
后续 compaction 触发阈值需要真实 usage 作为可靠依据。
需要将模型返回的真实用量沿事件流暴露给宿主。

## What Changes

- `packages/protocol`：新增 `usage_reported` 事件（inputTokens / outputTokens），
  紧随 `session_completed` 发出。
- `packages/agent`：
  - `ProviderChunk` 新增 `usage` 类型（单次模型请求的用量，提供商不支持时可不发）。
  - `AgentSession` 在 `run()` 内累计多次迭代的用量，
    仅当提供商上报过用量（>0）时在完成后 yield `usage_reported`。
- `packages/openai-provider`：请求体新增 `stream_options: { include_usage: true }`，
  解析流末尾 choices 为空、仅带 `usage` 的统计 chunk 并转为 `usage` chunk；
  不返回 usage 的旧式兼容端点静默容忍。
- `packages/cli`：渲染器补 `usage_reported` 分支（dim 提示行 `⋯ Tokens: N in / M out`），
  穷尽检查保持完整。

## Impact

- Affected specs: `agent-session`（Delta：用量上报）、`model-provider`（Delta：usage chunk）、`cli`（Delta：用量渲染）
- Affected code: `packages/protocol/src/events.ts`、`packages/agent/src/contracts/provider.ts`、
  `packages/agent/src/session.ts`、`packages/openai-provider/src/openai-provider.ts`、`packages/cli/src/renderer.ts`
- 向后兼容：不返回 usage 的端点行为与之前完全一致（不发 `usage_reported` 事件）；
  `stream_options` 为标准 OpenAI 流式参数，兼容端点不支持时会静默忽略。
