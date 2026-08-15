import { spawn, type ChildProcess } from 'node:child_process';
import type { JsonRpcIncoming, JsonRpcNotification, JsonRpcRequest } from './protocol.js';

export interface StdioTransportOptions {
  command: string;
  args?: readonly string[];
  /** 合并进子进程环境变量（不覆盖宿主环境）。 */
  env?: Record<string, string>;
}

/**
 * JSON-RPC 2.0 stdio 传输层：spawn 子进程，按行编解码消息，
 * 请求/响应经 id 配对；stderr 静默丢弃（服务端日志不干扰会话）。
 */
export class StdioTransport {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly options: StdioTransportOptions,
    private readonly timeoutMs: number,
  ) {}

  /** 启动子进程；命令不存在时 spawn 异步报 error，由首个请求超时暴露。 */
  start(): void {
    const env: Record<string, string | undefined> = { ...process.env, ...this.options.env };
    this.child = spawn(this.options.command, [...(this.options.args ?? [])], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env,
    });
    this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.child.on('error', (error) => this.failAll(error));
    this.child.on('close', () => this.failAll(new Error('MCP server process exited')));
  }

  /** 发送请求并等待响应（按 id 配对，超时拒绝）。 */
  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('MCP transport is closed'));
    }
    const id = this.nextId;
    this.nextId += 1;
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method };
    if (params !== undefined) {
      message.params = params;
    }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(message);
    });
  }

  /** 发送通知（无 id，不等待响应）。 */
  notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed) {
      return;
    }
    const message: JsonRpcNotification = { jsonrpc: '2.0', method };
    if (params !== undefined) {
      message.params = params;
    }
    this.send(message);
  }

  /** 终止子进程并拒绝所有未决请求；幂等。 */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.failAll(new Error('MCP transport closed'));
    const child = this.child;
    if (child !== null && child.exitCode === null) {
      child.stdin?.destroy();
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 2000).unref();
    }
    this.child = null;
  }

  private send(message: JsonRpcRequest | JsonRpcNotification): void {
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        this.dispatch(line);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  private dispatch(line: string): void {
    let message: JsonRpcIncoming;
    try {
      message = JSON.parse(line) as JsonRpcIncoming;
    } catch {
      return; // 非法 JSON 行静默跳过（防御噪声输出）。
    }
    if (!('id' in message) || message.id === null || typeof message.id !== 'number') {
      return; // 服务端通知/请求：本客户端不处理。
    }
    const entry = this.pending.get(message.id);
    if (entry === undefined) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if ('error' in message && message.error !== undefined) {
      entry.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
      return;
    }
    entry.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}
