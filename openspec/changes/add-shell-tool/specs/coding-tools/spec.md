# Capability: coding-tools (Delta: Shell 执行)

## ADDED Requirements

### Requirement: 受控 Shell 执行工具

仓库 SHALL 提供 `run_shell` 工具，通过系统 shell 执行命令并捕获输出。
该工具 MUST 标记 `requiresApproval: true`（高危操作需 HITL 授权），
其 `cwd` 参数 MUST 限定在工作区沙箱内，任何逃逸路径 SHALL 抛出错误。

#### Scenario: 成功执行

- **WHEN** 命令以退出码 0 结束
- **THEN** 结果 SHALL 包含 `[stdout]` / `[stderr]` 分区与命令输出
- **AND** 无任何输出时 SHALL 返回占位说明

#### Scenario: 工作目录逃逸

- **WHEN** `cwd` 解析后位于工作区根之外
- **THEN** 工具 SHALL 抛出路径逃逸错误（由 Agent Loop 转字符串交还 LLM）

### Requirement: 超时与取消

`run_shell` MUST 支持超时（默认 30 秒，上限 120 秒）与 `AbortSignal` 取消，
两种情况 SHALL 强制终止子进程（SIGKILL），并以描述性字符串返回结果。

#### Scenario: 命令超时

- **WHEN** 命令运行超过 `timeoutMs`
- **THEN** 子进程 SHALL 被杀掉
- **AND** 结果 SHALL 说明超时时长，并附带部分输出（若有）

#### Scenario: 会话取消

- **WHEN** 命令运行期间 `AbortSignal` 被触发
- **THEN** 子进程 SHALL 被杀掉
- **AND** 结果 SHALL 标记为已取消

### Requirement: 工具级错误不中断会话

非零退出码、超时与取消 MUST 以格式化字符串作为工具结果返回，
严禁抛出异常中断 Agent Loop（对应 spec 6.2 可恢复异常策略），
交由 LLM 进行自我修正。

#### Scenario: 非零退出码

- **WHEN** 命令以非零退出码结束
- **THEN** 结果 SHALL 包含 `Command failed with exit code <code>` 与已捕获的输出
