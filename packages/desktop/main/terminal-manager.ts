/**
 * 桌面端嵌入式终端管理器：负责在指定工作区维护交互式 Shell 子进程。
 * 纯 Node 实现，便于单测与跨平台运行。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

export class TerminalManager {
  private child: ChildProcess | null = null;
  private emit: ((data: string) => void) | null = null;
  private currentWorkspace: string;

  constructor(defaultWorkspace: string) {
    this.currentWorkspace = defaultWorkspace;
  }

  attachEmit(emit: (data: string) => void): void {
    this.emit = emit;
  }

  /**
   * 初始化或重建终端子进程。
   */
  init(workspace?: string): void {
    if (workspace !== undefined && workspace.length > 0) {
      this.currentWorkspace = workspace;
    }
    this.kill();

    const shell =
      process.platform === 'win32'
        ? process.env.COMSPEC || 'powershell.exe'
        : process.env.SHELL || '/bin/zsh';

    try {
      const child = spawn(shell, [], {
        cwd: this.currentWorkspace,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        this.emit?.(chunk.toString('utf8'));
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.emit?.(chunk.toString('utf8'));
      });

      child.on('exit', (code, signal) => {
        this.emit?.(
          `\r\n\x1b[90m[Process completed with exit code ${code ?? signal ?? 0}]\x1b[0m\r\n`,
        );
        if (this.child === child) {
          this.child = null;
        }
      });

      child.on('error', (err) => {
        this.emit?.(`\r\n\x1b[31m[Terminal launch error: ${err.message}]\x1b[0m\r\n`);
      });

      this.child = child;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit?.(`\r\n\x1b[31m[Terminal error: ${message}]\x1b[0m\r\n`);
    }
  }

  /** 接收终端按键或字符输入并写入子进程 stdin。 */
  write(data: string): void {
    if (this.child === null || this.child.stdin === null || this.child.stdin.destroyed) {
      this.init();
    }
    this.child?.stdin?.write(data);
  }

  /** 终端尺寸变化通知。 */
  resize(_cols: number, _rows: number): void {
    // 基础流式进程不支持 ioctl resize，预留契约以兼容未来扩展。
  }

  /** 终止并回收当前终端子进程。 */
  kill(): void {
    if (this.child !== null) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // 忽略进程杀死异常
      }
      this.child = null;
    }
  }

  get isAlive(): boolean {
    return this.child !== null && !this.child.killed;
  }
}
