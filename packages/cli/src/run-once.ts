import process from 'node:process';
import type { AgentSession } from '@cy-agent/agent';
import type { AgentEvent, Message } from '@cy-agent/protocol';
import { renderEvent } from './renderer.js';

/**
 * 非交互单次执行：驱动一次 session.run()，消费完事件流即返回。
 *
 * - text 模式：text_chunk 流式写 stdout（管道友好），工具/进度事件写 stderr。
 * - json 模式：结束时向 stdout 输出单个 JSON 对象，stdout 不含其他内容。
 * - 授权：非交互不提问，收到授权事件立即 resolveApproval
 *   （autoApprove 放行，默认拒绝，CI 安全默认）。
 * - SIGINT：取消当前执行，状态置为 cancelled。
 */

export interface RunOnceOptions {
  session: AgentSession;
  prompt: string;
  /** 标准输出：text 模式流式模型文本，json 模式输出结构化结果。默认 process.stdout。 */
  output?: NodeJS.WritableStream;
  /** 标准错误：text 模式下渲染工具等进度事件。默认 process.stderr。 */
  errorOutput?: NodeJS.WritableStream;
  /** 输出单个 JSON 对象而非流式文本，默认 false。 */
  json?: boolean;
  /** 自动批准需授权的工具调用；默认 false（拒绝）。 */
  autoApprove?: boolean;
  /** 进度事件是否输出 ANSI 颜色，默认 false。 */
  color?: boolean;
}

/** 单次执行中的一次工具调用摘要。 */
export interface ToolCallSummary {
  name: string;
  args: unknown;
  /** completed 正常完成；failed 执行抛错；denied 未获授权被拒绝。 */
  status: 'completed' | 'failed' | 'denied';
}

export interface RunOnceResult {
  sessionId: string;
  /** completed 正常完成；error 会话错误；cancelled 被取消（SIGINT）。 */
  status: 'completed' | 'error' | 'cancelled';
  /** 模型最终回复文本。 */
  result: string;
  toolCalls: ToolCallSummary[];
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

/** session 伪造的工具拒绝结果标记，用于识别 denied 状态。 */
const DENIED_MARKER = 'explicitly denied';

export async function runOnce(options: RunOnceOptions): Promise<RunOnceResult> {
  const out = options.output ?? process.stdout;
  const err = options.errorOutput ?? process.stderr;
  const json = options.json ?? false;
  const autoApprove = options.autoApprove ?? false;
  const color = options.color ?? false;

  const result: RunOnceResult = {
    sessionId: options.session.id,
    status: 'error',
    result: '',
    toolCalls: [],
  };
  // toolCallId -> 进行中的工具摘要，completed/failed 后定稿移入 result.toolCalls。
  const pendingTools = new Map<string, ToolCallSummary>();
  let streamedText = false;
  let finalMessages: Message[] | undefined;

  // 进度事件写 stderr；json 模式保持 stdout 纯净，全部静默。
  const progress = (event: AgentEvent, suffix?: string): void => {
    if (json) {
      return;
    }
    const rendered = renderEvent(event, { color });
    if (rendered === null) {
      return;
    }
    if (suffix !== undefined && rendered.endsWith('\n')) {
      err.write(`${rendered.slice(0, -1)} ${suffix}\n`);
      return;
    }
    err.write(rendered);
  };

  const finishTool = (toolCallId: string, status: ToolCallSummary['status']): void => {
    const summary = pendingTools.get(toolCallId);
    if (summary === undefined) {
      return;
    }
    summary.status = status;
    result.toolCalls.push(summary);
    pendingTools.delete(toolCallId);
  };

  // SIGINT：取消执行而非直接杀死进程，保证会话状态正确落盘。
  const onSigint = (): void => {
    options.session.cancel();
  };
  process.on('SIGINT', onSigint);
  try {
    for await (const event of options.session.run(options.prompt)) {
      switch (event.type) {
        case 'session_started':
          result.sessionId = event.sessionId;
          break;
        case 'text_chunk':
          if (!json) {
            streamedText = true;
            out.write(event.text);
          }
          break;
        case 'tool_approval_requested':
          pendingTools.set(event.toolCallId, {
            name: event.name,
            args: event.args,
            status: 'completed',
          });
          // 非交互不提问：立即响应，--yes 放行，默认拒绝。
          options.session.resolveApproval(event.toolCallId, autoApprove);
          progress(event, autoApprove ? '(auto-approved)' : '(denied: non-interactive)');
          break;
        case 'tool_execution_started':
          pendingTools.set(event.toolCallId, {
            name: event.name,
            args: event.args,
            status: 'completed',
          });
          progress(event);
          break;
        case 'tool_execution_completed':
          if (typeof event.result === 'string' && event.result.includes(DENIED_MARKER)) {
            finishTool(event.toolCallId, 'denied');
          } else {
            finishTool(event.toolCallId, 'completed');
          }
          progress(event);
          break;
        case 'tool_execution_failed':
          finishTool(event.toolCallId, 'failed');
          progress(event);
          break;
        case 'session_completed':
          result.status = 'completed';
          finalMessages = event.finalMessages;
          break;
        case 'usage_reported':
          result.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          progress(event);
          break;
        case 'session_cancelled':
          result.status = 'cancelled';
          progress(event);
          break;
        case 'session_error':
          result.status = 'error';
          result.error = event.error.message;
          progress(event);
          break;
        default: {
          // context_trimmed / context_compacted；穷尽检查由 renderEvent 保证。
          progress(event);
        }
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  // 最终回复取完成消息里最后一条 assistant 文本消息。
  if (result.status === 'completed' && finalMessages !== undefined) {
    const lastAssistant = [...finalMessages]
      .reverse()
      .find((message) => message.role === 'assistant' && typeof message.content === 'string');
    if (lastAssistant !== undefined && typeof lastAssistant.content === 'string') {
      result.result = lastAssistant.content;
    }
  }

  if (json) {
    out.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (streamedText) {
    out.write('\n');
  }
  return result;
}

/** 读取全部 stdin 作为提示词（`-p -` 或管道输入），返回去除首尾空白的文本。 */
export async function readStdinPrompt(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}
