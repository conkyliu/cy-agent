import type { Message } from '@cy-agent/protocol';
import type { ToolBase } from '@cy-agent/agent';

/** OpenAI Chat Completions 线上消息格式（仅声明本 Provider 关心的字段）。 */
export interface OpenAIMessageWire {
  role: string;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * 将统一 Message 协议转换为 OpenAI Chat Completions 消息格式，
 * 屏蔽运行时核心与具体 API 之间的差异。
 */
export function toOpenAIMessages(messages: readonly Message[]): OpenAIMessageWire[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content ?? '',
        tool_call_id: message.toolCallId ?? '',
      };
    }
    if (
      message.role === 'assistant' &&
      message.toolCalls !== undefined &&
      message.toolCalls.length > 0
    ) {
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function' as const,
          function: { name: toolCall.name, arguments: toolCall.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content ?? '' };
  });
}

/** 将 ToolBase 快照转换为 OpenAI function-calling 工具定义。 */
export function toOpenAITools(tools: readonly ToolBase[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
