import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolBase, ToolContract } from '@cy-agent/agent';
import { computeLineDiff, getDiffStats } from './diff.js';
import { createGitSnapshot } from './git-snapshot.js';
import { resolveInWorkspaceSafe, SKIPPED_DIRECTORIES } from './workspace.js';

export interface ReadFileArgs {
  path: string;
  /** 1-based 起始行（可选） */
  startLine?: number;
  /** 1-based 结束行，含（可选） */
  endLine?: number;
}

export interface EditFileArgs {
  path: string;
  /** 被替换的精确代码块 */
  targetContent: string;
  /** 替换后的新代码块 */
  replacementContent: string;
  /** 是否允许多处匹配全部替换，默认 false */
  allowMultiple?: boolean;
}

export interface WriteFileArgs {
  path: string;
  content: string;
}

export interface ListDirectoryArgs {
  /** 相对工作区的目录，默认 '.' */
  path?: string;
}

export interface SearchFilesArgs {
  /** 正则表达式（不带定界符） */
  pattern: string;
  /** 搜索根目录，默认 '.' */
  path?: string;
  /** 仅搜索相对路径包含该子串的文件 */
  include?: string;
}

const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_MATCHES = 100;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

export function createReadFileTool(cwd: string): ToolContract<ReadFileArgs, string> {
  return {
    name: 'read_file',
    description:
      'Read the contents of a text file in the workspace, optionally a 1-based line range.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root' },
        startLine: { type: 'integer', minimum: 1, description: 'Optional 1-based start line' },
        endLine: {
          type: 'integer',
          minimum: 1,
          description: 'Optional 1-based inclusive end line',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const file = await resolveInWorkspaceSafe(cwd, args.path);
      const content = await fs.readFile(file, 'utf8');
      if (args.startLine === undefined && args.endLine === undefined) {
        return content;
      }
      const lines = content.split('\n');
      const start = Math.max(1, args.startLine ?? 1);
      const end = Math.min(lines.length, args.endLine ?? lines.length);
      if (start > end) {
        throw new Error(`Invalid line range: startLine ${start} > endLine ${end}`);
      }
      return lines.slice(start - 1, end).join('\n');
    },
  };
}

export function createWriteFileTool(cwd: string): ToolContract<WriteFileArgs, string> {
  return {
    name: 'write_file',
    description:
      'Create or overwrite a text file in the workspace. Requires user approval. ' +
      'Overwriting an existing file in a git repository creates a snapshot first.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const file = await resolveInWorkspaceSafe(cwd, args.path);
      // 安全兜底：覆写已有文件前先创建 git 快照（失败静默跳过，不阻塞写入）。
      const snapshot = await snapshotBeforeOverwrite(cwd, file);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, args.content, 'utf8');
      const base = `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${args.path}`;
      if (snapshot === null) {
        return base;
      }
      return `${base} (snapshot: ${snapshot}; restore with "git cat-file blob ${snapshot} > ${args.path}")`;
    },
  };
}

