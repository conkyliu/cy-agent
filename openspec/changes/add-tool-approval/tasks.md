# Tasks: add-tool-approval

## 1. 协议与契约

- [x] 1.1 `AgentEvent` 新增 `tool_approval_requested` 事件
- [x] 1.2 `ToolContract` 新增 `requiresApproval?: boolean` 字段

## 2. 会话授权挂起（Deferred Async Control）

- [x] 2.1 `AgentSession.resolveApproval(toolCallId, approved)` 宿主响应接口（迟到响应静默忽略）
- [x] 2.2 工具调度：需授权工具先创建 Deferred，再 yield 授权事件，随后挂起等待
- [x] 2.3 放行路径：yield `tool_execution_started` 后正常执行
- [x] 2.4 拒绝路径：跳过执行，伪造 `"System: The user explicitly denied the execution of this tool."` 结果并 yield `tool_execution_completed`
- [x] 2.5 取消传播：AbortSignal 自动解除挂起、清理回调，会话结束时清空 pendingApprovals

## 3. 测试与验证

- [x] 3.1 放行流程：授权事件 → started → completed → 会话完成
- [x] 3.2 拒绝流程：无 started、伪造结果交还 LLM、会话继续
- [x] 3.3 等待授权期间取消：`session_cancelled`、无工具结果残留、迟到响应不报错
