# Capability: cli (Delta: 上下文压缩提示)

## ADDED Requirements

### Requirement: 渲染上下文压缩事件

CLI 渲染器 SHALL 处理 `context_compacted` 事件，以低强调样式输出被总结替换的
消息条数；渲染器的事件穷尽检查（never 分支）MUST 覆盖该新事件类型。

#### Scenario: 压缩提示

- **WHEN** 会话发生上下文压缩
- **THEN** 终端 SHALL 输出一行包含被替换消息条数的提示
- **AND** 该提示 SHALL NOT 打断后续流式文本的连贯输出
