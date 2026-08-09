# Capability: cli (Delta: 非交互单次执行模式)

## ADDED Requirements

### Requirement: 非交互单次执行

CLI SHALL 支持非交互单次执行：`-p/--prompt=<text>`、`-p <text>`、位置参数
（`cy-agent "<text>"`）或从 stdin 读取（`-p -` / 空 `-p`）任一方式提供提示词时，
执行一轮完整 Agent Loop 后退出，MUST NOT 进入 REPL。
单次模式 SHALL 复用既有配置（模型 / API Key / `--cwd` / `--resume`），
执行结束 SHALL 写回会话存档（启用持久化时），支持多次调用串联同一会话。

#### Scenario: 单次执行并退出

- **WHEN** 以 `cy-agent -p "<prompt>"` 启动
- **THEN** CLI SHALL 执行一轮会话，输出模型最终回复后退出
- **AND** 进程 SHALL NOT 等待后续输入

#### Scenario: 退出码

- **WHEN** 会话正常完成（`session_completed`）
- **THEN** 退出码 SHALL 为 0
- **WHEN** 会话以 `session_error` 结束
- **THEN** 退出码 SHALL 非零

#### Scenario: 恢复会话串联

- **WHEN** 以 `--resume=<id> -p "<prompt>"` 启动且存档存在
- **THEN** 新回复 SHALL 追加到该会话存档

### Requirement: 非交互模式的工具授权

单次模式下 CLI MUST NOT 交互式提问授权；收到 `tool_approval_requested` 时 SHALL
立即调用 `resolveApproval`：提供 `-y/--yes` 时自动放行，否则默认拒绝（CI 安全默认），
并在进度输出中标注授权决策。

#### Scenario: 默认拒绝

- **WHEN** 模型调用需授权工具且未提供 `--yes`
- **THEN** 工具 SHALL 不被执行，会话以拒绝结果继续请求模型

#### Scenario: --yes 自动放行

- **WHEN** 提供 `-y` 且模型调用需授权工具
- **THEN** 工具 SHALL 被执行

### Requirement: 结构化与管道友好输出

单次模式 SHALL 提供两种输出格式，由 `--output=<text|json>` 控制（默认 `text`）：

- `text`：模型文本流式写入 stdout；工具执行等进度事件写入 stderr，
  stdout MUST 仅含模型文本，保证可直接管道使用。
- `json`：结束时向 stdout 输出单个 JSON 对象，MUST 包含
  `sessionId`、`status`（completed/error/cancelled）、`result`（最终回复）、
  `toolCalls`（名称与状态）；有 token 用量时 SHALL 包含 `usage`，
  出错时 SHALL 包含 `error`。stdout MUST NOT 混入任何非 JSON 内容。

非法 `--output` 取值 SHALL 以致命错误退出。单次执行期间收到 SIGINT SHALL
取消当前执行（退出码 130）。

#### Scenario: text 模式管道

- **WHEN** 以 text 模式执行并将 stdout 重定向
- **THEN** stdout SHALL 仅包含模型回复文本，进度事件出现在 stderr

#### Scenario: json 模式可解析

- **WHEN** 以 `--output=json` 执行
- **THEN** stdout SHALL 恰为一个可被 `JSON.parse` 解析的对象
- **AND** 其 `status` 与 `result` SHALL 与会话实际结果一致

#### Scenario: 非法输出格式

- **WHEN** 提供 `--output=xml` 等不支持的取值
- **THEN** CLI SHALL 报致命错误且退出码非零
