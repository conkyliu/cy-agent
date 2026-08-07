# Tasks: add-openai-provider

## 1. 包与工程

- [x] 1.1 新建 `packages/openai-provider`，接入 workspace 构建与 vitest 别名

## 2. 协议转换

- [x] 2.1 `toOpenAIMessages`：user/system/assistant/tool 消息与 toolCalls 的线上格式转换
- [x] 2.2 `toOpenAITools`：`ToolBase` 快照 → function-calling 工具定义

## 3. 流式提供商

- [x] 3.1 Chat Completions 流式请求（鉴权头、`stream: true`、AbortSignal 条件透传）
- [x] 3.2 SSE 逐行解析：跳过注释/空行、容忍损坏 JSON、识别 `[DONE]`
- [x] 3.3 文本增量 → `text` chunk
- [x] 3.4 工具调用增量按 index 累积 → start/chunk/end，流结束兜底补发 end
- [x] 3.5 非 2xx 响应抛出携带状态码与响应片段的 Provider 级错误

## 4. 测试与验证

- [x] 4.1 文本流 + 请求体/URL/鉴权头断言
- [x] 4.2 工具调用组装 + 消息与工具线上格式断言
- [x] 4.3 HTTP 错误、AbortSignal 传播、损坏 SSE 容错测试
