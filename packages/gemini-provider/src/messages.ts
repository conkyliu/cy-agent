import type { Message } from '@cy-agent/protocol';
import type { ToolBase } from '@cy-agent/agent';

export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiToolDeclaration {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface ConvertedGeminiPayload {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
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
 * 将统一 Message 协议转换为 Gemini API 所需的 contents / systemInstruction 结构。
 */
export function toGeminiContents(messages: readonly Message[]): ConvertedGeminiPayload {
  const systemTexts: string[] = [];
  const toolCallIdToName = new Map<string, string>();

  // 预扫描 assistant 的 toolCalls 建立 toolCallId -> name 映射
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolCallIdToName.set(tc.id, tc.name);
      }
    }
  }

  const rawContents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content !== null && message.content.length > 0) {
        systemTexts.push(message.content);
      }
      continue;
    }

    if (message.role === 'tool') {
      const toolName =
        (message.toolCallId ? toolCallIdToName.get(message.toolCallId) : undefined) ?? 'tool';
      rawContents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: toolName,
              response: { output: message.content ?? '' },
            },
          },
        ],
      });
      continue;
    }

    if (message.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (message.content !== null && message.content.length > 0) {
        parts.push({ text: message.content });
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const tc of message.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: parseJsonSafely(tc.arguments),
            },
          });
        }
      }
      if (parts.length === 0) {
        parts.push({ text: '' });
      }
      rawContents.push({ role: 'model', parts });
      continue;
    }

    // role === 'user'
    rawContents.push({
      role: 'user',
      parts: [{ text: message.content ?? '' }],
    });
  }

  // 合并相邻相同角色的 contents
  const mergedContents: GeminiContent[] = [];
  for (const item of rawContents) {
    const last = mergedContents[mergedContents.length - 1];
    if (last && last.role === item.role) {
      last.parts.push(...item.parts);
    } else {
      mergedContents.push({
        role: item.role,
        parts: [...item.parts],
      });
    }
  }

  const result: ConvertedGeminiPayload = {
    contents: mergedContents,
  };
  if (systemTexts.length > 0) {
    result.systemInstruction = {
      parts: [{ text: systemTexts.join('\n\n') }],
    };
  }
  return result;
}

/** 将 ToolBase 快照转换为 Gemini tool 结构。 */
export function toGeminiTools(tools: readonly ToolBase[]): GeminiToolDeclaration[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}
