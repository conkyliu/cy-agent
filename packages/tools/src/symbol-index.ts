import fs from 'node:fs/promises';
import path from 'node:path';
import { SKIPPED_DIRECTORIES } from './workspace.js';

/** 单文件索引上限（字节），超限跳过（防止异常大文件拖慢装配）。 */
export const MAX_FILE_SIZE_BYTES = 256 * 1024;
/** 默认索引文件数上限，超过截断（大仓库索引不阻塞会话启动）。 */
const DEFAULT_MAX_INDEXED_FILES = 2000;
/** 默认符号条目数上限，超过截断。 */
const DEFAULT_MAX_SYMBOL_ENTRIES = 20000;

/** 符号种类（各语言抽取器按语义映射到该封闭集合）。 */
export type SymbolKind =
  'function' | 'class' | 'method' | 'interface' | 'type' | 'const' | 'struct' | 'enum';

/** 符号索引条目：定义位置以工作区相对路径（斜杠分隔）+ 1 起始行号表示。 */
export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
}

export interface SymbolIndex {
  entries: SymbolEntry[];
  /** 实际抽取过符号来源的文件数。 */
  filesIndexed: number;
  /** 是否因上限截断（概览行会附标注）。 */
  truncated: boolean;
}

export interface SymbolIndexOptions {
  /** 覆盖默认文件数上限（测试用）。 */
  maxFiles?: number;
  /** 覆盖默认条目数上限（测试用）。 */
  maxEntries?: number;
}

/** 单行抽取结果（行号由扫描器补齐）。 */
interface RawSymbol {
  name: string;
  kind: SymbolKind;
}

/** 语言抽取器契约：按扩展名分派，容错正则实现（零第三方依赖）。 */
export interface LanguageExtractor {
  extensions: ReadonlySet<string>;
  extract(source: string): Array<RawSymbol & { line: number }>;
}

/** JS 关键字黑名单：方法启发式匹配时排除控制流等误报。 */
const JS_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'else',
  'do',
  'try',
  'new',
  'typeof',
  'case',
  'throw',
  'yield',
  'await',
  'delete',
  'in',
  'of',
  'void',
  'instanceof',
]);

const NAME = '[A-Za-z_$][\\w$]*';

/** 逐行尝试有序模式清单，首个命中即返回（每行至多一个符号）。 */
function extractByPatterns(
  source: string,
  patterns: Array<{ pattern: RegExp; kind: SymbolKind }>,
): Array<RawSymbol & { line: number }> {
  const results: Array<RawSymbol & { line: number }> = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const { pattern, kind } of patterns) {
      const name = pattern.exec(line)?.[1];
      if (name !== undefined) {
        results.push({ name, kind, line: index + 1 });
        break;
      }
    }
  }
  return results;
}

