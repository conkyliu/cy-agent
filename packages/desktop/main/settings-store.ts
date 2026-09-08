/**
 * 桌面端用户设置持久化存储：读写 userData/settings.json。
 * 纯 Node 实现，便于单测。
 */

import fs from 'node:fs';
import path from 'node:path';

export interface StoredSettings {
  provider?: 'openai' | 'anthropic' | 'gemini' | string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  customSystemPrompt?: string;
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  /** 读取设置；文件缺失或损坏时返回空对象。 */
  load(): StoredSettings {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {};
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as StoredSettings;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  /** 写入设置；失败静默（不影响内存中的配置生效）。 */
  save(settings: StoredSettings): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf8');
    } catch {
      // 写入异常不抛出
    }
  }
}
