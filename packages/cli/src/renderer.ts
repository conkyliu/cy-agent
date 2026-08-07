import type { AgentEvent } from '@cy-agent/protocol';

/**
 * 事件渲染器：将 AgentEvent 单向事件流转换为终端可读文本。
 *
 * 纯函数设计（不直接写 stdout），便于测试与未来复用给桌面 Shell。
 * 返回 null 表示该事件无需展示（如 session_started）。
 */

export interface RenderOptions {
  /** 是否输出 ANSI 颜色码，默认 false（非 TTY / 测试环境）。 */
  color?: boolean;
}

/** 长文本截断阈值，避免大文件内容刷屏。 */
const MAX_PREVIEW_LENGTH = 200;

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
} as const;

function paint(text: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${text}${ANSI.reset}` : text;
}

/** 将任意值压缩为单行预览。 */
export function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : safeStringify(value);
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_PREVIEW_LENGTH ? `${flat.slice(0, MAX_PREVIEW_LENGTH)}…` : flat;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 渲染单个事件为终端文本（含必要的换行）。
 * text_chunk 不加任何前缀与换行，保证流式输出连贯。
 */
export function renderEvent(event: AgentEvent, options: RenderOptions = {}): string | null {
  const color = options.color ?? false;

  switch (event.type) {
    case 'session_started':
    case 'session_completed':
      return null;
    case 'text_chunk':
      return event.text;
    case 'context_trimmed':
      return paint(
        `\n⋯ Context trimmed: removed ${event.removedMessages} message(s), ~${event.estimatedTokens} tokens remain\n`,
        ANSI.dim,
        color,
      );
    case 'context_compacted':
      return paint(
        `\n⋯ Context compacted: summarized ${event.removedMessages} message(s) into a brief summary\n`,
        ANSI.dim,
        color,
      );
    case 'tool_approval_requested':
      return paint(
        `\n⚠ Approval required for "${event.name}"\n  args: ${preview(event.args)}\n`,
        ANSI.yellow,
        color,
      );
    case 'tool_execution_started':
      return paint(`\n⚙ ${event.name} ${preview(event.args)}\n`, ANSI.cyan, color);
    case 'tool_execution_completed':
      return paint(`✓ ${preview(event.result)}\n`, ANSI.green, color);
    case 'tool_execution_failed':
      return paint(`✗ ${event.error}\n`, ANSI.red, color);
    case 'session_cancelled':
      return paint('\n⊘ Session cancelled\n', ANSI.dim, color);
    case 'session_error':
      return paint(`\n✗ Error: ${event.error.message}\n`, ANSI.red, color);
    default: {
      // 穷尽检查：新增事件类型时此处编译报错，提醒补渲染逻辑。
      const exhaustive: never = event;
      return String(exhaustive);
    }
  }
}
