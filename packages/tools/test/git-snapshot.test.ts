import { afterEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGitSnapshot } from '../src/git-snapshot.js';
import { createWriteFileTool } from '../src/coding-tools.js';

/** 创建临时目录；withRepo 为 true 时初始化为空 git 仓库。 */
async function setupWorkspace(withRepo: boolean): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-git-snapshot-'));
  if (withRepo) {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
  }
  return dir;
}

describe('createGitSnapshot', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('git 仓库内创建 blob 快照且内容可还原', async () => {
    dir = await setupWorkspace(true);
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'original content', 'utf8');

    const snapshot = await createGitSnapshot(dir, file);

    expect(snapshot.created).toBe(true);
    expect(snapshot.blobSha).toMatch(/^[0-9a-f]{40}$/);
    // 快照不触碰索引与工作区状态。
    const restored = execSync(`git cat-file blob ${snapshot.blobSha}`, { cwd: dir }).toString();
    expect(restored).toBe('original content');
    const status = execSync('git status --porcelain', { cwd: dir }).toString();
    expect(status).toContain('a.txt'); // 文件仍是未跟踪状态，未被 git add
  });

  it('非 git 仓库静默跳过', async () => {
    dir = await setupWorkspace(false);
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'x', 'utf8');

    const snapshot = await createGitSnapshot(dir, file);

    expect(snapshot.created).toBe(false);
    expect(snapshot.reason).toBe('not-a-git-repo');
  });
});

describe('write_file 覆写前快照', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('覆写 git 仓库内已有文件：结果附快照 SHA 且原内容可恢复', async () => {
    dir = await setupWorkspace(true);
    await fs.writeFile(path.join(dir, 'a.txt'), 'precious original', 'utf8');
    const tool = createWriteFileTool(dir);

    const result = await tool.execute({ path: 'a.txt', content: 'overwritten' });

    expect(result).toContain('Wrote 11 bytes to a.txt');
    const match = /\(snapshot: ([0-9a-f]{40});/.exec(result);
    expect(match).not.toBeNull();
    // 文件已被覆写……
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('overwritten');
    // ……但原内容可通过快照恢复。
    const restored = execSync(`git cat-file blob ${match?.[1] ?? ''}`, { cwd: dir }).toString();
    expect(restored).toBe('precious original');
  });

  it('新建文件不创建快照', async () => {
    dir = await setupWorkspace(true);
    const tool = createWriteFileTool(dir);

    const result = await tool.execute({ path: 'fresh.txt', content: 'hello' });

    expect(result).toBe('Wrote 5 bytes to fresh.txt');
  });

  it('非 git 目录覆写已有文件：正常写入且不提快照', async () => {
    dir = await setupWorkspace(false);
    await fs.writeFile(path.join(dir, 'a.txt'), 'old', 'utf8');
    const tool = createWriteFileTool(dir);

    const result = await tool.execute({ path: 'a.txt', content: 'new' });

    expect(result).toBe('Wrote 3 bytes to a.txt');
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('new');
  });
});
