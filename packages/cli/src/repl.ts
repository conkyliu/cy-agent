import { createInterface, type Interface } from 'node:readline/promises';
import process from 'node:process';
import type { AgentSession } from '@cy-agent/agent';
import type { Message } from '@cy-agent/protocol';
import type { SessionStore, StoredSession } from '@cy-agent/storage';
import { renderEvent } from './renderer.js';

/**
 * 交互式 REPL：CLI 作为 HITL 授权宿主。
 *
 * - 每行输入驱动一次 session.run()，实时渲染事件流。
 * - 收到 tool_approval_requested 时原地提问 y/N，再调 resolveApproval。
 * - SIGINT：会话运行中 -> 取消当前轮；空闲 -> 退出 REPL。
 * - 输入/输出流可注入，便于无 TTY 的自动化测试。
 *
 * 实现注意：readline 异步迭代器会独占缓冲 'line' 事件，
 * 与 question() 混用会导致后者永久挂起，
 * 因此统一走 nextLine() 队列读取所有输入行。
 */

export interface ReplOptions {
  session: AgentSession;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** 是否输出 ANSI 颜色，默认 false。 */
  color?: boolean;
  /** 提示语，默认 "> "。 */
  prompt?: string;
  /** 会话持久化存储；提供时每轮结束后自动保存，并启用会话管理命令。 */
  store?: SessionStore;
  /** 会话工厂：/new 与 /open 用它重建 AgentSession；未提供时禁用切换类命令。
   * sessionId 用于 /open 保留原会话 ID，保证持久化文件连续。 */
  createSession?: (initialMessages?: Message[], sessionId?: string) => AgentSession;
}

const EXIT_COMMANDS = new Set(['/exit', '/quit']);

/** 基于事件 + 队列的逐行读取器，支持 REPL 提示与授权提问交替进行。 */
class LineReader {
  private readonly lines: string[] = [];
  private readonly waiters: Array<(line: string | null) => void> = [];
  private ended = false;

