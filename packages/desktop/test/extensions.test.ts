import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '@cy-agent/agent';
import {
  applyWorkspace,
  WorkspaceManager,
  type WorkspaceSessionHost,
} from '../main/workspace-manager';

let base: string;
let workspaceA: string;
let workspaceB: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'cy-agent-ext-'));
  workspaceA = path.join(base, 'ws-a');
  workspaceB = path.join(base, 'ws-b');
  await mkdir(workspaceA);
  await mkdir(workspaceB);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function fakeHost(): WorkspaceSessionHost & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    isRunning: false,
    activeId: 's-0',
    setSystemPrompt(prompt: string) {
      prompts.push(prompt);
    },
    async newSession() {
      return { id: `s-${prompts.length}` };
    },
  };
}

describe('扩展装配（desktop）', () => {
  it('切换工作区后重扫插件与技能，工具集与技能段随之更新', async () => {
    // workspaceB 放置一个插件与一个技能，workspaceA 为空。
    await mkdir(path.join(workspaceB, '.cy-agent', 'plugins'), { recursive: true });
    await writeFile(
      path.join(workspaceB, '.cy-agent', 'plugins', 'greet.mjs'),
      `export default () => [{ name: 'greet_tool', description: 'greet', parameters: {}, execute: async () => 'hi' }];`,
      'utf8',
    );
    await mkdir(path.join(workspaceB, '.cy-agent', 'skills'), { recursive: true });
    await writeFile(
      path.join(workspaceB, '.cy-agent', 'skills', 'deploy.md'),
      '# 部署流程\n\n按步骤发布。',
      'utf8',
    );

    const registry = new ToolRegistry();
    const host = fakeHost();
    const initial = await applyWorkspace(registry, workspaceA, 'base');
    expect(registry.get('greet_tool')).toBeUndefined();
    expect(initial.extensionToolNames).toHaveLength(0);

    const manager = new WorkspaceManager(
      workspaceA,
      { registry, host, baseSystemPrompt: 'base' },
      {
        extensionToolNames: initial.extensionToolNames,
        mcpServers: initial.mcpServers,
      },
    );

    const result = await manager.selectWorkspace(workspaceB);
    expect(result.workspace).toBe(workspaceB);
    // 新工作区插件工具已注册。
    expect(registry.get('greet_tool')).toBeDefined();
    // 有技能则注册 load_skill。
    expect(registry.get('load_skill')).toBeDefined();
    // systemPrompt 含技能段。
    expect(host.prompts.at(-1)).toContain('deploy');
    expect(host.prompts.at(-1)).toContain('load_skill');
  });

  it('从含扩展的工作区切回空工作区时注销扩展工具', async () => {
    await mkdir(path.join(workspaceA, '.cy-agent', 'plugins'), { recursive: true });
    await writeFile(
      path.join(workspaceA, '.cy-agent', 'plugins', 'a.mjs'),
      `export default () => [{ name: 'a_tool', description: 'a', parameters: {}, execute: async () => 'a' }];`,
      'utf8',
    );

    const registry = new ToolRegistry();
    const host = fakeHost();
    const initial = await applyWorkspace(registry, workspaceA, 'base');
    expect(registry.get('a_tool')).toBeDefined();

    const manager = new WorkspaceManager(
      workspaceA,
      { registry, host, baseSystemPrompt: 'base' },
      {
        extensionToolNames: initial.extensionToolNames,
        mcpServers: initial.mcpServers,
      },
    );

    await manager.selectWorkspace(workspaceB);
    expect(registry.get('a_tool')).toBeUndefined();
    // 内置工具仍在。
    expect(registry.get('read_file')).toBeDefined();
  });
});
