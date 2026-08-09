# Tasks: add-cli-one-shot

## 1. 参数与配置

- [x] 1.1 `parseCliArgs` 支持单字符短选项：`-p <value>` / `-p=<value>`，别名归一化（`p → prompt`、`y → yes`）
- [x] 1.2 `parsePositionals` 收集位置参数（跳过选项及其值），支持 `cy-agent "prompt"`
- [x] 1.3 `loadConfig` 合并 `prompt` / `output(text|json)` / `yes`，非法 `--output` 报致命错误
- [x] 1.4 `HELP_TEXT` 补充单次执行用法与退出码说明

## 2. 单次执行

- [x] 2.1 `runOnce`：驱动一次 `session.run()`，返回结构化 `RunOnceResult`
- [x] 2.2 text 模式：`text_chunk` 流式写 stdout，进度事件经 `renderEvent` 写 stderr
- [x] 2.3 json 模式：结束时向 stdout 输出单个 JSON 对象（sessionId/status/result/toolCalls/usage/error）
- [x] 2.4 授权处理：非交互立即响应 `resolveApproval`，`--yes` 放行、默认拒绝
- [x] 2.5 SIGINT 取消执行（状态 cancelled）；`readStdinPrompt` 支持 `-p -` / 管道输入
- [x] 2.6 `main.ts` 接线：prompt 存在即单次执行并按状态设置退出码，结束后写回会话存档

## 3. 测试与验证

- [x] 3.1 config：短选项/别名/位置参数/output 校验测试
- [x] 3.2 runOnce：text/json 两种输出、授权放行与拒绝、错误状态、usage 透传测试
- [x] 3.3 typecheck / test / lint 全部通过
