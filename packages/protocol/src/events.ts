/**
 * Agent 事件协议：UI/CLI 层通过消费此单向事件流渲染界面。
 */

import type { Message } from './messages.js';

export type AgentEvent =
  | { type: 'session_started'; sessionId: string }
  | { type: 'text_chunk'; text: string }
  | { type: 'context_trimmed'; removedMessages: number; estimatedTokens: number }
  | { type: 'context_compacted'; removedMessages: number }
  | { type: 'tool_approval_requested'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_execution_started'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_execution_completed'; toolCallId: string; result: unknown }
  | { type: 'tool_execution_failed'; toolCallId: string; error: string }
  | { type: 'session_completed'; finalMessages: Message[] }
  /** 一轮会话（可能含多次模型迭代）的真实 token 用量，紧随 session_completed 发出。 */
  | { type: 'usage_reported'; inputTokens: number; outputTokens: number }
  | { type: 'session_cancelled' }
  | { type: 'session_error'; error: Error };
