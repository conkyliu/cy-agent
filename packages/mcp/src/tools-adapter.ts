import fs from 'node:fs/promises';
import type { ToolBase } from '@cy-agent/agent';
import { McpClient } from './client.js';

/** Claude Desktop 风格配置中的单个 server 声明。 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/** 单个 server 连接并适配后的结果（client 句柄供宿主退出时关闭）。 */
export interface McpLoadedServer {
  server: string;
  client: McpClient;
  tools: ToolBase[];
}

export interface McpLoadResult {
  tools: ToolBase[];
  servers: McpLoadedServer[];
  warnings: string[];
}

/**
 * 读取 Claude Desktop 风格 MCP 配置文件；解析失败抛错（配置错误属致命）。
 */
export async function readMcpConfig(file: string): Promise<McpConfigFile> {
  const raw = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(raw) as McpConfigFile;
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.mcpServers !== 'object') {
    throw new Error(`Invalid MCP config: missing "mcpServers" object in ${file}`);
  }
  return parsed;
}

/**
 * 逐 server 连接并适配为 ToolBase：命名 `mcp_<server>_<tool>`，
 * 参数 schema 透传，一律 requiresApproval（外部能力安全默认）。
 * 单 server 启动/握手失败收集告警并跳过，绝不阻塞其余 server。
 */
export async function loadMcpTools(config: McpConfigFile): Promise<McpLoadResult> {
  const result: McpLoadResult = { tools: [], servers: [], warnings: [] };
  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    try {
      const server = await connectServer(serverName, serverConfig);
      result.servers.push(server);
      result.tools.push(...server.tools);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push(`MCP server "${serverName}" unavailable: ${message}`);
    }
  }
  return result;
}

async function connectServer(
  serverName: string,
  serverConfig: McpServerConfig,
): Promise<McpLoadedServer> {
  if (typeof serverConfig.command !== 'string' || serverConfig.command.length === 0) {
    throw new Error('missing "command"');
  }
  const options: ConstructorParameters<typeof McpClient>[0] = { command: serverConfig.command };
  if (serverConfig.args !== undefined) {
    options.args = serverConfig.args;
  }
  if (serverConfig.env !== undefined) {
    options.env = serverConfig.env;
  }
  const client = new McpClient(options);
  try {
    await client.connect();
    const infos = await client.listTools();
    const tools = infos.map((info) => adaptTool(serverName, client, info.name, info));
    return { server: serverName, client, tools };
  } catch (error) {
    client.close();
    throw error;
  }
}

function adaptTool(
  serverName: string,
  client: McpClient,
  remoteName: string,
  info: { description?: string; inputSchema?: Record<string, unknown> },
): ToolBase {
  const name = `mcp_${sanitize(serverName)}_${sanitize(remoteName)}`;
  return {
    name,
    description: `MCP ${serverName}.${remoteName}: ${info.description ?? '(no description)'}`,
    parameters: info.inputSchema ?? { type: 'object', properties: {} },
    requiresApproval: true,
    execute: async (args: unknown, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Tool call aborted');
      }
      return client.callTool(remoteName, (args ?? {}) as Record<string, unknown>);
    },
  };
}

/** 工具名仅保留字母数字与下划线，防止与内置/其他工具命名冲突。 */
function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_]/g, '_');
}
