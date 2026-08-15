import fs from 'node:fs/promises';
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

/**
 * 安全版工作区路径解析：在 resolveInWorkspace 的 `..` 防御之上，
 * 额外防御符号链接逃逸（如工作区内 `link -> /etc`）。
 *
 * 做法：从目标路径逐级向上找到最近的存在祖先（含自身），对其 realpath
 * 并校验真实位置仍在工作区（同样取 realpath）之内；工作区内尚不存在的
 * 新建路径，只要其最近存在祖先合法即放行。校验失败抛工具级错误。
 */
export async function resolveInWorkspaceSafe(cwd: string, target: string): Promise<string> {
  const resolved = resolveInWorkspace(cwd, target);
  const realRoot = await fs.realpath(cwd);

  // 逐级向上寻找最近的存在祖先：不存在的路径无法 realpath。
  let probe = resolved;
  for (;;) {
    try {
      await fs.lstat(probe);
      break;
    } catch {
      // 路径不存在，继续向上。
    }
    const parent = path.dirname(probe);
    if (parent === probe) {
      break; // 已到文件系统根（理论上不会发生，resolveInWorkspace 已拦截）。
    }
    probe = parent;
  }

  const real = await fs.realpath(probe);
  const relative = path.relative(realRoot, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path "${target}" escapes the workspace root via symbolic link`);
  }
  return resolved;
}

/** 递归遍历时默认跳过的目录。 */
export const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage']);
