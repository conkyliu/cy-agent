import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ProviderContract, type ProviderChunk } from '@cy-agent/agent';
import type { Message } from '@cy-agent/protocol';
import type { SessionStore, SessionSummary, StoredSession } from '@cy-agent/storage';
import { SessionManager } from '../main/session-manager';
import type { IpcAgentEvent } from '../shared/ipc';

/** 内存存档存储。 */
class MemoryStore implements SessionStore {
  readonly sessions = new Map<string, StoredSession>();

  async save(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async load(id: string): Promise<StoredSession | null> {
    return this.sessions.get(id) ?? null;
  }
  async list(): Promise<SessionSummary[]> {
    return [...this.sessions.values()].map((session) => {
      const summary: SessionSummary = {
        id: session.id,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
      };
      if (session.title !== undefined) {
        summary.title = session.title;
      }
      return summary;
    });
  }
  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

/** 只回文本的 Provider。 */
function textProvider(answer = 'hello'): ProviderContract {
  return {
    name: 'fake-text',
    async *generateStream(): AsyncGenerator<ProviderChunk, void, unknown> {
      yield { type: 'text', text: answer };
    },
  };
}

/** 首个请求产出需授权工具调用，收到 tool 结果后回纯文本收尾。 */
function approvalProvider(): ProviderContract {
  return {
    name: 'fake-approval',
    async *generateStream({ messages }): AsyncGenerator<ProviderChunk, void, unknown> {
      const last = messages[messages.length - 1];
      if (last !== undefined && last.role === 'tool') {
        yield { type: 'text', text: 'done' };
        return;
      }
      yield {
        type: 'tool_call_start',
        toolCall: { id: 'tc-1', name: 'dangerous', arguments: '' },
      };
      yield { type: 'tool_call_chunk', toolCallId: 'tc-1', delta: '{}' };
      yield { type: 'tool_call_end', toolCallId: 'tc-1' };
    },
  };
}

/** 需授权工具。 */
function dangerousTool() {
  return {
    name: 'dangerous',
    description: 'requires approval',
    parameters: { type: 'object' },
    requiresApproval: true,
    execute: async (): Promise<string> => 'executed',
  };
}

function createManager(
  provider: ProviderContract,
  options: { configured?: boolean; tool?: boolean; onEvent?: (event: IpcAgentEvent) => void } = {},
): { manager: SessionManager; store: MemoryStore; events: IpcAgentEvent[] } {
  const registry = new ToolRegistry();
  if (options.tool === true) {
    registry.register(dangerousTool());
  }
  const store = new MemoryStore();
  const events: IpcAgentEvent[] = [];
  const manager = new SessionManager({
    provider,
    registry,
    store,
    systemPrompt: 'sys',
    configured: options.configured ?? true,
  });
  manager.attachEmit((event) => {
    events.push(event);
    options.onEvent?.(event);
  });
  return { manager, store, events };
}

describe('SessionManager', () => {
  it('单轮对话：事件经序列化转发，结束后自动存档并派生标题', async () => {
    const { manager, store, events } = createManager(textProvider());
    await manager.send('帮我修一个 bug');
    expect(events.map((event) => event.type)).toEqual([
      'session_started',
      'text_chunk',
      'session_completed',
    ]);
    const saved = store.sessions.get(manager.activeId);
    expect(saved).toBeDefined();
    expect(saved?.title).toBe('帮我修一个 bug');
    // 存档不含 system 消息。
    expect(saved?.messages.every((message) => message.role !== 'system')).toBe(true);
  });

  it('配置缺失：send 以 session_error 事件反馈而非抛出', async () => {
    const { manager, events } = createManager(textProvider(), { configured: false });
    await expect(manager.send('hi')).resolves.toBeUndefined();
    const error = events.find((event) => event.type === 'session_error');
    expect(error).toEqual({
      type: 'session_error',
      name: 'ConfigError',
      message: expect.stringContaining('API key'),
    });
  });

  it('竞态防护：运行中重复 send 与切换会话均被拒绝', async () => {
    // 用可门控的 Provider 把会话钉在运行态。
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedProvider: ProviderContract = {
      name: 'gated',
      async *generateStream(): AsyncGenerator<ProviderChunk, void, unknown> {
        await gate;
        yield { type: 'text', text: 'late' };
      },
    };
    const { manager } = createManager(gatedProvider);

    const first = manager.send('running turn');
    // 让事件循环进入 provider 挂起点。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manager.isRunning).toBe(true);

    await expect(manager.send('second')).rejects.toThrow('already running');
    await expect(manager.newSession()).rejects.toThrow('while a turn is running');
    await expect(manager.openSession('x')).rejects.toThrow('while a turn is running');

    release?.();
    await first;
    expect(manager.isRunning).toBe(false);
  });

  it('多会话：new/open 保留原 ID 写回同一存档，delete 禁止删除活动会话', async () => {
    const { manager, store } = createManager(textProvider());
    const firstId = manager.activeId;
    await manager.send('第一条');

    const { id: secondId } = await manager.newSession();
    expect(secondId).not.toBe(firstId);
    await manager.send('第二条');

    // 切回第一个会话：保留原 ID，后续存档写回同一文件。
    const opened = await manager.openSession(firstId);
    expect(opened.id).toBe(firstId);
    expect(opened.messages.some((message) => message.content === '第一条')).toBe(true);
    await manager.send('续写');
    expect(
      store.sessions.get(firstId)?.messages.some((message) => message.content === '续写'),
    ).toBe(true);

    await expect(manager.deleteSession(firstId)).rejects.toThrow('active session');
    await manager.deleteSession(secondId);
    expect(store.sessions.has(secondId)).toBe(false);
  });

  it('openSession 返回非 system 历史消息供渲染', async () => {
    const { manager } = createManager(textProvider());
    await manager.send('你好');
    const id = manager.activeId;
    await manager.newSession();
    const opened = await manager.openSession(id);
    expect(opened.messages.every((message: Message) => message.role !== 'system')).toBe(true);
    expect(opened.messages.length).toBe(2);
  });

  it('取消会话：挂起授权按拒绝处理，会话以 session_cancelled 终结', async () => {
    let approvalResolve: (() => void) | undefined;
    const approvalSeen = new Promise<void>((resolve) => {
      approvalResolve = resolve;
    });
    const { manager, events } = createManager(approvalProvider(), {
      tool: true,
      onEvent: (event) => {
        if (event.type === 'tool_approval_requested') {
          approvalResolve?.();
        }
      },
    });

    const turn = manager.send('do it');
    await approvalSeen;
    // 取消：核心 AbortSignal 自动把挂起授权按拒绝 settle。
    manager.cancel();
    await turn;

    const types = events.map((event) => event.type);
    expect(types).toContain('session_cancelled');
    expect(types).not.toContain('tool_execution_started');
  });

  it('resolveApproval 放行后工具真实执行', async () => {
    let approvalResolve: ((toolCallId: string) => void) | undefined;
    const approvalSeen = new Promise<string>((resolve) => {
      approvalResolve = resolve;
    });
    const { manager, events } = createManager(approvalProvider(), {
      tool: true,
      onEvent: (event) => {
        if (event.type === 'tool_approval_requested') {
          approvalResolve?.(event.toolCallId);
        }
      },
    });

    const turn = manager.send('do it');
    const toolCallId = await approvalSeen;
    manager.resolveApproval(toolCallId, true);
    await turn;

    expect(events.some((event) => event.type === 'tool_execution_started')).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'tool_execution_completed' && event.result === 'executed',
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'session_completed')).toBe(true);
  });
});
