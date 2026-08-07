# cy-agent

一个 Headless（无 UI 依赖）的 Agent 运行时与编码智能体 CLI，采用 TypeScript + pnpm workspace monorepo 架构，基于 OpenSpec 增量式开发。

## 项目简介

`cy-agent` 提供一个与 UI 完全解耦的智能体核心运行时：负责管理从用户输入、模型流式生成、高危工具人机授权（Human-in-the-loop），到工具调用与结果回传的完整生命周期（Agent Loop）。运行时通过单向事件流（AsyncGenerator）与外部宿主（CLI / 未来的桌面端）通信，可被任意前端形态复用。

### 核心特性

- **流式 Agent Loop**：基于 AsyncGenerator 的事件流驱动，实时推送文本生成、工具授权、工具执行等原子事件
- **Human-in-the-loop 授权**：`write_file`、`run_shell` 等高危工具执行前挂起等待用户显式批准，拒绝时以安全伪造结果回传模型
- **编码工具集**：内置文件读写与 Shell 执行工具，带工作区沙箱约束
- **会话持久化与多会话管理**：会话自动存档，支持 `--resume` 恢复；REPL 内支持 `/new`、`/open`、`/sessions`、`/delete` 等多会话命令
- **上下文预算管理**：启发式 token 估算 + 单元化裁剪，超限时自动裁剪发送副本（内部历史保持完整）
- **LLM 驱动的上下文压缩**：超过阈值时由模型将历史总结为摘要消息，原地替换上下文，失败静默回退裁剪
- **可中断**：通过 AbortController 全链路传播取消信号，随时安全中断会话
- **OpenAI 兼容 Provider**：支持任意 OpenAI 兼容端点（可通过 `--base-url` 指定）

## 仓库结构

```
cy-agent/
├── packages/
│   ├── protocol/         # 跨包统一数据协议（Message / AgentEvent）
│   ├── agent/            # 核心运行时：AgentSession、工具注册表、上下文预算与压缩
│   ├── tools/            # 内置工具实现（文件操作、Shell 执行）
│   ├── openai-provider/  # OpenAI 兼容模型提供商
│   ├── storage/          # 会话持久化存储
│   └── cli/              # REPL 交互式命令行（@cy-agent/cli）
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
node packages/cli/dist/main.js --resume
```

REPL 常用命令：`/sessions` 查看会话列表、`/new` 新建会话、`/open <id>` 切换会话、`/delete <id>` 删除会话、`/exit` 退出。

## 开发路线

项目采用 OpenSpec 增量式开发，每个 `add-*` 对应一个独立变更档案：

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | 工程基础（monorepo、TS strict、Vitest、CI） | ✅ |
| Phase 1 | Headless Agent Core（事件流、工具调用、HITL、取消） | ✅ |
| Phase 2 | Coding Agent CLI（编码工具、持久化、上下文管理） | ✅ |
| Phase 3+ | 桌面端 Shell、代码工作区、插件/MCP 扩展、高级上下文 | 规划中 |

## License

私有项目，保留所有权利。
