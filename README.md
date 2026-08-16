# cy-agent

一个 Headless（无 UI 依赖）的 Agent 运行时与编码智能体 CLI，采用 TypeScript + pnpm workspace monorepo 架构，基于 OpenSpec 增量式开发。

## 项目简介

`cy-agent` 提供一个与 UI 完全解耦的智能体核心运行时：负责管理从用户输入、模型流式生成、高危工具人机授权（Human-in-the-loop），到工具调用与结果回传的完整生命周期（Agent Loop）。运行时通过单向事件流（AsyncGenerator）与外部宿主通信，目前提供 CLI 与 Electron 桌面端两种宿主形态，并可通过 MCP / 技能 / 插件扩展能力边界。

### 核心特性

- **流式 Agent Loop**：基于 AsyncGenerator 的事件流驱动，实时推送文本生成、工具授权、工具执行等原子事件
- **Human-in-the-loop 授权**：`write_file`、`run_shell` 等高危工具执行前挂起等待用户显式批准，拒绝时以安全伪造结果回传模型
- **编码工具集**：内置文件读写、目录列举、内容搜索与 Shell 执行工具，带工作区沙箱约束（含符号链接逃逸防护）；`write_file` 覆盖前自动做 git 快照，工具输出超长自动截断防止上下文爆炸
- **会话持久化与多会话管理**：会话自动存档至工作区 `.cy-agent/sessions`，支持 `--resume` 恢复；REPL 内支持 `/new`、`/open`、`/sessions`、`/delete` 等多会话命令
- **非交互单次执行**：`-p/--prompt`（或位置参数 / stdin）跑一轮即退出，支持 `--output=json` 结构化输出，面向脚本与 CI 场景
- **上下文预算管理**：启发式 token 估算 + 单元化裁剪，超限时自动裁剪发送副本（内部历史保持完整）
- **LLM 驱动的上下文压缩**：超过阈值时由模型将历史总结为摘要消息，原地替换上下文，失败静默回退裁剪
- **可中断**：通过 AbortController 全链路传播取消信号，随时安全中断会话
- **Token 用量跟踪**：解析模型端点返回的真实 usage 统计，每轮会话结束后显示 `Tokens: N in / M out`
- **OpenAI 兼容 Provider**：支持任意 OpenAI 兼容端点（可通过 `--base-url` 指定）
- **Electron 桌面壳层**：主进程承载运行时，React 渲染层消费事件流，提供 HITL 授权卡片、流式渲染、多会话侧边栏与工作区切换（三平台打包：macOS / Windows / Linux）
- **代码工作区一等公民**：systemPrompt 自动注入工作区概览（目录树 + git 分支 + 标记文件），模型首轮即预知项目结构
- **扩展体系**：MCP（stdio 客户端）、技能（`.cy-agent/skills/*.md` 按需加载）、本地插件（`.cy-agent/plugins/*.mjs`）三类扩展统一经 `ToolRegistry` 挂载，加载失败降级不阻塞启动

## 仓库结构

```
cy-agent/
├── packages/
│   ├── protocol/         # 跨包统一数据协议（Message / AgentEvent）
│   ├── agent/            # 核心运行时：AgentSession、工具注册表、上下文预算与压缩
│   ├── tools/            # 内置工具实现（文件操作、Shell 执行、工作区概览、扩展装配）
│   ├── openai-provider/  # OpenAI 兼容模型提供商
│   ├── storage/          # 会话持久化存储
│   ├── mcp/              # MCP（Model Context Protocol）stdio 客户端
│   ├── cli/              # CLI（交互式 REPL + 非交互单次执行，@cy-agent/cli）
│   └── desktop/          # Electron 桌面壳层（主进程 / preload / React 渲染层）
├── openspec/             # OpenSpec 增量规格与变更档案
├── spec.md               # 运行时核心规范
└── vitest.config.ts
```

## 快速开始

### 环境要求

- Node.js >= 24
- pnpm（`corepack enable` 或安装 pnpm 11+）

### 安装与构建

```bash
pnpm install
pnpm build
```

### 运行验证

```bash
pnpm test        # 运行 Vitest 测试
pnpm typecheck   # 全量类型检查
```

### 使用 CLI