/** TypeScript / JavaScript 抽取器（best-effort，声明级启发式）。 */
const tsExtractor: LanguageExtractor = {
  extensions: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']),
  extract(source) {
    const patterns: Array<{ pattern: RegExp; kind: SymbolKind }> = [
      {
        pattern: new RegExp(
          `(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+(?:\\*\\s*)?(${NAME})`,
        ),
        kind: 'function',
      },
      {
        pattern: new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${NAME})`),
        kind: 'class',
      },
      { pattern: new RegExp(`(?:export\\s+)?interface\\s+(${NAME})`), kind: 'interface' },
      { pattern: new RegExp(`(?:export\\s+)?type\\s+(${NAME})\\s*=[^=]`), kind: 'type' },
      { pattern: new RegExp(`^export\\s+(?:const|let|var)\\s+(${NAME})`), kind: 'const' },
    ];
    const results: Array<RawSymbol & { line: number }> = [];
    // 方法启发式：缩进 + 可选修饰符 + name(args) + { ；排除关键字误报。
    const methodPattern = new RegExp(
      `^[\\t ]+(?:(?:public|private|protected|static|async|readonly|get|set)\\s+)*(${NAME})\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{`,
    );
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      let matched = false;
      for (const { pattern, kind } of patterns) {
        const name = pattern.exec(line)?.[1];
        if (name !== undefined) {
          results.push({ name, kind, line: index + 1 });
          matched = true;
          break;
        }
      }
      if (!matched) {
        const name = methodPattern.exec(line)?.[1];
        if (name !== undefined && !JS_KEYWORDS.has(name)) {
          results.push({ name, kind: 'method', line: index + 1 });
        }
      }
    }
    return results;
  },
};

/** Python 抽取器：def（含 async）缩进为方法，顶层为函数。 */
const pythonExtractor: LanguageExtractor = {
  extensions: new Set(['.py']),
  extract(source) {
    return extractByPatterns(source, [
      { pattern: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class' },
    ]).concat(
      source.split('\n').flatMap((line, index) => {
        const match = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line);
        if (match === null || match[1] === undefined || match[2] === undefined) {
          return [];
        }
        const kind: SymbolKind = match[1].length > 0 ? 'method' : 'function';
        return [{ name: match[2], kind, line: index + 1 }];
      }),
    );
  },
};

/** Go 抽取器：func（带接收者为方法）、type（struct/interface 细分）。 */
const goExtractor: LanguageExtractor = {
  extensions: new Set(['.go']),
  extract(source) {
    return extractByPatterns(source, [
      { pattern: /^func\s+\([^)]*\)\s*([A-Za-z_]\w*)/, kind: 'method' },
      { pattern: /^func\s+([A-Za-z_]\w*)/, kind: 'function' },
      { pattern: /^type\s+([A-Za-z_]\w*)\s+struct/, kind: 'struct' },
      { pattern: /^type\s+([A-Za-z_]\w*)\s+interface/, kind: 'interface' },
      { pattern: /^type\s+([A-Za-z_]\w*)/, kind: 'type' },
    ]);
  },
};

/** Rust 抽取器：fn（缩进为 impl 块方法）、struct / enum / type 别名。 */
const rustExtractor: LanguageExtractor = {
  extensions: new Set(['.rs']),
  extract(source) {
    const results: Array<RawSymbol & { line: number }> = [];
    const modifiers = '(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+|const\\s+|unsafe\\s+)*';
    const fnPattern = new RegExp(`^(\\s*)${modifiers}fn\\s+([A-Za-z_]\\w*)`);
    const typePatterns: Array<{ pattern: RegExp; kind: SymbolKind }> = [
      { pattern: new RegExp(`^\\s*${modifiers}struct\\s+([A-Za-z_]\\w*)`), kind: 'struct' },
      { pattern: new RegExp(`^\\s*${modifiers}enum\\s+([A-Za-z_]\\w*)`), kind: 'enum' },
      { pattern: new RegExp(`^\\s*${modifiers}type\\s+([A-Za-z_]\\w*)\\s*=`), kind: 'type' },
    ];
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const fn = fnPattern.exec(line);
      const fnIndent = fn?.[1];
      const fnName = fn?.[2];
      if (fnIndent !== undefined && fnName !== undefined) {
        const kind: SymbolKind = fnIndent.length > 0 ? 'method' : 'function';
        results.push({ name: fnName, kind, line: index + 1 });
        continue;
      }
      for (const { pattern, kind } of typePatterns) {
        const name = pattern.exec(line)?.[1];
        if (name !== undefined) {
          results.push({ name, kind, line: index + 1 });
          break;
        }
      }
    }
    return results;
  },
};

const EXTRACTORS: LanguageExtractor[] = [tsExtractor, pythonExtractor, goExtractor, rustExtractor];

/** 按文件扩展名查找抽取器；不支持的扩展名返回 undefined。 */
function extractorFor(fileName: string): LanguageExtractor | undefined {
  const extension = path.extname(fileName).toLowerCase();
  return EXTRACTORS.find((extractor) => extractor.extensions.has(extension));
}

/**
 * 构建工作区符号索引：递归扫描源码文件并按语言抽取符号定义。
 *
 * 有界容错：沿用 SKIPPED_DIRECTORIES、跳过隐藏条目与超限文件，单文件
 * 读取失败跳过；文件数 / 条目数超上限时截断并置 truncated 标记。
 */
export async function buildSymbolIndex(
  workspace: string,
  options: SymbolIndexOptions = {},
): Promise<SymbolIndex> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_INDEXED_FILES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_SYMBOL_ENTRIES;
  const entries: SymbolEntry[] = [];
  let filesIndexed = 0;
  let truncated = false;

  const walk = async (dir: string): Promise<void> => {
    if (truncated) {
      return;
    }
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (truncated) {
        return;
      }
      if (dirent.name.startsWith('.')) {
        continue;
      }
      if (dirent.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(dirent.name)) {
          await walk(path.join(dir, dirent.name));
        }
        continue;
      }
      if (!dirent.isFile()) {
        continue;
      }
      const extractor = extractorFor(dirent.name);
      if (extractor === undefined) {
        continue;
      }
      const full = path.join(dir, dirent.name);
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_FILE_SIZE_BYTES) {
          continue;
        }
        const source = await fs.readFile(full, 'utf8');
        const relative = path.relative(workspace, full).split(path.sep).join('/');
        for (const raw of extractor.extract(source)) {
          if (entries.length >= maxEntries) {
            truncated = true;
            break;
          }
          entries.push({ name: raw.name, kind: raw.kind, file: relative, line: raw.line });
        }
        filesIndexed += 1;
        if (filesIndexed >= maxFiles) {
          truncated = true;
        }
      } catch {
        // 单文件读取失败跳过，不中断整体扫描。
      }
    }
  };

  await walk(workspace);
  return { entries, filesIndexed, truncated };
}

/** 生成概览的符号索引行；无符号时返回空串（宿主不拼接）。 */
export function buildSymbolIndexSection(index: SymbolIndex): string {
  if (index.entries.length === 0) {
    return '';
  }
  const suffix = index.truncated ? ', truncated' : '';
  return `Symbol index: ${index.entries.length} symbols from ${index.filesIndexed} files${suffix} (use find_symbol)`;
}
