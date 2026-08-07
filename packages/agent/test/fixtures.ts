import type { ProviderChunk } from '../src/index.js';
import type { GenerateOptions, ProviderContract } from '../src/index.js';

export type Turn = ProviderChunk[] | ((options: GenerateOptions) => ProviderChunk[]);

/** 脚本化的测试用 Provider：每次 generateStream 消费一轮预设的 chunk 序列。 */
export class MockProvider implements ProviderContract {
  name = 'mock';
  readonly requests: GenerateOptions[] = [];

  constructor(private readonly turns: Turn[]) {}

  async *generateStream(options: GenerateOptions): AsyncGenerator<ProviderChunk, void, unknown> {
    this.requests.push(options);
    const turn = this.turns[this.requests.length - 1];
    if (!turn) {
      throw new Error('No more scripted turns');
    }
    const chunks = typeof turn === 'function' ? turn(options) : turn;
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}

export function textChunks(...parts: string[]): ProviderChunk[] {
  return parts.map((text) => ({ type: 'text', text }));
}

export function toolCallChunks(id: string, name: string, args: unknown): ProviderChunk[] {
  const json = JSON.stringify(args);
  return [
    { type: 'tool_call_start', toolCall: { id, name, arguments: '' } },
    { type: 'tool_call_chunk', toolCallId: id, delta: json.slice(0, Math.ceil(json.length / 2)) },
    { type: 'tool_call_chunk', toolCallId: id, delta: json.slice(Math.ceil(json.length / 2)) },
    { type: 'tool_call_end', toolCallId: id },
  ];
}
