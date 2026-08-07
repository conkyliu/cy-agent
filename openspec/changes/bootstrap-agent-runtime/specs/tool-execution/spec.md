# Capability: tool-execution

## ADDED Requirements

### Requirement: 自包含工具契约

每个工具 MUST 实现 `ToolContract`：包含 `name`、`description`、
完整 JSON Schema（`parameters`）与 `execute(args, signal)`，
使 LLM 无需外部上下文即可理解并调用工具。

#### Scenario: 参数透传与取消传递

- **WHEN** 运行时执行工具
- **THEN** 解析后的参数对象与会话 `AbortSignal` SHALL 传递给 `execute`

### Requirement: 工具注册表

`ToolRegistry` SHALL 支持运行时 `register` / `unregister`，
并能在会话启动时提供完整工具快照，为后续 MCP 与插件系统预留动态能力。

#### Scenario: 重复注册

- **WHEN** 注册同名工具
- **THEN** 注册表 SHALL 抛出错误，保留先注册的工具

#### Scenario: 会话获取快照

- **WHEN** Agent Loop 每轮请求模型前
- **THEN** 会话 SHALL 从注册表获取当前工具快照并作为 `tools` 传给提供商

### Requirement: 执行事件与错误边界

工具执行 SHALL 依次产出 `tool_execution_started` 与
`tool_execution_completed` 或 `tool_execution_failed`。
Tool 级错误 MUST NOT 中断会话：异常 SHALL 被捕获并转换为字符串形式
（如 `"Error: File not found"`）作为 `tool` 消息交还 LLM，由其决定重试或报错。

#### Scenario: 工具抛出异常

- **WHEN** 工具 `execute` 抛出异常
- **THEN** 会话 SHALL 产出 `tool_execution_failed` 事件并继续运行
- **AND** 下一轮模型请求 SHALL 包含内容为 `"Error: <异常信息>"` 的工具结果消息

#### Scenario: 调用未注册工具

- **WHEN** 模型请求调用未注册的工具
- **THEN** 运行时 SHALL 产出 `tool_execution_failed` 事件并将 "not registered" 错误交还 LLM

#### Scenario: 非法 JSON 参数

- **WHEN** 模型给出的工具参数无法解析为 JSON
- **THEN** 运行时 SHALL 以 `tool_execution_failed` 上报且不中断会话

### Requirement: 执行策略扩展点

运行时 SHALL 在每次工具执行前调用 `ToolExecutionPolicy.approve`（若提供）。
默认策略 MUST 自动静默放行；策略拒绝 SHALL 以错误形式交还 LLM，而非中断会话。
该挂起点为后续 Human-in-the-loop 授权保留扩展能力。

#### Scenario: 策略拒绝执行

- **WHEN** 注入的策略对某工具返回 false
- **THEN** 该工具 SHALL 不被执行，且拒绝原因以错误字符串交还 LLM，会话继续
