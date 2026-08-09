# Change: add-git-snapshot

## Why

`write_file` 覆写是**不可逆**操作：模型误写或用户事后反悔时，原文件内容
无法找回（除非恰好有版本控制提交）。借鉴 Aider 的安全兜底思路：写入前自动
创建快照，把拒绝/回滚成本从"不可逆"降为"可撤销"。

## What Changes

- `packages/tools` 新增 `git-snapshot.ts`：
  - `createGitSnapshot(cwd, file)`：用 `git hash-object -w` 把原文件内容写入
    **对象库（blob）**——不触碰索引、工作区、提交历史，是侵入性最低的快照。
  - 返回 `{ created, blobSha?, reason? }`；非 git 仓库（stderr 特征判定）、
    git 缺失、哈希失败均静默返回 `created: false`。
- `write_file`：覆写**已存在**的文件前先快照；成功时结果附
  `(snapshot: <sha>; restore with "git cat-file blob <sha> > <path>")`。
  新建文件无内容可保护，不快照。
- 安全兜底原则：快照任何失败都不阻塞写入本身。

## Impact

- Affected specs: `coding-tools`（write_file 快照需求）
- Affected code: tools/git-snapshot.ts、tools/coding-tools.ts、tools/index.ts
- 行为变化：git 仓库内覆写已有文件的 write_file 结果会附带快照信息；
  工具描述更新说明该行为。
