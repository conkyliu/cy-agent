import { describe, expect, it } from 'vitest';
import type { AgentEvent, Message } from '@cy-agent/protocol';
import { AgentSession, ToolRegistry, type ProviderContract, type ToolContract } from '../src/index.js';
import { MockProvider, textChunks, toolCallChunks } from './fixtures.js';

const echoTool: ToolContract<{ text: string }, string> = {
  name: 'echo',
  description: 'Echo the input text',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  execute: async (args) => `echo: ${args.text}`,
};

const failingTool: ToolContract = {
  name: 'boom',
  description: 'Always throws',
  parameters: { type: 'object' },
  execute: async () => {
    throw new Error('File not found');
  },
};

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function session(provider: ProviderContract, registry: ToolRegistry): AgentSession {
  return new AgentSession({ provider, registry });
}

describe('AgentSession', () => {
  it('completes with pure text and emits ordered events', async () => {
    const provider = new MockProvider([[...textChunks('Hello, '), ...textChunks('world!')]]);
    const registry = new ToolRegistry();

    const events = await drain(session(provider, registry).run('hi'));

    expect(events[0]?.type).toBe('session_started');
    const texts = events.filter((e) => e.type === 'text_chunk').map((e) => (e as { text: string }).text);
    expect(texts).toEqual(['Hello, ', 'world!']);
    const last = events[events.length - 1];
    expect(last?.type).toBe('session_completed');
    if (last?.type === 'session_completed') {
      expect(last.finalMessages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(last.finalMessages[1]?.content).toBe('Hello, world!');
    }
  });

  it('executes tool calls and loops back to the model', async () => {
    const provider = new MockProvider([
      [...textChunks('Let me check. '), ...toolCallChunks('tc1', 'echo', { text: 'ping' })],
      textChunks('Done.'),
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const events = await drain(session(provider, registry).run('use echo'));

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'session_started',
      'text_chunk',
      'tool_execution_started',
      'tool_execution_completed',
      'text_chunk',
      'session_completed',
    ]);

    const started = events.find((e) => e.type === 'tool_execution_started');
    expect(started).toMatchObject({ toolCallId: 'tc1', name: 'echo', args: { text: 'ping' } });

    const completed = events.find((e) => e.type === 'session_completed');
    if (completed?.type === 'session_completed') {
      const roles = completed.finalMessages.map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
      const toolMsg = completed.finalMessages.find((m): m is Message => m.role === 'tool');
      expect(toolMsg?.toolCallId).toBe('tc1');
      expect(toolMsg?.content).toBe('echo: ping');
    }

    // 第二轮请求必须携带工具结果。
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('converts tool errors into messages for the LLM without aborting', async () => {
    const provider = new MockProvider([
      toolCallChunks('tc1', 'boom', {}),
      textChunks('Recovered.'),
    ]);
    const registry = new ToolRegistry();
    registry.register(failingTool);

    const events = await drain(session(provider, registry).run('try boom'));

    const failed = events.find((e) => e.type === 'tool_execution_failed');
    expect(failed).toMatchObject({ toolCallId: 'tc1', error: 'Error: File not found' });
    expect(events[events.length - 1]?.type).toBe('session_completed');
  });

  it('reports unknown tools back to the LLM as errors', async () => {
    const provider = new MockProvider([
      toolCallChunks('tc1', 'ghost', {}),
      textChunks('ok'),
    ]);
    const registry = new ToolRegistry();

    const events = await drain(session(provider, registry).run('call ghost'));

    const failed = events.find((e) => e.type === 'tool_execution_failed');
    expect(failed).toMatchObject({ error: 'Error: Tool "ghost" is not registered' });
    expect(events[events.length - 1]?.type).toBe('session_completed');
  });

  it('emits session_error on provider-level failures', async () => {
    const provider: ProviderContract = {
      name: 'broken',
      async *generateStream() {
        throw new Error('Invalid API key');
      },
    };
    const registry = new ToolRegistry();

    const events = await drain(session(provider, registry).run('hi'));

    const last = events[events.length - 1];
    expect(last?.type).toBe('session_error');
    if (last?.type === 'session_error') {
      expect(last.error.message).toBe('Invalid API key');
    }
  });

  it('cancels mid-stream and marks the partial message as interrupted', async () => {
    const provider: ProviderContract = {
      name: 'slow',
      async *generateStream({ signal }) {
        yield { type: 'text', text: 'partial' };
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new Error('aborted'));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
    };
    const registry = new ToolRegistry();
    const agent = session(provider, registry);

    const drained = drain(agent.run('hi'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    agent.cancel();
    const events = await drained;

    expect(events[events.length - 1]?.type).toBe('session_cancelled');
    const partial = agent.getMessages().find((m) => m.interrupted);
    expect(partial?.content).toBe('partial');
    expect(agent.isRunning).toBe(false);
  });

  it('emits session_error when max iterations is exceeded', async () => {
    // 模型永远要求调用工具，形成死循环。
    const provider = new MockProvider([
      toolCallChunks('tc1', 'echo', { text: 'x' }),
      toolCallChunks('tc2', 'echo', { text: 'x' }),
      toolCallChunks('tc3', 'echo', { text: 'x' }),
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const agent = new AgentSession({ provider, registry, maxIterations: 2 });
    const events = await drain(agent.run('loop forever'));

    const last = events[events.length - 1];
    expect(last?.type).toBe('session_error');
    if (last?.type === 'session_error') {
      expect(last.error.message).toMatch(/max iterations/);
    }
  });

  it('rejects tool execution via policy without aborting the session', async () => {
    const provider = new MockProvider([
      toolCallChunks('tc1', 'echo', { text: 'secret' }),
      textChunks('Understood.'),
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const agent = new AgentSession({
      provider,
      registry,
      policy: { approve: (toolName) => toolName !== 'echo' },
    });
    const events = await drain(agent.run('echo it'));

    const failed = events.find((e) => e.type === 'tool_execution_failed');
    expect(failed).toMatchObject({ error: 'Error: Tool "echo" execution was rejected by policy' });
    expect(events[events.length - 1]?.type).toBe('session_completed');
  });

  it('handles invalid JSON tool arguments without aborting', async () => {
    const provider = new MockProvider([
      [
        { type: 'tool_call_start', toolCall: { id: 'tc1', name: 'echo', arguments: '' } },
        { type: 'tool_call_chunk', toolCallId: 'tc1', delta: '{not-json' },
        { type: 'tool_call_end', toolCallId: 'tc1' },
      ],
      textChunks('ok'),
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const events = await drain(session(provider, registry).run('bad args'));

    const failed = events.find((e) => e.type === 'tool_execution_failed');
    expect(failed).toMatchObject({ error: 'Error: Invalid JSON arguments for tool "echo"' });
    expect(events[events.length - 1]?.type).toBe('session_completed');
  });

  it('rejects duplicate tools and supports unregister', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(() => registry.register(echoTool)).toThrow(/already registered/);
    expect(registry.snapshot()).toHaveLength(1);
    expect(registry.unregister('echo')).toBe(true);
    expect(registry.snapshot()).toHaveLength(0);
  });

  it('rejects concurrent runs on the same session', async () => {
    const provider = new MockProvider([textChunks('a'), textChunks('b')]);
    const registry = new ToolRegistry();
    const agent = session(provider, registry);

    const gen = agent.run('first');
    await gen.next(); // session_started，此时进入运行中状态
    const second = agent.run('second');
    await expect(second.next()).rejects.toThrow(/already running/);
    await drain(gen);
  });
});

describe('AgentSession HITL 授权', () => {
  const writeFileTool: ToolContract<{ path: string }, string> = {
    name: 'write_file',
    description: 'Write a file (requires user approval)',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    requiresApproval: true,
    execute: async (args) => `wrote ${args.path}`,
  };

  /** 驱动会话：收到授权请求时自动响应。 */
  async function runWithApproval(
    agent: AgentSession,
    prompt: string,
    approve: boolean,
  ): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    const gen = agent.run(prompt);
    for (;;) {
      const result = await gen.next();
      if (result.done) {
        break;
      }
      events.push(result.value);
      if (result.value.type === 'tool_approval_requested') {
        agent.resolveApproval(result.value.toolCallId, approve);
      }
    }
    return events;
  }

  it('suspends for approval and executes after the host approves', async () => {
    const provider = new MockProvider([
      toolCallChunks('tc1', 'write_file', { path: '/tmp/a.txt' }),
      textChunks('Done.'),
    ]);
    const registry = new ToolRegistry();
    registry.register(writeFileTool);
    const agent = session(provider, registry);

    const events = await runWithApproval(agent, 'write it', true);

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'session_started',
      'tool_approval_requested',
      'tool_execution_started',
      'tool_execution_completed',
      'text_chunk',
      'session_completed',
    ]);
    expect(events[1]).toMatchObject({ name: 'write_file', args: { path: '/tmp/a.txt' } });

    const completed = events.find((e) => e.type === 'tool_execution_completed');
    expect(completed).toMatchObject({ result: 'wrote /tmp/a.txt' });
  });

  it('fabricates a denial result when the host rejects', async () => {
    const provider = new MockProvider([
      toolCallChunks('tc1', 'write_file', { path: '/tmp/a.txt' }),
      textChunks('Understood.'),
    ]);
    const registry = new ToolRegistry();
    registry.register(writeFileTool);
    const agent = session(provider, registry);

    const events = await runWithApproval(agent, 'write it', false);

    // 拒绝时不应产生 tool_execution_started，而是伪造 completed 结果。
    expect(events.some((e) => e.type === 'tool_execution_started')).toBe(false);
    const completed = events.find((e) => e.type === 'tool_execution_completed');
    expect(completed).toMatchObject({
      result: 'System: The user explicitly denied the execution of this tool.',
    });
    expect(events[events.length - 1]?.type).toBe('session_completed');

    // 拒绝结果必须交还 LLM（第二轮请求携带 tool 消息）。
    expect(provider.requests[1]?.messages.some((m) => m.role === 'tool' && m.content?.includes('denied'))).toBe(true);
  });

  it('cancels while waiting for approval without leaking the deferred', async () => {
    const provider = new MockProvider([toolCallChunks('tc1', 'write_file', { path: '/tmp/a.txt' })]);
    const registry = new ToolRegistry();
    registry.register(writeFileTool);
    const agent = session(provider, registry);

    const drained = drain(agent.run('write it'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    agent.cancel();
    const events = await drained;

    expect(events.some((e) => e.type === 'tool_approval_requested')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('session_cancelled');
    expect(agent.isRunning).toBe(false);
    // 取消后不应追加任何工具结果消息。
    expect(agent.getMessages().some((m) => m.role === 'tool')).toBe(false);
    // 迟到响应不应报错。
    expect(() => agent.resolveApproval('tc1', true)).not.toThrow();
  });

  it('restores initial messages after the system prompt for session resume', async () => {
    const provider = new MockProvider([textChunks('Continuing.')]);
    const registry = new ToolRegistry();
    const history: Message[] = [
      { id: 'h1', role: 'user', content: 'earlier question' },
      { id: 'h2', role: 'assistant', content: 'earlier answer' },
    ];

    const agent = new AgentSession({
      provider,
      registry,
      systemPrompt: 'You are cy-agent.',
      initialMessages: history,
    });
    const events = await drain(agent.run('follow up'));

    expect(events[events.length - 1]?.type).toBe('session_completed');
    // 首次模型请求必须携带 system + 历史 + 新用户消息。
    const request = provider.requests[0];
    expect(request?.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(request?.messages[1]?.content).toBe('earlier question');

    // 运行时拷贝消息：篡改历史数组不应影响会话内部状态。
    const firstHistory = history[0];
    if (firstHistory) {
      firstHistory.content = 'mutated';
    }
    expect(agent.getMessages().some((m) => m.content === 'mutated')).toBe(false);
  });

  it('trims context beyond budget and emits context_trimmed without losing internal history', async () => {
    const provider = new MockProvider([textChunks('first answer'), textChunks('second answer')]);
    const registry = new ToolRegistry();
    const agent = new AgentSession({
      provider,
      registry,
      contextBudget: { maxInputTokens: 10 },
      // 显式关闭压缩，单独验证裁剪路径。
      compaction: { enabled: false },
    });

    await drain(agent.run('hello first turn'));
    const events2 = await drain(agent.run('second turn'));

    const trimmed = events2.find((e) => e.type === 'context_trimmed');
    expect(trimmed).toMatchObject({ removedMessages: 2 });
    // 内部历史完整保留（两轮 user + assistant）。
    expect(agent.getMessages()).toHaveLength(4);
    // 第二次请求只携带裁剪后的最新消息。
    expect(provider.requests[1]?.messages.map((m) => m.content)).toEqual(['second turn']);
  });

  it('compacts old history into a summary message when the budget threshold is crossed', async () => {
    const provider = new MockProvider([
      textChunks('first answer'),
      // 第二次 run 触发的摘要请求。
      textChunks('User asked a question; assistant answered.'),
      textChunks('second answer'),
    ]);
    const registry = new ToolRegistry();
    const agent = new AgentSession({
      provider,
      registry,
      contextBudget: { maxInputTokens: 60 },
      compaction: { threshold: 0.4, keepRecentUnits: 1 },
    });

    await drain(agent.run('first question with enough words to count'));
    const events2 = await drain(agent.run('second question'));

    const compacted = events2.find((e) => e.type === 'context_compacted');
    expect(compacted).toMatchObject({ removedMessages: 2 });
    // 内部历史被原地替换：摘要 + 新 user + 新 assistant。
    const messages = agent.getMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toContain('[Context Summary]');
    // 摘要请求只携带转录本，主请求携带摘要 + 最新消息。
    expect(provider.requests[1]?.messages).toHaveLength(1);
    expect(provider.requests[1]?.messages[0]?.content).toContain('first question');
    expect(provider.requests[2]?.messages).toHaveLength(2);
    expect(provider.requests[2]?.messages[0]?.content).toContain('[Context Summary]');
    expect(provider.requests[2]?.messages[1]?.content).toBe('second question');
  });

  it('falls back to trimming when summarization fails', async () => {
    const provider = new MockProvider([
      textChunks('first answer'),
      // 摘要请求失败：generateStream 抛出 Provider 级错误。
      () => {
        throw new Error('summarization unavailable');
      },
      textChunks('second answer'),
    ]);
    const registry = new ToolRegistry();
    const agent = new AgentSession({
      provider,
      registry,
      contextBudget: { maxInputTokens: 10 },
      compaction: { keepRecentUnits: 1 },
    });

    await drain(agent.run('hello first turn'));
    const events2 = await drain(agent.run('second turn'));

    // 压缩失败不中断会话：回退到裁剪并正常完成。
    expect(events2.some((e) => e.type === 'context_compacted')).toBe(false);
    expect(events2.find((e) => e.type === 'context_trimmed')).toBeTruthy();
    expect(events2[events2.length - 1]?.type).toBe('session_completed');
    // 内部历史保持完整（压缩未生效）。
    expect(agent.getMessages()).toHaveLength(4);
  });
});
