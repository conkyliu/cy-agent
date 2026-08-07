import path from 'node:path';

/**
 * 将目标路径解析为工作区内的绝对路径。
 * 任何试图逃逸工作区根目录的路径（如 `../secret`）都会抛出错误，
 * 错误会被 Agent Loop 捕获并以字符串形式交还 LLM。
 */
export function resolveInWorkspace(cwd: string, target: string): string {
  const resolved = path.resolve(cwd, target);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path "${target}" escapes the workspace root`);
  }
  return resolved;
}

/** 递归遍历时默认跳过的目录。 */
export const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage']);
