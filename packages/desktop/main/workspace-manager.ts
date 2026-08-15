/**
 * 主进程工作区管理器：当前工作区状态、切换门控与工具重建。
 *
 * 不依赖 Electron，便于纯 Node 环境单测。会话宿主以结构化接口注入
 * （生产实现为 SessionManager）。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from '@cy-agent/agent';
import {
  buildWorkspaceOverview,
  createCodingTools,
  createRunShellTool,
  withWorkspaceOverview,
} from '@cy-agent/tools';
import type { WorkspaceMemory } from './workspace-memory';

/** 与工作区绑定的内置工具名（切换时整体重建）。 */
const WORKSPACE_TOOL_NAMES = [
  'read_file',
  'write_file',
  'list_directory',
  'search_files',
  'run_shell',
];

/** 工作区管理所需的会话宿主最小契约（结构化依赖，便于单测）。 */
export interface WorkspaceSessionHost {
  isRunning: boolean;
  activeId: string;
  setSystemPrompt(systemPrompt: string): void;
  newSession(): Promise<{ id: string }>;
}

export interface WorkspaceManagerOptions {
  registry: ToolRegistry;
  host: WorkspaceSessionHost;
  /** 不含工作区概览的基础 systemPrompt。 */
  baseSystemPrompt: string;
  memory?: WorkspaceMemory;
}

/** 重建指定工作区的编码工具集并注册（先注销旧工具）。 */
export function registerWorkspaceTools(registry: ToolRegistry, workspace: string): void {
  for (const name of WORKSPACE_TOOL_NAMES) {
    registry.unregister(name);
  }
  for (const tool of createCodingTools(workspace)) {
    registry.register(tool);
  }
  registry.register(createRunShellTool(workspace));
}

/** 启动初始工作区解析：记忆 > 环境变量/默认回退链；记忆目录失效则回退。 */
export function restoreWorkspace(memory: WorkspaceMemory | undefined, fallback: string): string {
  const remembered = memory?.load();
  if (remembered !== undefined && remembered !== null && isExistingDirectory(remembered)) {
    return remembered;
  }
  return fallback;
}

/** 拼装含工作区概览的 systemPrompt（概览生成内部已容错，绝不抛错）。 */
export async function buildSystemPrompt(
  baseSystemPrompt: string,
  workspace: string,
): Promise<string> {
  const overview = await buildWorkspaceOverview(workspace);
  return withWorkspaceOverview(baseSystemPrompt, overview);
}

function isExistingDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export class WorkspaceManager {
  private workspace: string;

  constructor(
    initialWorkspace: string,
    private readonly options: WorkspaceManagerOptions,
  ) {
    this.workspace = initialWorkspace;
  }

  get current(): string {
    return this.workspace;
  }

  /**
   * 切换工作区：
   * - 运行中（含未决授权挂起）拒绝，反馈明确错误由 UI 展示；
   * - 重建编码工具集（新目录为沙箱根）；
   * - 重新生成 systemPrompt（含新工作区概览）；
   * - 存档当前会话并开新会话（新会话即绑定新工具与新提示词）；
   * - 写入工作区记忆供下次启动恢复。
   */
  async selectWorkspace(target: string): Promise<{ workspace: string; sessionId: string }> {
    if (this.options.host.isRunning) {
      throw new Error('Cannot switch workspace while a turn is running');
    }
    const resolved = path.resolve(target);
    if (!isExistingDirectory(resolved)) {
      throw new Error(`Invalid workspace directory: ${target}`);
    }
    if (resolved === this.workspace) {
      // 同一目录：不产生任何状态变更。
      return { workspace: resolved, sessionId: this.options.host.activeId };
    }

    registerWorkspaceTools(this.options.registry, resolved);
    const prompt = await buildSystemPrompt(this.options.baseSystemPrompt, resolved);
    this.options.host.setSystemPrompt(prompt);
    const { id } = await this.options.host.newSession();
    this.workspace = resolved;
    this.options.memory?.save(resolved);
    return { workspace: resolved, sessionId: id };
  }
}
