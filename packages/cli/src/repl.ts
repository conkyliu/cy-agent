import { createInterface, type Interface } from 'node:readline/promises';
import process from 'node:process';
import type { AgentSession } from '@cy-agent/agent';
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

  // SIGINT：运行中取消当前轮，空闲时退出。
  let cancelled = false;
  const onSigint = (): void => {
    if (options.session.isRunning) {
      options.session.cancel();
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
      await runTurn(options.session, input, reader, write, color);
      write(prompt);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    rl.close();
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
