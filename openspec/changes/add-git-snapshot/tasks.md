# Tasks: add-git-snapshot

## 1. 快照模块

- [x] 1.1 `createGitSnapshot`：`git hash-object -w` 写入对象库 blob
- [x] 1.2 仓库判定：rev-parse 非零退出时按 stderr 区分"非仓库"与"git 缺失"
- [x] 1.3 SHA-1 格式校验；任何失败静默返回 `created: false`

## 2. write_file 集成

- [x] 2.1 覆写已存在文件前创建快照；新建文件跳过快照
- [x] 2.2 结果附快照 SHA 与恢复命令提示
- [x] 2.3 快照失败不阻塞写入；非 git 目录结果保持原格式
- [x] 2.4 工具描述更新；导出 `createGitSnapshot`

## 3. 测试与验证

- [x] 3.1 快照单测：blob 内容可还原、不触碰索引/工作区（git status 验证）
- [x] 3.2 非 git 仓库静默跳过（reason 断言）
- [x] 3.3 write_file 集成：覆写附 SHA 且原内容可恢复 / 新建不快照 / 非 git 正常写入
- [x] 3.4 `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` 全绿（90 个测试）
