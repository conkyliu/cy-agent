# Change: add-output-truncation

## Why

工具输出是上下文爆炸的主要来源之一：`read_file` 整读大文件、shell 命令倾泻
海量日志时，单条结果即可吞掉大量预算，加速触发裁剪/压缩甚至请求超限。
shell 工具内部虽有 100KB 截断，但其他工具与未来扩展的工具缺乏统一防线。
需要在结果进入上下文历史的必经之路上建立**统一截断层**。

## What Changes

- `packages/agent` 新增 `context/output.ts`：
  - `truncateToolOutput(text, maxChars)`：超长输出保留**头部 60% + 尾部 40%**
    （尾部常含错误信息），中间插入 `...[output truncated: N characters omitted]...`
    标记；标记计入最终长度，保证结果永不超限；上限极小时硬切兜底。
  - `DEFAULT_MAX_TOOL_OUTPUT_CHARS = 32_000`（约 8k token）。
- `AgentSession`：新增 `maxToolOutputChars` 选项（默认 32000）。工具成功结果
  在 `tool_execution_completed` 事件与历史消息中使用**同一截断结果**，
  宿主所见与模型所见一致；错误/拒绝路径不受影响（本身短小）。
- 非字符串结果先 JSON.stringify 再截断。

## Impact

- Affected specs: `agent-session`（输出截断需求）
- Affected code: agent/context/output.ts、agent/session.ts、agent/index.ts
- 行为变化：超过默认上限的工具输出将被截断；shell 工具的 100KB 上限仍生效，
  会话层统一收紧到 32000 字符。
