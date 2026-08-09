import { describe, expect, it } from 'vitest';
import type { IpcAgentEvent } from '../shared/ipc';
import {
  applyEvent,
  initialUiState,
  loadHistory,
  submitUserMessage,
  type ToolItem,
  type UiState,
} from '../renderer/src/state/events';

const started: IpcAgentEvent = {
  type: 'session_started',
  sessionId: 's-1',
};

describe('事件 reducer', () => {
  it('session_started 进入运行态并清理上一轮终态', () => {
    const dirty: UiState = {
      ...initialUiState,
      error: { name: 'E', message: 'm' },
      notice: 'n',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    const next = applyEvent(dirty, started);
    expect(next.status).toBe('running');
    expect(next.error).toBeNull();
    expect(next.notice).toBeNull();
    expect(next.usage).toBeNull();
  });

  it('text_chunk 流式拼接到同一 assistant 气泡', () => {
    let state = applyEvent(initialUiState, started);
    state = applyEvent(state, { type: 'text_chunk', text: '你好' });
    state = applyEvent(state, { type: 'text_chunk', text: '，世界' });
    expect(state.items).toHaveLength(1);
    const item = state.items[0];
    expect(item?.kind === 'assistant' && item.text).toBe('你好，世界');
  });

  it('授权 → 执行 → 完成 的工具卡片状态迁移', () => {
    let state = applyEvent(initialUiState, started);
    state = applyEvent(state, {
      type: 'tool_approval_requested',
      toolCallId: 'tc-1',
      name: 'write_file',
      args: { path: 'a.ts' },
    });
    expect(state.pendingApproval?.toolCallId).toBe('tc-1');
    const pending = state.items[0];
    expect(pending?.kind === 'tool' && pending.status).toBe('pending');

    state = applyEvent(state, {
      type: 'tool_execution_started',
      toolCallId: 'tc-1',
      name: 'write_file',
      args: { path: 'a.ts' },
    });
    expect((state.items[0] as ToolItem).status).toBe('running');

    state = applyEvent(state, {
      type: 'tool_execution_completed',
      toolCallId: 'tc-1',
      result: 'ok',
    });
    const completed = state.items[0];
    expect(completed?.kind === 'tool' && completed.status).toBe('completed');
    expect(completed?.kind === 'tool' && completed.result).toBe('ok');
    expect(state.items).toHaveLength(1);
  });

  it('免授权工具：started 时无卡片则新建', () => {
    let state = applyEvent(initialUiState, started);
    state = applyEvent(state, {
      type: 'tool_execution_started',
      toolCallId: 'tc-2',
      name: 'read_file',
      args: {},
    });
    expect(state.items).toHaveLength(1);
    expect((state.items[0] as ToolItem).status).toBe('running');
  });

  it('tool_execution_failed 标记失败并记录错误', () => {
    let state = applyEvent(initialUiState, {
      type: 'tool_execution_started',
      toolCallId: 'tc-3',
      name: 'run_shell',
      args: {},
    });
    state = applyEvent(state, {
      type: 'tool_execution_failed',
      toolCallId: 'tc-3',
      error: 'Error: exit 1',
    });
    const failed = state.items[0];
    expect(failed?.kind === 'tool' && failed.status).toBe('failed');
    expect(failed?.kind === 'tool' && failed.error).toBe('Error: exit 1');
  });

  it('工具后的 text_chunk 新建 assistant 气泡', () => {
    let state = applyEvent(initialUiState, { type: 'text_chunk', text: '先' });
    state = applyEvent(state, {
      type: 'tool_execution_started',
      toolCallId: 'tc-4',
      name: 'read_file',
      args: {},
    });
    state = applyEvent(state, { type: 'text_chunk', text: '后' });
    expect(state.items).toHaveLength(3);
    expect(state.items[2]?.kind).toBe('assistant');
  });

  it('终态事件：completed 回空闲，cancelled 带通知，error 带错误对象', () => {
    const running = applyEvent(initialUiState, started);
    expect(applyEvent(running, { type: 'session_completed', finalMessages: [] }).status).toBe(
      'idle',
    );

    const cancelled = applyEvent(running, { type: 'session_cancelled' });
    expect(cancelled.status).toBe('idle');
    expect(cancelled.notice).toBe('会话已取消');

    const errored = applyEvent(running, {
      type: 'session_error',
      name: 'ConfigError',
      message: 'no key',
    });
    expect(errored.status).toBe('idle');
    expect(errored.error).toEqual({ name: 'ConfigError', message: 'no key' });
  });

  it('usage_reported 记录用量徽标数据', () => {
    const state = applyEvent(initialUiState, {
      type: 'usage_reported',
      inputTokens: 12,
      outputTokens: 34,
    });
    expect(state.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  it('context 裁剪 / 压缩事件产出通知', () => {
    expect(
      applyEvent(initialUiState, {
        type: 'context_trimmed',
        removedMessages: 3,
        estimatedTokens: 99,
      }).notice,
    ).toContain('裁剪');
    expect(
      applyEvent(initialUiState, { type: 'context_compacted', removedMessages: 5 }).notice,
    ).toContain('压缩');
  });

  it('submitUserMessage 追加用户气泡并清理 pendingApproval', () => {
    const withApproval: UiState = {
      ...initialUiState,
      pendingApproval: { toolCallId: 'x', name: 'y', args: {} },
    };
    const next = submitUserMessage(withApproval, '你好');
    expect(next.items.at(-1)).toEqual({ kind: 'user', id: 'user-0', text: '你好' });
    expect(next.pendingApproval).toBeNull();
  });

  it('loadHistory 从存档消息重建 transcript（含工具结果关联）', () => {
    const state = loadHistory([
      { id: 'm1', role: 'user', content: '帮我看看' },
      {
        id: 'm2',
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'tc-9', name: 'read_file', arguments: '{"path":"a"}' }],
      },
      { id: 'm3', role: 'tool', toolCallId: 'tc-9', content: 'file content' },
      { id: 'm4', role: 'assistant', content: '完成了' },
    ]);
    expect(state.items.map((item) => item.kind)).toEqual(['user', 'tool', 'assistant']);
    const tool = state.items[1];
    expect(tool?.kind === 'tool' && tool.result).toBe('file content');
    expect(state.status).toBe('idle');
  });
});
