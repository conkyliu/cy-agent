import type { ToolBase } from './contracts/tool.js';

/**
 * 工具注册表。
 *
 * 后续需要支持 MCP 与插件系统，工具不是静态数组：
 * - 支持运行时 register / unregister；
 * - 会话启动时向 Registry 请求当前可用的完整工具快照。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolBase>();

  register(tool: ToolBase): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  get(toolName: string): ToolBase | undefined {
    return this.tools.get(toolName);
  }

  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /** 返回当前所有工具的快照（数组拷贝，防止外部篡改）。 */
  snapshot(): ToolBase[] {
    return [...this.tools.values()];
  }
}
