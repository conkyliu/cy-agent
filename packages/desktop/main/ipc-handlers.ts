/**
 * ipcMain 处理器注册：仅挂载白名单通道，错误统一转为 reject。
 */

import { app, dialog, ipcMain, type WebContents } from 'electron';
import { AnthropicProvider } from '@cy-agent/anthropic-provider';
import { GeminiProvider } from '@cy-agent/gemini-provider';
import { OpenAICompatProvider } from '@cy-agent/openai-provider';
import type { ProviderContract } from '@cy-agent/agent';
import { IpcChannels, type IpcDesktopConfig, type IpcUpdateConfigPayload } from '../shared/ipc';
import type { SessionManager } from './session-manager';
import type { WorkspaceManager } from './workspace-manager';
import type { DesktopRuntimeConfig } from './config';
import type { AppUpdater } from './updater';
import type { SettingsStore } from './settings-store';
import type { TerminalManager } from './terminal-manager';

export function createProvider(config: DesktopRuntimeConfig): ProviderContract {
  const apiKey = config.apiKey ?? 'missing';
  if (config.provider === 'anthropic') {
    return new AnthropicProvider({
      apiKey,
      model: config.model,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  }
  if (config.provider === 'gemini') {
    return new GeminiProvider({
      apiKey,
      model: config.model,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  }
  const providerOptions: ConstructorParameters<typeof OpenAICompatProvider>[0] = {
    apiKey,
    model: config.model,
  };
  if (config.baseUrl !== undefined && config.baseUrl.length > 0) {
    providerOptions.baseUrl = config.baseUrl;
  }
  return new OpenAICompatProvider(providerOptions);
}

function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '••••••••';
  }
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function registerIpcHandlers(
  manager: SessionManager,
  workspaceManager: WorkspaceManager,
  config: DesktopRuntimeConfig,
  updater: AppUpdater,
  settingsStore: SettingsStore,
  terminalManager: TerminalManager,
  getContents: () => WebContents | null,
): void {
  // 事件流单向推送：序列化后的事件经 agent:event 通道下发。
  const sendEvent = (event: unknown): void => {
    getContents()?.send(IpcChannels.agentEvent, event);
  };
  manager.attachEmit(sendEvent);

  // 终端输出单向推送：经 terminal:data 通道下发。
  const sendTerminalData = (data: string): void => {
    getContents()?.send(IpcChannels.terminalData, data);
  };
  terminalManager.attachEmit(sendTerminalData);

  // 更新状态单向推送：经 updater:event 下发。
  const sendUpdaterStatus = (status: unknown): void => {
    getContents()?.send(IpcChannels.updaterEvent, status);
  };
  updater.attachEmit(sendUpdaterStatus);

  ipcMain.handle(IpcChannels.sessionSend, (_e, text: unknown) => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Empty message');
    }
    return manager.send(text);
  });
  ipcMain.handle(IpcChannels.sessionCancel, () => {
    manager.cancel();
  });
  ipcMain.handle(
    IpcChannels.sessionResolveApproval,
    (_e, toolCallId: unknown, approved: unknown) => {
      if (typeof toolCallId !== 'string') {
        throw new Error('Invalid toolCallId');
      }
      manager.resolveApproval(toolCallId, approved === true);
    },
  );
  ipcMain.handle(IpcChannels.sessionsList, () => manager.listSessions());
  ipcMain.handle(IpcChannels.sessionsNew, () => manager.newSession());
  ipcMain.handle(IpcChannels.sessionsOpen, (_e, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid session id');
    }
    return manager.openSession(id);
  });
  ipcMain.handle(IpcChannels.sessionsDelete, (_e, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid session id');
    }
    return manager.deleteSession(id);
  });

  // 读取配置
  ipcMain.handle(IpcChannels.configGet, (): IpcDesktopConfig => {
    const isConfigured = Boolean(
      config.apiKey && config.apiKey !== 'missing' && config.apiKey.trim().length > 0,
    );
    const result: IpcDesktopConfig = {
      version: app.getVersion(),
      model: config.model,
      provider: config.provider ?? 'openai',
      workspace: workspaceManager.current,
      configured: isConfigured,
    };
    if (config.baseUrl !== undefined && config.baseUrl.length > 0) {
      result.baseUrl = config.baseUrl;
    }
    if (config.apiKey !== undefined && config.apiKey.length > 0 && config.apiKey !== 'missing') {
      result.apiKeyMasked = maskApiKey(config.apiKey);
    }
    if (config.customSystemPrompt !== undefined && config.customSystemPrompt.length > 0) {
      result.customSystemPrompt = config.customSystemPrompt;
    }
    return result;
  });

  // 更新配置并热重载
  ipcMain.handle(
    IpcChannels.configUpdate,
    async (_e, payload: unknown): Promise<IpcDesktopConfig> => {
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid configUpdate payload');
      }
      const data = payload as IpcUpdateConfigPayload;

      // 1. 合并更新本地持久化设置
      const currentStored = settingsStore.load();
      const updatedStored = { ...currentStored };
      if (data.provider !== undefined) {
        updatedStored.provider = data.provider;
        config.provider = data.provider;
      }
      if (data.model !== undefined && data.model.trim().length > 0) {
        updatedStored.model = data.model.trim();
        config.model = data.model.trim();
      }
      if (data.apiKey !== undefined && data.apiKey.trim().length > 0) {
        updatedStored.apiKey = data.apiKey.trim();
        config.apiKey = data.apiKey.trim();
      }
      if (data.baseUrl !== undefined) {
        updatedStored.baseUrl = data.baseUrl.trim();
        config.baseUrl = data.baseUrl.trim();
      }
      if (data.customSystemPrompt !== undefined) {
        updatedStored.customSystemPrompt = data.customSystemPrompt.trim();
        config.customSystemPrompt = data.customSystemPrompt.trim();
      }
      settingsStore.save(updatedStored);

      // 2. 重新实例化 Provider 并热重载
      const newProvider = createProvider(config);
      const isConfigured = Boolean(
        config.apiKey && config.apiKey !== 'missing' && config.apiKey.trim().length > 0,
      );
      manager.updateProvider(newProvider, isConfigured);
      workspaceManager.updateProvider(newProvider);

      const res: IpcDesktopConfig = {
        version: app.getVersion(),
        model: config.model,
        provider: config.provider ?? 'openai',
        workspace: workspaceManager.current,
        configured: isConfigured,
      };
      if (config.baseUrl !== undefined && config.baseUrl.length > 0) {
        res.baseUrl = config.baseUrl;
      }
      if (config.apiKey !== undefined && config.apiKey.length > 0 && config.apiKey !== 'missing') {
        res.apiKeyMasked = maskApiKey(config.apiKey);
      }
      if (config.customSystemPrompt !== undefined && config.customSystemPrompt.length > 0) {
        res.customSystemPrompt = config.customSystemPrompt;
      }
      return res;
    },
  );

  ipcMain.handle(IpcChannels.workspaceGet, () => ({ workspace: workspaceManager.current }));
  ipcMain.handle(IpcChannels.workspaceSelect, async () => {
    // 系统目录选择对话框：用户取消时返回 null，不改变当前工作区。
    const result = await dialog.showOpenDialog({
      title: '选择工作区目录',
      defaultPath: workspaceManager.current,
      properties: ['openDirectory', 'createDirectory'],
    });
    const selected = result.filePaths[0];
    if (result.canceled || selected === undefined) {
      return null;
    }
    const switched = await workspaceManager.selectWorkspace(selected);
    terminalManager.init(selected);
    return switched;
  });

  // 内嵌终端相关 IPC 通道
  ipcMain.handle(IpcChannels.terminalInit, (_e, targetWorkspace: unknown) => {
    const ws =
      typeof targetWorkspace === 'string' && targetWorkspace.length > 0
        ? targetWorkspace
        : workspaceManager.current;
    terminalManager.init(ws);
  });
  ipcMain.handle(IpcChannels.terminalWrite, (_e, data: unknown) => {
    if (typeof data === 'string') {
      terminalManager.write(data);
    }
  });
  ipcMain.handle(IpcChannels.terminalResize, (_e, cols: unknown, rows: unknown) => {
    if (typeof cols === 'number' && typeof rows === 'number') {
      terminalManager.resize(cols, rows);
    }
  });
  ipcMain.handle(IpcChannels.terminalKill, () => {
    terminalManager.kill();
  });

  // 更新相关 IPC 通道
  ipcMain.handle(IpcChannels.updaterCheck, () => updater.checkForUpdates());
  ipcMain.handle(IpcChannels.updaterDownload, () => updater.downloadUpdate());
  ipcMain.handle(IpcChannels.updaterInstall, () => updater.installUpdate());
}
