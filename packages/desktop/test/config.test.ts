import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDesktopConfig, readShellConfigExports } from '../main/config.ts';

describe('readShellConfigExports', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-agent-config-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('解析 export 语句（单引号/双引号/无引号）', () => {
    fs.writeFileSync(
      path.join(home, '.zshrc'),
      [
        'export CY_AGENT_API_KEY="sk-abc"',
        "export CY_AGENT_MODEL='gpt-4o-mini'",
        'export CY_AGENT_BASE_URL=https://example.com/v1 # 行内注释',
        'export UNRELATED_KEY=ignored',
        '# export CY_AGENT_CWD=/commented',
      ].join('\n'),
    );
    const result = readShellConfigExports(
      ['CY_AGENT_API_KEY', 'CY_AGENT_MODEL', 'CY_AGENT_BASE_URL', 'CY_AGENT_CWD'],
      home,
    );
    expect(result).toEqual({
      CY_AGENT_API_KEY: 'sk-abc',
      CY_AGENT_MODEL: 'gpt-4o-mini',
      CY_AGENT_BASE_URL: 'https://example.com/v1',
    });
  });

  it('按 shell 加载顺序后者覆盖前者', () => {
    fs.writeFileSync(path.join(home, '.zshenv'), 'export CY_AGENT_API_KEY="env-key"\n');
    fs.writeFileSync(path.join(home, '.zshrc'), 'export CY_AGENT_API_KEY="rc-key"\n');
    const result = readShellConfigExports(['CY_AGENT_API_KEY'], home);
    expect(result.CY_AGENT_API_KEY).toBe('rc-key');
  });

  it('配置文件不存在时返回空对象', () => {
    expect(readShellConfigExports(['CY_AGENT_API_KEY'], home)).toEqual({});
  });
});

describe('loadDesktopConfig 环境变量回退', () => {
  let home: string;
  const originalHomedir = os.homedir;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-agent-config-'));
    fs.writeFileSync(path.join(home, '.zshrc'), 'export CY_AGENT_API_KEY="sk-from-rc"\n');
    // 模拟 GUI 启动：进程环境无该变量，homedir 指向临时目录。
    (os as { homedir: () => string }).homedir = () => home;
  });

  afterEach(() => {
    (os as { homedir: () => string }).homedir = originalHomedir;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('进程环境缺失 API Key 时从 zshrc 回退读取', () => {
    const config = loadDesktopConfig({}, '/Documents');
    expect(config.apiKey).toBe('sk-from-rc');
  });

  it('进程环境已有 API Key 时不读取配置文件', () => {
    const config = loadDesktopConfig({ CY_AGENT_API_KEY: 'sk-from-env' }, '/Documents');
    expect(config.apiKey).toBe('sk-from-env');
  });

  it('进程环境变量为空串时同样回退', () => {
    const config = loadDesktopConfig({ CY_AGENT_API_KEY: '' }, '/Documents');
    expect(config.apiKey).toBe('sk-from-rc');
  });
});
