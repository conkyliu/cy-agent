import { describe, expect, it } from 'vitest';
import { truncateToolOutput } from '../src/context/output.js';

describe('truncateToolOutput', () => {
  it('不超过上限的输出原样返回', () => {
    expect(truncateToolOutput('short output', 100)).toBe('short output');
    expect(truncateToolOutput('', 100)).toBe('');
  });

  it('恰好等于上限时不截断', () => {
    const text = 'x'.repeat(100);
    expect(truncateToolOutput(text, 100)).toBe(text);
  });

  it('超长输出保留头部与尾部并插入截断标记', () => {
    const head = 'HEAD'.repeat(25); // 100 chars
    const middle = 'M'.repeat(1000);
    const tail = 'TAIL'.repeat(25); // 100 chars
    const text = head + middle + tail;

    const truncated = truncateToolOutput(text, 300);

    expect(truncated.length).toBeLessThanOrEqual(300);
    expect(truncated.startsWith('HEAD')).toBe(true);
    expect(truncated.endsWith('TAIL')).toBe(true);
    expect(truncated).toContain('output truncated');
    expect(truncated).toContain('characters omitted');
  });

  it('截断结果永不超过上限（含标记长度）', () => {
    const text = 'a'.repeat(100_000);
    for (const limit of [100, 257, 1000, 32_000]) {
      expect(truncateToolOutput(text, limit).length).toBeLessThanOrEqual(limit);
    }
  });

  it('上限极小时硬切兜底不抛错', () => {
    const truncated = truncateToolOutput('abcdefghij', 5);
    expect(truncated.length).toBeLessThanOrEqual(8);
    expect(truncated).toContain('...');
  });

  it('maxChars 非正数时原样返回', () => {
    expect(truncateToolOutput('abc', 0)).toBe('abc');
  });
});
