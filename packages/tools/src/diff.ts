/**
 * 零依赖轻量级行级 Diff 计算工具。
 * 基于最长公共子序列（LCS）算法生成统一 Diff（Unified Diff）文本与结构化行差异。
 */

export interface DiffLine {
  type: 'equal' | 'delete' | 'add';
  text: string;
}

export interface DiffStats {
  added: number;
  deleted: number;
}

/**
 * 计算两段多行文本的行级差异列表。
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.length === 0 ? [] : oldText.split('\n');
  const newLines = newText.length === 0 ? [] : newText.split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  // 边界优化：其中一边为空
  if (m === 0 && n === 0) {
    return [];
  }
  if (m === 0) {
    return newLines.map((text) => ({ type: 'add', text }));
  }
  if (n === 0) {
    return oldLines.map((text) => ({ type: 'delete', text }));
  }

  // 典型 LCS 动态规划矩阵（使用 1D 数组滚动或标准二维 DP）
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i < m; i++) {
    const oldLine = oldLines[i];
    for (let j = 0; j < n; j++) {
      if (oldLine === newLines[j]) {
        dp[i + 1]![j + 1] = dp[i]![j]! + 1;
      } else {
        dp[i + 1]![j + 1] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  // 回溯还原 DiffLine
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'equal', text: oldLines[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: 'add', text: newLines[j - 1]! });
      j--;
    } else if (i > 0) {
      result.push({ type: 'delete', text: oldLines[i - 1]! });
      i--;
    }
  }

  return result.reverse();
}

/**
 * 统计 Diff 中的增删行数。
 */
export function getDiffStats(diffLines: readonly DiffLine[]): DiffStats {
  let added = 0;
  let deleted = 0;
  for (const line of diffLines) {
    if (line.type === 'add') {
      added++;
    } else if (line.type === 'delete') {
      deleted++;
    }
  }
  return { added, deleted };
}

/**
 * 生成标准 Unified Diff 格式文本。
 *
 * @param filePath 文件相对路径
 * @param oldText 原文本
 * @param newText 新文本
 * @param contextLines 上下文保留行数，默认 3
 */
export function computeUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string,
  contextLines = 3,
): string {
  if (oldText === newText) {
    return '';
  }

  const lines = computeLineDiff(oldText, newText);

  interface DiffHunkItem {
    line: DiffLine;
    oldNum: number;
    newNum: number;
  }

  const numbered: DiffHunkItem[] = [];
  let curOld = 1;
  let curNew = 1;

  for (const item of lines) {
    if (item.type === 'equal') {
      numbered.push({ line: item, oldNum: curOld++, newNum: curNew++ });
    } else if (item.type === 'delete') {
      numbered.push({ line: item, oldNum: curOld++, newNum: -1 });
    } else if (item.type === 'add') {
      numbered.push({ line: item, oldNum: -1, newNum: curNew++ });
    }
  }

  // 识别修改区域
  const isChange = numbered.map((item) => item.line.type !== 'equal');
  const includeInHunk = new Array<boolean>(numbered.length).fill(false);

  for (let idx = 0; idx < numbered.length; idx++) {
    if (isChange[idx]) {
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(numbered.length - 1, idx + contextLines);
      for (let k = start; k <= end; k++) {
        includeInHunk[k] = true;
      }
    }
  }

  // 聚类为 Hunks
  const hunks: DiffHunkItem[][] = [];
  let currentHunk: DiffHunkItem[] = [];

  for (let idx = 0; idx < numbered.length; idx++) {
    if (includeInHunk[idx]) {
      currentHunk.push(numbered[idx]!);
    } else if (currentHunk.length > 0) {
      hunks.push(currentHunk);
      currentHunk = [];
    }
  }
  if (currentHunk.length > 0) {
    hunks.push(currentHunk);
  }

  if (hunks.length === 0) {
    return '';
  }

  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (const hunk of hunks) {
    const oldEntries = hunk.filter((h) => h.line.type !== 'add');
    const newEntries = hunk.filter((h) => h.line.type !== 'delete');

    const oldStart = oldEntries[0]?.oldNum ?? 1;
    const oldCount = oldEntries.length;
    const newStart = newEntries[0]?.newNum ?? 1;
    const newCount = newEntries.length;

    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);

    for (const h of hunk) {
      if (h.line.type === 'equal') {
        out.push(` ${h.line.text}`);
      } else if (h.line.type === 'delete') {
        out.push(`-${h.line.text}`);
      } else if (h.line.type === 'add') {
        out.push(`+${h.line.text}`);
      }
    }
  }

  return out.join('\n');
}
