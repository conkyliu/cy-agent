import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Message } from '@cy-agent/protocol';
import { JsonFileSessionStore } from '@cy-agent/storage';

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
  }));
}

describe('JsonFileSessionStore', () => {
  let dir: string;

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function setup(): JsonFileSessionStore {
    dir = path.join(os.tmpdir(), `cy-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return new JsonFileSessionStore(dir);
  }

  it('保存后可按 ID 加载（含消息完整性）', async () => {
    const store = setup();
    const messages = makeMessages(3);
    await store.save({ id: 'sess-1', updatedAt: '2026-01-01T00:00:00.000Z', messages });
    const loaded = await store.load('sess-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('sess-1');
    expect(loaded?.messages).toEqual(messages);
  });

  it('不存在的会话返回 null，不抛异常', async () => {
    const store = setup();
    expect(await store.load('missing')).toBeNull();
  });

  it('list 按 updatedAt 倒序并跳过损坏文件', async () => {
    const store = setup();
    await store.save({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z', messages: makeMessages(1) });
    await store.save({ id: 'new', updatedAt: '2026-02-01T00:00:00.000Z', messages: makeMessages(2) });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'broken.json'), '{not valid json', 'utf8');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'ignore me', 'utf8');

    const summaries = await store.list();
    expect(summaries.map((s) => s.id)).toEqual(['new', 'old']);
    expect(summaries[0]?.messageCount).toBe(2);
  });

  it('重复保存覆盖旧数据（updatedAt 更新）', async () => {
    const store = setup();
    await store.save({ id: 's', updatedAt: '2026-01-01T00:00:00.000Z', messages: makeMessages(1) });
    await store.save({ id: 's', updatedAt: '2026-03-01T00:00:00.000Z', messages: makeMessages(4) });
    const loaded = await store.load('s');
    expect(loaded?.messages.length).toBe(4);
    expect(loaded?.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('delete 移除会话，缺失时静默成功', async () => {
    const store = setup();
    await store.save({ id: 'doomed', updatedAt: '2026-01-01T00:00:00.000Z', messages: [] });
    await store.delete('doomed');
    expect(await store.load('doomed')).toBeNull();
    await expect(store.delete('doomed')).resolves.toBeUndefined();
  });

  it('拒绝路径注入形式的会话 ID', async () => {
    const store = setup();
    await expect(
      store.save({ id: '../evil', updatedAt: '2026-01-01T00:00:00.000Z', messages: [] }),
    ).rejects.toThrow(/Invalid session id/);
    await expect(store.load('a/b')).rejects.toThrow(/Invalid session id/);
  });

  it('损坏的会话文件加载返回 null', async () => {
    const store = setup();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'corrupt.json'), '{"id": 123}', 'utf8');
    expect(await store.load('corrupt')).toBeNull();
  });

  it('title 可保存并在加载与列表摘要中返回', async () => {
    const store = setup();
    await store.save({
      id: 'titled',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: makeMessages(1),
      title: 'Fix the login bug',
    });
    const loaded = await store.load('titled');
    expect(loaded?.title).toBe('Fix the login bug');
    const summaries = await store.list();
    expect(summaries[0]?.title).toBe('Fix the login bug');
  });

  it('无 title 的旧格式会话仍可加载，title 非字符串时视为损坏', async () => {
    const store = setup();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'legacy.json'),
      JSON.stringify({ id: 'legacy', updatedAt: '2026-01-01T00:00:00.000Z', messages: [] }),
      'utf8',
    );
    const legacy = await store.load('legacy');
    expect(legacy).not.toBeNull();
    expect(legacy?.title).toBeUndefined();

    await fs.writeFile(
      path.join(dir, 'badtitle.json'),
      JSON.stringify({ id: 'badtitle', updatedAt: '2026-01-01T00:00:00.000Z', messages: [], title: 42 }),
      'utf8',
    );
    expect(await store.load('badtitle')).toBeNull();
  });
});
