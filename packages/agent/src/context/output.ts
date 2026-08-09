/**
 * 工具输出截断：防止大体积结果（整读大文件、海量日志等）
 * 污染上下文历史，导致预算快速耗尽或请求超限。
 *
 * 策略：保留头部与尾部（尾部常含错误信息），中间插入截断标记；
 * 标记本身计入最终长度，保证结果不会超过上限。
 */

/** 单条工具输出的默认最大字符数（约 8k token）。 */
export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 32_000;

/** 截断时头部保留的比例，尾部保留剩余部分。 */
const HEAD_RATIO = 0.6;

/**
 * 将超长工具输出截断为"头部 + 截断标记 + 尾部"。
 * 不超过 maxChars 的输入原样返回。
 */
export function truncateToolOutput(
  text: string,
  maxChars: number = DEFAULT_MAX_TOOL_OUTPUT_CHARS,
): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  // 先预留标记长度的粗略估计，二次校正保证最终不超限。
  const omitted = text.length - maxChars;
  const marker = `\n...[output truncated: ${omitted} characters omitted]...\n`;
  const budget = maxChars - marker.length;
  if (budget <= 0) {
    // 上限小到放不下标记时，直接硬切并附最简标记。
    return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
  }
  const headLength = Math.ceil(budget * HEAD_RATIO);
  const tailLength = budget - headLength;
  const head = text.slice(0, headLength);
  const tail = tailLength > 0 ? text.slice(text.length - tailLength) : '';
  return `${head}${marker}${tail}`;
}
