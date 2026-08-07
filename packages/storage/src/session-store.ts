import fs from 'node:fs/promises';
import path from 'node:path';
import type { Message } from '@cy-agent/protocol';

/**
 * 会话历史持久化。
 *
 * 契约 + JSON 文件实现分离：未来可替换为 SQLite 而不影响 CLI。
 * 只保存非 system 消息（systemPrompt 由宿主在恢复时重新注入），
 * 避免系统提示词在历史中重复累积。
 */

export interface StoredSession {
  id: string;
  /** ISO 8601 时间戳 */
  updatedAt: string;
  /** 非 system 消息 */
  messages: Message[];
  /** 可选标题（通常取首条用户消息摘要），便于多会话列表辨识。 */
  title?: string;
}

export interface SessionSummary {
  id: string;
  updatedAt: string;
  /** 消息条数，便于列表展示 */
  messageCount: number;
  /** 可选标题，缺失时为 undefined。 */
  title?: string;
}

export interface SessionStore {
  save(session: StoredSession): Promise<void>;
  load(id: string): Promise<StoredSession | null>;
  /** 按 updatedAt 倒序返回摘要列表。 */
  list(): Promise<SessionSummary[]>;
  delete(id: string): Promise<void>;
}

/** 会话 ID 仅允许字母、数字、下划线与连字符，防止路径注入。 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class JsonFileSessionStore implements SessionStore {
  constructor(private readonly directory: string) {}

  async save(session: StoredSession): Promise<void> {
    this.assertSafeId(session.id);
    await fs.mkdir(this.directory, { recursive: true });
    const payload = JSON.stringify(session, null, 2);
    // 原子写入：先写临时文件再 rename，避免进程中断留下半截 JSON。
    const target = this.filePath(session.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, payload, 'utf8');
    await fs.rename(temporary, target);
  }

  async load(id: string): Promise<StoredSession | null> {
    this.assertSafeId(id);
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(id), 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
    return parseSession(raw);
  }

  async list(): Promise<SessionSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const summaries: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      try {
        const raw = await fs.readFile(path.join(this.directory, entry), 'utf8');
        const session = parseSession(raw);
        if (session !== null) {
          const summary: SessionSummary = {
            id: session.id,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
          };
          if (session.title !== undefined) {
            summary.title = session.title;
          }
          summaries.push(summary);
        }
      } catch {
        // 单个文件损坏不影响列表能力。
      }
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  async delete(id: string): Promise<void> {
    this.assertSafeId(id);
    await fs.rm(this.filePath(id), { force: true });
  }

  private filePath(id: string): string {
    return path.join(this.directory, `${id}.json`);
  }

  private assertSafeId(id: string): void {
    if (!SAFE_ID_PATTERN.test(id)) {
      throw new Error(`Invalid session id "${id}"`);
    }
  }
}

function parseSession(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed?.updatedAt !== 'string' ||
      !Array.isArray(parsed?.messages)
    ) {
      return null;
    }
    if (parsed.title !== undefined && typeof parsed.title !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
