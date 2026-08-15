import type { McpCallResult, McpInitializeParams, McpToolInfo } from './protocol.js';
import { StdioTransport, type StdioTransportOptions } from './stdio.js';

/** 本客户端声明的协议版本（服务端通常回以其支持版本，均接受）。 */
const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * MCP stdio 客户端：initialize 握手 + tools/list + tools/call。
 * 构造后必须 connect()；用完 close() 释放子进程。
 */
export class McpClient {
  private readonly transport: StdioTransport;

  constructor(options: StdioTransportOptions, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.transport = new StdioTransport(options, timeoutMs);
  }

  /** 启动子进程并完成 initialize 握手与 initialized 通知。 */
  async connect(): Promise<void> {
    this.transport.start();
    const params: McpInitializeParams = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'cy-agent', version: '0.1.0' },
    };
    await this.transport.request('initialize', params as unknown as Record<string, unknown>);
    this.transport.notify('notifications/initialized');
  }

  /** 枚举服务端工具。 */
  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.transport.request('tools/list')) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  /** 调用工具并将 content 提取为字符串；服务端标记 isError 时抛错。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.transport.request('tools/call', {
      name,
      arguments: args,
    })) as McpCallResult;
    if (result.isError === true) {
      throw new Error(`MCP tool "${name}" reported error: ${toolResultText(result)}`);
    }
    return toolResultText(result);
  }

  close(): void {
    this.transport.close();
  }
}

/** 提取 content 数组中的 text 块拼接为字符串；无 text 时序列化原始结果。 */
function toolResultText(result: McpCallResult): string {
  const blocks = result.content ?? [];
  const texts = blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string);
  if (texts.length > 0) {
    return texts.join('\n');
  }
  return JSON.stringify(result);
}
