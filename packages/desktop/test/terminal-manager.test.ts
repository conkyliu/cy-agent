import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TerminalManager } from '../main/terminal-manager.ts';

describe('TerminalManager', () => {
  let terminalManager: TerminalManager;

  beforeEach(() => {
    terminalManager = new TerminalManager(process.cwd());
  });

  afterEach(() => {
    terminalManager.kill();
  });

  it('正确启动 Shell 并接收终端输出', async () => {
    let received = '';
    terminalManager.attachEmit((data) => {
      received += data;
    });

    terminalManager.init();
    expect(terminalManager.isAlive).toBe(true);

    // 向终端写入测试命令
    terminalManager.write('echo "CY_TERMINAL_TEST_OK"\n');

    // 轮询等待 echo 输出
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (received.includes('CY_TERMINAL_TEST_OK')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(received).toContain('CY_TERMINAL_TEST_OK');
  });

  it('能够正常终止 Shell 子进程', () => {
    terminalManager.init();
    expect(terminalManager.isAlive).toBe(true);

    terminalManager.kill();
    expect(terminalManager.isAlive).toBe(false);
  });
});
