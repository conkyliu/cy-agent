import type { Message } from '@cy-agent/protocol';
import type { ToolBase } from '@cy-agent/agent';

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessageWire {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolWire {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ConvertedAnthropicPayload {
  system?: string;
  messages: AnthropicMessageWire[];
}

function parseJsonSafely(raw: string): Record<string, unknown> {
  if (!raw || raw.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

/**
 * 将统一 Message 协议转换为 Anthropic Messages API 所需结构：
 * 1. 抽取 system 消息合并为顶层 system 字符串。
 * 2. 转换 assistant（含 tool_use）与 tool（转为 user role 下的 tool_result）。
 * 3. 自动合并相邻同角色消息，保证 user / assistant 严格交替。
 */
export function toAnthropicMessages(messages: readonly Message[]): ConvertedAnthropicPayload {
  const systemParts: string[] = [];
  const rawTurnList: Array<{ role: 'user' | 'assistant'; blocks: AnthropicContentBlock[] }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content !== null && message.content.length > 0) {
        systemParts.push(message.content);
      }
      continue;
    }

    if (message.role === 'tool') {
      const toolBlock: AnthropicToolResultBlock = {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content ?? '',
      };
      rawTurnList.push({
        role: 'user',
        blocks: [toolBlock],
      });
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content !== null && message.content.length > 0) {
        blocks.push({ type: 'text', text: message.content });
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const tc of message.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: parseJsonSafely(tc.arguments),
          });
        }
      }
      // 如果既无文本也无工具调用，补充一个空文本块防止 payload 非法
      if (blocks.length === 0) {
        blocks.push({ type: 'text', text: '' });
      }
      rawTurnList.push({ role: 'assistant', blocks });
      continue;
    }

    // role === 'user'
    const userBlocks: AnthropicContentBlock[] = [{ type: 'text', text: message.content ?? '' }];
    rawTurnList.push({ role: 'user', blocks: userBlocks });
  }

  // 合并相邻相同 role 的消息
  const mergedMessages: AnthropicMessageWire[] = [];
  for (const turn of rawTurnList) {
    const last = mergedMessages[mergedMessages.length - 1];
    if (last && last.role === turn.role && Array.isArray(last.content)) {
      last.content.push(...turn.blocks);
    } else {
      mergedMessages.push({
        role: turn.role,
        content: [...turn.blocks],
      });
    }
  }

  const result: ConvertedAnthropicPayload = {
    messages: mergedMessages,
  };
  if (systemParts.length > 0) {
    result.system = systemParts.join('\n\n');
  }
  return result;
}

/** 将 ToolBase 快照转换为 Anthropic tool 结构。 */
export function toAnthropicTools(tools: readonly ToolBase[]): AnthropicToolWire[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}
