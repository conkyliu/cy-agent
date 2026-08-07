import { randomUUID } from 'node:crypto';
import type { AgentEvent, Message, ToolCall } from '@cy-agent/protocol';
import type { ProviderContract } from './contracts/provider.js';
import type { ToolRegistry } from './registry.js';
import { autoApprovePolicy, type ToolExecutionPolicy } from './policy.js';
import { DEFAULT_MAX_INPUT_TOKENS, buildUnits, estimateMessagesTokens, trimToBudget, type ContextBudgetOptions } from './context/budget.js';
import {
  buildTranscript,
  createSummaryMessage,
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_KEEP_RECENT_UNITS,
  SUMMARIZATION_PROMPT,
  type CompactionOptions,
} from './context/compaction.js';

export interface AgentSessionOptions {
  provider: ProviderContract;
  registry: ToolRegistry;
  systemPrompt?: string;
  /**
   * 恢复历史会话时的前置消息（追加在 system 消息之后）。
   * 持久化层应只保存非 system 消息，避免与 systemPrompt 重复。
   */
  initialMessages?: Message[];
  /**
   * 工具执行策略。默认自动静默执行；
   * 为后续 Human-in-the-loop 预留的扩展点。
   */
  policy?: ToolExecutionPolicy;
  /** 单轮会话内允许的最大模型请求次数，防止工具调用死循环。 */
  maxIterations?: number;
  /** 上下文窗口预算；超预算时裁剪发送给模型的历史副本（内部历史不变）。 */
  contextBudget?: ContextBudgetOptions;
  /** LLM 驱动的上下文压缩；预算将满时先总结旧历史，失败回退裁剪。 */
  compaction?: CompactionOptions;
}

/**
 * AgentSession：核心执行单元，串联 Provider 与 ToolRegistry。
 *
 * 采用基于 AsyncGenerator 的单向事件流模式，
 * 由线性 Agent Loop（while 循环）驱动状态流转。
 */
export class AgentSession {
  readonly id: string;

  private readonly messages: Message[] = [];
  private readonly policy: ToolExecutionPolicy;
  private readonly maxIterations: number;
  private readonly maxInputTokens: number;
  private readonly compactionEnabled: boolean;
  private readonly compactionThreshold: number;
  private readonly keepRecentUnits: number;
  /** 正在等待宿主（CLI / UI）响应的授权请求：toolCallId -> settle 回调。 */
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();
  private abortController: AbortController | null = null;
  private running = false;

  constructor(private readonly options: AgentSessionOptions) {
    this.id = randomUUID();
    this.policy = options.policy ?? autoApprovePolicy;
    this.maxIterations = options.maxIterations ?? 20;
    this.maxInputTokens = options.contextBudget?.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
    this.compactionEnabled = options.compaction?.enabled ?? true;
    this.compactionThreshold = options.compaction?.threshold ?? DEFAULT_COMPACTION_THRESHOLD;
    this.keepRecentUnits = options.compaction?.keepRecentUnits ?? DEFAULT_KEEP_RECENT_UNITS;
    if (options.systemPrompt !== undefined) {
      this.messages.push({ id: randomUUID(), role: 'system', content: options.systemPrompt });
    }
    if (options.initialMessages !== undefined) {
      for (const message of options.initialMessages) {
        // 拷贝消息对象，防止外部持久化层与运行时共享引用。
        this.messages.push({ ...message });
      }
    }
  }

