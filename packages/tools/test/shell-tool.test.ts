import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRunShellTool } from '@cy-agent/tools';

describe('run_shell 工具', () => {
  let cwd: string;

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function setup(): Promise<void> {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-shell-'));
  }

  it('标记为需授权，且成功命令返回 stdout', async () => {
    await setup();
    const tool = createRunShellTool(cwd);
    expect(tool.requiresApproval).toBe(true);
    expect(tool.name).toBe('run_shell');

    const result = await tool.execute({ command: 'echo hello-shell' });
    expect(result).toContain('[stdout]');
    expect(result).toContain('hello-shell');
    expect(result).not.toContain('exit code');
  });

  it('非零退出码格式化为结果而非抛异常（交还 LLM 自我修正）', async () => {
    await setup();
    const tool = createRunShellTool(cwd);
    const result = await tool.execute({ command: 'echo oops 1>&2; exit 3' });
    expect(result).toContain('Command failed with exit code 3');
    expect(result).toContain('[stderr]');
    expect(result).toContain('oops');
  });

  it('无输出的成功命令给出占位说明', async () => {
    await setup();
    const tool = createRunShellTool(cwd);
    const result = await tool.execute({ command: 'true' });
    expect(result).toBe('(completed with no output)');
  });

  it('支持相对工作目录', async () => {
    await setup();
    await fs.mkdir(path.join(cwd, 'nested'));
    const tool = createRunShellTool(cwd);
    const result = await tool.execute({ command: 'pwd', cwd: 'nested' });
    expect(result).toContain('nested');
  });

  it('cwd 逃逸工作区时抛出错误', async () => {
    await setup();
    const tool = createRunShellTool(cwd);
    await expect(tool.execute({ command: 'pwd', cwd: '../..' })).rejects.toThrow(
      /escapes the workspace/,
    );
  });

  it('超时后杀掉进程并返回超时说明', async () => {
    await setup();
    const tool = createRunShellTool(cwd);
    const started = Date.now();
    const result = await tool.execute({ command: 'sleep 5', timeoutMs: 200 });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result).toContain('timed out after 200ms');
  });

  it('AbortSignal 取消正在运行的命令', async () => {
    await setup();
    const tool = createRunShellTool(cwd);
    const controller = new AbortController();
    const pending = tool.execute({ command: 'sleep 5' }, controller.signal);
    setTimeout(() => controller.abort(), 100);
    const result = await pending;
    expect(result).toContain('was cancelled');
  });

  it('已取消的信号直接拒绝执行', async () => {
    await setup();
    const tool = createRunShellTool(cwd);
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute({ command: 'echo hi' }, controller.signal)).rejects.toThrow(
      /cancelled/,
    );
  });
});
