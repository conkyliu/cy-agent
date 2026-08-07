# Tasks: add-session-persistence

## 1. 运行时支持

- [x] 1.1 `AgentSessionOptions.initialMessages`：追加在 system 消息之后，拷贝隔离

## 2. 存储包

- [x] 2.1 新建 `packages/storage`，接入 workspace 构建与 vitest 别名
- [x] 2.2 `SessionStore` 契约（save/load/list/delete）
- [x] 2.3 `JsonFileSessionStore`：原子写入（tmp + rename）、ID 白名单校验
- [x] 2.4 损坏容忍：load 返回 null，list 跳过损坏文件，目录不存在返回空

## 3. CLI 集成

- [x] 3.1 每轮结束自动保存非 system 消息，失败仅警告
- [x] 3.2 `--resume=<id>` 加载历史会话；不存在时报错退出
- [x] 3.3 `/sessions` 命令列出最近 10 个会话（倒序）

## 4. 测试与验证

- [x] 4.1 store 测试：round-trip/缺失/排序/覆盖/删除/ID 注入/损坏文件（7 个）
- [x] 4.2 AgentSession 恢复测试：消息顺序、外部篡改隔离
- [x] 4.3 CLI 持久化测试：自动保存（不含 system）、/sessions 输出、未启用提示
- [x] 4.4 全量 build/typecheck/test 通过（54 个测试）
