# Change: add-session-persistence

## Why

spec 明确将"会话历史在磁盘上的 JSON 持久化"列为 Phase 2 能力。
CLI 关闭后上下文即丢失，用户无法跨进程延续对话；
需要一个与运行时解耦的持久化层，并让 CLI 支持自动保存与恢复。

## What Changes

- 新增 `packages/storage`（`@cy-agent/storage`）：
  - `SessionStore` 契约：`save / load / list / delete`，未来可替换 SQLite。
  - `JsonFileSessionStore`：每会话一个 JSON 文件；
    临时文件 + rename 原子写入；会话 ID 白名单校验防路径注入；
    损坏文件容忍（load 返回 null，list 跳过）。
  - 只保存**非 system 消息**，systemPrompt 由宿主恢复时重新注入，避免重复累积。
- `packages/agent`：`AgentSessionOptions` 新增 `initialMessages`，
  追加在 system 消息之后，消息对象拷贝隔离（防外部篡改）。
- `packages/cli`：
  - 每轮结束后自动保存会话至 `<cwd>/.cy-agent/sessions`（失败仅警告不中断）。
  - `--resume=<id>`：加载历史会话作为 `initialMessages`，不存在时报错退出。
  - `/sessions` 命令：按 updatedAt 倒序列出最近 10 个会话。

## Impact

- Affected specs: `agent-session`（Delta：会话恢复）、`cli`（Delta：持久化命令）
- Affected code: `packages/storage/*`（新增）、`packages/agent/src/session.ts`、`packages/cli/*`
- 向后兼容：不提供 store 时 CLI 行为与之前完全一致。