  /** 取消当前正在进行的会话，并清理挂起的授权请求。 */
  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * 外部宿主（CLI 提示符或 Electron 弹窗）响应授权请求。
   * @param toolCallId 待授权的工具调用 ID
   * @param approved true 为放行，false 为拒绝
   */
  resolveApproval(toolCallId: string, approved: boolean): void {
    // 会话已取消或已响应时静默忽略，避免宿主迟到响应报错。
    this.pendingApprovals.get(toolCallId)?.(approved);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** 当前上下文消息的只读快照。 */
  getMessages(): readonly Message[] {
    return this.messages;
  }

  /**
   * 执行一轮完整的 Agent Loop：
   * 用户输入 -> 模型流式生成 -> 工具调用 -> 递归回溯 -> 最终结果。
   */
  async *run(prompt: string): AsyncGenerator<AgentEvent, void, unknown> {
    if (this.running) {
      throw new Error('Session is already running');
    }
    this.running = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.messages.push({ id: randomUUID(), role: 'user', content: prompt });
    yield { type: 'session_started', sessionId: this.id };

    try {
      for (let iteration = 0; iteration < this.maxIterations; iteration++) {
        if (signal.aborted) {
          yield { type: 'session_cancelled' };
          return;
        }

        // 上下文压缩：预算将满时先尝试 LLM 总结旧历史，失败则回退到裁剪。
        const compactedCount = await this.compactIfNeeded(signal);
        if (signal.aborted) {
          yield { type: 'session_cancelled' };
          return;
        }
        if (compactedCount > 0) {
          yield { type: 'context_compacted', removedMessages: compactedCount };
        }

        const tools = this.options.registry.snapshot();
        const streamGen = this.streamModel(tools, signal);

        // 实时转发 text_chunk 事件，同时累积完整生成结果。
        let iter = await streamGen.next();
        while (!iter.done) {
          yield iter.value;
          iter = await streamGen.next();
        }
        const generated = iter.value;

        if (signal.aborted) {
          this.pushInterruptedAssistant(generated.text, generated.toolCalls);
          yield { type: 'session_cancelled' };
          return;
        }

        const { text, toolCalls } = generated;

        // 无工具调用：模型判断任务完成，输出纯文本。
        if (toolCalls.length === 0) {
          this.messages.push({ id: randomUUID(), role: 'assistant', content: text });
          yield { type: 'session_completed', finalMessages: [...this.messages] };
          return;
        }

        const assistantMessage: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: text.length > 0 ? text : null,
          toolCalls,
        };
        this.messages.push(assistantMessage);

        // 顺序执行工具调用，事件流保持确定性顺序。
        for (const toolCall of toolCalls) {
          if (signal.aborted) {
            yield { type: 'session_cancelled' };
            return;
          }
          yield* this.executeTool(toolCall, signal);
          if (signal.aborted) {
            yield { type: 'session_cancelled' };
            return;
          }
        }
        // 递归回溯：携带工具结果回到模型请求。
      }

      yield {
        type: 'session_error',
        error: new Error(`Session exceeded max iterations (${this.maxIterations})`),
      };
    } catch (error) {
      if (signal.aborted) {
        yield { type: 'session_cancelled' };
        return;
      }
      // Provider 级错误：中断会话，抛出 session_error。
      yield { type: 'session_error', error: toError(error) };
    } finally {
      this.running = false;
      this.abortController = null;
      // 清空挂起的授权 Deferred，防止内存泄漏。
      this.pendingApprovals.clear();
    }
  }

