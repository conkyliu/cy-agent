# Change: add-shell-tool

## Why

编码 Agent 仅有文件读写/搜索能力时，无法执行构建、测试、Git 等真实开发操作。
需要一个受控的 Shell 执行工具，且必须纳入 HITL 授权机制（高危操作）。

## What Changes

- `packages/tools` 新增 `shell-tool.ts`：
  - `createRunShellTool(workspaceRoot)`：`run_shell` 工具，`requiresApproval: true`。
  - 参数：`command`（必填）、`cwd`（沙箱内相对目录）、`timeoutMs`（默认 30s，上限 120s）。
  - 安全边界：
    - `cwd` 经 `resolveInWorkspace` 防路径逃逸。
    - 超时 `SIGKILL` 杀进程；`AbortSignal` 取消同样杀进程。
    - stdout/stderr 各自上限 100KB，超长截断。
  - 错误策略（spec 6.2）：非零退出码、超时、取消均**格式化为结果字符串**返回，
    不抛异常，交由 LLM 自我修正；仅进程无法启动等致命情况抛出。
- `packages/cli` 的 `main.ts` 注册 `run_shell` 并更新系统提示词。

## Impact

- Affected specs: `coding-tools`（Delta：新增 shell 执行要求）
- Affected code: `packages/tools/src/shell-tool.ts`（新增）、`packages/tools/src/index.ts`、`packages/cli/src/main.ts`
- 不改变既有四个编码工具的行为。
