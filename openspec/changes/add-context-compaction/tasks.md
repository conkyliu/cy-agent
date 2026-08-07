# Tasks: add-context-compaction

## 1. 协议

- [x] 1.1 `AgentEvent` 新增 `context_compacted`（removedMessages）

## 2. 压缩模块

- [x] 2.1 `buildTranscript`：按角色逐行转录，工具调用仅保留名称摘要
- [x] 2.2 `createSummaryMessage`：`role: 'user'` + `[Context Summary]` 标记前缀
- [x] 2.3 `SUMMARIZATION_PROMPT`：保留目标/决策/文件路径/未决问题，剔除冗余

## 3. 会话集成

- [x] 3.1 `compaction` 选项：`enabled`（默认 true）/ `threshold`（默认 0.8）/ `keepRecentUnits`（默认 2）
- [x] 3.2 每次模型请求前估算超阈值触发压缩；跳过受保护单元与最近 N 单元
- [x] 3.3 摘要消息原地替换内部历史（可持久化），yield `context_compacted`
- [x] 3.4 压缩失败（Provider 报错/空摘要/取消）静默回退到裁剪

## 4. CLI

- [x] 4.1 渲染器补 `context_compacted` 分支（never 穷尽检查通过）

## 5. 测试与验证

- [x] 5.1 compaction 单测：转录本格式/工具名摘要/摘要消息标记（3 个）
- [x] 5.2 session 集成：压缩成功（事件 + 原地替换 + 请求内容）、失败回退裁剪
- [x] 5.3 既有裁剪测试显式 `compaction: { enabled: false }` 隔离
- [x] 5.4 renderer 断言 `context_compacted` 输出
- [x] 5.5 `pnpm build && pnpm typecheck && pnpm test` 全绿（68 个测试）
