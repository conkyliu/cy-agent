import { describe, expect, it } from 'vitest';
import { serializeAgentEvent } from '../shared/ipc';

describe('serializeAgentEvent', () => {
  it('将 session_error 的 Error 实例序列化为 { name, message } 纯对象', () => {
    const serialized = serializeAgentEvent({
      type: 'session_error',
      error: new TypeError('boom'),
    });
    expect(serialized).toEqual({ type: 'session_error', name: 'TypeError', message: 'boom' });
    // 纯对象可直接结构化克隆（IPC 传输前提）。
    expect(() => structuredClone(serialized)).not.toThrow();
  });

  it('其余事件原样透传', () => {
    const chunk = { type: 'text_chunk', text: 'hi' } as const;
    expect(serializeAgentEvent(chunk)).toBe(chunk);
    const cancelled = { type: 'session_cancelled' } as const;
    expect(serializeAgentEvent(cancelled)).toBe(cancelled);
  });

  it('usage_reported 与授权事件保持字段完整', () => {
    const usage = { type: 'usage_reported', inputTokens: 3, outputTokens: 4 } as const;
    expect(serializeAgentEvent(usage)).toEqual(usage);
    const approval = {
      type: 'tool_approval_requested',
      toolCallId: 'tc-1',
      name: 'write_file',
      args: { path: 'a.ts' },
    } as const;
    expect(serializeAgentEvent(approval)).toEqual(approval);
  });
});
