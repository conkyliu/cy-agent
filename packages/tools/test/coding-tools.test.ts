import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolBase } from '@cy-agent/agent';
import { AgentSession, ToolRegistry } from '@cy-agent/agent';
import {
  createCodingTools,
  createListDirectoryTool,
  createReadFileTool,
  createSearchFilesTool,
  createWriteFileTool,
} from '@cy-agent/tools';
import { MockProvider, textChunks, toolCallChunks } from '../../agent/test/fixtures.js';
import type { AgentEvent } from '@cy-agent/protocol';

let cwd: string;
let tools: Map<string, ToolBase>;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'cy-agent-tools-'));
  tools = new Map(createCodingTools(cwd).map((tool) => [tool.name, tool]));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function tool(name: string): ToolBase {
  const found = tools.get(name);
  if (!found) {
    throw new Error(`Tool ${name} not found`);
  }
  return found;
}

describe('coding tools', () => {
  it('read_file reads full content and line ranges', async () => {
    await writeFile(path.join(cwd, 'a.txt'), 'l1\nl2\nl3\nl4');

    const read = createReadFileTool(cwd);
    await expect(read.execute({ path: 'a.txt' })).resolves.toBe('l1\nl2\nl3\nl4');
    await expect(read.execute({ path: 'a.txt', startLine: 2, endLine: 3 })).resolves.toBe('l2\nl3');
    await expect(read.execute({ path: 'missing.txt' })).rejects.toThrow(/ENOENT/);
    await expect(read.execute({ path: 'a.txt', startLine: 3, endLine: 1 })).rejects.toThrow(
      /Invalid line range/,
    );
  });

  it('write_file creates nested directories and requires approval', async () => {
    const write = createWriteFileTool(cwd);
    expect(write.requiresApproval).toBe(true);

    const result = await write.execute({ path: 'nested/dir/b.txt', content: '你好 cy-agent' });
    expect(result).toMatch(/Wrote .* bytes to nested\/dir\/b.txt/);
    await expect(readFile(path.join(cwd, 'nested/dir/b.txt'), 'utf8')).resolves.toBe(
      '你好 cy-agent',
    );
  });

  it('edit_file replaces unique target block and handles errors gracefully', async () => {
    const edit = tool('edit_file');
    expect(edit.requiresApproval).toBe(true);

    await writeFile(path.join(cwd, 'sample.ts'), 'function add(a: number, b: number) {\n  return a - b;\n}\n');

    // 正常精准替换
    const result = await edit.execute({
      path: 'sample.ts',
      targetContent: '  return a - b;',
      replacementContent: '  return a + b;',
    });
    expect(result).toContain('Successfully edited sample.ts');
    await expect(readFile(path.join(cwd, 'sample.ts'), 'utf8')).resolves.toBe(
      'function add(a: number, b: number) {\n  return a + b;\n}\n',
    );

    // 文件不存在
    await expect(
      edit.execute({ path: 'nonexistent.ts', targetContent: 'a', replacementContent: 'b' }),
    ).rejects.toThrow(/does not exist.*write_file/);

    // 目标内容不存在
    await expect(
      edit.execute({ path: 'sample.ts', targetContent: 'missing code', replacementContent: 'new code' }),
    ).rejects.toThrow(/Target content not found/);

    // 目标内容为空
    await expect(
      edit.execute({ path: 'sample.ts', targetContent: '', replacementContent: 'x' }),
    ).rejects.toThrow(/targetContent cannot be empty/);

    // 多处匹配且未设置 allowMultiple
    await writeFile(path.join(cwd, 'multi.txt'), 'foo\nbar\nfoo\n');
    await expect(
      edit.execute({ path: 'multi.txt', targetContent: 'foo', replacementContent: 'baz' }),
    ).rejects.toThrow(/occurs 2 times/);

    // 多处匹配且设置了 allowMultiple: true
    const multiResult = await edit.execute({
      path: 'multi.txt',
      targetContent: 'foo',
      replacementContent: 'baz',
      allowMultiple: true,
    });
    expect(multiResult).toContain('replaced 2 occurrence(s)');
    await expect(readFile(path.join(cwd, 'multi.txt'), 'utf8')).resolves.toBe('baz\nbar\nbaz\n');
  });

  it('list_directory lists sorted entries with type markers', async () => {
    await writeFile(path.join(cwd, 'z.txt'), 'z');
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await mkdir(path.join(cwd, 'sub'));

    const list = createListDirectoryTool(cwd);
    await expect(list.execute({})).resolves.toBe('[file] a.txt\n[dir]  sub\n[file] z.txt');

    await mkdir(path.join(cwd, 'empty'));
    await expect(list.execute({ path: 'empty' })).resolves.toBe('(empty directory)');
  });

  it('search_files returns file:line matches and honors include filter', async () => {
    await writeFile(path.join(cwd, 'one.ts'), 'const foo = 1;\nconst bar = 2;\n');
    await writeFile(path.join(cwd, 'two.md'), 'mention foo here\n');

    const search = createSearchFilesTool(cwd);
    const all = await search.execute({ pattern: 'foo' });
    expect(all).toContain('one.ts:1: const foo = 1;');
    expect(all).toContain('two.md:1: mention foo here');

    const onlyTs = await search.execute({ pattern: 'foo', include: '.ts' });
    expect(onlyTs).toContain('one.ts');
    expect(onlyTs).not.toContain('two.md');

    await expect(search.execute({ pattern: 'nomatch-xyz' })).resolves.toBe('No matches found.');
    await expect(search.execute({ pattern: '[invalid' })).rejects.toThrow();
  });

  it('rejects paths escaping the workspace sandbox', async () => {
    await expect(tool('read_file').execute({ path: '../outside.txt' })).rejects.toThrow(
      /escapes the workspace/,
    );
    await expect(
      tool('write_file').execute({ path: '../../evil.txt', content: 'x' }),
    ).rejects.toThrow(/escapes the workspace/);
    await expect(
      tool('edit_file').execute({
        path: '../../evil.txt',
        targetContent: 'a',
        replacementContent: 'b',
      }),
    ).rejects.toThrow(/escapes the workspace/);
    await expect(tool('list_directory').execute({ path: '..' })).rejects.toThrow(
      /escapes the workspace/,
    );
    await expect(tool('search_files').execute({ pattern: 'x', path: '..' })).rejects.toThrow(
      /escapes the workspace/,
    );
  });

  it('integrates with AgentSession end-to-end', async () => {
    await writeFile(path.join(cwd, 'hello.txt'), 'hello world');

    const provider = new MockProvider([
      toolCallChunks('tc1', 'read_file', { path: 'hello.txt' }),
      textChunks('The file says hello world.'),
    ]);
    const registry = new ToolRegistry();
    for (const codingTool of createCodingTools(cwd)) {
      registry.register(codingTool);
    }
    const agent = new AgentSession({ provider, registry });

    const events: AgentEvent[] = [];
    for await (const event of agent.run('read hello.txt')) {
      events.push(event);
    }

    const completed = events.find((e) => e.type === 'tool_execution_completed');
    expect(completed).toMatchObject({ result: 'hello world' });
    expect(events[events.length - 1]?.type).toBe('session_completed');
  });
});
