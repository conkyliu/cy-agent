import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSymbolIndex,
  buildSymbolIndexSection,
  MAX_FILE_SIZE_BYTES,
  type SymbolIndex,
} from '../src/index.js';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-symidx-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

async function writeSource(relative: string, content: string): Promise<void> {
  const full = path.join(workspace, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

function entryOf(index: SymbolIndex, name: string) {
  return index.entries.find((entry) => entry.name === name);
}

describe('buildSymbolIndex', () => {
  it('多语言符号抽取：TS/Python/Go/Rust 各就各位', async () => {
    await writeSource(
      'src/app.ts',
      [
        'export class Foo {',
        '  greet(name: string): string {',
        '    return name;',
        '  }',
        '}',
        'export interface Bar {',
        '  id: number;',
        '}',
        'export type Alias = string;',
        'export const BAZ = 1;',
        'async function helper(): Promise<void> {}',
      ].join('\n'),
    );
    await writeSource(
      'script.py',
      [
        'import os',
        '',
        'class Service:',
        '    def run(self):',
        '        pass',
        '',
        'async def fetch_data():',
        '    pass',
      ].join('\n'),
    );
    await writeSource(
      'main.go',
      [
        'package main',
        '',
        'type Config struct {',
        '  Port int',
        '}',
        '',
        'func main() {',
        '}',
        '',
        'func (c *Config) Start() {',
        '}',
      ].join('\n'),
    );
    await writeSource(
      'lib.rs',
      [
        'pub struct Point {',
        '  x: i32,',
        '}',
        '',
        'pub enum Color {',
        '  Red,',
        '}',
        '',
        'pub fn run() {',
        '}',
        '',
        'impl Point {',
        '  pub fn move_by(&mut self) {',
        '  }',
        '}',
      ].join('\n'),
    );

    const index = await buildSymbolIndex(workspace);
    expect(index.filesIndexed).toBe(4);
    expect(index.truncated).toBe(false);

    expect(entryOf(index, 'Foo')).toMatchObject({ kind: 'class', file: 'src/app.ts', line: 1 });
    expect(entryOf(index, 'greet')).toMatchObject({ kind: 'method', file: 'src/app.ts' });
    expect(entryOf(index, 'Bar')).toMatchObject({ kind: 'interface' });
    expect(entryOf(index, 'Alias')).toMatchObject({ kind: 'type' });
    expect(entryOf(index, 'BAZ')).toMatchObject({ kind: 'const' });
    expect(entryOf(index, 'helper')).toMatchObject({ kind: 'function' });

    expect(entryOf(index, 'Service')).toMatchObject({ kind: 'class', file: 'script.py' });
    expect(
      index.entries.find((entry) => entry.name === 'run' && entry.file === 'script.py'),
    ).toMatchObject({ kind: 'method', file: 'script.py' });
    expect(entryOf(index, 'fetch_data')).toMatchObject({ kind: 'function', file: 'script.py' });

    expect(entryOf(index, 'Config')).toMatchObject({ kind: 'struct', file: 'main.go' });
    expect(entryOf(index, 'main')).toMatchObject({ kind: 'function', file: 'main.go' });
    expect(entryOf(index, 'Start')).toMatchObject({ kind: 'method', file: 'main.go' });

    expect(entryOf(index, 'Point')).toMatchObject({ kind: 'struct', file: 'lib.rs' });
    expect(entryOf(index, 'Color')).toMatchObject({ kind: 'enum', file: 'lib.rs' });
    expect(
      index.entries.find((entry) => entry.name === 'run' && entry.file === 'lib.rs'),
    ).toMatchObject({ kind: 'function', file: 'lib.rs' });
    expect(entryOf(index, 'move_by')).toMatchObject({ kind: 'method', file: 'lib.rs' });
  });

  it('跳过 node_modules、隐藏目录与超限文件', async () => {
    await writeSource('node_modules/dep/index.ts', 'export class Hidden {}');
    await writeSource('.hidden/secret.ts', 'export class Secret {}');
    await writeSource(
      'big.ts',
      `// padding\n${'x'.repeat(MAX_FILE_SIZE_BYTES)}\nexport class Big {}`,
    );
    await writeSource('src/ok.ts', 'export class Ok {}');

    const index = await buildSymbolIndex(workspace);
    const names = index.entries.map((entry) => entry.name);
    expect(names).toContain('Ok');
    expect(names).not.toContain('Hidden');
    expect(names).not.toContain('Secret');
    expect(names).not.toContain('Big');
    expect(index.filesIndexed).toBe(1);
    expect(index.truncated).toBe(false);
  });

  it('文件数超上限时截断', async () => {
    await writeSource('a.ts', 'export class A {}');
    await writeSource('b.ts', 'export class B {}');
    await writeSource('c.ts', 'export class C {}');
    const index = await buildSymbolIndex(workspace, { maxFiles: 2 });
    expect(index.filesIndexed).toBe(2);
    expect(index.truncated).toBe(true);
  });

  it('条目数超上限时截断', async () => {
    await writeSource(
      'many.ts',
      Array.from({ length: 5 }, (_, index) => `export class K${index} {}`).join('\n'),
    );
    const index = await buildSymbolIndex(workspace, { maxEntries: 3 });
    expect(index.entries).toHaveLength(3);
    expect(index.truncated).toBe(true);
  });

  it('空工作区返回空索引', async () => {
    const index = await buildSymbolIndex(workspace);
    expect(index.entries).toHaveLength(0);
    expect(index.filesIndexed).toBe(0);
    expect(index.truncated).toBe(false);
  });
});

describe('buildSymbolIndexSection', () => {
  it('无符号为空；有符号含计数与 find_symbol 提示；截断附标注', () => {
    expect(buildSymbolIndexSection({ entries: [], filesIndexed: 0, truncated: false })).toBe('');
    const section = buildSymbolIndexSection({
      entries: [{ name: 'A', kind: 'class', file: 'a.ts', line: 1 }],
      filesIndexed: 1,
      truncated: false,
    });
    expect(section).toBe('Symbol index: 1 symbols from 1 files (use find_symbol)');
    const truncatedSection = buildSymbolIndexSection({
      entries: [{ name: 'A', kind: 'class', file: 'a.ts', line: 1 }],
      filesIndexed: 1,
      truncated: true,
    });
    expect(truncatedSection).toContain('truncated');
  });
});
