import { describe, expect, it } from 'vitest';
import type { Message } from '@cy-agent/protocol';
import type { ProviderChunk, ToolBase } from '@cy-agent/agent';
import { OpenAICompatProvider } from '@cy-agent/openai-provider';

interface CapturedRequest {
  url: string;
  init: RequestInit;
  body: Record<string, any>;
}

/** 构造返回 SSE 流的假 fetch，并捕获请求。 */
function mockFetch(events: Array<Record<string, unknown>>): {
  fetchImpl: typeof fetch;
  captured: () => CapturedRequest;
} {
  let capturedRequest: CapturedRequest | null = null;
  const text =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';

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
  async execute(args: any) {
    return `echo: ${args.text}`;
  },
};

describe('OpenAICompatProvider', () => {
  it('streams text deltas and sends a well-formed request', async () => {
    const { fetchImpl, captured } = mockFetch([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' } }] },
    ]);
    const provider = new OpenAICompatProvider({
      apiKey: 'sk-test',
      model: 'gpt-test',
      baseUrl: 'https://example.com/v1/',
      fetchImpl,
    });

    const chunks = await collect(provider.generateStream({ messages: [userMessage] }));

    expect(chunks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ]);

    const request = captured();
    expect(request.url).toBe('https://example.com/v1/chat/completions');
    expect(request.init.headers).toMatchObject({ authorization: 'Bearer sk-test' });
    expect(request.body.model).toBe('gpt-test');
    expect(request.body.stream).toBe(true);
    expect(request.body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(request.body.tools).toBeUndefined();
  });

  it('assembles streamed tool calls and converts messages/tools to wire format', async () => {
    const { fetchImpl, captured } = mockFetch([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'echo', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"te' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'xt":"hi"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const provider = new OpenAICompatProvider({ apiKey: 'sk-test', model: 'gpt-test', fetchImpl });

    const messages: Message[] = [
      userMessage,
      {
        id: 'm2',
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'call_0', name: 'echo', arguments: '{"text":"prev"}' }],
      },
      { id: 'm3', role: 'tool', content: 'echo: prev', toolCallId: 'call_0' },
    ];
    const chunks = await collect(provider.generateStream({ messages, tools: [echoTool] }));

    expect(chunks).toEqual([
      { type: 'tool_call_start', toolCall: { id: 'call_1', name: 'echo', arguments: '' } },
      { type: 'tool_call_chunk', toolCallId: 'call_1', delta: '{"te' },
      { type: 'tool_call_chunk', toolCallId: 'call_1', delta: 'xt":"hi"}' },
      { type: 'tool_call_end', toolCallId: 'call_1' },
    ]);

    const body = captured().body;
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'echo', description: 'Echo text', parameters: echoTool.parameters } },
    ]);
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'echo', arguments: '{"text":"prev"}' } }],
    });
    expect(body.messages[2]).toEqual({ role: 'tool', content: 'echo: prev', tool_call_id: 'call_0' });
  });

  it('throws a provider-level error on non-2xx responses', async () => {
    const fetchImpl = (async () =>
      new Response('Invalid API key', { status: 401 })) as unknown as typeof fetch;
    const provider = new OpenAICompatProvider({ apiKey: 'bad', model: 'gpt-test', fetchImpl });

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
    const provider = new OpenAICompatProvider({ apiKey: 'sk-test', model: 'gpt-test', fetchImpl });

    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(provider.generateStream({ messages: [userMessage], signal: controller.signal })),
    ).rejects.toThrow(/aborted/);
  });

  it('tolerates malformed SSE lines', async () => {
    const fetchImpl = (async () => {
      const text =
        ': comment line\n\n' +
        'data: {broken json\n\n' +
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
        'data: [DONE]\n\n';
      return new Response(text, { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new OpenAICompatProvider({ apiKey: 'sk-test', model: 'gpt-test', fetchImpl });

    const chunks = await collect(provider.generateStream({ messages: [userMessage] }));
    expect(chunks).toEqual([{ type: 'text', text: 'ok' }]);
  });
});
