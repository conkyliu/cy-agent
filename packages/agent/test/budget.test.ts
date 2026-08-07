import { describe, expect, it } from 'vitest';
import type { Message } from '@cy-agent/protocol';
import {
  buildUnits,
  estimateMessagesTokens,
  estimateTokens,
  trimToBudget,
} from '../src/context/budget.js';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  return { content: null, ...partial };
}

describe('estimateTokens', () => {
  it('空文本为 0，英文约 4 字符/token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });

  it('CJK 字符按更高密度估算（同长度 token 更多）', () => {
    const cjk = estimateTokens('中'.repeat(40));
    const latin = estimateTokens('a'.repeat(40));
    expect(cjk).toBeGreaterThan(latin);
  });
});

describe('buildUnits', () => {
  it('普通消息各自成单元，system 单元受保护', () => {
    const messages: Message[] = [
      msg({ id: 's', role: 'system', content: 'sys' }),
      msg({ id: 'u1', role: 'user', content: 'hi' }),
      msg({ id: 'a1', role: 'assistant', content: 'hello' }),
    ];
    const units = buildUnits(messages);
    expect(units).toHaveLength(3);
    expect(units[0]?.protected).toBe(true);
    expect(units[1]?.protected).toBe(false);
  });

  it('assistant(toolCalls) 与后续 tool 结果归入同一单元', () => {
    const messages: Message[] = [
      msg({
        id: 'a1',
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{}' }],
      }),
      msg({ id: 't1', role: 'tool', content: 'result', toolCallId: 'tc1' }),
      msg({ id: 't2', role: 'tool', content: 'result2', toolCallId: 'tc2' }),
      msg({ id: 'a2', role: 'assistant', content: 'done' }),
    ];
    const units = buildUnits(messages);
    expect(units).toHaveLength(2);
    expect(units[0]?.messages.map((m) => m.id)).toEqual(['a1', 't1', 't2']);
    expect(units[1]?.messages.map((m) => m.id)).toEqual(['a2']);
  });
});

describe('trimToBudget', () => {
  const system = msg({ id: 's', role: 'system', content: 'You are helpful.' });
  const u1 = msg({ id: 'u1', role: 'user', content: 'x'.repeat(200) });
  const a1 = msg({ id: 'a1', role: 'assistant', content: 'y'.repeat(200) });
  const u2 = msg({ id: 'u2', role: 'user', content: 'z'.repeat(200) });

  it('未超预算时原样返回且不修改原数组', () => {
    const messages = [system, u1, a1, u2];
    const result = trimToBudget(messages, Number.MAX_SAFE_INTEGER);
    expect(result.removedMessages).toBe(0);
    expect(result.messages).toHaveLength(4);
    expect(messages).toHaveLength(4);
  });

  it('超预算时从最旧单元开始裁剪，system 与最新消息永远保留', () => {
    const messages = [system, u1, a1, u2];
    const budget = estimateMessagesTokens([system, u2]);
    const result = trimToBudget(messages, budget);

    expect(result.removedMessages).toBe(2);
    expect(result.messages.map((m) => m.id)).toEqual(['s', 'u2']);
    expect(result.estimatedTokens).toBeLessThanOrEqual(budget);
    // 原数组不受影响。
    expect(messages).toHaveLength(4);
  });

  it('工具组整组裁剪，绝不拆散 assistant(toolCalls) 与 tool 结果', () => {
    const toolGroup: Message[] = [
      msg({
        id: 'a-tool',
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{"path":"a"}' }],
      }),
      msg({ id: 't1', role: 'tool', content: 'r'.repeat(200), toolCallId: 'tc1' }),
    ];
    const messages = [system, ...toolGroup, u2];
    // 预算只容得下 system + 最新消息，工具组必须整体移除。
    const budget = estimateMessagesTokens([system, u2]);
    const result = trimToBudget(messages, budget);

    expect(result.messages.map((m) => m.id)).toEqual(['s', 'u2']);
    // 不允许出现只剩 assistant(toolCalls) 或只剩 tool 的残缺状态。
    expect(result.messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('极端情况：仅保留 system 与最后单元也不报错', () => {
    const messages = [system, u1, u2];
    const result = trimToBudget(messages, 1);
    expect(result.messages.map((m) => m.id)).toEqual(['s', 'u2']);
  });
});
