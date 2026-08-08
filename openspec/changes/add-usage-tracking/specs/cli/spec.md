# Change: add-usage-tracking

## ADDED Requirements

### Requirement: 用量渲染

CLI 渲染器 MUST 处理 `usage_reported` 事件，以低对比提示行输出本轮 token 用量
（形如 `⋯ Tokens: N in / M out`），且 SHALL 保持 `AgentEvent` 穷尽检查完整
（新增事件类型时编译期强制补渲染分支）。

#### Scenario: 轮次结束显示用量

- **WHEN** 事件流包含 `usage_reported { inputTokens: 100, outputTokens: 42 }`
- **THEN** 终端 SHALL 输出包含 `100` 与 `42` 的用量提示行

#### Scenario: 无用量事件

- **WHEN** 事件流不包含 `usage_reported`
- **THEN** 终端 SHALL 不输出任何用量行，界面与之前一致
