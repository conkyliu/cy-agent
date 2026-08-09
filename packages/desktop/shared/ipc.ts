/**
 * 桌面端 IPC 契约：主进程与渲染进程共享的通道名、载荷类型与序列化规则。
 *
 * 本文件 MUST NOT 依赖 Electron / Node / DOM 运行时 API，
 * 仅使用类型导入，保证可同时被主进程（esbuild）与渲染进程（Vite）编译。
 */

import type { Message } from '@cy-agent/protocol';

/** IPC 通道白名单：preload 仅暴露此处列出的通道。 */
export const IpcChannels = {
  sessionSend: 'session:send',
  sessionCancel: 'session:cancel',
  sessionResolveApproval: 'session:resolve-approval',
  sessionsList: 'sessions:list',
  sessionsNew: 'sessions:new',
  sessionsOpen: 'sessions:open',
  sessionsDelete: 'sessions:delete',
  configGet: 'config:get',
  /** 主进程 -> 渲染进程单向事件推送通道。 */
  agentEvent: 'agent:event',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/**
 * 可跨进程传输的 AgentEvent 变体。
 * `session_error` 的 Error 实例序列化为 `{ name, message }` 纯对象
 * （结构化克隆无法传输 Error）。
 */
export type IpcAgentEvent =
  | { type: 'session_started'; sessionId: string }
  | { type: 'text_chunk'; text: string }
  | { type: 'context_trimmed'; removedMessages: number; estimatedTokens: number }
  | { type: 'context_compacted'; removedMessages: number }
  | { type: 'tool_approval_requested'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_execution_started'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_execution_completed'; toolCallId: string; result: unknown }
  | { type: 'tool_execution_failed'; toolCallId: string; error: string }
  | { type: 'session_completed'; finalMessages: Message[] }
  | { type: 'usage_reported'; inputTokens: number; outputTokens: number }
  | { type: 'session_cancelled' }
  | { type: 'session_error'; name: string; message: string };

/** 与 `@cy-agent/protocol` 的 AgentEvent 同构（Error 除外），用于入参约束。 */
type RawAgentEvent = IpcAgentEvent | { type: 'session_error'; error: Error };

/** 将核心事件序列化为可跨 IPC 传输的纯对象。 */
export function serializeAgentEvent(event: RawAgentEvent): IpcAgentEvent {
  if (event.type === 'session_error' && 'error' in event) {
    return { type: 'session_error', name: event.error.name, message: event.error.message };
  }
  return event;
}

/** 会话摘要（对齐 storage 的 SessionSummary，此处内联避免渲染侧引入 storage）。 */
export interface IpcSessionSummary {
  id: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
}

/** `config:get` 载荷：仅暴露展示所需信息，绝不包含 API Key。 */
export interface IpcDesktopConfig {
  model: string;
  workspace: string;
  /** API Key 是否已配置；缺失时 UI 展示配置引导。 */
  configured: boolean;
}

/** preload 暴露给渲染进程的白名单 API 形状。 */
export interface DesktopApi {
  send(text: string): Promise<void>;
  cancel(): Promise<void>;
  resolveApproval(toolCallId: string, approved: boolean): Promise<void>;
  listSessions(): Promise<IpcSessionSummary[]>;
  /** 存档当前会话并开空会话，返回新会话 ID。 */
  newSession(): Promise<{ id: string }>;
  /** 存档当前会话并载入目标会话（保留原 ID），返回历史非 system 消息供渲染。 */
  openSession(id: string): Promise<{ id: string; messages: Message[] }>;
  deleteSession(id: string): Promise<void>;
  getConfig(): Promise<IpcDesktopConfig>;
  /** 订阅 AgentEvent 流，返回退订函数。 */
  onAgentEvent(listener: (event: IpcAgentEvent) => void): () => void;
}
