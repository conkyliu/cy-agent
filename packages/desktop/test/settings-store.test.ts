import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore, type StoredSettings } from '../main/settings-store.ts';

describe('SettingsStore', () => {
  let tmpDir: string;
  let settingsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-agent-settings-test-'));
    settingsFile = path.join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件不存在时 load 返回空对象', () => {
    const store = new SettingsStore(settingsFile);
    expect(store.load()).toEqual({});
  });

  it('正确持久化保存并恢复各项设置', () => {
    const store = new SettingsStore(settingsFile);
    const data: StoredSettings = {
      provider: 'gemini',
      model: 'google/antigravity',
      apiKey: 'test-api-key',
      baseUrl: 'https://proxy.example.com',
      customSystemPrompt: 'Always output typescript code',
    };
    store.save(data);

    const reloaded = store.load();
    expect(reloaded).toEqual(data);
  });

  it('文件内容损坏或非法 JSON 时优雅降级返回空对象', () => {
    fs.writeFileSync(settingsFile, '{ invalid json content ...');
    const store = new SettingsStore(settingsFile);
    expect(store.load()).toEqual({});
  });
});
