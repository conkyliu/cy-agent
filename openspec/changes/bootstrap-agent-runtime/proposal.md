# Change: bootstrap-agent-runtime

## Why

Phase 1 的首要目标是建立 Headless Agent Core。当前仓库仅有工程骨架规划，
缺少可运行的运行时核心：统一消息/事件协议、模型提供商契约、工具契约与 Agent Loop。
本变更落地三大能力：`agent-session`、`model-provider`、`tool-execution`。

## What Changes

- 新增 `packages/protocol`：统一 `Message` / `ToolCall` 消息模型与 `AgentEvent` 事件协议。
- 新增 `packages/agent`：
  - `ProviderContract` / `ProviderChunk`：模型提供商流式生成契约。
  - `ToolContract`：自包含工具定义（含 JSON Schema）。
  - `ToolRegistry`：运行时注册/注销与工具快照。
  - `AgentSession`：基于 `AsyncGenerator` 事件流的 Agent Loop，支持会话取消（`AbortController`）。
  - `ToolExecutionPolicy`：工具执行策略扩展点（默认自动静默执行，为 Human-in-the-loop 预留）。
- 工程基础：pnpm workspace、TypeScript strict、Vitest、GitHub Actions CI。

## Impact

- Affected specs: `agent-session`（新增）、`model-provider`（新增）、`tool-execution`（新增）
- Affected code: `packages/protocol/**`、`packages/agent/**`、根目录构建/测试配置
- 非目标：桌面端 IPC、MCP 客户端、持久化记忆、具体业务工具（AST/Git 等）

## Design Decision: 工具执行授权

采用"默认静默自动执行 + 预留策略挂起点"：`ToolExecutionPolicy.approve` 在每次工具执行前调用，
当前默认实现自动放行；后续 Phase 3 的权限对话框可接入该挂起点实现 Human-in-the-loop，
无需改动 Agent Loop 主流程。