```bash
# 交互模式（REPL）
node packages/cli/dist/main.js --base-url <模型端点> --api-key <密钥> --model <模型名>

# 恢复历史会话
node packages/cli/dist/main.js --resume <会话ID>

# 非交互单次执行（脚本 / CI）
cy-agent -p "梳理本项目的目录结构"
cy-agent "修复 xxx"               # 位置参数写法等价于 -p
echo "..." | cy-agent -p -        # 从 stdin 读取提示词
cy-agent -p "..." --output=json   # 结构化 JSON 输出
cy-agent -p "..." -y              # 自动批准工具调用（默认拒绝，CI 安全默认）
```

单次模式退出码：`0` 会话完成、`130` 取消（SIGINT）、`1` 会话出错或致命错误。

参数支持环境变量回退，可写入 `~/.zshrc` 后免参启动：

| 参数 | 环境变量 | 说明 |
| --- | --- | --- |
| `--base-url=<url>` | `CY_AGENT_BASE_URL` | OpenAI 兼容 API 端点 |
| `--api-key=<key>` | `CY_AGENT_API_KEY` / `OPENAI_API_KEY` | API 密钥 |
| `--model=<name>` | `CY_AGENT_MODEL` | 模型名（默认 gpt-4o） |
| `--cwd=<dir>` | — | 工作区目录（默认当前目录） |
| `--mcp-config=<file>` | `CY_AGENT_MCP_CONFIG` | MCP 服务器配置文件 |
| `--resume=<id>` | — | 恢复指定历史会话 |

### 全局命令

通过 pnpm 软链接可将 CLI 注册为全局命令，之后在任意目录直接运行 `cy-agent`：

```bash
pnpm link --global ./packages/cli
pnpm setup        # 将 pnpm 全局目录加入 PATH，重开终端生效
```

REPL 常用命令：`/sessions` 查看会话列表、`/new` 新建会话、`/open <id>` 切换会话、`/delete <id>` 删除会话、`/exit` 退出。

### 桌面端

Electron 桌面壳层复用 CLI 的环境变量约定（base URL / API key / model）：

```bash
pnpm desktop:dev      # 开发模式（Vite dev server 热更新）
pnpm desktop:build    # 构建全量产物（electron-builder）
pnpm desktop:release  # 构建并发布安装包（macOS dmg / Windows / Linux）
```

桌面端支持在 UI 中切换工作区目录（记忆最后选择），HITL 授权以模态卡片呈现，三平台安装包由 CI 在打 tag 时自动发布到 GitHub Release。

### 扩展体系

三类扩展统一经 `ToolRegistry` 挂载，任一扩展加载失败均降级跳过、不阻塞启动：

- **MCP**：Claude Desktop 风格配置文件，经 `--mcp-config` 或 `CY_AGENT_MCP_CONFIG` 指定；远程工具注册为 `mcp_<server>_<tool>`，一律需要授权。

  ```json
  {
    "mcpServers": {
      "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] }
    }
  }
  ```

- **技能（Skills）**：工作区 `.cy-agent/skills/<name>.md`，文件名即技能名，首行非空行为描述；模型经内置 `load_skill` 工具按需加载全文，避免全量注入。
- **本地插件（Plugins）**：工作区 `.cy-agent/plugins/*.mjs` 默认导出 `createTools({ workspace }) => ToolBase[]`，启动时动态加载；插件以宿主权限执行，信任边界等同 `run_shell`。

## 开发路线

项目采用 OpenSpec 增量式开发，每个 `add-*` 对应一个独立变更档案：

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | 工程基础（monorepo、TS strict、Vitest、CI） | ✅ |
| Phase 1 | Headless Agent Core（事件流、工具调用、HITL、取消） | ✅ |
| Phase 2 | Coding Agent CLI（编码工具、持久化、上下文管理） | ✅ |
| Phase 3 | Electron 桌面壳层（IPC 桥、授权 UI、事件流渲染、三平台打包） | ✅ |
| Phase 4 | 代码工作区（工作区切换、概览注入、符号链接逃逸防护） | ✅ |
| Phase 5 | 扩展体系（MCP / 技能 / 插件） | ✅ |

## License

私有项目，保留所有权利。
