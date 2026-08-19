import { describe, expect, it } from 'vitest';
import type { Message } from '@cy-agent/protocol';
import type { ProviderChunk, ToolBase } from '@cy-agent/agent';
import { AnthropicProvider } from '../src/index.js';

interface CapturedRequest {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function mockAnthropicFetch(events: Array<Record<string, unknown>>): {
  fetchImpl: typeof fetch;
  captured: () => CapturedRequest;
} {
  let capturedRequest: CapturedRequest | null = null;
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedRequest = {
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body)),
    };
    return new Response(text, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    captured: () => {
      if (!capturedRequest) {
        throw new Error('fetch was not called');
      }
      return capturedRequest;
    },
  };
}

async function collect(gen: AsyncGenerator<ProviderChunk>): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

const userMessage: Message = { id: 'm1', role: 'user', content: 'hi' };

const echoTool: ToolBase = {
  name: 'echo',
  description: 'Echo text',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args: { text: string }) {
    return `echo: ${args.text}`;
  },
};

describe('AnthropicProvider', () => {
  it('streams text deltas and separates system prompt cleanly', async () => {
    const { fetchImpl, captured } = mockAnthropicFetch([
      { type: 'message_start', message: { usage: { input_tokens: 15, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]);
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      model: 'claude-3-7-sonnet-20250219',
      baseUrl: 'https://api.anthropic.com/v1',
      fetchImpl,
    });

    const messages: Message[] = [
      { id: 's1', role: 'system', content: 'You are helpful' },
      userMessage,
    ];
    const chunks = await collect(provider.generateStream({ messages }));

    expect(chunks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'usage', inputTokens: 15, outputTokens: 5 },
    ]);

    const request = captured();
    expect(request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request.init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
    });
    expect(request.body.model).toBe('claude-3-7-sonnet-20250219');
    expect(request.body.system).toBe('You are helpful');
    expect(request.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  it('assembles streamed tool_use calls and converts tool messages', async () => {
    const { fetchImpl, captured } = mockAnthropicFetch([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'echo' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"te' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'xt":"hi"}' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]);
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      model: 'claude-3-5-sonnet-20241022',
      fetchImpl,
    });

    const messages: Message[] = [
      userMessage,
      {
        id: 'm2',
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'toolu_0', name: 'echo', arguments: '{"text":"prev"}' }],
      },
      { id: 'm3', role: 'tool', content: 'echo: prev', toolCallId: 'toolu_0' },
    ];
    const chunks = await collect(provider.generateStream({ messages, tools: [echoTool] }));

    expect(chunks).toEqual([
      { type: 'tool_call_start', toolCall: { id: 'toolu_1', name: 'echo', arguments: '' } },
      { type: 'tool_call_chunk', toolCallId: 'toolu_1', delta: '{"te' },
      { type: 'tool_call_chunk', toolCallId: 'toolu_1', delta: 'xt":"hi"}' },
      { type: 'tool_call_end', toolCallId: 'toolu_1' },
    ]);

    const body = captured().body;
    expect(body.tools).toEqual([
      {
        name: 'echo',
        description: 'Echo text',
        input_schema: echoTool.parameters,
      },
    ]);
    // tool message should be merged into user role message with tool_result block
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_0', name: 'echo', input: { text: 'prev' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: 'echo: prev' }],
      },
    ]);
  });

  it('throws a provider-level error on non-2xx responses', async () => {
    const fetchImpl = (async () =>
      new Response('Invalid API key', { status: 401 })) as unknown as typeof fetch;
    const provider = new AnthropicProvider({
      apiKey: 'bad',
      model: 'claude-3-7-sonnet',
      fetchImpl,
    });

    await expect(collect(provider.generateStream({ messages: [userMessage] }))).rejects.toThrow(
      /401.*Invalid API key/,
    );
  });

  it('propagates abort signal to fetch', async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new Error('aborted');
      }
      throw new Error('should not reach here');
    }) as unknown as typeof fetch;
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      model: 'claude-3-7-sonnet',
      fetchImpl,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(provider.generateStream({ messages: [userMessage], signal: controller.signal })),
    ).rejects.toThrow(/aborted/);
  });
});
