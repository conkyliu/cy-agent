/* global process */
/**
 * 测试用内联 MCP server：按行读写 JSON-RPC，
 * 回显 initialize / tools/list / tools/call 三类请求。
 */
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

const respond = (id, result) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
};

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    respond(msg.id, {
      protocolVersion: '2025-06-18',
      capabilities: {},
      serverInfo: { name: 'mock', version: '0.0.0' },
    });
  } else if (msg.method === 'tools/list') {
    respond(msg.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo the input',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
        { name: 'boom', description: 'Always fails', inputSchema: { type: 'object' } },
      ],
    });
  } else if (msg.method === 'tools/call') {
    const args = msg.params?.arguments ?? {};
    if (msg.params?.name === 'echo') {
      respond(msg.id, { content: [{ type: 'text', text: `echo:${args.text ?? ''}` }] });
    } else {
      respond(msg.id, { content: [{ type: 'text', text: 'boom failed' }], isError: true });
    }
  }
});
