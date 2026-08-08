import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ToolContract } from '@cy-agent/agent';
import { resolveInWorkspace } from './workspace.js';

export interface RunShellArgs {
  /** 交由系统 shell 执行的命令 */
  command: string;
  /** 工作目录（相对工作区根），默认 '.' */
  cwd?: string;
  /** 超时毫秒数，默认 30000，上限 120000 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
/** stdout/stderr 各自的最大捕获字节数，防止刷屏。 */
const MAX_OUTPUT_BYTES = 100_000;

/**
 * Shell 执行工具：高危操作，requiresApproval 强制开启。
 *
 * 安全边界：
 * - cwd 必须位于工作区沙箱内（resolveInWorkspace 防逃逸）。
 * - 超时杀进程树（POSIX 用 kill 'SIGKILL'，Windows 用 taskkill /T /F），
 *   AbortSignal 取消同样杀进程树。
 * - 输出超长截断；非零退出码不抛异常，格式化为结果交还 LLM 自我修正
 *   （遵循 spec 6.2：工具级错误严禁终止 Loop）。
 */
export function createRunShellTool(workspaceRoot: string): ToolContract<RunShellArgs, string> {
  return {
    name: 'run_shell',
    description:
      'Run a shell command inside the workspace and capture its output. ' +
      'Requires user approval. Use for builds, tests, git and other CLI operations.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute via the system shell' },
        cwd: {
          type: 'string',
          description: 'Working directory relative to the workspace root, default "."',
        },
        timeoutMs: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_TIMEOUT_MS,
          description: `Timeout in milliseconds, default ${DEFAULT_TIMEOUT_MS}`,
        },
      },
      required: ['command'],
    },
    execute: async (args, signal) => {
      const cwd = resolveInWorkspace(workspaceRoot, args.cwd ?? '.');
      const timeoutMs = Math.min(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      return runCommand(args.command, cwd, timeoutMs, signal);
    },
  };
}

interface Captured {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Shell command was cancelled'));
      return;
    }

    const child: ChildProcessWithoutNullStreams = spawn(command, { cwd, shell: true });
    const captured: Captured = {
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    };
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const key = stream;
      const truncationKey = stream === 'stdout' ? 'stdoutTruncated' : 'stderrTruncated';
      if (captured[truncationKey]) {
        return;
      }
      const next = captured[key] + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_BYTES) {
        captured[key] = next.slice(0, MAX_OUTPUT_BYTES);
        captured[truncationKey] = true;
      } else {
        captured[key] = next;
      }
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
    }, timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      killChild(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      // 无法启动进程属于工具级错误，抛出后由 Agent Loop 转字符串交还 LLM。
      reject(new Error(`Failed to start shell command: ${error.message}`));
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (aborted) {
        resolve(formatCancelled(command, captured));
        return;
      }
      if (timedOut) {
        resolve(formatTimeout(command, timeoutMs, captured));
        return;
      }
      resolve(formatResult(code ?? 0, captured));
    });
  });
}

/**
 * 杀掉子进程及其整棵进程树。
 *
 * Windows 下 shell:true 会先启动 cmd.exe，再派生实际的子孙进程；
 * child.kill() 只能终止 cmd.exe 本身，孙进程仍持有 stdio 管道句柄，
 * 导致 'close' 事件迟迟不触发。因此 Windows 上用 taskkill /T /F 杀整棵树。
 */
function killChild(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32') {
    if (child.pid === undefined) {
      child.kill('SIGKILL');
      return;
    }
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {
      // taskkill 不可用时退化为仅杀 shell 进程本身。
      child.kill('SIGKILL');
    });
    return;
  }
  child.kill('SIGKILL');
}

function withTruncationNote(text: string, truncated: boolean): string {
  return truncated ? `${text}\n…[output truncated]` : text;
}

function formatResult(code: number, captured: Captured): string {
  const stdout = withTruncationNote(captured.stdout.trimEnd(), captured.stdoutTruncated);
  const stderr = withTruncationNote(captured.stderr.trimEnd(), captured.stderrTruncated);
  const sections = [
    stdout.length > 0 ? `[stdout]\n${stdout}` : null,
    stderr.length > 0 ? `[stderr]\n${stderr}` : null,
  ].filter((section): section is string => section !== null);

  if (code === 0) {
    return sections.length > 0 ? sections.join('\n') : '(completed with no output)';
  }
  const body = sections.length > 0 ? `\n${sections.join('\n')}` : '';
  return `Command failed with exit code ${code}.${body}`;
}

function formatTimeout(command: string, timeoutMs: number, captured: Captured): string {
  const partial = captured.stdout.trimEnd() || captured.stderr.trimEnd();
  const body = partial.length > 0 ? `\nPartial output:\n${partial.slice(0, 2000)}` : '';
  return `Command "${command}" timed out after ${timeoutMs}ms and was killed.${body}`;
}

function formatCancelled(command: string, captured: Captured): string {
  const partial = captured.stdout.trimEnd() || captured.stderr.trimEnd();
  const body = partial.length > 0 ? `\nPartial output:\n${partial.slice(0, 2000)}` : '';
  return `Command "${command}" was cancelled.${body}`;
}
