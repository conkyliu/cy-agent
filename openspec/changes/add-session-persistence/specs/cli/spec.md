# Capability: cli (Delta: 会话持久化)

## ADDED Requirements

### Requirement: 会话自动持久化

CLI SHALL 在每轮会话结束后将非 system 消息保存至工作区内
`.cy-agent/sessions` 目录（每会话一个 JSON 文件，原子写入）；
保存失败 MUST 仅输出警告，不得中断 REPL。systemPrompt MUST NOT 写入历史文件。

#### Scenario: 一轮结束后保存

- **WHEN** 用户完成一轮对话
- **THEN** 磁盘 SHALL 存在以会话 ID 命名的 JSON 文件
- **AND** 其中消息 SHALL 不含任何 system 角色消息

### Requirement: 会话列表与恢复

CLI SHALL 提供 `/sessions` 命令按更新时间倒序列出已保存会话，
并支持 `--resume=<id>` 启动参数恢复指定会话；
恢复不存在的会话 SHALL 以非零退出码报错。

#### Scenario: 列出会话

- **WHEN** 用户输入 `/sessions`
- **THEN** CLI SHALL 输出最近会话的 ID、更新时间与消息数

#### Scenario: 恢复会话

- **WHEN** 以 `--resume=<id>` 启动且该会话存在
- **THEN** 新会话的首次模型请求 SHALL 携带完整历史上下文

#### Scenario: 恢复失败

- **WHEN** `--resume` 指向不存在的会话 ID
- **THEN** CLI SHALL 输出错误提示并以非零退出码退出
