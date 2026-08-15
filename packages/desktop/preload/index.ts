/**
 * preload：contextBridge 白名单桥。
 * 渲染进程只能触达此处显式暴露的方法，无法访问任何 Node/Electron 内部 API。
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type DesktopApi, type IpcAgentEvent } from '../shared/ipc';

const api: DesktopApi = {
  send: (text) => ipcRenderer.invoke(IpcChannels.sessionSend, text),
  cancel: () => ipcRenderer.invoke(IpcChannels.sessionCancel),
  resolveApproval: (toolCallId, approved) =>
    ipcRenderer.invoke(IpcChannels.sessionResolveApproval, toolCallId, approved),
  listSessions: () => ipcRenderer.invoke(IpcChannels.sessionsList),
  newSession: () => ipcRenderer.invoke(IpcChannels.sessionsNew),
  openSession: (id) => ipcRenderer.invoke(IpcChannels.sessionsOpen, id),
  deleteSession: (id) => ipcRenderer.invoke(IpcChannels.sessionsDelete, id),
  getConfig: () => ipcRenderer.invoke(IpcChannels.configGet),
  getWorkspace: () => ipcRenderer.invoke(IpcChannels.workspaceGet),
  selectWorkspace: () => ipcRenderer.invoke(IpcChannels.workspaceSelect),
  onAgentEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: IpcAgentEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IpcChannels.agentEvent, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.agentEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld('desktop', api);