  constructor(rl: Interface) {
    rl.on('line', (line) => {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        this.lines.push(line);
      }
    });
    rl.on('close', () => {
      this.ended = true;
      for (const waiter of this.waiters.splice(0)) {
        waiter(null);
      }
    });
  }

  /** 读取下一行；输入流结束时返回 null。 */
  nextLine(): Promise<string | null> {
    const buffered = this.lines.shift();
    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }
    if (this.ended) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export async function runRepl(options: ReplOptions): Promise<void> {
  const output = options.output ?? process.stdout;
  const color = options.color ?? false;
  const prompt = options.prompt ?? '> ';
  const write = (text: string): void => {
    output.write(text);
  };

  const rl: Interface = createInterface({
    input: options.input ?? process.stdin,
    output,
    terminal: false,
  });
  const reader = new LineReader(rl);

  // 当前活动会话：/new 与 /open 会替换它。
  let session = options.session;

  // SIGINT：运行中取消当前轮，空闲时退出。
  let cancelled = false;
  const onSigint = (): void => {
    if (session.isRunning) {
      session.cancel();
    } else {
      cancelled = true;
      rl.close();
    }
  };
  process.on('SIGINT', onSigint);

  write(`cy-agent REPL. Type /exit to quit.\n${prompt}`);

  try {
    for (;;) {
      const line = await reader.nextLine();
      if (line === null || cancelled) {
        break;
      }
      const input = line.trim();
      if (input.length === 0) {
        write(prompt);
        continue;
      }
      if (EXIT_COMMANDS.has(input)) {
        break;
      }
      if (input === '/sessions') {
        await listSessions(options.store, session.id, write);
        write(prompt);
        continue;
      }
      if (input === '/new') {
        session = await startNewSession(options, session, write);
        write(prompt);
        continue;
      }
      if (input.startsWith('/open ')) {
        session = await openSession(options, session, input.slice('/open '.length).trim(), write);
        write(prompt);
        continue;
      }
      if (input.startsWith('/delete ')) {
        await deleteSession(options.store, session.id, input.slice('/delete '.length).trim(), write);
        write(prompt);
        continue;
      }
      await runTurn(session, input, reader, write, color);
      if (options.store !== undefined) {
        await persistSession(session, options.store, write);
      }
      write(prompt);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    rl.close();
  }
}

/** /new：先存档当前会话，再用工厂创建空会话。 */
async function startNewSession(
  options: ReplOptions,
  current: AgentSession,
  write: (text: string) => void,
): Promise<AgentSession> {
  if (options.createSession === undefined) {
    write('Session switching is not available (no session factory).\n');
    return current;
  }
  if (options.store !== undefined) {
    await persistSession(current, options.store, write);
  }
  const next = options.createSession();
  write(`Started new session ${next.id}.\n`);
  return next;
}

/** /open <id>：先存档当前会话，再载入目标会话重建 AgentSession。 */
async function openSession(
  options: ReplOptions,
  current: AgentSession,
  targetId: string,
  write: (text: string) => void,
): Promise<AgentSession> {
  if (options.createSession === undefined || options.store === undefined) {
    write('Session switching is not available (no session factory or store).\n');
    return current;
  }
  if (targetId.length === 0) {
    write('Usage: /open <session-id>\n');
    return current;
  }
  if (targetId === current.id) {
    write(`Already in session ${targetId}.\n`);
    return current;
  }
  let stored;
  try {
    stored = await options.store.load(targetId);
  } catch (error) {
    write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    return current;
  }
  if (stored === null) {
    write(`Session "${targetId}" not found. Use /sessions to list saved sessions.\n`);
    return current;
  }
  await persistSession(current, options.store, write);
  const next = options.createSession(stored.messages, targetId);
  write(`Opened session ${targetId} (${stored.messages.length} messages).\n`);
  return next;
}

/** /delete <id>：删除存档会话；当前会话不允许删除。 */
async function deleteSession(
  store: SessionStore | undefined,
  currentId: string,
  targetId: string,
  write: (text: string) => void,
): Promise<void> {
  if (store === undefined) {
    write('Session persistence is not enabled.\n');
    return;
  }
  if (targetId.length === 0) {
    write('Usage: /delete <session-id>\n');
    return;
  }
  if (targetId === currentId) {
    write('Cannot delete the active session. Start a new one first (/new).\n');
    return;
  }
  try {
    await store.delete(targetId);
    write(`Deleted session ${targetId}.\n`);
  } catch (error) {
    write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/** 执行一轮会话并消费事件流；授权事件转为交互式提问。 */
async function runTurn(
  session: AgentSession,
  promptText: string,
  reader: LineReader,
  write: (text: string) => void,
  color: boolean,
): Promise<void> {
  for await (const event of session.run(promptText)) {
    if (event.type === 'tool_approval_requested') {
      const rendered = renderEvent(event, { color });
      if (rendered !== null) {
        write(rendered);
      }
      write(`Approve "${event.name}"? [y/N] `);
      const answer = ((await reader.nextLine()) ?? '').trim().toLowerCase();
      // 会话可能在提问期间被取消，迟到响应由 session 静默忽略。
      session.resolveApproval(event.toolCallId, answer === 'y' || answer === 'yes');
      continue;
    }
    const rendered = renderEvent(event, { color });
    if (rendered !== null) {
      write(rendered);
    }
  }
  write('\n');
}

/** 从首条用户消息派生会话标题（压缩空白、截断 60 字符）。 */
function deriveTitle(messages: readonly Message[]): string | undefined {
  const firstUser = messages.find((message) => message.role === 'user' && typeof message.content === 'string');
  if (firstUser === undefined || typeof firstUser.content !== 'string') {
    return undefined;
  }
  const collapsed = firstUser.content.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return undefined;
  }
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed;
}

/** 保存当前会话的非 system 消息；保存失败仅提示不中断 REPL。 */
async function persistSession(
  session: AgentSession,
  store: SessionStore,
  write: (text: string) => void,
): Promise<void> {
  try {
    const messages = session.getMessages().filter((message) => message.role !== 'system');
    const stored: StoredSession = {
      id: session.id,
      updatedAt: new Date().toISOString(),
      messages,
    };
    const title = deriveTitle(messages);
    if (title !== undefined) {
      stored.title = title;
    }
    await store.save(stored);
  } catch (error) {
    write(`⚠ Failed to persist session: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function listSessions(
  store: SessionStore | undefined,
  currentId: string,
  write: (text: string) => void,
): Promise<void> {
  if (store === undefined) {
    write('Session persistence is not enabled.\n');
    return;
  }
  const summaries = await store.list();
  if (summaries.length === 0) {
    write('No saved sessions.\n');
    return;
  }
  for (const summary of summaries.slice(0, 10)) {
    const marker = summary.id === currentId ? '*' : ' ';
    const title = summary.title ?? '(untitled)';
    write(`${marker} ${summary.id}  ${title}  ${summary.updatedAt}  (${summary.messageCount} messages)\n`);
  }
}
