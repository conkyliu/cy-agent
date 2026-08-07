# Tasks: add-multi-session

## 1. 运行时

- [x] 1.1 `AgentSessionOptions.id` 可选字段：恢复存档时保留原 ID

## 2. 持久化

- [x] 2.1 `StoredSession` / `SessionSummary` 新增可选 `title`
- [x] 2.2 解析容错：无 title 的旧格式可加载，title 非字符串视为损坏
- [x] 2.3 list 摘要携带 title（条件赋值，兼容 exactOptionalPropertyTypes）

## 3. REPL 多会话命令

- [x] 3.1 会话工厂 `createSession(initialMessages?, sessionId?)` 注入，当前会话可替换
- [x] 3.2 `/new`：存档当前会话后创建空会话
- [x] 3.3 `/open <id>`：存档当前 → 载入目标（保留原 ID）；不存在时报错不切换
- [x] 3.4 `/delete <id>`：删除存档；活动会话禁止删除
- [x] 3.5 `/sessions`：`*` 标记当前会话并显示标题
- [x] 3.6 存档时从首条用户消息派生 title（压缩空白、截断 60 字符）
- [x] 3.7 SIGINT 处理器跟随当前活动会话

## 4. 装配

- [x] 4.1 main.ts 提供会话工厂；`--resume` 保留原会话 ID
- [x] 4.2 HELP_TEXT 更新

## 5. 测试与验证

- [x] 5.1 agent：提供 id 被采纳 / 缺省自动生成
- [x] 5.2 storage：title 往返 + 旧格式兼容 + 非字符串 title 拒载
- [x] 5.3 cli：/new + /open + /sessions 全流程（存档连续性、标题、当前标记）
- [x] 5.4 cli：/delete 删除与活动会话保护
- [x] 5.5 `pnpm build && pnpm typecheck && pnpm test` 全绿（74 个测试）
