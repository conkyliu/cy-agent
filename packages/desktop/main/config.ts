/**
 * 桌面端运行配置：复用 CLI 的环境变量约定。
 * CY_AGENT_API_KEY / OPENAI_API_KEY、CY_AGENT_MODEL、CY_AGENT_BASE_URL、CY_AGENT_CWD。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DesktopRuntimeConfig {
  /** 缺失时不崩溃，send 时经事件流反馈 session_error。 */
  apiKey?: string;
  model: string;
  baseUrl?: string;
  /** 编码工具沙箱根目录。 */
  workspace: string;
}

/** 配置加载需要关注的变量（缺失时尝试从 shell 配置文件补充）。 */
const CONFIG_KEYS = [
  'CY_AGENT_API_KEY',
  'OPENAI_API_KEY',
  'CY_AGENT_MODEL',
  'CY_AGENT_BASE_URL',
  'CY_AGENT_CWD',
] as const;

/** 从进程环境与 shell 配置文件合并读取配置变量，进程环境优先。 */
function resolveConfigEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const missing = CONFIG_KEYS.filter((key) => env[key] === undefined || env[key] === '');
  if (!missing.includes('CY_AGENT_API_KEY') && !missing.includes('OPENAI_API_KEY')) {
    // API Key 已就绪，其余变量缺失不影响可用性，避免多余的文件解析。
    return env;
  }
  // shell 配置文件值仅作回退：进程环境中非空值优先。
  const merged: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(readShellConfigExports(missing))) {
    if (merged[key] === undefined || merged[key] === '') {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * 解析用户 shell 配置文件中的 `export KEY=VALUE` 语句。
 * GUI 启动（Dock/Finder）不加载 zshrc，借此补齐终端中设置的环境变量。
 * 仅做静态文本解析（不执行脚本），支持单/双引号与无引号值。
 * @param home 用户主目录（可注入便于测试）。
 */
export function readShellConfigExports(
  keys: readonly string[],
  home: string = os.homedir(),
): Record<string, string> {
  // 读取顺序即 shell 加载顺序，后者覆盖前者。
  const files = ['.zshenv', '.zprofile', '.zshrc'];
  const result: Record<string, string> = {};
  const wanted = new Set(keys);
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(home, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const match = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)\s*(?:#.*)?$/.exec(
        line,
      );
      if (match === null || match[1] === undefined || match[2] === undefined) {
        continue;
      }
      const name = match[1];
      if (!wanted.has(name)) {
        continue;
      }
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[name] = value;
    }
  }
  return result;
}

/**
 * 从环境变量装载配置。
 * @param defaultWorkspace CY_AGENT_CWD 未设置时的回退目录（通常为 Documents）。
 */
export function loadDesktopConfig(
  env: Record<string, string | undefined>,
  defaultWorkspace: string,
): DesktopRuntimeConfig {
  const resolved = resolveConfigEnv(env);
  const model = pick(resolved.CY_AGENT_MODEL) ?? 'gpt-4o';
  const workspace = pick(resolved.CY_AGENT_CWD) ?? defaultWorkspace;
  const apiKey = pick(resolved.CY_AGENT_API_KEY, resolved.OPENAI_API_KEY);
  const baseUrl = pick(resolved.CY_AGENT_BASE_URL);

  const config: DesktopRuntimeConfig = { model, workspace };
  if (apiKey !== undefined) {
    config.apiKey = apiKey;
  }
  if (baseUrl !== undefined) {
    config.baseUrl = baseUrl;
  }
  return config;
}

/** 返回第一个非空且非空串的候选值。 */
function pick(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}