  private async *streamModel(
    tools: ReturnType<ToolRegistry['snapshot']>,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent, { text: string; toolCalls: ToolCall[] }, unknown> {
    let text = '';
    const pending = new Map<string, ToolCall>();
    const completed: ToolCall[] = [];

    // 上下文预算：仅裁剪发送给模型的副本，内部历史保持完整。
    const trimmed = trimToBudget(this.messages, this.maxInputTokens);
    if (trimmed.removedMessages > 0) {
      yield {
        type: 'context_trimmed',
        removedMessages: trimmed.removedMessages,
        estimatedTokens: trimmed.estimatedTokens,
      };
    }

    const stream = this.options.provider.generateStream({
      messages: trimmed.messages,
      tools,
      signal,
    });

    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          break;
        }
        switch (chunk.type) {
          case 'text': {
            text += chunk.text;
            // 遇到 text，实时推送给消费者。
            yield { type: 'text_chunk', text: chunk.text };
            break;
          }
          case 'tool_call_start': {
            pending.set(chunk.toolCall.id, { ...chunk.toolCall });
            break;
          }
          case 'tool_call_chunk': {
            const call = pending.get(chunk.toolCallId);
            if (call) {
              call.arguments += chunk.delta;
            }
            break;
          }
          case 'tool_call_end': {
            const call = pending.get(chunk.toolCallId);
            if (call) {
              pending.delete(chunk.toolCallId);
              completed.push(call);
            }
            break;
          }
        }
      }
    } catch (error) {
      // 取消导致的 Provider 中断：保留已累积的部分结果，由上层标记 interrupted。
      if (!signal.aborted) {
        throw error;
      }
    }

    return { text, toolCalls: completed };
  }

  private async *executeTool(toolCall: ToolCall, signal: AbortSignal): AsyncGenerator<AgentEvent, void, unknown> {
    let args: unknown;
    try {
      args = toolCall.arguments.length > 0 ? JSON.parse(toolCall.arguments) : {};
    } catch {
      args = null;
    }

    const appendToolResult = (content: string): void => {
      this.messages.push({ id: randomUUID(), role: 'tool', content, toolCallId: toolCall.id });
    };

    try {
      if (args === null) {
        throw new Error(`Invalid JSON arguments for tool "${toolCall.name}"`);
      }

      const tool = this.options.registry.get(toolCall.name);
      if (!tool) {
        throw new Error(`Tool "${toolCall.name}" is not registered`);
      }

      const approved = (await this.policy.approve?.(toolCall.name, args)) ?? true;
      if (!approved) {
        throw new Error(`Tool "${toolCall.name}" execution was rejected by policy`);
      }

      // Human-in-the-loop：需授权的工具挂起等待宿主响应。
      if (tool.requiresApproval === true) {
        // 先创建 Deferred 再向外 yield 事件，保证宿主的同步响应不会丢失。
        const approval = this.createApproval(toolCall.id, signal);
        yield { type: 'tool_approval_requested', toolCallId: toolCall.id, name: toolCall.name, args };
        const userApproved = await approval;
        if (signal.aborted) {
          // 等待授权期间被取消：不追加任何结果，由外层统一处理。
          return;
        }
        if (!userApproved) {
          // 用户拒绝：跳过真实执行，伪造结果交还 LLM。
          const denied = 'System: The user explicitly denied the execution of this tool.';
          yield { type: 'tool_execution_completed', toolCallId: toolCall.id, result: denied };
          appendToolResult(denied);
          return;
        }
      }

      yield { type: 'tool_execution_started', toolCallId: toolCall.id, name: toolCall.name, args };

      const result = await tool.execute(args, signal);
      yield { type: 'tool_execution_completed', toolCallId: toolCall.id, result };
      appendToolResult(typeof result === 'string' ? result : JSON.stringify(result));
    } catch (error) {
      // Tool 级错误不中断会话：异常转换为字符串交还给 LLM。
      const message = `Error: ${toError(error).message}`;
      yield { type: 'tool_execution_failed', toolCallId: toolCall.id, error: message };
      appendToolResult(message);
    }
  }

  /**
   * 创建挂起等待授权响应的 Deferred（Deferred Async Control）。
   * 必须在 yield 授权事件之前调用，确保宿主响应时回调已注册。
   * 会话取消时通过 AbortSignal 自动解除挂起并清理回调。
   */
  private createApproval(toolCallId: string, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (approved: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.pendingApprovals.delete(toolCallId);
        signal.removeEventListener('abort', onAbort);
        resolve(approved);
      };
      const onAbort = (): void => settle(false);

      if (signal.aborted) {
        settle(false);
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.pendingApprovals.set(toolCallId, settle);
    });
  }

  private pushInterruptedAssistant(text: string, toolCalls: ToolCall[]): void {
    this.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: text.length > 0 ? text : null,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      interrupted: true,
    });
  }

  /**
   * 预算将满时压缩旧历史：
   * 保留受保护单元（原始 systemPrompt）与最近 keepRecentUnits 个单元，
   * 将中间的消息交给 Provider 总结为一条摘要消息并原地替换。
   * 任何失败（Provider 报错、空摘要、取消）都返回 0，由后续裁剪兜底。
   * @returns 被压缩移除的消息条数
   */
  private async compactIfNeeded(signal: AbortSignal): Promise<number> {
    if (!this.compactionEnabled) {
      return 0;
    }
    const thresholdTokens = Math.floor(this.maxInputTokens * this.compactionThreshold);
    if (estimateMessagesTokens(this.messages) <= thresholdTokens) {
      return 0;
    }

    const units = buildUnits(this.messages);
    const endIndex = units.length - this.keepRecentUnits;
    let startIndex = 0;
    // 跳过受保护单元（原始 systemPrompt 永不压缩）。
    while (startIndex < endIndex && units[startIndex]?.protected === true) {
      startIndex += 1;
    }
    // 可压缩单元不足两条时收益太低，不值得一次额外的模型请求。
    if (endIndex - startIndex < 2) {
      return 0;
    }

    const countBefore = units.slice(0, startIndex).reduce((sum, unit) => sum + unit.messages.length, 0);
    const toSummarize = units.slice(startIndex, endIndex).flatMap((unit) => unit.messages);

    let summary: string;
    try {
      summary = await this.generateSummary(toSummarize, signal);
    } catch {
      // 压缩失败不是致命异常：回退到预算裁剪，会话继续。
      return 0;
    }
    if (signal.aborted || summary.length === 0) {
      return 0;
    }

    this.messages.splice(countBefore, toSummarize.length, createSummaryMessage(summary));
    return toSummarize.length;
  }

  /** 调用 Provider 生成历史摘要，仅收集文本 chunk。 */
  private async generateSummary(target: readonly Message[], signal: AbortSignal): Promise<string> {
    let text = '';
    const stream = this.options.provider.generateStream({
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          content: `${SUMMARIZATION_PROMPT}\n\n${buildTranscript(target)}`,
        },
      ],
      signal,
    });
    for await (const chunk of stream) {
      if (signal.aborted) {
        break;
      }
      if (chunk.type === 'text') {
        text += chunk.text;
      }
    }
    return text.trim();
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
