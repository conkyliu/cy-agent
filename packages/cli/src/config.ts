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
  /** 单次执行提示词；存在时进入非交互模式，执行一轮后退出。 */
  prompt?: string;
  /** 单次模式输出格式：text（默认，流式）或 json（结构化）。 */
  output?: 'text' | 'json';
  /** 单次模式下自动批准需授权的工具调用；默认拒绝（CI 安全默认）。 */
  yes?: boolean;
  /** MCP 配置文件路径（Claude Desktop 风格）；未设置则不加载 MCP 工具。 */
  mcpConfig?: string;
}

export const HELP_TEXT = `cy-agent - interactive coding agent CLI

Usage:
  cy-agent [options]                  Start the interactive REPL
  cy-agent -p "<prompt>" [options]    Run one prompt and exit (non-interactive)
  cy-agent "<prompt>" [options]       Same as -p (positional prompt)
  echo "<prompt>" | cy-agent -p -     Read the prompt from stdin

Options:
  -p, --prompt=<text>   Run the prompt once and exit (non-interactive)
  --output=<fmt>        One-shot output format: text (default) or json
  -y, --yes             Auto-approve tool calls in one-shot mode (default: deny)
  --mcp-config=<file>   MCP servers config       (env: CY_AGENT_MCP_CONFIG)
  --model=<name>      Model name            (env: CY_AGENT_MODEL, default: gpt-4o)
  --base-url=<url>    OpenAI-compatible API (env: CY_AGENT_BASE_URL)
  --api-key=<key>     API key               (env: CY_AGENT_API_KEY or OPENAI_API_KEY)
  --cwd=<dir>         Workspace directory   (default: process.cwd())
  --resume=<id>       Resume a saved session (see /sessions)
  --help              Show this help

Exit codes (one-shot mode):
  0    session completed
  130  cancelled (SIGINT)
  1    session error or fatal CLI error

REPL commands:
  /exit, /quit        Leave the REPL
  /sessions           List saved sessions (* marks the active one)
  /new                Save the current session and start a new one
  /open <id>          Save the current session and open a saved one
  /delete <id>        Delete a saved session (not the active one)
  Ctrl-C (running)    Cancel the current turn
`;

/**
 * 解析 `--key=value` 与单字符短选项（`-p <value>` / `-p=<value>`）。
 * 短选项无 `=` 时消费下一参数作为值；短别名归一化为长名（p -> prompt）。
 * 未知参数静默忽略，保持 CLI 向前兼容。
 */
export function parseCliArgs(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    const match = /^--?([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || match[1] === undefined) {
      continue;
    }
    const key = SHORT_ALIASES[match[1]] ?? match[1];
    let value = match[2];
    // 单字符短选项无 `=` 时，消费下一参数作为值（如 -p "hello"）。
    if (value === undefined && match[1].length === 1 && i + 1 < argv.length) {
      value = argv[i + 1];
      i += 1;
    }
    flags.set(key, value ?? '');
  }
  return flags;
}

/** 单字符短选项到长选项名的映射。 */
const SHORT_ALIASES: Record<string, string> = {
  p: 'prompt',
  y: 'yes',
};

/**
 * 收集位置参数（跳过选项本身及其消费的值），
 * 支持 `cy-agent "fix the bug"` 直接以位置参数提供提示词。
 */
export function parsePositionals(argv: readonly string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    const match = /^--?([a-z-]+)(?:=.*)?$/.exec(arg);
    if (match !== null && match[1] !== undefined) {
      // 单字符短选项无 `=` 时，下一参数是选项值而非位置参数。
      if (match[1].length === 1 && !arg.includes('=')) {
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
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
  const prompt = pick(flags.get('prompt'));
  const outputRaw = pick(flags.get('output'));
  if (outputRaw !== undefined && outputRaw !== 'text' && outputRaw !== 'json') {
    throw new Error(`Invalid --output="${outputRaw}". Expected "text" or "json".`);
  }
  const yes = flags.has('yes');
  const mcpConfig = pick(flags.get('mcp-config'), env.CY_AGENT_MCP_CONFIG);

  const config: CliConfig = { apiKey, model, cwd: workspace };
  if (baseUrl !== undefined) {
    config.baseUrl = baseUrl;
  }
  if (resume !== undefined) {
    config.resume = resume;
  }
  if (prompt !== undefined) {
    config.prompt = prompt;
  }
  if (outputRaw !== undefined) {
    config.output = outputRaw;
  }
  if (yes) {
    config.yes = true;
  }
  if (mcpConfig !== undefined) {
    config.mcpConfig = mcpConfig;
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
