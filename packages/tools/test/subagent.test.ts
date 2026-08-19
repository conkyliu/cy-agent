import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GenerateOptions, ProviderChunk, ProviderContract, ToolBase } from '@cy-agent/agent';
import { createDelegateTaskTool, loadExtensions } from '../src/index.js';

class MockProvider implements ProviderContract {
  readonly name = 'mock';
  constructor(private readonly responses: ProviderChunk[][]) {}

  async *generateStream(_options: GenerateOptions): AsyncGenerator<ProviderChunk, void, unknown> {
    const chunkList = this.responses.shift() ?? [];
    for (const chunk of chunkList) {
      yield chunk;
    }
  }
}

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-subagent-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('Sub-agent (delegate_task)', () => {
  it('执行子任务并返回子会话输出文本', async () => {
    await fs.writeFile(path.join(workspace, 'index.ts'), 'export const answer = 42;', 'utf8');

    const provider = new MockProvider([
      // 轮次 1: 子智能体调用 read_file 工具
      [
        {
          type: 'tool_call_start',
          toolCall: { id: 'tc-1', name: 'read_file', arguments: '' },
        },
        {
          type: 'tool_call_chunk',
          toolCallId: 'tc-1',
          delta: JSON.stringify({ path: 'index.ts' }),
        },
        { type: 'tool_call_end', toolCallId: 'tc-1' },
      ],
      // 轮次 2: 收到工具结果后生成总结
      [
        { type: 'text', text: 'index.ts exports answer = 42.' },
        { type: 'usage', inputTokens: 10, outputTokens: 8 },
      ],
    ]);

    const tool = createDelegateTaskTool({ provider, workspace });
    expect(tool.name).toBe('delegate_task');
    expect(tool.requiresApproval).toBe(false);

    const result = await tool.execute({
      task: 'Check index.ts for exported answer',
      goal: 'Find the exported value',
      context: 'Check index.ts',
    });

    expect(result).toBe('index.ts exports answer = 42.');
  });

  it('超过最大嵌套深度时拒绝派生子会话', async () => {
    const provider = new MockProvider([]);
    const tool = createDelegateTaskTool({
      provider,
      workspace,
      maxDepth: 1,
      currentDepth: 1,
    });

    const result = await tool.execute({
      task: 'Nested subtask',
      goal: 'Should fail',
    });

    expect(result).toContain('Maximum delegation depth reached');
  });

  it('父会话 AbortSignal 中断时级联取消子任务', async () => {
    const controller = new AbortController();
    const provider = new MockProvider([[{ type: 'text', text: 'Thinking...' }]]);

    const tool = createDelegateTaskTool({ provider, workspace });
    controller.abort();

    const result = await tool.execute(
      {
        task: 'Long running task',
        goal: 'Cancelled immediately',
      },
      controller.signal,
    );

    expect(result).toContain('cancelled');
  });

  it('子智能体工具注册表中剔除 delegate_task, write_file 与 run_shell', async () => {
    const customTool: ToolBase = {
      name: 'read_custom',
      description: 'read custom',
      parameters: { type: 'object' },
      execute: async () => 'custom data',
    };
    const dangerousTool: ToolBase = {
      name: 'run_shell',
      description: 'shell',
      parameters: { type: 'object' },
      execute: async () => 'shell result',
    };

    let observedTools: string[] = [];
    const provider: ProviderContract = {
      name: 'inspector',
      async *generateStream(options: GenerateOptions) {
        observedTools = (options.tools ?? []).map((t) => t.name);
        yield { type: 'text', text: 'All tools inspected.' };
      },
    };

    const tool = createDelegateTaskTool({
      provider,
      workspace,
      customTools: [customTool, dangerousTool],
    });

    await tool.execute({
      task: 'Inspect available tools',
      goal: 'Verify tool isolation',
    });

    expect(observedTools).toContain('read_file');
    expect(observedTools).toContain('list_directory');
    expect(observedTools).toContain('search_files');
    expect(observedTools).toContain('read_custom');
    expect(observedTools).not.toContain('delegate_task');
    expect(observedTools).not.toContain('run_shell');
    expect(observedTools).not.toContain('write_file');
  });

  it('loadExtensions 在提供 provider 时自动装配 delegate_task', async () => {
    const provider = new MockProvider([]);
    const extensions = await loadExtensions(workspace, { provider });
    const toolNames = extensions.tools.map((t) => t.name);
    expect(toolNames).toContain('delegate_task');
  });
});
