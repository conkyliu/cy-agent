import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolBase } from '@cy-agent/agent';

/** 插件目录（工作区内）。 */
export const PLUGINS_DIR = '.cy-agent/plugins';

/** 插件默认导出契约：返回本插件提供的工具列表。 */
export type PluginFactory = (context: { workspace: string }) => ToolBase[] | Promise<ToolBase[]>;

export interface PluginLoadResult {
  tools: ToolBase[];
  warnings: string[];
}

/**
 * 扫描工作区插件目录，动态 import 每个 *.mjs 并调用默认导出
 * createTools({ workspace })。单插件失败告警跳过，绝不中断启动。
 *
 * 安全边界：插件代码以宿主进程权限执行，信任级别与 run_shell 等同，
 * 仅应存在于用户信任的工作区。
 */
export async function loadPluginTools(workspace: string): Promise<PluginLoadResult> {
  const result: PluginLoadResult = { tools: [], warnings: [] };
  let files: string[];
  try {
    files = await fs.readdir(path.join(workspace, PLUGINS_DIR));
  } catch {
    return result; // 无插件目录：正常状态。
  }
  for (const file of files.sort()) {
    if (!file.endsWith('.mjs')) {
      continue;
    }
    const full = path.join(workspace, PLUGINS_DIR, file);
    try {
      const module = (await import(pathToFileURL(full).href)) as { default?: unknown };
      if (typeof module.default !== 'function') {
        throw new Error('missing default export createTools');
      }
      const tools = await (module.default as PluginFactory)({ workspace });
      if (Array.isArray(tools)) {
        result.tools.push(...tools);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push(`Plugin "${file}" failed to load: ${message}`);
    }
  }
  return result;
}