export function createEditFileTool(cwd: string): ToolContract<EditFileArgs, string> {
  return {
    name: 'edit_file',
    description:
      'Edit an existing text file in the workspace by replacing an exact block of code (targetContent) with new code (replacementContent). ' +
      'Requires user approval. Creates a git snapshot before modifying. Prefer this over write_file when modifying existing files.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root' },
        targetContent: {
          type: 'string',
          description:
            'The exact block of code to be replaced. Must match uniquely in the file unless allowMultiple is true.',
        },
        replacementContent: {
          type: 'string',
          description: 'The new code to replace targetContent with.',
        },
        allowMultiple: {
          type: 'boolean',
          description:
            'Optional. If true, all occurrences of targetContent will be replaced. Defaults to false.',
        },
      },
      required: ['path', 'targetContent', 'replacementContent'],
    },
    execute: async (args) => {
      const file = await resolveInWorkspaceSafe(cwd, args.path);
      let content: string;
      try {
        content = await fs.readFile(file, 'utf8');
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          throw new Error(
            `File "${args.path}" does not exist. Use "write_file" to create new files.`,
          );
        }
        throw error;
      }

      if (args.targetContent.length === 0) {
        throw new Error('targetContent cannot be empty.');
      }

      const occurrences = countOccurrences(content, args.targetContent);
      if (occurrences === 0) {
        throw new Error(
          `Target content not found in "${args.path}". Please verify the exact lines and formatting.`,
        );
      }

      if (occurrences > 1 && args.allowMultiple !== true) {
        throw new Error(
          `Target content occurs ${occurrences} times in "${args.path}". Please provide more surrounding context lines to uniquely identify the block to replace, or set allowMultiple to true.`,
        );
      }

      const newContent =
        args.allowMultiple === true
          ? content.replaceAll(args.targetContent, args.replacementContent)
          : content.replace(args.targetContent, args.replacementContent);

      const snapshot = await snapshotBeforeOverwrite(cwd, file);
      await fs.writeFile(file, newContent, 'utf8');

      const diffStats = getDiffStats(computeLineDiff(args.targetContent, args.replacementContent));
      const base = `Successfully edited ${args.path}: replaced ${occurrences} occurrence(s) (-${diffStats.deleted} +${diffStats.added} lines).`;
      if (snapshot === null) {
        return base;
      }
      return `${base} (snapshot: ${snapshot}; restore with "git cat-file blob ${snapshot} > ${args.path}")`;
    },
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/** 目标文件已存在时创建快照并返回 blob SHA；否则或失败时返回 null。 */
async function snapshotBeforeOverwrite(cwd: string, file: string): Promise<string | null> {
  try {
    await fs.stat(file);
  } catch {
    // 新建文件没有需要保护的内容。
    return null;
  }
  const snapshot = await createGitSnapshot(cwd, file);
  if (snapshot.created && snapshot.blobSha !== undefined) {
    return snapshot.blobSha;
  }
  return null;
}

export function createListDirectoryTool(cwd: string): ToolContract<ListDirectoryArgs, string> {
  return {
    name: 'list_directory',
    description: 'List files and subdirectories of a directory in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to the workspace root, default "."',
        },
      },
    },
    execute: async (args) => {
      const dir = await resolveInWorkspaceSafe(cwd, args.path ?? '.');
      const entries = await fs.readdir(dir, { withFileTypes: true });
      if (entries.length === 0) {
        return '(empty directory)';
      }
      return entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => `${entry.isDirectory() ? '[dir] ' : '[file]'} ${entry.name}`)
        .join('\n');
    },
  };
}

export function createSearchFilesTool(cwd: string): ToolContract<SearchFilesArgs, string> {
  return {
    name: 'search_files',
    description:
      'Search file contents in the workspace with a regular expression. Returns matches as "file:line: text".',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern (without delimiters)' },
        path: { type: 'string', description: 'Root directory to search, default "."' },
        include: {
          type: 'string',
          description: 'Only search files whose relative path contains this substring',
        },
      },
      required: ['pattern'],
    },
    execute: async (args, signal) => {
      const regex = new RegExp(args.pattern);
      const root = await resolveInWorkspaceSafe(cwd, args.path ?? '.');
      const files = await collectFiles(root, signal);

      const matches: string[] = [];
      for (const file of files) {
        if (signal?.aborted) {
          break;
        }
        if (matches.length >= MAX_SEARCH_MATCHES) {
          break;
        }
        const relative = path.relative(cwd, file);
        if (args.include !== undefined && !relative.includes(args.include)) {
          continue;
        }
        try {
          const stat = await fs.stat(file);
          if (stat.size > MAX_SEARCH_FILE_BYTES) {
            continue;
          }
          const content = await fs.readFile(file, 'utf8');
          if (content.includes('\u0000')) {
            continue; // 跳过二进制文件
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && matches.length < MAX_SEARCH_MATCHES; i++) {
            const line = lines[i];
            if (line !== undefined && regex.test(line)) {
              matches.push(`${relative}:${i + 1}: ${line.trim()}`);
            }
          }
        } catch {
          // 单个文件不可读时跳过，不影响整体搜索。
        }
      }
      return matches.length > 0 ? matches.join('\n') : 'No matches found.';
    },
  };
}

async function collectFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    if (signal?.aborted || files.length >= MAX_SEARCH_FILES) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (signal?.aborted || files.length >= MAX_SEARCH_FILES) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await walk(full);
        }
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };

  await walk(root);
  return files;
}

/** 创建全部内置编码工具，所有路径均沙箱化在 cwd 工作区内。 */
export function createCodingTools(cwd: string): ToolBase[] {
  return [
    createReadFileTool(cwd),
    createEditFileTool(cwd),
    createWriteFileTool(cwd),
    createListDirectoryTool(cwd),
    createSearchFilesTool(cwd),
  ];
}
