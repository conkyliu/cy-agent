import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorkspaceOverview,
  createReadFileTool,
  createWriteFileTool,
  resolveInWorkspaceSafe,
} from '@cy-agent/tools';

let cwd: string;
let outside: string;

beforeEach(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'cy-agent-ws-'));
  cwd = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  await mkdir(cwd);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(path.dirname(cwd), { recursive: true, force: true });
});

describe('resolveInWorkspaceSafe', () => {
  it('still rejects `..` escapes like resolveInWorkspace', async () => {
    await expect(resolveInWorkspaceSafe(cwd, '../outside/x.txt')).rejects.toThrow(
      /escapes the workspace root/,
    );
  });

  it('rejects paths whose symlink target lies outside the workspace', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(cwd, 'link'));

    await expect(resolveInWorkspaceSafe(cwd, 'link/secret.txt')).rejects.toThrow(
      /escapes the workspace root via symbolic link/,
    );
    // 目标尚不存在、但最近存在祖先为工作区外时同样拒绝。
    await expect(resolveInWorkspaceSafe(cwd, 'link/new.txt')).rejects.toThrow(
      /escapes the workspace root via symbolic link/,
    );
  });

  it('allows symlinks whose real location stays inside the workspace', async () => {
    await writeFile(path.join(cwd, 'real.txt'), 'inside');
    await symlink(path.join(cwd, 'real.txt'), path.join(cwd, 'alias.txt'));

    await expect(resolveInWorkspaceSafe(cwd, 'alias.txt')).resolves.toBe(
      path.join(cwd, 'alias.txt'),
    );
  });

  it('allows new paths under normal in-workspace directories', async () => {
    await mkdir(path.join(cwd, 'src'));
    await expect(resolveInWorkspaceSafe(cwd, 'src/new-file.ts')).resolves.toBe(
      path.join(cwd, 'src/new-file.ts'),
    );
  });

  it('read_file / write_file reject symlink escapes end-to-end', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(cwd, 'link'));

    const read = createReadFileTool(cwd);
    await expect(read.execute({ path: 'link/secret.txt' })).rejects.toThrow(
      /escapes the workspace/,
    );

    const write = createWriteFileTool(cwd);
    await expect(write.execute({ path: 'link/evil.txt', content: 'x' })).rejects.toThrow(
      /escapes the workspace/,
    );
    await expect(rm(path.join(outside, 'evil.txt'), { force: true })).resolves.toBeUndefined();
  });
});

describe('buildWorkspaceOverview', () => {
  it('includes directory tree, git branch and marker files', async () => {
    await writeFile(path.join(cwd, 'package.json'), '{}');
    await writeFile(path.join(cwd, 'README.md'), '# demo');
    await mkdir(path.join(cwd, 'src'));
    await writeFile(path.join(cwd, 'src/index.ts'), 'export {};');
    // 应被跳过的目录。
    await mkdir(path.join(cwd, 'node_modules'));
    await writeFile(path.join(cwd, 'node_modules/dep.js'), 'x');

    execFileSync('git', ['init', '-b', 'main'], { cwd });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd });

    const overview = await buildWorkspaceOverview(cwd);
    expect(overview).toContain(`Workspace root: ${cwd}`);
    expect(overview).toContain('Git branch: main');
    expect(overview).toContain('[dir]  src');
    expect(overview).toContain('[file] package.json');
    expect(overview).toContain('  [file] index.ts');
    expect(overview).not.toContain('node_modules');
    expect(overview).toContain('Marker files: README.md, package.json');
  });

  it('omits git branch section outside a repository', async () => {
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const overview = await buildWorkspaceOverview(cwd);
    expect(overview).not.toContain('Git branch');
    expect(overview).toContain('[file] a.txt');
  });

  it('truncates huge directories without timing out', async () => {
    await mkdir(path.join(cwd, 'big'));
    for (let i = 0; i < 200; i++) {
      await writeFile(path.join(cwd, 'big', `f${i}.txt`), 'x');
    }

    const started = Date.now();
    const overview = await buildWorkspaceOverview(cwd);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(overview).toContain('… (truncated)');
  }, 10_000);
});
