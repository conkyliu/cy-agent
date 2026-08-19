# cy-agent

一个 Headless（无 UI 依赖）的 Agent 运行时与编码智能体框架，采用 TypeScript + pnpm workspace monorepo 架构，基于 OpenSpec 增量式开发。

---

## 🌟 项目简介

`cy-agent` 提供与 UI 完全解耦的智能体核心运行时：负责管理从用户输入、模型流式生成、高危工具人机授权（Human-in-the-loop），到工具调用与结果回传的完整生命周期（Agent Loop）。

运行时基于单向事件流（`AsyncGenerator`）与外部宿主通信，目前支持 **CLI 终端** 与 **Electron 桌面端** 两种宿主形态，并可通过 **MCP / 技能（Skills）/ 本地插件（Plugins）** 自由扩展能力边界。

---

## ✨ 核心特性

- ⚡️ **流式 Agent Loop**：基于 `AsyncGenerator` 单向事件流驱动，实时推送文本分块、工具授权请求、执行状态与生命周期事件。
- 🛡️ **Human-in-the-loop (HITL) 交互授权**：`write_file`、`run_shell` 及远程 MCP 工具在执行前挂起等待用户显式批准；拒绝时以安全降级结果回传模型，会话不中断。
- 🧰 **内置编码工具集**：
  - **文件操作**：`read_file`、`write_file`、`list_directory`、`search_files`。
  - **Git 自动快照**：`write_file` 覆写已有文件前自动生成 Git Blob 快照，附带快照 SHA，支持追溯与回滚。
  - **工作区安全沙箱**：内置严格的路径解析与符号链接（Symlink）逃逸检测，杜绝跨工作区非法读写。
  - **输出安全截断**：工具返回超长内容时自动按阈值截断并保留尾部提示，防止上下文爆炸。
- 🧭 **代码导航与符号索引 (Phase 6)**：
  - `find_symbol`：快速定位工作区内的类、接口、函数、方法、变量与类型定义及其精确位置。
  - `file_dependencies`：解析 ESM/CJS 依赖关系，区分项目内部文件依赖与外部 NPM 依赖。
  - **自动上下文增强**：首轮 systemPrompt 自动注入工作区概览（目录树 + Git 分支 + 标记文件 + 顶层符号索引）。
- 🤖 **原生多 Provider 智能路由 (Phase 7)**：
  - **OpenAI 兼容**：支持 OpenAI、DeepSeek、Qwen、Ollama、vLLM 等兼容端点。
  - **Anthropic Claude**：原生 Messages API 流式协议（支持 Claude 3.7 Sonnet 等）。
  - **Google Gemini**：原生 REST API 流式协议（支持 Gemini 2.0 Flash / Pro 等）。
  - **智能路由**：支持按模型名（`claude-*`、`gemini-*`）或 API 环境变量自动推断 Provider。
- 🧩 **多维扩展体系 (Phase 5)**：
  - **MCP (Model Context Protocol)**：支持 stdio 客户端与 Claude Desktop 格式配置，自动挂载远程工具。
  - **技能库 (Skills)**：放置于 `.cy-agent/skills/*.md`，模型按需经 `load_skill` 动态检索加载。
  - **本地插件 (Plugins)**：放置于 `.cy-agent/plugins/*.mjs`，动态加载自定义工具，加载失败优雅降级。
- 💾 **会话持久化与多会话管理**：自动持久化存储于 `.cy-agent/sessions`，支持 `--resume` 恢复；REPL / 桌面端支持多会话新建、切换与删除。
- 📉 **智能上下文预算与压缩**：启发式 Token 估算 + 单元化裁剪；超出阈值触发 LLM 上下文摘要压缩（Compaction）。
- 📊 **真实 Token 用量跟踪**：解析各模型 Provider 返回的原生 Usage，每轮输出精确统计（`Tokens: N in / M out`）。
- 🖥️ **Electron 桌面客户端与自动更新**：
  - **设计美学**：采用 JetBrains Islands Light 浅色风格与 Tailwind 原子化设计。
  - **多工作区与会话**：可视化切换项目目录（带历史记忆），多会话侧边栏管理。
  - **自动更新 (Auto-Update)**：集成 `electron-updater`，支持更新检测、Release Notes 预览、后台下载进度与一键重启安装。

---

## 🏗️ 仓库结构

