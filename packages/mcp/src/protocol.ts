/**
 * MCP 协议最小子集类型：JSON-RPC 2.0 消息与 initialize / tools/list /
 * tools/call 三组方法所需结构。不引入官方 SDK，保持最小依赖面。
 */

/** JSON-RPC 2.0 请求（带 id，期待响应）。 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 通知（无 id，不期待响应）。 */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

/** 入站消息：响应或服务端通知（本客户端仅忽略后者）。 */
export type JsonRpcIncoming = JsonRpcResponse | JsonRpcNotification;

/** tools/list 返回的单个工具定义（schema 原样透传给 LLM）。 */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** tools/call 返回内容块（仅提取 text 类型）。 */
export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpCallResult {
  content?: McpContentBlock[];
  isError?: boolean;
}

/** initialize 握手参数（客户端身份与能力声明）。 */
export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: { name: string; version: string };
}
