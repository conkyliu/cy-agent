# Capability: cli (Interactive Coding Agent REPL)

## ADDED Requirements

### Requirement: 可配置的 CLI 入口

仓库 SHALL 提供 `cy-agent` 可执行入口，通过命令行参数与环境变量完成配置，
优先级为：命令行参数 > 环境变量 > 默认值；
MUST 兼容 `OPENAI_API_KEY`，并在缺失 API Key 时以非零退出码报告致命错误。

#### Scenario: 缺失 API Key

- **WHEN** 未提供任何 API Key 来源即启动 CLI
- **THEN** CLI SHALL 输出明确的缺失提示与帮助文本
- **AND** 进程退出码 SHALL 非零

#### Scenario: 参数覆盖环境变量

- **WHEN** 同时提供 `--model` 参数与 `CY_AGENT_MODEL` 环境变量
- **THEN** CLI SHALL 使用命令行参数指定的模型

### Requirement: 事件流渲染

CLI SHALL 提供纯函数渲染器将 `AgentEvent` 转换为终端文本：
`text_chunk` 原样连贯输出；工具事件输出名称与参数/结果预览（超长截断）；
授权请求、取消、错误事件 SHALL 有明显视觉标识；颜色输出 MUST 可关闭。

#### Scenario: 流式文本

- **WHEN** 连续收到多个 `text_chunk`
- **THEN** 渲染结果 SHALL 无额外前缀或换行，保持模型输出连贯

### Requirement: 交互式 REPL 与 HITL 授权宿主

REPL SHALL 以每行用户输入驱动一次 `session.run()` 并实时渲染事件流；
收到 `tool_approval_requested` 时 MUST 原地提问（默认拒绝），
并将答复转换为 `resolveApproval` 调用；SIGINT 在会话运行中 SHALL 取消当前轮，
空闲时退出。REPL 的输入/输出流 MUST 可注入以便自动化测试。

#### Scenario: 授权放行

- **WHEN** 模型调用需授权工具且用户回答 `y`
- **THEN** 工具 SHALL 被执行，结果与后续模型输出正常渲染

#### Scenario: 授权拒绝

- **WHEN** 用户对授权提问回答非 `y`
- **THEN** 工具 SHALL 不被执行
- **AND** 会话 SHALL 以伪造的拒绝结果继续请求模型

#### Scenario: 运行中取消

- **WHEN** 会话执行期间收到 SIGINT
- **THEN** 当前轮 SHALL 被取消且 REPL SHALL 回到输入提示符
