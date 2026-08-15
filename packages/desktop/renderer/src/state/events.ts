/**
 * 事件流状态机（纯 reducer）：将 IpcAgentEvent 归约为 UI 状态。
 * 纯函数实现，便于无 DOM 的 Node 环境单测。
 */

import type { Message } from '@cy-agent/protocol';
import type { IpcAgentEvent } from '../../../shared/ipc';

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
}

export interface AssistantItem {
  kind: 'assistant';
  id: string;
  text: string;
}

export interface ToolItem {
  kind: 'tool';
  toolCallId: string;
  name: string;
  argsText: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export type TranscriptItem = UserItem | AssistantItem | ToolItem;

export interface PendingApproval {
  toolCallId: string;
  name: string;
  args: unknown;
}

export interface UiState {
  status: 'idle' | 'running';
  items: TranscriptItem[];
  pendingApproval: PendingApproval | null;
  error: { name: string; message: string } | null;
  notice: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export const initialUiState: UiState = {
  status: 'idle',
  items: [],
  pendingApproval: null,
  error: null,
  notice: null,
  usage: null,
};

/** 用户提交输入：追加用户气泡并清理上一轮的终态信息。 */
export function submitUserMessage(state: UiState, text: string): UiState {
  return {
    ...state,
    items: [...state.items, { kind: 'user', id: `user-${state.items.length}`, text }],
    error: null,
    notice: null,
    usage: null,
    pendingApproval: null,
  };
}

/** 单事件归约。 */
export function applyEvent(state: UiState, event: IpcAgentEvent): UiState {
  switch (event.type) {
    case 'session_started':
      return { ...state, status: 'running', error: null, notice: null, usage: null };
    case 'text_chunk':
      return appendText(state, event.text);
    case 'context_trimmed':
      return { ...state, notice: `上下文已裁剪 ${event.removedMessages} 条历史消息` };
    case 'context_compacted':
      return { ...state, notice: `上下文已压缩 ${event.removedMessages} 条历史消息` };
    case 'tool_approval_requested':
      return {
        ...state,
        pendingApproval: { toolCallId: event.toolCallId, name: event.name, args: event.args },
        items: [
          ...state.items,
          {
            kind: 'tool',
            toolCallId: event.toolCallId,
            name: event.name,
            argsText: formatArgs(event.args),
            status: 'pending',
          },
        ],
      };
    case 'tool_execution_started':
      return upsertTool(state, event.toolCallId, event.name, event.args, { status: 'running' });
    case 'tool_execution_completed':
      return updateTool(state, event.toolCallId, {
        status: 'completed',
        result: formatResult(event.result),
      });
    case 'tool_execution_failed':
      return updateTool(state, event.toolCallId, { status: 'failed', error: event.error });
    case 'session_completed':
      return { ...state, status: 'idle', pendingApproval: null };
    case 'usage_reported':
      return {
        ...state,
        usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens },
      };
    case 'session_cancelled':
      return { ...state, status: 'idle', pendingApproval: null, notice: '会话已取消' };
    case 'session_error':
      return {
        ...state,
        status: 'idle',
        pendingApproval: null,
        error: { name: event.name, message: event.message },
      };
  }
}

/** 会话切换 / 历史载入：由存档消息重建 transcript。 */
export function loadHistory(messages: readonly Message[]): UiState {
  const items: TranscriptItem[] = [];
  const toolResults = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      toolResults.set(message.toolCallId, message.content ?? '');
    }
  }
  for (const message of messages) {
    if (message.role === 'user') {
      items.push({ kind: 'user', id: message.id, text: message.content ?? '' });
      continue;
    }
    if (message.role === 'assistant') {
      if (typeof message.content === 'string' && message.content.length > 0) {
        items.push({ kind: 'assistant', id: message.id, text: message.content });
      }
      if (message.toolCalls !== undefined) {
        for (const call of message.toolCalls) {
          const result = toolResults.get(call.id);
          const item: ToolItem = {
            kind: 'tool',
            toolCallId: call.id,
            name: call.name,
            argsText: call.arguments,
            status: 'completed',
          };
          if (result !== undefined) {
            item.result = result;
          }
          items.push(item);
        }
      }
    }
  }
  return { ...initialUiState, items };
}

/** 清空 transcript（新会话）。 */
export function clearTranscript(): UiState {
  return initialUiState;
}

/** 清空 transcript 并附带系统通知（如工作区切换）。 */
export function clearTranscriptWithNotice(notice: string): UiState {
  return { ...initialUiState, notice };
}

/** text_chunk：追加到末尾 assistant 气泡；末尾不是 assistant 则新建。 */
function appendText(state: UiState, text: string): UiState {
  const last = state.items[state.items.length - 1];
  if (last !== undefined && last.kind === 'assistant') {
    const updated: AssistantItem = { ...last, text: last.text + text };
    return { ...state, items: [...state.items.slice(0, -1), updated] };
  }
  const item: AssistantItem = { kind: 'assistant', id: `assistant-${state.items.length}`, text };
  return { ...state, items: [...state.items, item] };
}

/** started：更新已有卡片（授权后执行），缺失时新建（免授权工具）。 */
function upsertTool(
  state: UiState,
  toolCallId: string,
  name: string,
  args: unknown,
  patch: Partial<ToolItem>,
): UiState {
  const index = state.items.findIndex(
    (item): item is ToolItem => item.kind === 'tool' && item.toolCallId === toolCallId,
  );
  if (index === -1) {
    const item: ToolItem = {
      kind: 'tool',
      toolCallId,
      name,
      argsText: formatArgs(args),
      status: 'running',
      ...patch,
    };
    return { ...state, items: [...state.items, item] };
  }
  return patchToolAt(state, index, patch);
}

/** completed/failed：仅更新已存在的卡片（未知 ID 容错忽略）。 */
function updateTool(state: UiState, toolCallId: string, patch: Partial<ToolItem>): UiState {
  const index = state.items.findIndex(
    (item): item is ToolItem => item.kind === 'tool' && item.toolCallId === toolCallId,
  );
  if (index === -1) {
    return state;
  }
  return patchToolAt(state, index, patch);
}

function patchToolAt(state: UiState, index: number, patch: Partial<ToolItem>): UiState {
  const current = state.items[index];
  if (current === undefined || current.kind !== 'tool') {
    return state;
  }
  const updated: ToolItem = { ...current, ...patch };
  const items = state.items.slice();
  items[index] = updated;
  return { ...state, items };
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2) ?? '';
  } catch {
    return String(args);
  }
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2) ?? '';
  } catch {
    return String(result);
  }
}
