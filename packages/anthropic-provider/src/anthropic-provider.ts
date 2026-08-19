import type { GenerateOptions, ProviderChunk, ProviderContract } from '@cy-agent/agent';
import { toAnthropicMessages, toAnthropicTools } from './messages.js';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** 默认 https://api.anthropic.com/v1，可指向任何 Anthropic 代理/兼容端点 */
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  /** 可注入的 fetch 实现，便于测试 */
  fetchImpl?: typeof fetch;
}

interface BlockAccumulator {
  index: number;
  id: string;
  name: string;
  isToolUse: boolean;
  started: boolean;
  ended: boolean;
}

interface AnthropicEventPayload {
  type: string;
  index?: number;
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: {
    output_tokens?: number;
  };
}

/**
 * Anthropic Claude 原生流式提供商。
 *
 * 负责将 Anthropic Messages API 的 SSE 原始流转换为标准 ProviderChunk：
 * - text_delta -> text
 * - tool_use 块 -> tool_call_start / tool_call_chunk / tool_call_end
 * - message_start / message_delta -> usage (inputTokens / outputTokens)
 */
export class AnthropicProvider implements ProviderContract {
  readonly name = 'anthropic';

  constructor(private readonly options: AnthropicOptions) {}

  async *generateStream(options: GenerateOptions): AsyncGenerator<ProviderChunk, void, unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const baseUrl = (this.options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');

    const { system, messages } = toAnthropicMessages(options.messages);

    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens ?? 4096,
      messages,
      stream: true,
    };
    if (system !== undefined && system.length > 0) {
      body.system = system;
    }
    if (this.options.temperature !== undefined) {
      body.temperature = this.options.temperature;
    }
    const tools = options.tools ?? [];
    if (tools.length > 0) {
      body.tools = toAnthropicTools(tools);
    }

    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };
    if (options.signal !== undefined) {
      requestInit.signal = options.signal;
    }

    const targetUrl = baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`;
    const response = await fetchImpl(targetUrl, requestInit);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (!response.body) {
      throw new Error('Anthropic API returned an empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const blocks = new Map<number, BlockAccumulator>();
    let buffer = '';
    let finished = false;

    let inputTokens = 0;
    let outputTokens = 0;
    let hasUsage = false;

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
            continue; // 跳过 SSE 事件名、注释或空行
          }
          const data = line.slice('data:'.length).trim();
          if (data === '[DONE]') {
            finished = true;
            break;
          }

          let payload: AnthropicEventPayload;
          try {
            payload = JSON.parse(data) as AnthropicEventPayload;
          } catch {
            continue; // 容忍单行损坏的 JSON
          }

          if (payload.type === 'message_start' && payload.message?.usage) {
            hasUsage = true;
            inputTokens = payload.message.usage.input_tokens ?? 0;
            outputTokens = payload.message.usage.output_tokens ?? 0;
          }

          if (payload.type === 'message_delta' && payload.usage?.output_tokens) {
            hasUsage = true;
            outputTokens = payload.usage.output_tokens;
          }

          if (payload.type === 'content_block_start' && typeof payload.index === 'number') {
            const index = payload.index;
            const cb = payload.content_block;
            const isToolUse = cb?.type === 'tool_use';
            const entry: BlockAccumulator = {
              index,
              id: cb?.id ?? `call_${index}`,
              name: cb?.name ?? '',
              isToolUse,
              started: isToolUse,
              ended: false,
            };
            blocks.set(index, entry);

            if (isToolUse) {
              yield {
                type: 'tool_call_start',
                toolCall: {
                  id: entry.id,
                  name: entry.name,
                  arguments: '',
                },
              };
            }
          }

          if (payload.type === 'content_block_delta' && typeof payload.index === 'number') {
            const index = payload.index;
            const delta = payload.delta;

            if (
              delta?.type === 'text_delta' &&
              typeof delta.text === 'string' &&
              delta.text.length > 0
            ) {
              yield { type: 'text', text: delta.text };
            }

            if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const entry = blocks.get(index);
              const toolCallId = entry?.id ?? `call_${index}`;
              yield {
                type: 'tool_call_chunk',
                toolCallId,
                delta: delta.partial_json,
              };
            }
          }

          if (payload.type === 'content_block_stop' && typeof payload.index === 'number') {
            const index = payload.index;
            const entry = blocks.get(index);
            if (entry && entry.isToolUse && !entry.ended) {
              entry.ended = true;
              yield { type: 'tool_call_end', toolCallId: entry.id };
            }
          }

          if (payload.type === 'message_stop') {
            finished = true;
            break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 兜底补发 tool_call_end
    for (const entry of blocks.values()) {
      if (entry.isToolUse && entry.started && !entry.ended) {
        entry.ended = true;
        yield { type: 'tool_call_end', toolCallId: entry.id };
      }
    }

    if (hasUsage) {
      yield {
        type: 'usage',
        inputTokens,
        outputTokens,
      };
    }
  }
}
