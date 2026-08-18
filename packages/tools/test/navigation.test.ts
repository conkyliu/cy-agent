import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFileDependenciesTool,
  createFindSymbolTool,
  type SymbolEntry,
  type SymbolIndex,
} from '../src/index.js';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-nav-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

function makeIndex(entries: SymbolEntry[]): SymbolIndex {
  return { entries, filesIndexed: entries.length, truncated: false };
}

describe('find_symbol', () => {
  it('命中返回 file:line [kind] 清单且免授权', async () => {
    const tool = createFindSymbolTool(
      makeIndex([
        { name: 'Foo', kind: 'class', file: 'src/a.ts', line: 3 },
        { name: 'Foo', kind: 'function', file: 'src/b.ts', line: 7 },
      ]),
    );
    expect(tool.requiresApproval).toBeFalsy();
    const result = await tool.execute({ name: 'Foo' });
    expect(result).toContain('src/a.ts:3 [class]');
    expect(result).toContain('src/b.ts:7 [function]');
  });

  it('kind 过滤仅返回匹配种类', async () => {
    const tool = createFindSymbolTool(
      makeIndex([
        { name: 'Foo', kind: 'class', file: 'src/a.ts', line: 3 },
        { name: 'Foo', kind: 'function', file: 'src/b.ts', line: 7 },
      ]),
    );
    const result = await tool.execute({ name: 'Foo', kind: 'class' });
    expect(result).toBe('src/a.ts:3 [class]');
  });

  it('未命中返回引导文本（改用 search_files）', async () => {
    const tool = createFindSymbolTool(makeIndex([]));
    const result = await tool.execute({ name: 'Ghost' });
    expect(result).toContain('No symbol "Ghost"');
    expect(result).toContain('search_files');
  });

  it('结果超上限截断并提示收窄', async () => {
    const entries: SymbolEntry[] = Array.from({ length: 5 }, (_, index) => ({
      name: 'Dup',
      kind: 'function',
      file: `f${index}.ts`,
      line: index + 1,
    }));
    const tool = createFindSymbolTool(makeIndex(entries), 3);
    const result = await tool.execute({ name: 'Dup' });
    const lines = result.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('2 more');
  });
});

describe('file_dependencies', () => {
  it('TS 相对导入解析为工作区文件，外部依赖标注 (external)', async () => {
    await fs.mkdir(path.join(workspace, 'src', 'lib'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'sibling.ts'), 'export const x = 1;', 'utf8');
    await fs.writeFile(path.join(workspace, 'src', 'lib', 'index.ts'), '', 'utf8');
    await fs.writeFile(
      path.join(workspace, 'src', 'main.ts'),
      [
        "import { x } from './sibling';",
        "import { util } from './lib';",
        "import fs from 'node:fs';",
        "import lodash from 'lodash';",
      ].join('\n'),
      'utf8',
    );
    const tool = createFileDependenciesTool(workspace);
    expect(tool.requiresApproval).toBeFalsy();
    const result = await tool.execute({ path: 'src/main.ts' });
    expect(result).toContain('- src/sibling.ts');
    expect(result).toContain('- src/lib/index.ts');
    expect(result).toContain('node:fs (external)');
    expect(result).toContain('lodash (external)');
  });

  it('Python import 与 from-import 抽取', async () => {
    await fs.writeFile(
      path.join(workspace, 'app.py'),
      ['import os, sys', 'from pathlib import Path'].join('\n'),
      'utf8',
    );
    const tool = createFileDependenciesTool(workspace);
    const result = await tool.execute({ path: 'app.py' });
    expect(result).toContain('os (external)');
    expect(result).toContain('sys (external)');
    expect(result).toContain('pathlib (external)');
  });

  it('不支持语言返回错误文本', async () => {
    await fs.writeFile(path.join(workspace, 'main.go'), 'package main', 'utf8');
    const tool = createFileDependenciesTool(workspace);
    const result = await tool.execute({ path: 'main.go' });
    expect(result).toContain('Unsupported file type');
  });

  it('不存在文件与越权路径均返回错误文本', async () => {
    const tool = createFileDependenciesTool(workspace);
    const missing = await tool.execute({ path: 'nope.ts' });
    expect(missing).toContain('not found');
    const escape = await tool.execute({ path: '../outside.ts' });
    expect(escape).toContain('escapes the workspace root');
  });
});
