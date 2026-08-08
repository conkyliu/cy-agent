import type { Message } from '@cy-agent/protocol';

/**
 * 上下文窗口预算：token 估算与历史裁剪。
 *
 * 零依赖启发式估算（不引入 tokenizer）：英文约 4 字符/token，
 * 中日韩等宽字符密度更高，按 2 字符/token 计；每条消息附加固定开销。
 * 估算宁可偏高，保证裁剪后真实 token 数大概率在预算内。
 */

export interface ContextBudgetOptions {
  /** 发送给模型的最大输入 token 数（估算值），默认 128000。 */
  maxInputTokens?: number;
}

export const DEFAULT_MAX_INPUT_TOKENS = 128_000;

/** 每条消息的固定协议开销（角色标记、分隔符等）。 */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/** 估算单段文本的 token 数。 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let cjk = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // CJK 统一表意文字与全角区间按高密度计。
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x30ff)) {
      cjk += 1;
    }
  }
  const other = text.length - cjk;
  return Math.max(1, Math.ceil(cjk / 2 + other / 4));
}

/** 估算单条消息的 token 数（含工具调用参数与结果）。 */
export function estimateMessageTokens(message: Message): number {
  let tokens = PER_MESSAGE_OVERHEAD_TOKENS;
  if (message.content !== null) {
    tokens += estimateTokens(message.content);
  }
  if (message.toolCalls !== undefined) {
    for (const toolCall of message.toolCalls) {
      tokens += estimateTokens(toolCall.name) + estimateTokens(toolCall.arguments);
    }
  }
  return tokens;
}

/** 估算消息列表的总 token 数。 */
export function estimateMessagesTokens(messages: readonly Message[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

/**
 * 不可分割的裁剪单元。
 * assistant(toolCalls) 与紧随其后的 tool 结果必须成组保留：
 * 拆开会导致 OpenAI 等 API 因 tool_call_id 无关联而报 400。
 */
interface MessageUnit {
  messages: Message[];
  tokens: number;
  /** system 消息所在单元永远保留。 */
  protected: boolean;
}

export function buildUnits(messages: readonly Message[]): MessageUnit[] {
  const units: MessageUnit[] = [];
  let current: MessageUnit | null = null;

  for (const message of messages) {
    const last = current?.messages[current.messages.length - 1];
    // tool 消息跟随其 assistant(toolCalls) 或前一条 tool 结果，归入同一单元。
    const continuesGroup =
      message.role === 'tool' && (last?.role === 'assistant' || last?.role === 'tool');

    if (current === null || !continuesGroup) {
      current = { messages: [], tokens: 0, protected: false };
      units.push(current);
    }
    current.messages.push(message);
    current.tokens += estimateMessageTokens(message);
    if (message.role === 'system') {
      current.protected = true;
    }

    // 仅 assistant(toolCalls) 保持单元开启等待 tool 结果；其余消息闭合单元。
    const keepsGroupOpen =
      message.role === 'assistant' &&
      message.toolCalls !== undefined &&
      message.toolCalls.length > 0;
    if (!keepsGroupOpen && message.role !== 'tool') {
      current = null;
    }
  }
  return units;
}

export interface TrimResult {
  messages: Message[];
  /** 被移除的消息条数（0 表示未裁剪）。 */
  removedMessages: number;
  /** 裁剪后的估算 token 数。 */
  estimatedTokens: number;
}

/**
 * 按预算裁剪历史：
 * 1. 受保护单元（system）与最后一个单元（含最新用户输入）永不裁剪；
 * 2. 从最旧的单元开始整组移除，直到估算 token 落入预算；
 * 3. 裁剪只作用于副本，调用方的原始数组不受影响。
 */
export function trimToBudget(
  messages: readonly Message[],
  maxInputTokens: number = DEFAULT_MAX_INPUT_TOKENS,
): TrimResult {
  const units = buildUnits(messages);
  let total = units.reduce((sum, unit) => sum + unit.tokens, 0);

  let dropped = 0;
  // 最后可裁剪的单元索引：倒数第二个（最后一个永远保留）。
  for (let i = 0; i < units.length - 1 && total > maxInputTokens; i++) {
    const unit = units[i];
    if (unit === undefined || unit.protected) {
      continue;
    }
    total -= unit.tokens;
    dropped += unit.messages.length;
    unit.messages = [];
    unit.tokens = 0;
  }

  const kept = units.flatMap((unit) => unit.messages);
  return {
    messages: kept,
    removedMessages: dropped,
    estimatedTokens: total,
  };
}