```
cy-agent/
├── packages/
│   ├── protocol/            # 跨包统一数据协议（Message / ToolCall / AgentEvent / TokenUsage）
│   ├── agent/               # 核心运行时：AgentSession、工具注册表、上下文预算与压缩
│   ├── tools/               # 内置工具实现（文件读写、Shell、工作区概览、代码导航/符号索引、扩展装配）
│   ├── openai-provider/     # OpenAI 兼容模型提供商
│   ├── anthropic-provider/  # Anthropic Claude 原生模型提供商
│   ├── gemini-provider/     # Google Gemini 原生模型提供商
│   ├── storage/             # 会话持久化存储层（JSON 文件系统）
│   ├── mcp/                 # MCP（Model Context Protocol）stdio 客户端实现
│   ├── cli/                 # CLI 命令行工具（交互式 REPL + 一次性执行）
│   └── desktop/             # Electron 桌面壳层（主进程 / preload / React 渲染层 / 自动更新）
├── openspec/                # OpenSpec 增量规格与变更档案
├── spec.md                  # 核心架构与协议规范
└── vitest.config.ts         # 测试套件配置
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 24
- **pnpm** >= 11 (`corepack enable` 或 `npm i -g pnpm`)

### 安装与构建

```bash
pnpm install
pnpm build
```

### 测试与代码质量

```bash
pnpm test            # 运行 Vitest 单元与集成测试
pnpm test:coverage   # 测试覆盖率统计
pnpm typecheck       # 全包 TypeScript 类型检查
pnpm lint            # ESLint 检查
pnpm format          # Prettier 代码格式化
```

---

## 💻 CLI 使用指南

### 1. 交互模式 (REPL)

```bash
# 使用 OpenAI 兼容模型（默认）
cy-agent --api-key <OPENAI_API_KEY> --model gpt-4o

# 使用 Anthropic Claude 模型（自动识别 Provider）
cy-agent --api-key <ANTHROPIC_API_KEY> --model claude-3-7-sonnet-20250219

# 使用 Google Gemini 模型（自动识别 Provider）
cy-agent --api-key <GEMINI_API_KEY> --model gemini-2.0-flash

# 使用自定义中转或本地模型端点
cy-agent --base-url https://api.deepseek.com/v1 --api-key <KEY> --model deepseek-chat

# 恢复历史会话
cy-agent --resume <SESSION_ID>
```

#### REPL 内置指令

| 指令 | 说明 |
| --- | --- |
| `/sessions` | 查看已保存的所有会话（`*` 标记当前会话） |
| `/new` | 保存当前会话并开启一个新会话 |
| `/open <id>` | 保存当前会话并切换到指定历史会话 |
| `/delete <id>`| 删除指定的历史会话 |
| `/exit` 或 `/quit` | 退出 REPL |
| `Ctrl+C` | 中断当前轮次生成与执行 |

---

### 2. 非交互单次执行模式 (CI / 脚本自动化)

```bash
# 通过 -p 传递提示词，执行一轮后自动退出
cy-agent -p "梳理本项目的目录结构与核心入口"

# 位置参数简写（等价于 -p）
cy-agent "分析 packages/tools/src 中的符号索引实现"

# 从标准输入 (stdin) 读取提示词
cat error.log | cy-agent -p -

# 结构化 JSON 格式输出（便于下游解析）
cy-agent -p "总结 package.json 依赖" --output=json

# 自动批准工具调用（CI / 批处理场景，默认拒绝以确保安全）
cy-agent -p "更新版本号并测试" -y
```

> **单次模式退出码**：`0` 正常完成、`130` 用户取消（SIGINT）、`1` 执行出错。

---

### 3. 配置参数与环境变量

命令行参数与环境变量可无缝配合，优先级为：**命令行参数 > 环境变量 > 默认值**。

| CLI 参数 | 环境变量 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `--provider=<type>` | `CY_AGENT_PROVIDER` | 模型提供商：`openai`、`anthropic`、`gemini` | 智能推断或 `openai` |
| `--api-key=<key>` | `CY_AGENT_API_KEY`<br>`OPENAI_API_KEY`<br>`ANTHROPIC_API_KEY`<br>`GEMINI_API_KEY` | API 密钥（各 Provider 专属变量均受支持） | — |
| `--model=<name>` | `CY_AGENT_MODEL` | 模型名称 | `gpt-4o` / `claude-3-7-sonnet-20250219` / `gemini-2.0-flash` |
| `--base-url=<url>` | `CY_AGENT_BASE_URL` | 自定义 API 端点 | Provider 官方默认端点 |
| `--cwd=<dir>` | — | 工具沙箱工作区根目录 | `process.cwd()` |
| `--mcp-config=<path>` | `CY_AGENT_MCP_CONFIG` | MCP 服务器配置文件路径 | — |
| `--resume=<id>` | — | 恢复的历史会话 ID | — |
| `-p, --prompt=<text>` | — | 单次执行提示词 | — |
| `--output=<format>` | — | 单次输出格式：`text` / `json` | `text` |
| `-y, --yes` | — | 单次模式自动批准工具调用 | `false`（默认拒绝） |

---

### 4. 注册全局命令

通过 pnpm link 即可将 CLI 注册到系统 PATH：

```bash
pnpm link --global ./packages/cli
pnpm setup    # 确保 pnpm global bin 目录在 PATH 中
cy-agent --help
```

---

## 🖥️ Electron 桌面客户端

桌面端提供可视化操作界面，主进程直接承载 Agent 运行时，渲染进程负责流式事件消费与呈现：

```bash
# 启动桌面端开发环境（支持 Vite 热更新）
pnpm desktop:dev

