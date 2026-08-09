/**
 * ipcMain 处理器注册：仅挂载白名单通道，错误统一转为 reject。
 */

import { ipcMain, type WebContents } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type { SessionManager } from './session-manager';
import type { DesktopRuntimeConfig } from './config';

export function registerIpcHandlers(
  manager: SessionManager,
  config: DesktopRuntimeConfig,
  getContents: () => WebContents | null,
): void {
  // 事件流单向推送：序列化后的事件经 agent:event 通道下发。
  const sendEvent = (event: unknown): void => {
    getContents()?.send(IpcChannels.agentEvent, event);
  };
  manager.attachEmit(sendEvent);

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
    model: config.model,
    workspace: config.workspace,
    configured: config.apiKey !== undefined,
  }));
}
