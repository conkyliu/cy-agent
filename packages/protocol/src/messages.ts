/**
 * 统一消息协议：屏蔽不同大模型 API 之间的消息结构差异。
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  /** JSON string */
  arguments: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string | null;
  toolCalls?: ToolCall[];
  /** 仅当 role === 'tool' 时存在，用于关联工具结果 */
  toolCallId?: string;
  /** 会话被取消时，未完成的助手消息会被标记为 interrupted */
  interrupted?: boolean;
}
