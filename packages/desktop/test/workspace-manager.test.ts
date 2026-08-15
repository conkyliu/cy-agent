import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry, type ProviderChunk, type ProviderContract } from '@cy-agent/agent';
import type { SessionStore, SessionSummary, StoredSession } from '@cy-agent/storage';
import { SessionManager } from '../main/session-manager';
import { WorkspaceMemory } from '../main/workspace-memory';
import {
  buildSystemPrompt,
  registerWorkspaceTools,
  restoreWorkspace,
  WorkspaceManager,
} from '../main/workspace-manager';

let base: string;
let workspaceA: string;
let workspaceB: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'cy-agent-wsm-'));
  workspaceA = path.join(base, 'ws-a');
  workspaceB = path.join(base, 'ws-b');
  await mkdir(workspaceA);
  await mkdir(workspaceB);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

class MemoryStore implements SessionStore {
  readonly sessions = new Map<string, StoredSession>();
  async save(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async load(id: string): Promise<StoredSession | null> {
    return this.sessions.get(id) ?? null;
  }
  async list(): Promise<SessionSummary[]> {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
    }));
  }
  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

function textProvider(): ProviderContract {
  return {
    name: 'fake-text',
    async *generateStream(): AsyncGenerator<ProviderChunk, void, unknown> {
      yield { type: 'text', text: 'ok' };
    },
  };
}

function createManager(): { manager: SessionManager; registry: ToolRegistry } {
  const registry = new ToolRegistry();
  registerWorkspaceTools(registry, workspaceA);
  const manager = new SessionManager({
    provider: textProvider(),
    registry,
    store: new MemoryStore(),
    systemPrompt: 'base',
    configured: true,
  });
  return { manager, registry };
}

describe('WorkspaceMemory', () => {
  it('读写往返；文件缺失或损坏返回 null', async () => {
    const file = path.join(base, 'state', 'workspace.json');
    const memory = new WorkspaceMemory(file);
    expect(memory.load()).toBeNull();

    memory.save('/tmp/some-project');
    expect(memory.load()).toBe('/tmp/some-project');

    await writeFile(file, '{broken json', 'utf8');
    expect(memory.load()).toBeNull();
  });
});

describe('restoreWorkspace', () => {
  it('记忆目录有效时恢复；缺失或失效时回退', () => {
    const memory = new WorkspaceMemory(path.join(base, 'memory.json'));
    expect(restoreWorkspace(memory, workspaceA)).toBe(workspaceA);

    memory.save(workspaceB);
    expect(restoreWorkspace(memory, workspaceA)).toBe(workspaceB);

    memory.save(path.join(base, 'not-exists'));
    expect(restoreWorkspace(memory, workspaceA)).toBe(workspaceA);

    expect(restoreWorkspace(undefined, workspaceA)).toBe(workspaceA);
  });
});

describe('WorkspaceManager', () => {
  it('运行中切换被拒绝，工作区与会话均不受影响', async () => {
    const { registry } = createManager();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedProvider: ProviderContract = {
      name: 'gated',
      async *generateStream(): AsyncGenerator<ProviderChunk, void, unknown> {
        await gate;
        yield { type: 'text', text: 'late' };
      },
    };
    const gatedManager = new SessionManager({
      provider: gatedProvider,
      registry,
      store: new MemoryStore(),
      systemPrompt: 'base',
      configured: true,
    });
    const workspaceManager = new WorkspaceManager(workspaceA, {
      registry,
      host: gatedManager,
      baseSystemPrompt: 'base',
    });

    const turn = gatedManager.send('running');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gatedManager.isRunning).toBe(true);

    await expect(workspaceManager.selectWorkspace(workspaceB)).rejects.toThrow(
      'Cannot switch workspace while a turn is running',
    );
    expect(workspaceManager.current).toBe(workspaceA);

    release?.();
    await turn;
    expect(gatedManager.isRunning).toBe(false);
  });

  it('切换后工具以新目录为沙箱根，新会话使用新 systemPrompt，并写入记忆', async () => {
    const { manager, registry } = createManager();
    const memory = new WorkspaceMemory(path.join(base, 'memory.json'));
    const workspaceManager = new WorkspaceManager(workspaceA, {
      registry,
      host: manager,
      baseSystemPrompt: 'base',
      memory,
    });

    await writeFile(path.join(workspaceB, 'b.txt'), 'from B');
    const previousSessionId = manager.activeId;

    const result = await workspaceManager.selectWorkspace(workspaceB);
    expect(result.workspace).toBe(workspaceB);
    expect(result.sessionId).not.toBe(previousSessionId);
    expect(workspaceManager.current).toBe(workspaceB);
    expect(memory.load()).toBe(workspaceB);

    // 工具重建验证：read_file 现在以 workspaceB 为沙箱根。
    const read = registry.get('read_file');
    expect(read).toBeDefined();
    await expect(read?.execute({ path: 'b.txt' })).resolves.toBe('from B');
    await expect(read?.execute({ path: '../ws-a/b.txt' })).rejects.toThrow(/escapes/);

    // 新会话已绑定新工具：后续对话在新会话上进行。
    await manager.send('hi');
    expect(manager.activeId).toBe(result.sessionId);
  });

  it('buildSystemPrompt 拼接基础提示词与工作区概览', async () => {
    await writeFile(path.join(workspaceB, 'package.json'), '{}');
    const prompt = await buildSystemPrompt('base-prompt', workspaceB);
    expect(prompt.startsWith('base-prompt')).toBe(true);
    expect(prompt).toContain(`Workspace root: ${workspaceB}`);
    expect(prompt).toContain('[file] package.json');
  });

  it('选择同一目录不产生任何状态变更', async () => {
    const { manager, registry } = createManager();
    const workspaceManager = new WorkspaceManager(workspaceA, {
      registry,
      host: manager,
      baseSystemPrompt: 'base',
    });

    const sessionId = manager.activeId;
    const result = await workspaceManager.selectWorkspace(workspaceA);
    expect(result).toEqual({ workspace: workspaceA, sessionId });
    expect(manager.activeId).toBe(sessionId);
  });

  it('无效目录（不存在/非目录）被拒绝', async () => {
    const { manager, registry } = createManager();
    const workspaceManager = new WorkspaceManager(workspaceA, {
      registry,
      host: manager,
      baseSystemPrompt: 'base',
    });

    await expect(workspaceManager.selectWorkspace(path.join(base, 'ghost'))).rejects.toThrow(
      'Invalid workspace directory',
    );
    await expect(
      workspaceManager.selectWorkspace(path.join(workspaceA, 'no-such.txt')),
    ).rejects.toThrow();
    expect(workspaceManager.current).toBe(workspaceA);
  });
});
