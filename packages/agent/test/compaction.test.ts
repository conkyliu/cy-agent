import { describe, expect, it } from 'vitest';
import type { Message } from '@cy-agent/protocol';
import { buildTranscript, createSummaryMessage, SUMMARY_MARKER } from '../src/context/compaction.js';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  return { content: null, ...partial };
}

describe('buildTranscript', () => {
  it('按角色逐行输出消息内容', () => {
    const transcript = buildTranscript([
      msg({ id: 'u1', role: 'user', content: 'fix the bug' }),
      msg({ id: 'a1', role: 'assistant', content: 'on it' }),
    ]);
    expect(transcript).toBe('user: fix the bug\nassistant: on it');
  });

  it('工具调用仅保留名称摘要，content 为 null 时不留空白残留', () => {
    const transcript = buildTranscript([
      msg({
        id: 'a1',
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: 'tc1', name: 'read_file', arguments: '{"path":"a"}' },
          { id: 'tc2', name: 'search_files', arguments: '{}' },
        ],
      }),
    ]);
    expect(transcript).toBe('assistant: (called tools: read_file, search_files)');
  });
});

describe('createSummaryMessage', () => {
  it('生成带标记前缀的 user 角色消息', () => {
    const message = createSummaryMessage('User asked to fix a bug.');
    expect(message.role).toBe('user');
    expect(message.content).toContain(SUMMARY_MARKER);
    expect(message.content).toContain('User asked to fix a bug.');
    expect(message.id.length).toBeGreaterThan(0);
  });
});
