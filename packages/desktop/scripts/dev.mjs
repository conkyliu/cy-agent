/**
 * 开发态启动：先构建 main/preload（依赖各 workspace 包已构建），
 * 起 Vite dev server，待就绪后携带 CY_DESKTOP_RENDERER_URL 拉起 Electron。
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const DEV_PORT = 5173;

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: pkgRoot,
    stdio: options.quiet === true ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    if (options.keepAlive !== true) {
      process.exit(code ?? 0);
    }
  });
  return child;
}

// 1. 构建主进程与 preload（同步等待完成）。
await new Promise((resolve, reject) => {
  const build = spawn('pnpm', ['build:main'], {
    cwd: pkgRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build:main failed'))));
});
await new Promise((resolve, reject) => {
  const build = spawn('pnpm', ['build:preload'], {
    cwd: pkgRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build:preload failed'))));
});

// 2. 启动 Vite dev server 并等待就绪。
const vite = run('pnpm', ['exec', 'vite', '--port', String(DEV_PORT), '--strictPort'], {
  quiet: true,
  keepAlive: true,
});
const devUrl = `http://localhost:${DEV_PORT}/`;
const readyTimeout = Date.now() + 60_000;
await new Promise((resolve, reject) => {
  const check = async () => {
    try {
      const response = await fetch(devUrl);
      if (response.ok) {
        resolve();
        return;
      }
    } catch {
      // server 尚未就绪，继续轮询
    }
    if (Date.now() > readyTimeout) {
      reject(new Error('Vite dev server 启动超时'));
      return;
    }
    setTimeout(check, 300);
  };
  check();
  vite.stderr?.on('data', (chunk) => process.stderr.write(chunk));
});
console.log(`[desktop] renderer ready at ${devUrl}`);

// 3. 拉起 Electron 主进程（dev server URL 在 spawn 时注入）。
const electron = run('pnpm', ['exec', 'electron', '.'], {
  keepAlive: true,
  env: { ...process.env, CY_DESKTOP_RENDERER_URL: devUrl },
});

process.on('SIGINT', () => {
  vite.kill();
  electron.kill();
  process.exit(0);
});
