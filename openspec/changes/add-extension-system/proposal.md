# Change: add-extension-system

## Why

Phase 1–4 的工具集是编译期固定的五个内置编码工具：用户无法接入外部能力
（数据库、浏览器、检索服务等），无法把重复性操作沉淀为可复用技能，也无法
在不改源码的前提下注入自定义工具。行业事实标准 MCP（Model Context Protocol）
已被主流工具生态采用，不支持 MCP 意味着 cy-agent 被隔离在该生态之外。
Phase 5 建立扩展体系：三类扩展（MCP / 技能 / 插件）统一经既有 `ToolRegistry`
与 `systemPrompt` 注入机制挂载，核心 Agent Loop 零感知。

## What Changes

- **MCP 客户端（stdio）**：
  - 新增 `packages/mcp`（`@cy-agent/mcp`）：JSON-RPC 2.0 stdio 客户端，
    实现 `initialize` 握手、`tools/list`、`tools/call`；不引入官方 SDK，
    保持 monorepo 最小依赖面。
  - MCP 配置文件（Claude Desktop 风格 `{ "mcpServers": { name: { command, args, env } } }`），
    CLI 经 `--mcp-config=<file>` 或 `CY_AGENT_MCP_CONFIG` 指定，桌面端复用
    同一环境变量约定。
  - 每个远程工具适配为 `ToolBase` 注册进 `ToolRegistry`，命名 `mcp_<server>_<tool>`；
    MCP 工具一律 `requiresApproval: true`（外部能力安全默认）。
  - 单个 server 启动/握手失败降级跳过并告警，MUST NOT 阻塞会话启动。
- **技能（Skills）**：
  - 工作区 `.cy-agent/skills/*.md` 为技能定义：文件名即技能名，首个非空行
    为描述，正文为指令全文。
  - 新增内置工具 `load_skill`（免授权只读）；工作区概览追加 Available skills
    段落（名称 + 描述），模型按需经 `load_skill` 取全文，避免全量注入撑大提示词。
- **本地插件（Plugins）**：
  - 工作区 `.cy-agent/plugins/*.mjs` 默认导出
    `createTools({ workspace }) => ToolBase[]`，启动时动态 `import()` 加载注册。
  - 插件工具沿用工具自身声明的 `requiresApproval`；加载失败降级跳过并告警。
  - 文档明确：插件代码以宿主权限执行，信任边界与运行 `run_shell` 等同。
- **双宿主装配**：CLI 与桌面端主进程共享装配函数
  `loadExtensions(workspace, options)`（位于 `packages/tools`），返回扩展工具
  列表与技能概览段；桌面端工作区切换时随工具重建一同重扫插件与技能。

## Impact

- Affected specs：新增 capability `extension-system`；`code-workspace` 概览段
  增加 Available skills（增量修订）。
- Affected code：新增 `packages/mcp`；`packages/tools` 扩展装配与 `load_skill`；
  `packages/cli` 参数与装配；`packages/desktop` 主进程装配；
  `pnpm-workspace.yaml` / CI 构建脚本纳入新包。
- 边界保持：`packages/agent` / `packages/protocol` 零改动（扩展工具均实现
  既有 `ToolBase`，经 `ToolRegistry.register` 挂载）。
- 安全：MCP 与插件均为宿主进程权限，全部经授权门控；技能仅文本注入。
