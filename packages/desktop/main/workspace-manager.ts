/**
 * 主进程工作区管理器：当前工作区状态、切换门控、工具重建与扩展装配。
 *
 * 不依赖 Electron，便于纯 Node 环境单测。会话宿主以结构化接口注入
 * （生产实现为 SessionManager）。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from '@cy-agent/agent';
import type { McpLoadedServer } from '@cy-agent/mcp';
import {
  buildWorkspaceOverview,
  closeMcpServers,
  createCodingTools,
  createLoadSkillTool,
  createRunShellTool,
  loadExtensions,
  withWorkspaceOverview,
  type LoadExtensionsOptions,
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
  /** MCP 配置文件路径；未提供则不加载 MCP 工具。 */
  mcpConfig?: string;
}

/** 应用工作区后的装配结果（供宿主与后续切换清理使用）。 */
export interface PreparedWorkspace {
  systemPrompt: string;
  /** 已注册的扩展工具名（切换时注销）。 */
  extensionToolNames: string[];
  /** 已连接的 MCP server 句柄（切换/退出时关闭）。 */
  mcpServers: McpLoadedServer[];
  /** 扩展加载告警（坏插件/坏 server）。 */
  warnings: string[];
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

/**
 * 拼装含工作区概览的 systemPrompt（概览生成内部已容错，绝不抛错）；
 * 可选追加技能清单段（无技能时 skillsSection 为空串，原样返回）。
 */
export async function buildSystemPrompt(
  baseSystemPrompt: string,
  workspace: string,
  skillsSection = '',
): Promise<string> {
  const overview = await buildWorkspaceOverview(workspace);
  let prompt = withWorkspaceOverview(baseSystemPrompt, overview);
  if (skillsSection.length > 0) {
    prompt = `${prompt}\n\n${skillsSection}`;
  }
  return prompt;
}

/**
 * 应用工作区：重建内置编码工具 + 加载扩展（MCP/插件/技能）+ 生成 systemPrompt。
 * 供 bootstrap 与切换共用。previous* 参数用于清理上一工作区的扩展残留。
 */
export async function applyWorkspace(
  registry: ToolRegistry,
  workspace: string,
  baseSystemPrompt: string,
  options: {
    mcpConfig?: string;
    previousExtensionToolNames?: string[];
    previousMcpServers?: McpLoadedServer[];
  } = {},
): Promise<PreparedWorkspace> {
  for (const name of options.previousExtensionToolNames ?? []) {
    registry.unregister(name);
  }
  if (options.previousMcpServers !== undefined) {
    closeMcpServers(options.previousMcpServers);
  }

  registerWorkspaceTools(registry, workspace);

  const extensionOptions: LoadExtensionsOptions = {};
  if (options.mcpConfig !== undefined) {
    extensionOptions.mcpConfig = options.mcpConfig;
  }
  const extensions = await loadExtensions(workspace, extensionOptions);

  const extensionToolNames: string[] = [];
  for (const tool of extensions.tools) {
    registry.register(tool);
    extensionToolNames.push(tool.name);
  }
  if (extensions.skills.length > 0) {
    const skillTool = createLoadSkillTool(workspace);
    registry.register(skillTool);
    extensionToolNames.push(skillTool.name);
  }

  const systemPrompt = await buildSystemPrompt(
    baseSystemPrompt,
    workspace,
    extensions.skillsSection,
  );
  return {
    systemPrompt,
    extensionToolNames,
    mcpServers: extensions.mcpServers,
    warnings: extensions.warnings,
  };
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
  private extensionToolNames: string[] = [];
  private mcpServers: McpLoadedServer[] = [];

  constructor(
    initialWorkspace: string,
    private readonly options: WorkspaceManagerOptions,
    initialState?: Pick<PreparedWorkspace, 'extensionToolNames' | 'mcpServers'>,
  ) {
    this.workspace = initialWorkspace;
    if (initialState !== undefined) {
      this.extensionToolNames = initialState.extensionToolNames;
      this.mcpServers = initialState.mcpServers;
    }
  }

  get current(): string {
    return this.workspace;
  }

  /**
   * 切换工作区：
   * - 运行中（含未决授权挂起）拒绝，反馈明确错误由 UI 展示；
   * - 重建编码工具集与扩展（新目录为沙箱根，重扫插件与技能）；
   * - 重新生成 systemPrompt（含新工作区概览与技能段）；
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

    const applyOptions: {
      mcpConfig?: string;
      previousExtensionToolNames: string[];
      previousMcpServers: McpLoadedServer[];
    } = {
      previousExtensionToolNames: this.extensionToolNames,
      previousMcpServers: this.mcpServers,
    };
    if (this.options.mcpConfig !== undefined) {
      applyOptions.mcpConfig = this.options.mcpConfig;
    }
    const prepared = await applyWorkspace(
      this.options.registry,
      resolved,
      this.options.baseSystemPrompt,
      applyOptions,
    );
    this.extensionToolNames = prepared.extensionToolNames;
    this.mcpServers = prepared.mcpServers;
    this.options.host.setSystemPrompt(prepared.systemPrompt);
    const { id } = await this.options.host.newSession();
    this.workspace = resolved;
    this.options.memory?.save(resolved);
    return { workspace: resolved, sessionId: id };
  }
}
