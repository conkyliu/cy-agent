import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ToolBase } from '@cy-agent/agent';
import { AgentSession, ToolRegistry } from '@cy-agent/agent';
import type { AgentEvent, Message } from '@cy-agent/protocol';
import { JsonFileSessionStore } from '@cy-agent/storage';
import { MockProvider, textChunks, toolCallChunks } from '../../agent/test/fixtures.js';
import { loadConfig, parseCliArgs } from '../src/config.js';
import { preview, renderEvent } from '../src/renderer.js';
import { runRepl } from '../src/repl.js';

describe('parseCliArgs', () => {
  it('解析 --key=value 形式参数并忽略未知参数', () => {
    const flags = parseCliArgs(['--model=gpt-4o', '--base-url=https://x.test/v1', 'ignored', '-x']);
    expect(flags.get('model')).toBe('gpt-4o');
    expect(flags.get('base-url')).toBe('https://x.test/v1');
    expect(flags.has('ignored')).toBe(false);
  });

  it('支持无值开关（如 --help）', () => {
    const flags = parseCliArgs(['--help']);
    expect(flags.get('help')).toBe('');
  });
});

describe('loadConfig', () => {
  it('命令行参数优先于环境变量，模型有默认值', () => {
    const env = { CY_AGENT_API_KEY: 'env-key', CY_AGENT_MODEL: 'env-model' };
    const flags = parseCliArgs(['--api-key=flag-key']);
    const config = loadConfig(env, flags, '/workspace');
    expect(config.apiKey).toBe('flag-key');
    expect(config.model).toBe('env-model');
    expect(config.cwd).toBe('/workspace');
    expect(config.baseUrl).toBeUndefined();
  });

  it('兼容 OPENAI_API_KEY，并支持 --cwd 覆盖', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'oai' }, parseCliArgs(['--cwd=/repo']), '/elsewhere');
    expect(config.apiKey).toBe('oai');
    expect(config.model).toBe('gpt-4o');
    expect(config.cwd).toBe('/repo');
  });

  it('缺失 API Key 时抛出致命错误', () => {
    expect(() => loadConfig({}, new Map(), '/workspace')).toThrow(/Missing API key/);
  });
});

describe('renderEvent', () => {
  it('text_chunk 原样输出，生命周期事件不渲染', () => {
    expect(renderEvent({ type: 'text_chunk', text: 'Hello' })).toBe('Hello');
    expect(renderEvent({ type: 'session_started', sessionId: 's1' })).toBeNull();
    expect(
      renderEvent({ type: 'session_completed', finalMessages: [] }),
    ).toBeNull();
  });

  it('渲染工具执行与错误事件', () => {
    const started = renderEvent({
      type: 'tool_execution_started',
      toolCallId: 'c1',
      name: 'read_file',
      args: { path: 'a.ts' },
    });
    expect(started).toContain('read_file');
    expect(started).toContain('"path":"a.ts"');

    const failed = renderEvent({ type: 'tool_execution_failed', toolCallId: 'c1', error: 'Error: ENOENT' });
    expect(failed).toContain('ENOENT');

    const error = renderEvent({ type: 'session_error', error: new Error('boom') });
    expect(error).toContain('boom');

    const cancelled = renderEvent({ type: 'session_cancelled' });
    expect(cancelled).toContain('cancelled');

    const trimmed = renderEvent({ type: 'context_trimmed', removedMessages: 2, estimatedTokens: 128 });
    expect(trimmed).toContain('trimmed');
    expect(trimmed).toContain('2');

    const compacted = renderEvent({ type: 'context_compacted', removedMessages: 5 });
    expect(compacted).toContain('compacted');
    expect(compacted).toContain('5');
  });

  it('开启颜色时输出 ANSI 码，关闭时为纯文本', () => {
    const event: AgentEvent = { type: 'session_cancelled' };
    expect(renderEvent(event, { color: true })).toContain('\u001b[');
    expect(renderEvent(event, { color: false })).not.toContain('\u001b[');
  });

  it('preview 压缩空白并截断超长文本', () => {
    expect(preview('a\n\nb  c')).toBe('a b c');
    const long = 'x'.repeat(500);
    const shortened = preview(long);
    expect(shortened.length).toBeLessThanOrEqual(202);
    expect(shortened.endsWith('…')).toBe(true);
  });
});

