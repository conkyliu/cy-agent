import fs from 'node:fs';
import path from 'node:path';
import type { ToolContract } from '@cy-agent/agent';
import type { SymbolIndex, SymbolKind } from './symbol-index.js';
import { resolveInWorkspace } from './workspace.js';

/** find_symbol 单次返回条目上限，超过提示收窄查询。 */
const MAX_FIND_RESULTS = 50;

/** kind 过滤参数可选值（与 SymbolKind 保持同步）。 */
const SYMBOL_KINDS: SymbolKind[] = [
  'function',
  'class',
  'method',
  'interface',
  'type',
  'const',
  'struct',
  'enum',
];

export interface FindSymbolArgs {
  name: string;
  kind?: SymbolKind;
}

/**
 * 符号定位工具：按名称查询索引中的定义清单，输出 `file:line [kind]`。
 * 只读免授权；未命中返回引导文本（改用 search_files）。
 */
export function createFindSymbolTool(
  index: SymbolIndex,
  maxResults: number = MAX_FIND_RESULTS,
): ToolContract<FindSymbolArgs, string> {
  return {
    name: 'find_symbol',
    description:
      'Locate symbol definitions in the workspace index by exact name. ' +
      'Returns "file:line [kind]" entries. Use instead of search_files when you know a symbol name. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact symbol name to look up' },
        kind: { type: 'string', enum: SYMBOL_KINDS, description: 'Optional symbol kind filter' },
      },
      required: ['name'],
    },
    execute: async (args) => {
      let matches = index.entries.filter((entry) => entry.name === args.name);
      if (args.kind !== undefined) {
        matches = matches.filter((entry) => entry.kind === args.kind);
      }
      if (matches.length === 0) {
        return `No symbol "${args.name}" found in the index. Try search_files with a regex pattern.`;
      }
      const lines = matches
        .slice(0, maxResults)
        .map((entry) => `${entry.file}:${entry.line} [${entry.kind}]`);
      if (matches.length > maxResults) {
        lines.push(`… (${matches.length - maxResults} more, refine with the kind filter)`);
      }
      return lines.join('\n');
    },
  };
}

export interface FileDependenciesArgs {
  path: string;
}

/** 支持依赖解析的 TS/JS 扩展名。 */
const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
/** 相对导入解析时尝试补全的扩展名。 */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];
/** 相对导入解析时尝试的 index 文件名。 */
const RESOLVE_INDEX_FILES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs',
];

/** 抽取 TS/JS 导入说明符（import / export-from / require / 动态 import），去重保序。 */
function extractJsImports(source: string): string[] {
  const patterns = [
    /import\s+[\w$*,{}\s]+?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /export\s+[\w$*,{}\s]+?from\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const seen = new Set<string>();
  const specifiers: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec !== undefined && !seen.has(spec)) {
        seen.add(spec);
        specifiers.push(spec);
      }
    }
  }
  return specifiers;
}

/** 抽取 Python 导入模块名（import / from-import），去重保序。 */
function extractPythonImports(source: string): string[] {
  const seen = new Set<string>();
  const modules: string[] = [];
  const push = (module: string): void => {
    if (module.length > 0 && !seen.has(module)) {
      seen.add(module);
      modules.push(module);
    }
  };
  for (const match of source.matchAll(/^from\s+([.\w]+)\s+import\b/gm)) {
    const module = match[1];
    if (module !== undefined) {
      push(module);
    }
  }
  for (const match of source.matchAll(/^import\s+(.+)$/gm)) {
    const raw = match[1];
    if (raw === undefined) {
      continue;
    }
    for (const part of raw.split(',')) {
      const module = part.split(/\s+as\s+/)[0]?.trim() ?? '';
      if (/^[.\w]+$/.test(module)) {
        push(module);
      }
    }
  }
  return modules;
}

/** 相对导入解析：补全扩展名或 index 文件；无法解析返回 null。 */
function resolveRelativeImport(workspace: string, fromDir: string, spec: string): string | null {
  const base = path.resolve(fromDir, spec);
  const candidates = [base, ...RESOLVE_EXTENSIONS.map((ext) => `${base}${ext}`)];
  for (const indexFile of RESOLVE_INDEX_FILES) {
    candidates.push(path.join(base, indexFile));
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return path.relative(workspace, candidate).split(path.sep).join('/');
      }
    } catch {
      // 候选不存在，继续尝试。
    }
  }
  return null;
}

/**
 * 文件依赖解析工具：列出源文件的导入依赖。
 * 相对导入解析为工作区内实际文件，其余标注 (external)。只读免授权。
 */
export function createFileDependenciesTool(
  workspace: string,
): ToolContract<FileDependenciesArgs, string> {
  return {
    name: 'file_dependencies',
    description:
      'List import dependencies of a workspace source file (TS/JS/Python). ' +
      'Relative imports are resolved to workspace files; others are marked (external). Read-only.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      let absolute: string;
      try {
        absolute = resolveInWorkspace(workspace, args.path);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      let source: string;
      try {
        source = fs.readFileSync(absolute, 'utf8');
      } catch {
        return `File "${args.path}" not found in the workspace.`;
      }
      const extension = path.extname(absolute).toLowerCase();
      let specifiers: string[];
      if (TS_EXTENSIONS.includes(extension)) {
        specifiers = extractJsImports(source);
      } else if (extension === '.py') {
        specifiers = extractPythonImports(source);
      } else {
        return `Unsupported file type "${extension}" for dependency analysis (supported: TS/JS/Python).`;
      }
      if (specifiers.length === 0) {
        return `No dependencies found in ${args.path}.`;
      }
      const lines = specifiers.map((spec) => {
        const resolved = spec.startsWith('.')
          ? resolveRelativeImport(workspace, path.dirname(absolute), spec)
          : null;
        return resolved ?? `${spec} (external)`;
      });
      return `Dependencies of ${args.path}:\n${lines.map((line) => `- ${line}`).join('\n')}`;
    },
  };
}
