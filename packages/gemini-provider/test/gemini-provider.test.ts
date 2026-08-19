import { describe, expect, it } from 'vitest';
import type { Message } from '@cy-agent/protocol';
import type { ProviderChunk, ToolBase } from '@cy-agent/agent';
import { GeminiProvider } from '../src/index.js';

interface CapturedRequest {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function mockGeminiFetch(events: Array<Record<string, unknown>>): {
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

describe('GeminiProvider', () => {
  it('streams text and extracts systemInstruction and usageMetadata', async () => {
    const { fetchImpl, captured } = mockGeminiFetch([
      {
        candidates: [{ content: { parts: [{ text: 'Hello' }], role: 'model' } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 1, totalTokenCount: 9 },
      },
      {
        candidates: [{ content: { parts: [{ text: ' world!' }], role: 'model' } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
      },
    ]);
    const provider = new GeminiProvider({
      apiKey: 'gemini-key-test',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      fetchImpl,
    });

    const messages: Message[] = [
      { id: 's1', role: 'system', content: 'Act as assistant' },
      userMessage,
    ];
    const chunks = await collect(provider.generateStream({ messages }));

    expect(chunks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world!' },
      { type: 'usage', inputTokens: 8, outputTokens: 3 },
    ]);

    const request = captured();
    expect(request.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse',
    );
    expect(request.init.headers).toMatchObject({
      'x-goog-api-key': 'gemini-key-test',
    });
    expect(request.body.systemInstruction).toEqual({
      parts: [{ text: 'Act as assistant' }],
    });
    expect(request.body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('handles function call candidates and formats tools', async () => {
    const { fetchImpl, captured } = mockGeminiFetch([
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'echo', args: { text: 'hello' } } }],
              role: 'model',
            },
          },
        ],
      },
    ]);
    const provider = new GeminiProvider({
      apiKey: 'gemini-key-test',
      model: 'models/gemini-1.5-pro',
      fetchImpl,
    });

    const messages: Message[] = [
      userMessage,
      {
        id: 'm2',
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'call_prev', name: 'echo', arguments: '{"text":"prev"}' }],
      },
      { id: 'm3', role: 'tool', content: 'echo: prev', toolCallId: 'call_prev' },
    ];

    const chunks = await collect(provider.generateStream({ messages, tools: [echoTool] }));

    expect(chunks.length).toBe(3);
    expect(chunks[0]?.type).toBe('tool_call_start');
    expect(chunks[0] && 'toolCall' in chunks[0] ? chunks[0].toolCall.name : '').toBe('echo');
    expect(chunks[1]?.type).toBe('tool_call_chunk');
    expect(chunks[1] && 'delta' in chunks[1] ? chunks[1].delta : '').toBe('{"text":"hello"}');
    expect(chunks[2]?.type).toBe('tool_call_end');

    const body = captured().body;
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          { name: 'echo', description: 'Echo text', parameters: echoTool.parameters },
        ],
      },
    ]);
    // check tool response converted to user functionResponse
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      {
        role: 'model',
        parts: [{ functionCall: { name: 'echo', args: { text: 'prev' } } }],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'echo', response: { output: 'echo: prev' } } }],
      },
    ]);
  });

  it('throws a provider-level error on non-2xx responses', async () => {
    const fetchImpl = (async () =>
      new Response('API key invalid', { status: 400 })) as unknown as typeof fetch;
    const provider = new GeminiProvider({
      apiKey: 'bad',
      model: 'gemini-2.0-flash',
      fetchImpl,
    });

    await expect(collect(provider.generateStream({ messages: [userMessage] }))).rejects.toThrow(
      /400.*API key invalid/,
    );
  });
});
