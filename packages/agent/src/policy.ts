/**
 * 工具执行策略扩展点。
 *
 * 当前版本默认静默自动执行所有工具；
 * 该接口为后续 Human-in-the-loop（等待用户授权）预留挂起能力。
 */
export interface ToolExecutionPolicy {
  /**
   * 在工具执行前调用。返回 false 表示拒绝执行，
   * 拒绝原因会以错误形式交还给 LLM。
   */
  approve?(toolName: string, args: unknown): boolean | Promise<boolean>;
}

/** 默认策略：自动静默执行所有工具。 */
export const autoApprovePolicy: ToolExecutionPolicy = {};
