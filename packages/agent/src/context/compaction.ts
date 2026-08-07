import { randomUUID } from 'node:crypto';
import type { Message } from '@cy-agent/protocol';

/**
 * LLM 驱动的上下文压缩（Compaction）。
 *
 * 与 add-token-budget 的裁剪（丢弃旧历史）互补：
 * 预算将满时先尝试让模型把旧历史总结为一条摘要消息，
 * 压缩失败再回退到裁剪，保证长会话的信息保真度。
 */

export interface CompactionOptions {
  /** 默认启用；估算 token 超过阈值时触发。 */
  enabled?: boolean;
  /** 触发比例：估算 token > maxInputTokens * threshold 时压缩，默认 0.8。 */
  threshold?: number;
  /** 压缩时保留最近的单元数（含最新用户输入），默认 2。 */
  keepRecentUnits?: number;
}

export const DEFAULT_COMPACTION_THRESHOLD = 0.8;
export const DEFAULT_KEEP_RECENT_UNITS = 2;

/** 摘要消息前缀标记，便于宿主识别与调试。 */
export const SUMMARY_MARKER = '[Context Summary]';

/** 交给 Provider 的总结指令。 */
export const SUMMARIZATION_PROMPT = `Summarize the following conversation transcript into a concise context brief for a coding assistant.
Requirements:
- Preserve: user goals, decisions made, file paths, tool results worth keeping, and any unresolved questions.
- Omit: small talk, redundant retries, and verbose raw outputs.
- Reply with the summary only, no preamble.`;

/**
 * 将消息序列转为供模型总结的转录本。
 * 工具调用仅保留名称摘要，避免参数/结果原文撑爆总结请求。
 */
export function buildTranscript(messages: readonly Message[]): string {
  return messages
    .map((message) => {
      const parts: string[] = [];
      if (message.content !== null) {
        parts.push(message.content);
      }
      if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
        parts.push(`(called tools: ${message.toolCalls.map((t) => t.name).join(', ')})`);
      }
      return `${message.role}: ${parts.join(' ')}`;
    })
    .join('\n');
}

/**
 * 由模型摘要构造替代消息。
 * 使用 user 角色：既不会被持久化层（只存非 system 消息）丢弃，
 * 也不会像 system 消息那样被预算裁剪模块永久保护。
 */
export function createSummaryMessage(summary: string): Message {
  return {
    id: randomUUID(),
    role: 'user',
    content: `${SUMMARY_MARKER} The following is a summary of the earlier conversation:\n${summary}`,
  };
}
