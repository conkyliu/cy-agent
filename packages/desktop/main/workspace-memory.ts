/**
 * 工作区记忆：最后选择的工作区持久化到 userData 下的 JSON 文件，
 * 下次启动恢复。纯 Node 实现，便于单测。
 */

import fs from 'node:fs';
import path from 'node:path';

interface MemoryFile {
  workspace: string;
}

export class WorkspaceMemory {
  constructor(private readonly filePath: string) {}

  /** 读取记忆；文件缺失或损坏时返回 null（回退到环境变量链）。 */
  load(): string | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as MemoryFile;
      if (typeof parsed.workspace === 'string' && parsed.workspace.length > 0) {
        return parsed.workspace;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 写入记忆；失败静默（记忆缺失不影响功能，仅失去恢复能力）。 */
  save(workspace: string): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ workspace } satisfies MemoryFile), 'utf8');
    } catch {
      // 写入失败不阻塞切换本身。
    }
  }
}
