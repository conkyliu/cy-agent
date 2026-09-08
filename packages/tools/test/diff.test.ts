import { describe, expect, it } from 'vitest';
import { computeLineDiff, computeUnifiedDiff, getDiffStats } from '../src/diff.js';

describe('diff utilities', () => {
  it('handles empty and identical inputs', () => {
    expect(computeLineDiff('', '')).toEqual([]);
    expect(computeUnifiedDiff('test.txt', 'hello\nworld', 'hello\nworld')).toBe('');
  });

  it('calculates diff for pure additions and pure deletions', () => {
    const addDiff = computeLineDiff('', 'line 1\nline 2');
    expect(addDiff).toEqual([
      { type: 'add', text: 'line 1' },
      { type: 'add', text: 'line 2' },
    ]);
    expect(getDiffStats(addDiff)).toEqual({ added: 2, deleted: 0 });

    const delDiff = computeLineDiff('line 1\nline 2', '');
    expect(delDiff).toEqual([
      { type: 'delete', text: 'line 1' },
      { type: 'delete', text: 'line 2' },
    ]);
    expect(getDiffStats(delDiff)).toEqual({ added: 0, deleted: 2 });
  });

  it('identifies replacements and computes stats correctly', () => {
    const oldText = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const newText = 'const a = 1;\nconst b = 20;\nconst c = 3;';

    const diff = computeLineDiff(oldText, newText);
    expect(getDiffStats(diff)).toEqual({ added: 1, deleted: 1 });

    const unified = computeUnifiedDiff('src/math.ts', oldText, newText);
    expect(unified).toContain('--- a/src/math.ts');
    expect(unified).toContain('+++ b/src/math.ts');
    expect(unified).toContain('-const b = 2;');
    expect(unified).toContain('+const b = 20;');
    expect(unified).toContain(' const a = 1;');
    expect(unified).toContain(' const c = 3;');
  });

  it('formats unified diff with proper hunk headers', () => {
    const oldText = 'line 1\nline 2\nline 3\nline 4\nline 5';
    const newText = 'line 1\nline 2\nmodified 3\nline 4\nline 5';

    const unified = computeUnifiedDiff('file.txt', oldText, newText, 1);
    expect(unified).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(unified).toContain('-line 3');
    expect(unified).toContain('+modified 3');
  });
});
