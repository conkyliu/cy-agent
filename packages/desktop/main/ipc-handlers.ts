/**
 * ipcMain 处理器注册：仅挂载白名单通道，错误统一转为 reject。
 */

import { app, dialog, ipcMain, type WebContents } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type { SessionManager } from './session-manager';
import type { WorkspaceManager } from './workspace-manager';
import type { DesktopRuntimeConfig } from './config';
import type { AppUpdater } from './updater';

export function registerIpcHandlers(
  manager: SessionManager,
  workspaceManager: WorkspaceManager,
  config: DesktopRuntimeConfig,
  updater: AppUpdater,
  getContents: () => WebContents | null,
): void {
  // 事件流单向推送：序列化后的事件经 agent:event 通道下发。
  const sendEvent = (event: unknown): void => {
    getContents()?.send(IpcChannels.agentEvent, event);
  };
  manager.attachEmit(sendEvent);

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
  ipcMain.handle(IpcChannels.configGet, () => ({
    version: app.getVersion(),
    model: config.model,
    workspace: config.workspace,
    configured: config.apiKey !== undefined,
  }));
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
    // 运行中切换会在此抛错，经 invoke 转为 reject 反馈至 UI。
    return workspaceManager.selectWorkspace(selected);
  });

  // 更新相关 IPC 通道
  ipcMain.handle(IpcChannels.updaterCheck, () => updater.checkForUpdates());
  ipcMain.handle(IpcChannels.updaterDownload, () => updater.downloadUpdate());
  ipcMain.handle(IpcChannels.updaterInstall, () => updater.installUpdate());
}
