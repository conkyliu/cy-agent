import type { GenerateOptions, ProviderChunk, ProviderContract } from '@cy-agent/agent';
import { toGeminiContents, toGeminiTools } from './messages.js';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** 默认 https://generativelanguage.googleapis.com/v1beta，可指向任何代理/兼容端点 */
  baseUrl?: string;
  temperature?: number;
  /** 可注入的 fetch 实现，便于测试 */
  fetchImpl?: typeof fetch;
}

interface GeminiCandidatePart {
  text?: string;
  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
  };
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiCandidatePart[];
    role?: string;
  };
  finishReason?: string;
}

interface GeminiSsePayload {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

/**
 * Google Gemini 原生流式提供商。
 *
 * 负责将 Gemini streamGenerateContent 的 SSE 原始流转换为标准 ProviderChunk：
 * - parts.text -> text
 * - parts.functionCall -> tool_call_start / tool_call_chunk / tool_call_end
 * - usageMetadata -> usage (inputTokens / outputTokens)
 */
export class GeminiProvider implements ProviderContract {
  readonly name = 'gemini';

  constructor(private readonly options: GeminiOptions) {}

  async *generateStream(options: GenerateOptions): AsyncGenerator<ProviderChunk, void, unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const baseUrl = (
      this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
    ).replace(/\/+$/, '');

    const { systemInstruction, contents } = toGeminiContents(options.messages);

    const body: Record<string, unknown> = {
      contents,
    };
    if (systemInstruction !== undefined) {
      body.systemInstruction = systemInstruction;
    }
    if (this.options.temperature !== undefined) {
      body.generationConfig = { temperature: this.options.temperature };
    }
    const tools = options.tools ?? [];
    if (tools.length > 0) {
      body.tools = toGeminiTools(tools);
    }

    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.options.apiKey,
      },
      body: JSON.stringify(body),
    };
    if (options.signal !== undefined) {
      requestInit.signal = options.signal;
    }

    const modelName = this.options.model.startsWith('models/')
      ? this.options.model
      : `models/${this.options.model}`;
    const targetUrl = `${baseUrl}/${modelName}:streamGenerateContent?alt=sse`;

    const response = await fetchImpl(targetUrl, requestInit);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (!response.body) {
      throw new Error('Gemini API returned an empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    let callCounter = 0;

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
            continue; // 跳过 SSE 注释或空行
          }
          const data = line.slice('data:'.length).trim();
          if (data === '[DONE]') {
            finished = true;
            break;
          }

          let payload: GeminiSsePayload;
          try {
            payload = JSON.parse(data) as GeminiSsePayload;
          } catch {
            continue; // 容忍损坏行
          }

          if (payload.error) {
            throw new Error(
              `Gemini stream error: ${payload.error.message ?? JSON.stringify(payload.error)}`,
            );
          }

          if (payload.usageMetadata) {
            hasUsage = true;
            inputTokens = payload.usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens = payload.usageMetadata.candidatesTokenCount ?? outputTokens;
          }

          const candidates = payload.candidates ?? [];
          for (const candidate of candidates) {
            const parts = candidate.content?.parts ?? [];
            for (const part of parts) {
              if (typeof part.text === 'string' && part.text.length > 0) {
                yield { type: 'text', text: part.text };
              }

              if (part.functionCall) {
                callCounter += 1;
                const toolCallId = `call_gemini_${Date.now()}_${callCounter}`;
                const argsString = JSON.stringify(part.functionCall.args ?? {});

                yield {
                  type: 'tool_call_start',
                  toolCall: {
                    id: toolCallId,
                    name: part.functionCall.name,
                    arguments: '',
                  },
                };
                yield {
                  type: 'tool_call_chunk',
                  toolCallId,
                  delta: argsString,
                };
                yield {
                  type: 'tool_call_end',
                  toolCallId,
                };
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
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