# 打包桌面应用产物
pnpm desktop:build

# 构建发布安装包（macOS dmg/zip、Windows nsis、Linux AppImage/deb）
pnpm desktop:release
```

### 桌面端功能亮点

- **设计美学**：基于 JetBrains Islands Light 浅色主题设计，层次分明，留白舒适。
- **HITL 可视化授权**：高危工具调用以浮窗审批卡片展现，支持查看参数细节并进行一键批准/拒绝。
- **工作区无缝切换**：在界面顶部轻松切换工作目录，自动重载技能、插件与符号索引，并自动记忆最近打开的目录。
- **应用内自动更新**：依托 `electron-updater` 与 GitHub Releases，自动检测最新版本、展示 Release Notes、实时更新下载进度，支持一键“重启并安装”。

---

## 🧩 扩展系统

所有扩展统一由 `ToolRegistry` 挂载，任一扩展加载异常均优雅降级，不阻断核心运行时启动。

### 1. Model Context Protocol (MCP)

通过 `--mcp-config` 或环境变量 `CY_AGENT_MCP_CONFIG` 指定配置文件（兼容 Claude Desktop 格式）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/username/workspace"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}
```

*远程 MCP 工具命名格式为 `mcp_<server>_<tool>`，调用时默认触发人机授权。*

### 2. 技能库 (Skills)

在项目工作区创建 `.cy-agent/skills/<skill-name>.md`：
- 文件名即技能名称。
- 第一行非空文本作为技能概要说明，自动注册至首轮系统提示词中。
- 模型在需要时调用内置工具 `load_skill({ name: "..." })` 按需加载技能全文。

### 3. 本地插件 (Plugins)

在项目工作区创建 `.cy-agent/plugins/<plugin-name>.mjs`：

```javascript
export function createTools({ workspace }) {
  return [
    {
      name: 'my_custom_tool',
      description: '执行特定项目自定义操作',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '查询参数' }
        },
        required: ['query']
      },
      needsApproval: false,
      execute: async ({ query }) => {
        return `Custom tool result for: ${query}`;
      }
    }
  ];
}
```

---

## 🗺️ 架构与演进路线 (OpenSpec)

本项目全面采用 **OpenSpec** 规范驱动开发，各能力阶段演进如下：

| 阶段 | 模块 / 目标 | 核心产物 | 状态 |
| --- | --- | --- | --- |
| **Phase 0** | **工程骨架** | Monorepo、TypeScript strict、Vitest、CI/CD 自动化 | ✅ |
| **Phase 1** | **Headless Agent Core** | AsyncGenerator 事件流、ToolRegistry、HITL 授权机制、Abort 中断 | ✅ |
| **Phase 2** | **Coding Agent CLI** | 编码工具集、Git 快照回滚、会话持久化、Token 预算与历史摘要压缩 | ✅ |
| **Phase 3** | **Desktop Shell** | Electron 桌面端、IPC 事件单向流、React 浅色 UI、三平台打包发布 | ✅ |
| **Phase 4** | **代码工作区** | 工作区目录切换与记忆、上下文概览自动注入、符号链接沙箱防护 | ✅ |
| **Phase 5** | **扩展能力** | MCP stdio 客户端、Skills 技能动态加载、Plugins 插件动态加载 | ✅ |
| **Phase 6** | **高级代码导航** | `find_symbol` 符号索引快速检索、`file_dependencies` 文件依赖图谱解析 | ✅ |
| **Phase 7** | **原生多 Provider** | Anthropic Claude / Google Gemini 原生流式协议支持与智能路由 | ✅ |
| **Desktop+** | **桌面体验增强** | 集成 `electron-updater` 自动更新模块与更新通知交互 | ✅ |

---

## 📄 License

私有项目，保留所有权利。