describe('runRepl（CLI 作为 HITL 授权宿主）', () => {
  function createApprovalTool(executed: { count: number }): ToolBase {
    return {
      name: 'write_file',
      description: 'Write a file',
      parameters: { type: 'object' },
      requiresApproval: true,
      async execute(): Promise<string> {
        executed.count += 1;
        return 'Wrote 2 bytes to a.txt';
      },
    };
  }

  function setup(answer: string): {
    run: () => Promise<string>;
    executed: { count: number };
  } {
    const provider = new MockProvider([
      toolCallChunks('call_1', 'write_file', { path: 'a.txt', content: 'hi' }),
      [...textChunks('All done.')],
    ]);
    const executed = { count: 0 };
    const registry = new ToolRegistry();
    registry.register(createApprovalTool(executed));
    const session = new AgentSession({ provider, registry });

    const input = new PassThrough();
    const output = new PassThrough();
    let captured = '';
    output.on('data', (chunk: Buffer) => {
      captured += chunk.toString();
    });

    const run = async (): Promise<string> => {
      const replDone = runRepl({ session, input, output });
      input.write('create a.txt\n');
      input.write(`${answer}\n`);
      input.write('/exit\n');
      input.end();
      await replDone;
      return captured;
    };
    return { run, executed };
  }

  it('授权放行：提问后执行工具并继续对话', async () => {
    const { run, executed } = setup('y');
    const out = await run();
    expect(out).toContain('Approval required for "write_file"');
    expect(out).toContain('Approve "write_file"? [y/N]');
    expect(out).toContain('Wrote 2 bytes to a.txt');
    expect(out).toContain('All done.');
    expect(executed.count).toBe(1);
  });

  it('授权拒绝：不执行工具，伪造拒绝结果交还模型', async () => {
    const { run, executed } = setup('n');
    const out = await run();
    expect(out).toContain('Approve "write_file"? [y/N]');
    expect(out).toContain('explicitly denied');
    expect(out).toContain('All done.');
    expect(executed.count).toBe(0);
  });
});

