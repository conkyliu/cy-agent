# Capability: cli (Delta: 进程内多会话管理)

## ADDED Requirements

### Requirement: 会话开启与切换

REPL SHALL 通过宿主注入的会话工厂支持进程内多会话。切换任何会话前 MUST 先
存档当前会话（启用持久化时），切换 SHALL NOT 丢失未保存的对话。

#### Scenario: /new 开启新会话

- **WHEN** 用户输入 `/new`
- **THEN** 当前会话 SHALL 被存档（若启用持久化）
- **AND** REPL SHALL 切换到工厂创建的空会话并提示新会话 ID

#### Scenario: /open 恢复历史会话

- **WHEN** 用户输入 `/open <id>` 且存档存在
- **THEN** 当前会话 SHALL 先被存档
- **AND** REPL SHALL 用存档消息与原会话 ID 重建会话并提示消息数
- **AND** 后续每轮存档 SHALL 写回该原 ID 对应的文件

#### Scenario: /open 目标不存在

- **WHEN** 用户输入 `/open <id>` 且存档不存在
- **THEN** REPL SHALL 提示未找到并 SHALL NOT 切换会话

### Requirement: 会话删除保护

`/delete <id>` SHALL 删除指定存档；活动会话 MUST NOT 被删除。

#### Scenario: 删除存档会话

- **WHEN** 用户输入 `/delete <id>` 且目标非活动会话
- **THEN** 对应存档文件 SHALL 被移除

#### Scenario: 删除活动会话被拒绝

- **WHEN** 用户输入 `/delete <id>` 且目标为当前活动会话
- **THEN** REPL SHALL 提示无法删除并 SHALL NOT 移除存档

### Requirement: 会话列表可辨识

`/sessions` 输出 SHALL 用 `*` 标记当前活动会话，并为每条存档显示标题。
标题 MUST 由首条用户消息派生（压缩空白、最长 60 字符）；无标题的旧存档
SHALL 以占位符显示且可正常加载。

#### Scenario: 列表展示

- **WHEN** 用户输入 `/sessions` 且存在多个存档
- **THEN** 输出 SHALL 按更新时间倒序列出 ID、标题、时间与消息数
- **AND** 当前活动会话行 SHALL 以 `*` 开头
