import type { ToolBase } from '@cy-agent/agent';
import { loadMcpTools, readMcpConfig, type McpLoadedServer } from '@cy-agent/mcp';
import { loadPluginTools } from './plugins.js';
import { buildSkillsOverviewSection, listSkills, type SkillInfo } from './skills.js';

export interface LoadExtensionsOptions {
  /** MCP 配置文件路径（Claude Desktop 风格）；未提供则跳过 MCP。 */
  mcpConfig?: string;
}

export interface Extensions {
  /** MCP + 插件提供的全部工具（load_skill 由宿主按需另行注册）。 */
  tools: ToolBase[];
  /** 工作区技能清单（用于概览段与 load_skill）。 */
  skills: SkillInfo[];
  /** 概览用 Available skills 段落；无技能时为空串。 */
  skillsSection: string;
  /** 已连接的 MCP server 句柄（宿主退出/切换时关闭）。 */
  mcpServers: McpLoadedServer[];
  /** 加载告警（坏插件/坏 server），宿主应展示给用户。 */
  warnings: string[];
}

/**
 * 统一扩展装配入口：聚合 MCP 工具、本地插件工具与技能概览段。
 * 任一扩展源失败均降级跳过并收集告警，绝不阻塞会话启动。
 */
export async function loadExtensions(
  workspace: string,
  options: LoadExtensionsOptions = {},
): Promise<Extensions> {
  const warnings: string[] = [];
  const tools: ToolBase[] = [];
  let mcpServers: McpLoadedServer[] = [];

  if (options.mcpConfig !== undefined && options.mcpConfig.length > 0) {
    try {
      const config = await readMcpConfig(options.mcpConfig);
      const mcp = await loadMcpTools(config);
      tools.push(...mcp.tools);
      mcpServers = mcp.servers;
      warnings.push(...mcp.warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`MCP config "${options.mcpConfig}" not loaded: ${message}`);
    }
  }

  const plugins = await loadPluginTools(workspace);
  tools.push(...plugins.tools);
  warnings.push(...plugins.warnings);

  const skills = await listSkills(workspace);
  return {
    tools,
    skills,
    skillsSection: buildSkillsOverviewSection(skills),
    mcpServers,
    warnings,
  };
}

/** 关闭 MCP server 句柄（宿主退出或工作区切换时调用）。 */
export function closeMcpServers(servers: McpLoadedServer[]): void {
  for (const server of servers) {
    server.client.close();
  }
}
