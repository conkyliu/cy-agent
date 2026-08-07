# Tasks: bootstrap-agent-runtime

## 1. 工程基础（Phase 0）

- [x] 1.1 建立 pnpm workspace monorepo（`packages/*`）
- [x] 1.2 TypeScript strict 基础配置（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）
- [x] 1.3 接入 Vitest 测试框架
- [x] 1.4 配置 GitHub Actions CI（build → typecheck → test）

## 2. 协议层（packages/protocol）

- [x] 2.1 定义统一消息模型 `Message` / `ToolCall` / `Role`
- [x] 2.2 定义事件协议 `AgentEvent`（8 种事件类型）
- [x] 2.3 为取消场景预留 `interrupted` 消息标记

## 3. 运行时契约（packages/agent）

- [x] 3.1 定义 `ProviderContract` 与 `ProviderChunk` 流式契约
- [x] 3.2 定义自包含 `ToolContract`（含 JSON Schema）
- [x] 3.3 实现 `ToolRegistry`（register / unregister / snapshot）

## 4. 会话与 Agent Loop

- [x] 4.1 实现 `AgentSession.run`：文本流转发、工具调用累积与递归回溯
- [x] 4.2 实现工具执行：参数解析、顺序执行、started/completed/failed 事件
- [x] 4.3 实现取消机制：`AbortController` 传播、中断消息标记 `interrupted`
- [x] 4.4 实现错误边界：Provider 级 → `session_error`；Tool 级 → 错误字符串交还 LLM
- [x] 4.5 预留 `ToolExecutionPolicy` 授权挂起点（默认自动放行）

## 5. 测试与验证

- [x] 5.1 纯文本完成流程与事件顺序测试
- [x] 5.2 工具调用循环与上下文携带测试
- [x] 5.3 工具错误 / 未知工具不中断会话测试
- [x] 5.4 Provider 错误 → `session_error` 测试
- [x] 5.5 流中取消 → `session_cancelled` 且部分消息标记 `interrupted` 测试
- [x] 5.6 Registry 重复注册 / 注销、并发运行保护测试
- [x] 5.7 迭代上限、策略拒绝、非法 JSON 参数边界测试
