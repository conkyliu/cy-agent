/**
 * 工具契约：工具定义必须自包含，提供完整的 JSON Schema 供 LLM 理解。
 */

/**
 * 非泛型基础接口：注册表与通用工具数组使用。
 * execute 参数使用 any 以获得双向可赋值性（泛型工具因参数逆变
 * 无法直接赋值给 execute 参数为 unknown 的类型）。
 */
export interface ToolBase {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
  /** 是否需要用户显式授权（如：写入文件、执行 Shell） */
  requiresApproval?: boolean;
  execute(args: any, signal?: AbortSignal): Promise<any>;
}

/**
 * 泛型工具契约：工具实现者使用，保留参数与结果的强类型。
 */
export interface ToolContract<TArgs = unknown, TResult = unknown> extends ToolBase {
  execute(args: TArgs, signal?: AbortSignal): Promise<TResult>;
}
