# Change: add-openai-provider

## Why

`bootstrap-agent-runtime` 只定义了 `ProviderContract`，仓库中尚无真实模型提供商，
CLI 与端到端联调无法进行。需要一个通用的 OpenAI 兼容流式提供商
（覆盖 OpenAI 及各类兼容端点），作为 Phase 2 CLI 的前置能力。

## What Changes

- 新增 `packages/openai-provider`（`@cy-agent/openai-provider`）：
  - `OpenAICompatProvider`：实现 `ProviderContract.generateStream`。
    - 请求：Chat Completions（`stream: true`），透传 `AbortSignal` 至 fetch，非 2xx 抛 Provider 级错误。
    - SSE 解析：逐行读取 `data:` 帧，容忍注释行与损坏 JSON，识别 `[DONE]`。
    - 转换：`delta.content` → `text` chunk；`delta.tool_calls` 增量按 index 累积 →
      `tool_call_start`（收到名称后发出）/ `tool_call_chunk` / `tool_call_end`（finish_reason 或流结束兜底）。
  - `toOpenAIMessages` / `toOpenAITools`：统一协议 ↔ OpenAI 线上格式转换
    （assistant 工具调用、tool 结果消息、function-calling 工具定义）。
  - 可注入 `fetchImpl`，全部行为可通过假 fetch 离线测试。

## Impact

- Affected specs: `model-provider`（新增 OpenAI 兼容实现要求）
- Affected code: 新增 `packages/openai-provider/**`、vitest 别名
- 依赖：`@cy-agent/agent`（契约类型）、`@cy-agent/protocol`（Message）；零第三方运行时依赖（原生 fetch）
