/**
 * Sub-agent 多智能体子任务派生工具：
 * 允许主智能体委托专注的子任务给隔离的子会话执行，避免父会话上下文膨胀。
 */

import {
  AgentSession,
  ToolRegistry,
  type ProviderContract,
  type ToolBase,
  type ToolContract,
} from '@cy-agent/agent';
import {
  createListDirectoryTool,
  createReadFileTool,
  createSearchFilesTool,
} from './coding-tools.js';

export interface DelegateTaskArgs {
  /** 子任务的具体描述 */
  task: string;
  /** 期望达成的目标或结论标准 */
  goal: string;
  /** 相关背景信息或文件范围提示（可选） */
  context?: string;
}

export interface DelegateTaskToolOptions {
  provider: ProviderContract;
  workspace: string;
  /** 允许的最大嵌套深度（默认 1，即仅允许顶级主智能体派生 1 层子智能体） */
  maxDepth?: number;
  /** 当前深度（顶级为 0，子智能体为 1...） */
  currentDepth?: number;
  /** 子智能体单轮最大模型迭代次数，默认 10 */
  maxIterations?: number;
  /** 额外要注入子智能体的只读工具（例如符号索引、依赖解析工具等） */
  customTools?: ToolBase[];
}

export const SUBAGENT_SYSTEM_PROMPT = `You are a specialized sub-agent operating within the user's workspace.
Your mission is to autonomously and thoroughly investigate the codebase to accomplish the assigned task and goal.
You have access to read-only workspace tools (read_file, list_directory, search_files, find_symbol, file_dependencies).

Guidelines:
1. Focus strictly on the assigned task and goal.
2. Inspect relevant files, directory structures, and code symbols directly using tools.
3. Be concise, precise, and structured in your investigation.
4. When finished, provide a comprehensive final summary that directly answers the assigned goal with clear findings and evidence.`;

/**
 * 创建 delegate_task 工具，用于派生子智能体执行专注的子任务。
 */
export function createDelegateTaskTool(
  options: DelegateTaskToolOptions,
): ToolContract<DelegateTaskArgs, string> {
  const maxDepth = options.maxDepth ?? 1;
  const currentDepth = options.currentDepth ?? 0;
  const maxIterations = options.maxIterations ?? 10;

  return {
    name: 'delegate_task',
    description:
      'Delegate a focused subtask or exploratory research to an isolated sub-agent. The sub-agent will autonomously investigate the workspace using read-only tools and return a structured summary of findings without polluting the main session context.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Detailed description of the subtask to perform.',
        },
        goal: {
          type: 'string',
          description: 'The specific goal, expected deliverable, or conclusion criteria.',
        },
        context: {
          type: 'string',
          description: 'Helpful background context or specific file paths to focus on.',
        },
      },
      required: ['task', 'goal'],
    },
    // 只读分析类委托默认免显式授权
    requiresApproval: false,
    async execute(args: DelegateTaskArgs, signal?: AbortSignal): Promise<string> {
      if (currentDepth >= maxDepth) {
        return `Error: Maximum delegation depth reached (${maxDepth}). Cannot spawn nested sub-agents.`;
      }

      if (signal?.aborted) {
        return 'Sub-agent task was cancelled before starting.';
      }

      // 构建子智能体专属的工具注册表（只读工具集）
      const subRegistry = new ToolRegistry();
      subRegistry.register(createReadFileTool(options.workspace));
      subRegistry.register(createListDirectoryTool(options.workspace));
      subRegistry.register(createSearchFilesTool(options.workspace));

      if (options.customTools) {
        for (const tool of options.customTools) {
          // 杜绝自身嵌套派生
          if (
            tool.name !== 'delegate_task' &&
            tool.name !== 'run_shell' &&
            tool.name !== 'write_file'
          ) {
            subRegistry.register(tool);
          }
        }
      }

      const subSession = new AgentSession({
        provider: options.provider,
        registry: subRegistry,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        maxIterations,
      });

      // 组装清晰的子任务提示词
      const promptLines = [`# Assigned Goal\n${args.goal}`, `# Task Description\n${args.task}`];
      if (args.context && args.context.trim().length > 0) {
        promptLines.push(`# Context & Hints\n${args.context.trim()}`);
      }
      const userPrompt = promptLines.join('\n\n');

      let finalText = '';
      const onAbort = () => subSession.cancel();
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        for await (const event of subSession.run(userPrompt)) {
          if (signal?.aborted) {
            return 'Sub-agent task was cancelled by parent session.';
          }
          if (event.type === 'text_chunk') {
            finalText += event.text;
          } else if (event.type === 'session_error') {
            return `Sub-agent failed with error: ${event.error.message}`;
          } else if (event.type === 'session_cancelled') {
            return 'Sub-agent task was cancelled.';
          }
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }

      return finalText.trim().length > 0
        ? finalText.trim()
        : 'Sub-agent completed the task with no text output.';
    },
  };
}
