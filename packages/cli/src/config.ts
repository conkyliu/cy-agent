/**
 * CLI 配置解析：命令行参数 + 环境变量。
 *
 * 优先级：命令行参数 > 环境变量 > 默认值。
 * 零第三方依赖（不引入 commander/yargs）。
 */

export interface CliConfig {
  apiKey: string;
  model: string;
  /** 未设置时使用 Provider 默认端点（OpenAI 官方）。 */
  baseUrl?: string;
  /** 编码工具沙箱根目录，默认当前工作目录。 */
  cwd: string;
  /** 恢复指定会话 ID（可选）。 */
  resume?: string;
}

export const HELP_TEXT = `cy-agent - interactive coding agent CLI

Usage:
  cy-agent [options]

Options:
  --model=<name>      Model name            (env: CY_AGENT_MODEL, default: gpt-4o)
  --base-url=<url>    OpenAI-compatible API (env: CY_AGENT_BASE_URL)
  --api-key=<key>     API key               (env: CY_AGENT_API_KEY or OPENAI_API_KEY)
  --cwd=<dir>         Workspace directory   (default: process.cwd())
  --resume=<id>       Resume a saved session (see /sessions)
  --help              Show this help

REPL commands:
  /exit, /quit        Leave the REPL
  /sessions           List saved sessions (* marks the active one)
  /new                Save the current session and start a new one
  /open <id>          Save the current session and open a saved one
  /delete <id>        Delete a saved session (not the active one)
  Ctrl-C (running)    Cancel the current turn
`;

/**
 * 解析 `--key=value` 形式的命令行参数。
 * 未知参数静默忽略，保持 CLI 向前兼容。
 */
export function parseCliArgs(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || match[1] === undefined) {
      continue;
    }
    flags.set(match[1], match[2] ?? '');
  }
  return flags;
}

/**
 * 合并命令行参数与环境变量生成运行配置。
 * @throws 缺失 API Key 时抛出致命错误（对应 spec 的 Fatal Exception）。
 */
export function loadConfig(
  env: Record<string, string | undefined>,
  flags: ReadonlyMap<string, string>,
  cwd: string,
): CliConfig {
  const apiKey = pick(flags.get('api-key'), env.CY_AGENT_API_KEY, env.OPENAI_API_KEY);
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      'Missing API key. Set CY_AGENT_API_KEY / OPENAI_API_KEY or pass --api-key=<key>.',
    );
  }

  const model = pick(flags.get('model'), env.CY_AGENT_MODEL) ?? 'gpt-4o';
  const baseUrl = pick(flags.get('base-url'), env.CY_AGENT_BASE_URL);
  const workspace = pick(flags.get('cwd')) ?? cwd;
  const resume = pick(flags.get('resume'));

  const config: CliConfig = { apiKey, model, cwd: workspace };
  if (baseUrl !== undefined) {
    config.baseUrl = baseUrl;
  }
  if (resume !== undefined) {
    config.resume = resume;
  }
  return config;
}

/** 返回第一个非空且非空串的候选值。 */
function pick(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}
