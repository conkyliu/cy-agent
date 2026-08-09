# Change: add-cli-one-shot

## Why

运行时（`AgentSession`）本身是 headless 的，但 CLI 层只有 REPL（`main.ts → runRepl`），
没有脚本可用的形态：无法 `cy-agent -p "<prompt>"` 一次性执行并退出，也没有结构化输出。
这导致自动化脚本与 CI 集成完全无法使用 cy-agent。

## What Changes

- `config.ts`：
  - `parseCliArgs` 支持单字符短选项（`-p <value>`、`-p=<value>`），
    短别名归一化（`p → prompt`、`y → yes`）；单字符短选项无 `=` 时消费下一参数作为值。
  - 新增 `parsePositionals`：收集位置参数（跳过选项及其值），支持 `cy-agent "prompt"`。
  - `CliConfig` 新增 `prompt`（存在即单次执行模式）、`output: 'text' | 'json'`、`yes`。
  - `HELP_TEXT` 补充单次执行用法与退出码说明。
- 新增 `run-once.ts`：
  - `runOnce`：驱动一次 `session.run()`，消费事件流后退出。
    - text 模式：`text_chunk` 流式写 stdout；工具/进度事件经 `renderEvent` 写 stderr，
      stdout 保持管道友好。
    - json 模式（`--output=json`）：结束时向 stdout 输出单个 JSON 对象
      （`sessionId` / `status` / `result` / `toolCalls` / `usage` / `error`）。
  - 授权处理：非交互模式不提问，收到 `tool_approval_requested` 立即响应
    `resolveApproval`——`--yes` 自动放行，默认拒绝（CI 安全默认）。
  - SIGINT：取消当前执行，状态 `cancelled`。
  - `readStdinPrompt`：`-p -` 或空 `-p` 时从 stdin 读取提示词。
- `main.ts`：存在 prompt（`-p/--prompt`、位置参数或 stdin）时走 `runOnce` 并退出，
  退出码：completed → 0，cancelled（SIGINT）→ 130，其余 → 1；否则进入 REPL（行为不变）。
  单次模式执行结束同样写回会话存档（支持 `--resume` 多轮串联）。
- `repl.ts`：导出 `persistSession` 供单次模式复用。

## Impact

- Affected specs: `cli`（新增单次执行与结构化输出能力）
- Affected code: `packages/cli/*`
- REPL 交互行为不变；不修改其他包。
