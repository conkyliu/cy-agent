# Tasks: add-output-truncation

## 1. 截断模块

- [x] 1.1 `truncateToolOutput`：头部 60% + 尾部 40% 保留，中间截断标记
- [x] 1.2 标记计入长度，结果永不超限；上限极小硬切兜底
- [x] 1.3 `DEFAULT_MAX_TOOL_OUTPUT_CHARS = 32_000`

## 2. 会话集成

- [x] 2.1 `maxToolOutputChars` 选项（默认 32000）
- [x] 2.2 工具成功结果统一截断：事件流与历史消息使用同一结果
- [x] 2.3 非字符串结果先 JSON.stringify 再截断
- [x] 2.4 错误/拒绝路径不受影响

## 3. 测试与验证

- [x] 3.1 output 单测：原样返回/边界相等/头尾保留/永不超限/硬切兜底/非正上限（6 个）
- [x] 3.2 session 集成：大输出工具被截断（事件与历史一致、头尾保留）
- [x] 3.3 `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` 全绿（85 个测试）
