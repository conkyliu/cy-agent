/**
 * Electron 主进程入口：装配 Agent 运行时、注册 IPC、创建安全窗口。
 */

import path from 'node:path';
import process from 'node:process';
import { app, BrowserWindow, session, shell } from 'electron';
import { ToolRegistry } from '@cy-agent/agent';
import { OpenAICompatProvider } from '@cy-agent/openai-provider';
import { JsonFileSessionStore } from '@cy-agent/storage';
import { loadDesktopConfig } from './config';
import { registerIpcHandlers } from './ipc-handlers';
import { SessionManager } from './session-manager';
import { WorkspaceMemory } from './workspace-memory';
import {
  buildSystemPrompt,
  registerWorkspaceTools,
  restoreWorkspace,
  WorkspaceManager,
} from './workspace-manager';

const BASE_SYSTEM_PROMPT = `You are cy-agent, a coding assistant operating inside the user's workspace.
Use the provided tools (read_file, write_file, list_directory, search_files, run_shell) to inspect and modify code.
Be concise. write_file and run_shell require explicit user approval and will be prompted automatically.`;

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'cy-agent',
    webPreferences: {
      // 安全基线：渲染进程与 Node 完全隔离，仅经 preload 白名单通信。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
    },
  });

  // 拦截导航与弹窗：单窗口应用，禁止任何外部跳转。
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    // 外部链接交给系统浏览器，不在应用内开窗。
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devUrl = process.env.CY_DESKTOP_RENDERER_URL;
  if (devUrl !== undefined && devUrl.length > 0) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
  return window;
}

function bootstrap(): void {
  // 启动装配含异步概览生成，主体放入 async 引导函数。
  void bootstrapAsync();
}

async function bootstrapAsync(): Promise<void> {
  // 环境变量配置：CY_AGENT_CWD 优先，缺省回退到用户 Documents。
  const config = loadDesktopConfig(process.env, app.getPath('documents'));

  const providerOptions: ConstructorParameters<typeof OpenAICompatProvider>[0] = {
    // Key 缺失时占位构造，send 阶段以 session_error 反馈（configured=false）。
    apiKey: config.apiKey ?? 'missing',
    model: config.model,
  };
  if (config.baseUrl !== undefined) {
    providerOptions.baseUrl = config.baseUrl;
  }
  const provider = new OpenAICompatProvider(providerOptions);

  // 工作区：记忆 > CY_AGENT_CWD / Documents 回退链。
  const memory = new WorkspaceMemory(path.join(app.getPath('userData'), 'workspace.json'));
  const workspace = restoreWorkspace(memory, config.workspace);

  const registry = new ToolRegistry();
  registerWorkspaceTools(registry, workspace);

  // 桌面端存档独立于工作区，放在应用 userData 下。
  const store = new JsonFileSessionStore(path.join(app.getPath('userData'), 'sessions'));

  // systemPrompt 追加工作区概览：新建会话/切换工作区时重新生成。
  const systemPrompt = await buildSystemPrompt(BASE_SYSTEM_PROMPT, workspace);

  const manager = new SessionManager({
    provider,
    registry,
    store,
    systemPrompt,
    configured: config.apiKey !== undefined,
  });

  const workspaceManager = new WorkspaceManager(workspace, {
    registry,
    host: manager,
    baseSystemPrompt: BASE_SYSTEM_PROMPT,
    memory,
  });

  registerIpcHandlers(manager, workspaceManager, config, () => mainWindow?.webContents ?? null);

  // 拒绝所有权限请求（桌面壳层不需要摄像头/定位等）。
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

void app.whenReady().then(() => {
  bootstrap();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
