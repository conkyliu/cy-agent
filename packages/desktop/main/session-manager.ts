/**
 * 主进程会话管理器：承载单活动 AgentSession，暴露给 IPC 层调用。
 *
 * 不依赖 Electron，便于纯 Node 环境单测。事件经 serializeAgentEvent
 * 序列化后交给 emit 回调（由 IPC 层转发至渲染进程）。
 */

import { AgentSession, type ToolRegistry } from '@cy-agent/agent';
import type { ProviderContract } from '@cy-agent/agent';
import type { Message } from '@cy-agent/protocol';
import type { SessionStore, StoredSession } from '@cy-agent/storage';
import { serializeAgentEvent, type IpcAgentEvent, type IpcSessionSummary } from '../shared/ipc';

export interface SessionManagerOptions {
  provider: ProviderContract;
  registry: ToolRegistry;
  store: SessionStore;
  systemPrompt: string;
  /** API Key 是否已配置；缺失时 send 以 session_error 事件反馈而非崩溃。 */
  configured: boolean;
}

export class SessionManager {
  private session: AgentSession;
  /** 事件推送回调，由 IPC 层在窗口就绪后通过 attachEmit 挂载。 */
  private emit: ((event: IpcAgentEvent) => void) | null = null;

  constructor(private readonly options: SessionManagerOptions) {
    this.session = this.createSession();
  }

  /** 挂载事件推送回调（可重复调用，后挂者替换）。 */
  attachEmit(emit: (event: IpcAgentEvent) => void): void {
    this.emit = emit;
  }

  /** 替换 systemPrompt：后续重建会话（新建/打开/工作区切换）使用新提示词。 */
  setSystemPrompt(systemPrompt: string): void {
    this.options.systemPrompt = systemPrompt;
  }

  private forward(event: IpcAgentEvent): void {
    this.emit?.(event);
  }

  get activeId(): string {
    return this.session.id;
  }

  get isRunning(): boolean {
    return this.session.isRunning;
  }

  /** 执行一轮会话并转发事件流；运行中重复发送直接拒绝。 */
  async send(text: string): Promise<void> {
    if (this.session.isRunning) {
      throw new Error('Session is already running');
    }
    if (!this.options.configured) {
      // 配置缺失：经事件流反馈，UI 展示配置引导。
      this.forward({
        type: 'session_error',
        name: 'ConfigError',
        message: 'Missing API key. Set CY_AGENT_API_KEY or OPENAI_API_KEY and restart.',
      });
      return;
    }
    for await (const event of this.session.run(text)) {
      this.forward(serializeAgentEvent(event));
    }
    await this.persist();
  }

  /** 取消当前轮；核心的 AbortSignal 会自动把挂起授权按拒绝处理。 */
  cancel(): void {
    this.session.cancel();
  }

  resolveApproval(toolCallId: string, approved: boolean): void {
    this.session.resolveApproval(toolCallId, approved);
  }

  async listSessions(): Promise<IpcSessionSummary[]> {
    const summaries = await this.options.store.list();
    return summaries.map((summary) => {
      const item: IpcSessionSummary = {
        id: summary.id,
        updatedAt: summary.updatedAt,
        messageCount: summary.messageCount,
      };
      if (summary.title !== undefined) {
        item.title = summary.title;
      }
      return item;
    });
  }

  /** 存档当前会话并开空会话；运行中禁止切换。 */
  async newSession(): Promise<{ id: string }> {
    this.assertNotRunning();
    await this.persist();
    this.session = this.createSession();
    return { id: this.session.id };
  }

  /** 存档当前会话并载入目标会话（保留原 ID）；运行中禁止切换。 */
  async openSession(id: string): Promise<{ id: string; messages: Message[] }> {
    this.assertNotRunning();
    if (id === this.session.id) {
      return { id, messages: this.visibleMessages() };
    }
    const stored = await this.options.store.load(id);
    if (stored === null) {
      throw new Error(`Session "${id}" not found`);
    }
    await this.persist();
    this.session = this.createSession(stored.messages, id);
    return { id, messages: this.visibleMessages() };
  }

  /** 删除存档会话；活动会话禁止删除。 */
  async deleteSession(id: string): Promise<void> {
    if (id === this.session.id) {
      throw new Error('Cannot delete the active session');
    }
    await this.options.store.delete(id);
  }

  private assertNotRunning(): void {
    if (this.session.isRunning) {
      throw new Error('Cannot switch sessions while a turn is running');
    }
  }

  /** 会话工厂：systemPrompt 重新注入，恢复会话时保留原 ID。 */
  private createSession(initialMessages?: Message[], sessionId?: string): AgentSession {
    const options: ConstructorParameters<typeof AgentSession>[0] = {
      provider: this.options.provider,
      registry: this.options.registry,
      systemPrompt: this.options.systemPrompt,
    };
    if (initialMessages !== undefined) {
      options.initialMessages = initialMessages;
    }
    if (sessionId !== undefined) {
      options.id = sessionId;
    }
    return new AgentSession(options);
  }

  /** 非 system 消息快照（渲染历史与持久化共用）。 */
  private visibleMessages(): Message[] {
    return this.session.getMessages().filter((message) => message.role !== 'system');
  }

  /** 存档当前会话；失败仅以事件提示，不中断管理器。 */
  private async persist(): Promise<void> {
    try {
      const messages = this.visibleMessages();
      const stored: StoredSession = {
        id: this.session.id,
        updatedAt: new Date().toISOString(),
        messages,
      };
      const title = deriveTitle(messages);
      if (title !== undefined) {
        stored.title = title;
      }
      await this.options.store.save(stored);
    } catch (error) {
      this.forward({
        type: 'session_error',
        name: 'PersistenceError',
        message: `Failed to persist session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

/** 从首条用户消息派生会话标题（压缩空白、截断 60 字符），语义对齐 CLI。 */
function deriveTitle(messages: readonly Message[]): string | undefined {
  const firstUser = messages.find(
    (message) => message.role === 'user' && typeof message.content === 'string',
  );
  if (firstUser === undefined || typeof firstUser.content !== 'string') {
    return undefined;
  }
  const collapsed = firstUser.content.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return undefined;
  }
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed;
}
