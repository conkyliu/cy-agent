# Tasks: add-token-budget

## 1. 协议

- [x] 1.1 `AgentEvent` 新增 `context_trimmed`（removedMessages / estimatedTokens）

## 2. 预算模块

- [x] 2.1 `estimateTokens`：零依赖启发式（英文 4 字符/token、CJK 2 字符/token）
- [x] 2.2 `estimateMessageTokens` / `estimateMessagesTokens`：含 toolCalls 参数与每消息开销
- [x] 2.3 `buildUnits`：assistant(toolCalls) + tool 结果成组；system 单元受保护
- [x] 2.4 `trimToBudget`：从最旧单元整组移除，system 与最新单元永不裁剪

## 3. 会话集成

- [x] 3.1 `contextBudget.maxInputTokens` 选项（默认 128000）
- [x] 3.2 请求模型前裁剪发送副本，内部历史不变；裁剪时 yield `context_trimmed`

## 4. CLI

- [x] 4.1 渲染器补 `context_trimmed` 分支（never 穷尽检查通过）

## 5. 测试与验证

- [x] 5.1 budget 单测：估算/单元分组/裁剪顺序/工具组完整性/极端预算（8 个）
- [x] 5.2 session 集成：裁剪事件 + 内部历史完整 + Provider 收到裁剪副本
- [x] 5.3 renderer 断言；全量 build/typecheck/test 通过（63 个测试）
