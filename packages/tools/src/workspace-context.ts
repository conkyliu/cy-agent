import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SKIPPED_DIRECTORIES } from './workspace.js';

/** 目录树最大条目数，超过后截断（大仓库概览不阻塞会话启动）。 */
const MAX_TREE_ENTRIES = 120;
/** 目录树最大深度。 */
const MAX_TREE_DEPTH = 2;
/** git 分支探测超时（毫秒）。 */
const GIT_BRANCH_TIMEOUT_MS = 3000;
/** 项目类型标记文件清单（仅检查存在性）。 */
const MARKER_FILES = [
  'README.md',
  'package.json',
  'tsconfig.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
];

/**
 * 生成工作区概览文本：目录树（深度 ≤ 2）+ git 分支 + 标记文件清单。
 * 由宿主在构造 systemPrompt 时拼接注入，让模型首轮即预知工作区结构，
 * 省去 list_directory 试探往返。
 *
 * 容错策略：任一段落 IO 失败即降级省略该段落，绝不抛错
 * （概览是增益信息，不能阻塞会话启动）。
 */
export async function buildWorkspaceOverview(cwd: string): Promise<string> {
  const sections: string[] = [`Workspace root: ${cwd}`];

  const branch = await readGitBranch(cwd);
  if (branch !== null) {
    sections.push(`Git branch: ${branch}`);
  }

  const tree = await readDirectoryTree(cwd);
  if (tree.length > 0) {
    sections.push(`Directory tree (depth ≤ ${MAX_TREE_DEPTH}):\n${tree}`);
  }

  const markers = await readMarkerFiles(cwd);
  if (markers.length > 0) {
    sections.push(`Marker files: ${markers.join(', ')}`);
  }

  if (sections.length === 1) {
    // 全部探测失败时降级为空段，宿主侧不拼接。
    return '';
  }
  return `## Workspace overview\n\n${sections.join('\n\n')}`;
}

/** 将概览拼接到基础 systemPrompt 之后；概览为空（全部探测失败）时原样返回。 */
export function withWorkspaceOverview(baseSystemPrompt: string, overview: string): string {
  if (overview.length === 0) {
    return baseSystemPrompt;
  }
  return `${baseSystemPrompt}\n\n${overview}`;
}

/** 生成目录树文本；不可读目录静默跳过，超上限截断。 */
async function readDirectoryTree(cwd: string): Promise<string> {
  const lines: string[] = [];
  let truncated = false;

  const walk = async (dir: string, indent: string, depth: number): Promise<void> => {
    if (truncated) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      const isDir = entry.isDirectory();
      if (isDir && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      lines.push(`${indent}${isDir ? '[dir] ' : '[file]'} ${entry.name}`);
      if (isDir && depth < MAX_TREE_DEPTH) {
        await walk(path.join(dir, entry.name), `${indent}  `, depth + 1);
      }
    }
  };

  await walk(cwd, '', 1);
  if (lines.length === 0) {
    return '';
  }
  return truncated ? `${lines.join('\n')}… (truncated)` : lines.join('\n');
}

/** 探测 git 当前分支；非仓库或 git 不可用时返回 null（静默省略）。 */
function readGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child: ChildProcess;
    try {
      child = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, GIT_BRANCH_TIMEOUT_MS);

    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      const branch = out.trim();
      finish(code === 0 && branch.length > 0 ? branch : null);
    });
  });
}

/** 返回根目录下存在的标记文件列表。 */
async function readMarkerFiles(cwd: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of MARKER_FILES) {
    try {
      await fs.access(path.join(cwd, name));
      found.push(name);
    } catch {
      // 不存在即跳过。
    }
  }
  return found;
}
