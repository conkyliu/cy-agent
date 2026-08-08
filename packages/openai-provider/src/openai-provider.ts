import type { GenerateOptions, ProviderChunk, ProviderContract } from '@cy-agent/agent';
import { toOpenAIMessages, toOpenAITools } from './messages.js';

export interface OpenAICompatOptions {
  apiKey: string;
  model: string;
  /** 默认 https://api.openai.com/v1，可指向任何 OpenAI 兼容端点 */
  baseUrl?: string;
  temperature?: number;
  /** 可注入的 fetch 实现，便于测试 */
  fetchImpl?: typeof fetch;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  started: boolean;
  ended: boolean;
}

/** SSE 流中 tool_calls 增量的最小结构（外部 JSON，字段均可能缺失）。 */
interface SseToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** Chat Completions SSE chunk 的最小结构。 */
interface SseChunkPayload {
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  choices?: Array<{
    delta?: { content?: unknown; tool_calls?: SseToolCallDelta[] };
    finish_reason?: string;
  }>;
}

/**
 * OpenAI 兼容流式提供商。
 *
 * 负责将 Chat Completions 的 SSE 原始流转换为标准 ProviderChunk：
 * - delta.content -> text
 * - delta.tool_calls 增量 -> tool_call_start / tool_call_chunk / tool_call_end
 * 非 2xx 响应抛出 Provider 级错误（由 AgentSession 转为 session_error）；
 * AbortSignal 透传给 fetch，取消时中止网络请求。
 */
export class OpenAICompatProvider implements ProviderContract {
  readonly name = 'openai-compat';

  constructor(private readonly options: OpenAICompatOptions) {}

  async *generateStream(options: GenerateOptions): AsyncGenerator<ProviderChunk, void, unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const baseUrl = (this.options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: toOpenAIMessages(options.messages),
      stream: true,
      // 请求在流末尾追加 usage 统计 chunk（不支持的兼容端点会静默忽略）。
      stream_options: { include_usage: true },
    };
    if (this.options.temperature !== undefined) {
      body.temperature = this.options.temperature;
    }
    const tools = options.tools ?? [];
    if (tools.length > 0) {
      body.tools = toOpenAITools(tools);
    }

    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(body),
    };
    if (options.signal !== undefined) {
      requestInit.signal = options.signal;
    }

    const response = await fetchImpl(`${baseUrl}/chat/completions`, requestInit);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible API error ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (!response.body) {
      throw new Error('OpenAI-compatible API returned an empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const accumulators = new Map<number, ToolCallAccumulator>();
    let buffer = '';
    let finished = false;

    try {
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');

          if (!line.startsWith('data:')) {
            continue; // 跳过 SSE 注释与空行
          }
          const data = line.slice('data:'.length).trim();
          if (data === '[DONE]') {
            finished = true;
            break;
          }

          let payload: SseChunkPayload;
          try {
            payload = JSON.parse(data) as SseChunkPayload;
          } catch {
            continue; // 容忍单行损坏的 JSON
          }

          // include_usage 时末尾会出现 choices 为空、仅带 usage 的统计 chunk。
          const usage = payload.usage;
          if (
            usage &&
            typeof usage.prompt_tokens === 'number' &&
            typeof usage.completion_tokens === 'number'
          ) {
            yield {
              type: 'usage',
              inputTokens: usage.prompt_tokens,
              outputTokens: usage.completion_tokens,
            };
          }

          const choice = payload.choices?.[0];
          const delta = choice?.delta;

          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            yield { type: 'text', text: delta.content };
          }

          if (Array.isArray(delta?.tool_calls)) {
            for (const toolCallDelta of delta.tool_calls) {
              yield* this.applyToolCallDelta(accumulators, toolCallDelta);
            }
          }

          if (choice?.finish_reason === 'tool_calls') {
            finished = true;
            break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 流结束兜底：为所有已开始但未结束的工具调用补发 tool_call_end。
    for (const entry of accumulators.values()) {
      if (entry.started && !entry.ended) {
        entry.ended = true;
        yield { type: 'tool_call_end', toolCallId: entry.id };
      }
    }
  }

  private *applyToolCallDelta(
    accumulators: Map<number, ToolCallAccumulator>,
    delta: SseToolCallDelta,
  ): Generator<ProviderChunk, void, unknown> {
    const index = typeof delta?.index === 'number' ? delta.index : 0;
    let entry = accumulators.get(index);
    if (!entry) {
      entry = { id: '', name: '', started: false, ended: false };
      accumulators.set(index, entry);
    }

    if (typeof delta.id === 'string' && delta.id.length > 0) {
      entry.id = delta.id;
    }
    const fn = delta.function;
    if (fn && typeof fn.name === 'string' && fn.name.length > 0) {
      entry.name = fn.name;
    }

    // 收到名称后才视为开始，保证 tool_call_start 携带完整元信息。
    if (!entry.started && entry.name.length > 0) {
      entry.started = true;
      if (entry.id.length === 0) {
        entry.id = `call_${index}`;
      }
      yield {
        type: 'tool_call_start',
        toolCall: { id: entry.id, name: entry.name, arguments: '' },
      };
    }

    if (entry.started && fn && typeof fn.arguments === 'string' && fn.arguments.length > 0) {
      yield { type: 'tool_call_chunk', toolCallId: entry.id, delta: fn.arguments };
    }
  }
}
