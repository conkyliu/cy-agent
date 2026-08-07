# Change: add-token-budget

## Why

多轮工具调用会快速累积上下文，一旦超过模型窗口将导致 Provider 级 400 错误
（不可恢复异常，直接中断会话）。运行时需要在请求模型前主动管理上下文窗口：
估算 token、超预算时裁剪历史，且裁剪绝不能破坏 tool_call 关联。

## What Changes

- `packages/protocol`：新增 `context_trimmed` 事件
  （`removedMessages` / `estimatedTokens`），宿主可感知并提示用户。
- `packages/agent` 新增 `context/budget.ts`：
  - 零依赖启发式估算：英文 ≈4 字符/token，CJK ≈2 字符/token，每消息 4 token 开销。
  - **单元化裁剪**：`assistant(toolCalls)` 与紧随的 `tool` 结果为不可分割单元，
    防止拆散后 API 因 tool_call_id 无关联报 400；system 单元与最新单元永不裁剪；
    从最旧单元整组移除直到落入预算。
- `AgentSession`：新增 `contextBudget.maxInputTokens`（默认 128000），
  每次请求模型前对**发送副本**裁剪（内部历史完整保留），
  发生裁剪时先 yield `context_trimmed` 事件。
- `packages/cli`：渲染器补 `context_trimmed` 分支（dim 提示行），穷尽检查保持完整。

## Impact

- Affected specs: `agent-session`（Delta：上下文预算）、`cli`（Delta：裁剪提示渲染）
- Affected code: `packages/protocol/src/events.ts`、`packages/agent/src/context/budget.ts`（新增）、
  `packages/agent/src/session.ts`、`packages/cli/src/renderer.ts`
- 向后兼容：默认预算 128000，短对话不触发裁剪，行为与之前一致。
