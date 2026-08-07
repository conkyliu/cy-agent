# Capability: cli (Delta: 上下文裁剪提示)

## ADDED Requirements

### Requirement: 渲染上下文裁剪事件

CLI 渲染器 SHALL 处理 `context_trimmed` 事件，以低强调样式输出
被移除的消息数与剩余估算 token 数；渲染器的事件穷尽检查
（never 分支）MUST 覆盖该新事件类型。

#### Scenario: 裁剪提示

- **WHEN** 会话因超预算发生裁剪
- **THEN** 终端 SHALL 输出一行包含移除条数与剩余 token 估算的提示
- **AND** 该提示 SHALL NOT 打断后续流式文本的连贯输出