describe('runRepl 会话持久化', () => {
  it('每轮结束自动保存非 system 消息，/sessions 可列出', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-repl-store-'));
    try {
      const store = new JsonFileSessionStore(dir);
      const provider = new MockProvider([textChunks('Saved turn.')]);
      const session = new AgentSession({
        provider,
        registry: new ToolRegistry(),
        systemPrompt: 'System prompt should not be persisted.',
      });

      const input = new PassThrough();
      const output = new PassThrough();
      let captured = '';
      output.on('data', (chunk: Buffer) => {
        captured += chunk.toString();
      });

      const replDone = runRepl({ session, input, output, store });
      input.write('hello\n');
      input.write('/sessions\n');
      input.write('/exit\n');
      input.end();
      await replDone;

      // 磁盘上存在会话文件，且不含 system 消息。
      const stored = await store.load(session.id);
      expect(stored).not.toBeNull();
      expect(stored?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(stored?.messages.some((m) => m.content?.includes('System prompt'))).toBe(false);

      // /sessions 输出包含当前会话 ID。
      expect(captured).toContain(session.id);
      expect(captured).toContain('(2 messages)');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('未提供 store 时 /sessions 提示未启用', async () => {
    const provider = new MockProvider([textChunks('ok')]);
    const session = new AgentSession({ provider, registry: new ToolRegistry() });
    const input = new PassThrough();
    const output = new PassThrough();
    let captured = '';
    output.on('data', (chunk: Buffer) => {
      captured += chunk.toString();
    });

    const replDone = runRepl({ session, input, output });
    input.write('/sessions\n');
    input.write('/exit\n');
    input.end();
    await replDone;

    expect(captured).toContain('not enabled');
  });
});

describe('runRepl 多会话管理', () => {
  function captureStreams(): {
    input: PassThrough;
    output: PassThrough;
    text: () => string;
  } {
    const input = new PassThrough();
    const output = new PassThrough();
    let captured = '';
    output.on('data', (chunk: Buffer) => {
      captured += chunk.toString();
    });
    return { input, output, text: () => captured };
  }

  it('/new 开启新会话，/open 恢复历史会话，/sessions 标记当前会话', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-multi-session-'));
    try {
      const store = new JsonFileSessionStore(dir);
      const provider = new MockProvider([
        textChunks('first reply'),
        textChunks('second reply'),
        textChunks('continued reply'),
      ]);
      const registry = new ToolRegistry();
      const created: AgentSession[] = [];
      const createSession = (initialMessages?: Message[], sessionId?: string): AgentSession => {
        const options: ConstructorParameters<typeof AgentSession>[0] = { provider, registry };
        if (initialMessages !== undefined) {
          options.initialMessages = initialMessages;
        }
        if (sessionId !== undefined) {
          options.id = sessionId;
        }
        const next = new AgentSession(options);
        created.push(next);
        return next;
      };
      const first = createSession();

      const { input, output, text } = captureStreams();
      const replDone = runRepl({ session: first, input, output, store, createSession });
      input.write('fix the login bug\n');
      input.write('/new\n');
      input.write('write unit tests\n');
      input.write('/open ghost\n');
      input.write(`/open ${first.id}\n`);
      input.write('continue fixing\n');
      input.write('/sessions\n');
      input.write('/exit\n');
      input.end();
      await replDone;

      const out = text();
      expect(out).toContain('Started new session');
      expect(out).toContain('Session "ghost" not found');
      expect(out).toContain(`Opened session ${first.id}`);

      // 工厂被调用两次：/new（无历史）与 /open（携带 2 条历史）。
      expect(created).toHaveLength(3);
      // /open 重建的会话保留原 ID，后续轮次写回同一存档文件。
      expect(created[2]?.id).toBe(first.id);

      // 只有两个存档文件；恢复的会话累积了 4 条消息并带标题。
      const summaries = await store.list();
      expect(summaries.map((s) => s.id).sort()).toEqual([created[1]?.id ?? '', first.id].sort());
      const reopened = await store.load(first.id);
      expect(reopened?.messages).toHaveLength(4);
      expect(reopened?.title).toBe('fix the login bug');

      // /sessions 用 * 标记当前（恢复后的）会话。
      expect(out).toContain(`* ${first.id}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('/delete 删除存档会话；当前会话不可删除', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-multi-session-'));
    try {
      const store = new JsonFileSessionStore(dir);
      const provider = new MockProvider([textChunks('hi')]);
      const registry = new ToolRegistry();
      const createSession = (initialMessages?: Message[], sessionId?: string): AgentSession => {
        const options: ConstructorParameters<typeof AgentSession>[0] = { provider, registry };
        if (initialMessages !== undefined) {
          options.initialMessages = initialMessages;
        }
        if (sessionId !== undefined) {
          options.id = sessionId;
        }
        return new AgentSession(options);
      };
      const first = createSession();

      const { input, output, text } = captureStreams();
      const replDone = runRepl({ session: first, input, output, store, createSession });
      input.write('hello\n');
      input.write('/new\n');
      input.write(`/delete ${first.id}\n`);
      input.write('/delete missing\n');
      input.write('/exit\n');
      input.end();
      await replDone;

      const out = text();
      expect(out).toContain(`Deleted session ${first.id}`);
      expect(await store.load(first.id)).toBeNull();
      // /delete missing 对不存在的会话静默成功（fs.rm force 语义）。
      expect(out).toContain('Deleted session missing');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('活动会话不允许被 /delete 移除', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-multi-session-'));
    try {
      const store = new JsonFileSessionStore(dir);
      const provider = new MockProvider([textChunks('hi')]);
      const session = new AgentSession({ provider, registry: new ToolRegistry() });

      const { input, output, text } = captureStreams();
      const replDone = runRepl({ session, input, output, store });
      input.write('hello\n');
      input.write(`/delete ${session.id}\n`);
      input.write('/exit\n');
      input.end();
      await replDone;

      expect(text()).toContain('Cannot delete the active session');
      expect(await store.load(session.id)).not.toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
