import type { Message, ToolCall } from '@cy-agent/protocol';
import type { ToolBase } from './tool.js';

export interface GenerateOptions {
  messages: Message[];
  tools?: ToolBase[];
  /** 用于 Session 取消 */
  signal?: AbortSignal;
}

/**
 * Provider 需要在内部将大模型的原始 Stream 转换为标准 ProviderChunk 抛出。
 */
export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_chunk'; toolCallId: string; delta: string }
  | { type: 'tool_call_end'; toolCallId: string };

/**
 * 模型提供商契约：任何接入的模型（OpenAI / Anthropic / Gemini 等）必须实现此接口。
 */
export interface ProviderContract {
  name: string;
  generateStream(options: GenerateOptions): AsyncGenerator<ProviderChunk, void, unknown>;
}
