# Project: cy-agent

## Purpose

Headless Agent 运行时。核心与任何 UI / 框架 / 宿主环境（CLI、Electron）解耦，
负责定义模型提供商（Provider）契约、工具（Tool）契约，
并管理从用户输入到工具调用、再到最终结果输出的完整生命周期（Agent Loop）。

## Tech Stack

### Core（Headless 运行时）

- TypeScript（strict 模式，`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）
- pnpm workspace monorepo
- Node.js >= 18（原生 `AbortController` / `AsyncGenerator`）
- Vitest（测试）、GitHub Actions（CI）

### Desktop Frontend（Phase 3 Desktop Shell 起）

- **Electron**：桌面宿主壳层，主进程承载 Agent 运行时，渲染进程仅消费事件流。
- **React**：渲染进程 UI 框架，通过 IPC 订阅 `AgentEvent` 单向事件流。
- **TailwindCSS**：原子化样式方案，所有视觉样式通过 Tailwind 工具类 + Design Token 表达。
- 核心边界不变：`packages/agent` / `packages/protocol` 严禁依赖 Electron / React / DOM API。

## UI Style（桌面端）

- 设计基准：**JetBrains Islands Light**（IntelliJ 新 UI 浅色主题）。
- 关键视觉特征：大圆角（8px+）控件、柔和中性灰背景层次、低饱和度强调色（蓝色系 #3574F0 类主色）、充足留白、扁平无边框输入框与工具栏。
- 落地约定：以 Tailwind CSS 变量 / theme 扩展定义 Islands Light 色板与圆角 Token，组件层不写裸 CSS 颜色值；后续如引入组件库，需可覆盖至该主题。

## Monorepo Layout

- `packages/protocol`：统一消息模型（Message / ToolCall）与事件协议（AgentEvent）。
- `packages/agent`：运行时核心。Provider 契约、Tool 契约、`ToolRegistry`、`AgentSession`（Agent Loop）。

## Conventions

- 事件流：核心采用基于 `AsyncGenerator` 的单向事件流，UI/CLI 仅消费事件。
- 依赖反转：核心仅依赖 `ProviderContract` / `ToolContract` 接口。
- 错误边界：Provider 级错误中断会话（`session_error`）；Tool 级错误转为字符串交还 LLM，不中断会话。
- OpenSpec：每个能力变更对应一个独立 change（`openspec/changes/add-*`），增量归档。

## Roadmap Reference

- Phase 0 工程基础（本仓库骨架）
- Phase 1 Headless Agent Core（当前：bootstrap-agent-runtime）
- Phase 2 Coding Agent CLI
- Phase 3 Desktop Shell
- Phase 4 代码工作区
- Phase 5 扩展能力（插件 / 技能 / MCP）
- Phase 6 高级上下文（符号索引 / 依赖图）
