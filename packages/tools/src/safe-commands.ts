/**
 * 安全命令白名单与判定引擎：
 * 用于识别只读、查询、状态检查类低风险命令，实现免打扰自动批准（免除 HITL 弹窗）。
 * 遵循严格保守原则：任何包含重定向、管道、命令串联或写操作子命令的请求均强制要求人工审批。
 */

/** 严格禁止的危险 Shell 元字符与构造（检测到直接拒绝自动放行） */
const DANGEROUS_PATTERNS = [
  />/, // 输出重定向 (> 或 >>)
  /</, // 输入重定向
  /\|/, // 管道符 (|)
  /;/, // 顺序执行 (;)
  /&&/, // 逻辑与 (&&)
  /\|\|/, // 逻辑或 (||)
  /\$\(/, // 命令替换 $(...)
  /`/, // 反引号命令替换 `...`
  /\b(sudo|su|chmod|chown|eval|exec|kill|pkill)\b/, // 权限提升与危险内建
];

/** 允许的独立只读基础工具（其参数默认为文件路径或只读选项） */
const SAFE_STANDALONE_COMMANDS = new Set([
  'pwd',
  'ls',
  'dir',
  'cat',
  'head',
  'tail',
  'wc',
  'which',
  'file',
  'stat',
  'du',
  'df',
  'uname',
  'whoami',
  'echo',
]);

/** Git 允许的只读子命令列表 */
const SAFE_GIT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'branch',
  'rev-parse',
  'tag',
  'remote',
  'describe',
]);

/** 包管理器允许的只读子命令 */
const SAFE_PM_SUBCOMMANDS = new Set(['list', 'ls', 'outdated', 'why']);

/**
 * 校验指定 shell 命令行是否为幂等、只读的安全命令。
 *
 * @param command 要执行的完整命令行字符串
 * @returns true 表示确认为安全命令可自动批准；false 表示需要人工授权
 */
export function isSafeCommand(command: string): boolean {
  if (typeof command !== 'string') {
    return false;
  }

  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // 1. 检查是否存在任何危险元字符或管道/重定向
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // 2. 检查括号与引号是否成对（防止截断注入）
  if (!areQuotesBalanced(trimmed)) {
    return false;
  }

  // 3. 提取命令主词与参数
  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0) {
    return false;
  }

  const mainCommand = tokens[0]?.toLowerCase() ?? '';

  // 4. 版本与环境信息查询命令（如 node -v, pnpm --version, git --version 等）
  if (isVersionCheck(tokens)) {
    return true;
  }

  // 5. 独立只读命令（如 ls, pwd, cat, head 等）
  if (SAFE_STANDALONE_COMMANDS.has(mainCommand)) {
    return true;
  }

  // 6. Git 只读子命令检查
  if (mainCommand === 'git') {
    return isSafeGitCommand(tokens.slice(1));
  }

  // 7. 包管理器只读查询（如 pnpm list, npm ls 等）
  if (mainCommand === 'npm' || mainCommand === 'pnpm' || mainCommand === 'yarn') {
    return isSafePackageCommand(tokens.slice(1));
  }

  // 其余任何未知命令一律归为需要授权
  return false;
}

/** 检查引号是否完整闭合 */
function areQuotesBalanced(str: string): boolean {
  let single = false;
  let double = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === "'" && !double && (i === 0 || str[i - 1] !== '\\')) {
      single = !single;
    } else if (char === '"' && !single && (i === 0 || str[i - 1] !== '\\')) {
      double = !double;
    }
  }
  return !single && !double;
}

/** 简单的命令行 Token 提取（支持引号内的空格合并） */
function tokenizeCommand(command: string): string[] {
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(command)) !== null) {
    const token = match[1] ?? match[2] ?? match[0];
    if (token !== undefined && token.length > 0) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** 判定是否为单纯的版本信息查询（如 `git --version`, `node -v`） */
function isVersionCheck(tokens: readonly string[]): boolean {
  if (tokens.length === 2) {
    const arg = tokens[1]?.toLowerCase();
    if (arg === '-v' || arg === '--version' || arg === '-version' || arg === 'version') {
      return true;
    }
  }
  return false;
}

/** 判定 Git 是否为只读子命令 */
function isSafeGitCommand(args: readonly string[]): boolean {
  for (const arg of args) {
    // 忽略全局选项（如 git -C ... 或 git --no-pager ...）
    if (arg.startsWith('-')) {
      continue;
    }
    // 遇到的第一个非 flag 参数即为子命令
    const subCommand = arg.toLowerCase();
    return SAFE_GIT_SUBCOMMANDS.has(subCommand);
  }
  return false;
}

/** 判定包管理器（npm/pnpm/yarn）是否为只读子命令 */
function isSafePackageCommand(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg.startsWith('-')) {
      continue;
    }
    const subCommand = arg.toLowerCase();
    return SAFE_PM_SUBCOMMANDS.has(subCommand);
  }
  return false;
}
