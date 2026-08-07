# Change: add-cli

## Why

Phase 2 的目标是提供一个可用的编码 Agent CLI。运行时核心（AgentSession）、
编码工具（add-coding-tools）与真实模型提供商（add-openai-provider）均已就绪，
但缺少面向用户的交互入口：需要一个 REPL 将三者串联，
并让 CLI 成为 HITL 授权机制的宿主（响应 `tool_approval_requested`）。

## What Changes

- 新增 `packages/cli`（`@cy-agent/cli`），bin 名 `cy-agent`，零第三方运行时依赖：
  - `config.ts`：`--key=value` 参数解析 + 环境变量合并
    （`CY_AGENT_API_KEY` / `OPENAI_API_KEY` / `CY_AGENT_MODEL` / `CY_AGENT_BASE_URL`），
    缺失 API Key 时以 Fatal 错误退出（对应 spec 6.2 不可恢复异常）。
  - `renderer.ts`：纯函数事件渲染器，`AgentEvent` → 终端文本
    （可选 ANSI 颜色、长文本截断），不直接写 stdout，便于测试与桌面端复用。
  - `repl.ts`：交互主循环，输入/输出流可注入。
    - 每行输入驱动一次 `session.run()`，实时渲染事件流。
    - 授权宿主：收到授权事件时原地提问 `y/N`，调用 `resolveApproval`。
    - SIGINT：运行中取消当前轮（`session.cancel()`），空闲退出 REPL。
  - `main.ts`：入口，组装 OpenAICompatProvider + createCodingTools + AgentSession。

## Impact

- Affected specs: `cli`（新增能力）
- Affected code: `packages/cli/*`、根 `vitest.config.ts`（别名）
- 不修改任何既有包的行为。
