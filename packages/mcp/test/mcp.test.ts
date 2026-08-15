import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { McpClient, loadMcpTools, readMcpConfig, type McpConfigFile } from '../src/index.js';

const MOCK_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'mock-server.mjs',
);
const NODE = process.execPath;

describe('McpClient', () => {
  it('完成握手、枚举与调用往返', async () => {
    const client = new McpClient({ command: NODE, args: [MOCK_SERVER] }, 10000);
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('echo');
    const result = await client.callTool('echo', { text: 'hello' });
    expect(result).toBe('echo:hello');
    client.close();
  });

  it('服务端 isError 结果转为抛错', async () => {
    const client = new McpClient({ command: NODE, args: [MOCK_SERVER] }, 10000);
    await client.connect();
    await expect(client.callTool('boom', {})).rejects.toThrow('reported error');
    client.close();
  });
});

describe('loadMcpTools', () => {
  const opened: McpClient[] = [];

  afterAll(() => {
    for (const client of opened) {
      client.close();
    }
  });

  it('适配命名、授权标记与 schema 透传，坏 server 降级告警', async () => {
    const config: McpConfigFile = {
      mcpServers: {
        demo: { command: NODE, args: [MOCK_SERVER] },
        broken: { command: '/nonexistent-cy-agent-binary' },
      },
    };
    const result = await loadMcpTools(config);
    for (const server of result.servers) {
      opened.push(server.client);
    }

    const echo = result.tools.find((tool) => tool.name === 'mcp_demo_echo');
    expect(echo).toBeDefined();
    expect(echo?.requiresApproval).toBe(true);
    expect(echo?.parameters).toEqual({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
    expect(result.warnings.some((warning) => warning.includes('broken'))).toBe(true);

    const output = await echo?.execute({ text: 'via adapter' });
    expect(output).toBe('echo:via adapter');
  });

  it('配置缺少 mcpServers 时拒绝', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-mcp-'));
    const file = path.join(dir, 'mcp.json');
    await fs.writeFile(file, JSON.stringify({ servers: {} }), 'utf8');
    await expect(readMcpConfig(file)).rejects.toThrow('mcpServers');
  });
});
