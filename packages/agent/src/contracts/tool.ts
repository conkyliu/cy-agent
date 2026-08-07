/**
 * 工具契约：工具定义必须自包含，提供完整的 JSON Schema 供 LLM 理解。
 */
export interface ToolContract<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
  /** 是否需要用户显式授权（如：写入文件、执行 Shell） */
  requiresApproval?: boolean;
  execute: (args: TArgs, signal?: AbortSignal) => Promise<TResult>;
}
