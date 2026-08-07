# Change: add-multi-session

## Why

add-session-persistence 只支持"单会话 + 启动时 --resume"：REPL 进程内无法开启、
切换、删除多个会话，存档列表也全是 UUID 难以辨识。编码工作流经常需要并行
多条任务线（修 bug / 写测试 / 探索性实验），需要进程内的多会话管理能力。

## What Changes

- `packages/agent`：`AgentSessionOptions` 新增可选 `id`——恢复存档会话时传入
  原 ID，保证后续每轮存档写回同一文件，不产生分裂副本。
- `packages/storage`：`StoredSession` / `SessionSummary` 新增可选 `title`
  （缺失容忍、非字符串视为损坏），便于列表辨识。
- `packages/cli`：
  - REPL 引入**会话工厂** `createSession(initialMessages?, sessionId?)`，
    当前会话变为可替换状态；未提供工厂时切换类命令提示不可用。
  - 新命令：`/new`（存档当前并开空会话）、`/open <id>`（存档当前并载入目标
    会话，保留原 ID）、`/delete <id>`（删除存档；活动会话禁止删除）。
  - `/sessions` 用 `*` 标记当前会话并显示标题。
  - 存档时从首条用户消息派生 `title`（压缩空白、截断 60 字符）。
  - `--resume` 路径同样保留原会话 ID。
- HELP_TEXT 同步新命令。

## Impact

- Affected specs: `agent-session`（可选会话 ID）、`cli`（多会话命令与标题）
- Affected code: agent/session.ts、storage/session-store.ts、cli/repl.ts、
  cli/main.ts、cli/config.ts
- 向后兼容：旧存档文件（无 title）可正常加载；未提供工厂时 REPL 行为不变。
