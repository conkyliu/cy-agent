# Tasks: add-shell-tool

## 1. 工具实现

- [x] 1.1 `createRunShellTool`：`run_shell` 工具，`requiresApproval: true`，JSON Schema 完整
- [x] 1.2 `cwd` 沙箱校验（复用 `resolveInWorkspace`）
- [x] 1.3 超时杀进程（默认 30s，上限 120s）与 AbortSignal 取消杀进程
- [x] 1.4 stdout/stderr 捕获与 100KB 截断标记
- [x] 1.5 结果格式化：成功/非零退出码/超时/取消四种形态，均返回字符串不中断 Loop

## 2. CLI 集成

- [x] 2.1 `main.ts` 注册 `run_shell`，系统提示词更新为五工具

## 3. 测试与验证

- [x] 3.1 成功/非零退出码/无输出/相对工作目录用例
- [x] 3.2 cwd 逃逸拒绝、超时杀进程、AbortSignal 取消、已取消信号直接拒绝用例
- [x] 3.3 全量 build/typecheck/test 通过（44 个测试）
