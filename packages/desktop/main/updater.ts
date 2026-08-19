/**
 * 主进程更新管理器：包装 electron-updater，向渲染层推送状态并处理下载/安装请求。
 */

import { app } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import type { IpcUpdaterStatus } from '../shared/ipc';

export interface UpdaterDelegate {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): this;
  on(event: 'update-available' | 'update-downloaded', listener: (info: UpdateInfo) => void): this;
  on(event: 'download-progress', listener: (progress: ProgressInfo) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
}

export class AppUpdater {
  private emit: ((status: IpcUpdaterStatus) => void) | null = null;
  private currentStatus: IpcUpdaterStatus = { type: 'idle' };
  private readonly updater: UpdaterDelegate;

  constructor(customUpdater?: UpdaterDelegate) {
    this.updater = customUpdater ?? autoUpdater;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = true;

    this.registerEvents();
  }

  attachEmit(emit: (status: IpcUpdaterStatus) => void): void {
    this.emit = emit;
    // 连接时立即下发当前最新状态
    if (this.currentStatus.type !== 'idle') {
      this.emit(this.currentStatus);
    }
  }

  private setStatus(status: IpcUpdaterStatus): void {
    this.currentStatus = status;
    this.emit?.(status);
  }

  getStatus(): IpcUpdaterStatus {
    return this.currentStatus;
  }

  private registerEvents(): void {
    this.updater.on('checking-for-update', () => {
      this.setStatus({ type: 'checking' });
    });

    this.updater.on('update-available', (info: UpdateInfo) => {
      let releaseNotes: string | undefined;
      if (typeof info.releaseNotes === 'string') {
        releaseNotes = info.releaseNotes;
      } else if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes
          .map((n) => (typeof n === 'string' ? n : n.note))
          .filter(Boolean)
          .join('\n');
      }

      const status: IpcUpdaterStatus = {
        type: 'available',
        version: info.version,
      };
      if (info.releaseDate) {
        status.releaseDate = info.releaseDate;
      }
      if (releaseNotes) {
        status.releaseNotes = releaseNotes;
      }
      this.setStatus(status);
    });

    this.updater.on('update-not-available', () => {
      this.setStatus({
        type: 'not-available',
        currentVersion: app?.getVersion?.() ?? '0.0.0',
      });
    });

    this.updater.on('download-progress', (progress: ProgressInfo) => {
      this.setStatus({
        type: 'downloading',
        percent: Math.round(progress.percent * 10) / 10,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    this.updater.on('update-downloaded', (info: UpdateInfo) => {
      this.setStatus({
        type: 'downloaded',
        version: info.version,
      });
    });

    this.updater.on('error', (err: Error) => {
      this.setStatus({
        type: 'error',
        message: err.message || String(err),
      });
    });
  }

  async checkForUpdates(): Promise<void> {
    if (app && !app.isPackaged && this.updater === autoUpdater) {
      // 开发环境中模拟未发现新版本或跳过真实检测，避免 dev-app-update.yml 缺失报错
      this.setStatus({
        type: 'not-available',
        currentVersion: app?.getVersion?.() ?? '0.0.0',
      });
      return;
    }

    try {
      this.setStatus({ type: 'checking' });
      await this.updater.checkForUpdates();
    } catch (error) {
      this.setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async downloadUpdate(): Promise<void> {
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  installUpdate(): void {
    this.updater.quitAndInstall();
  }
}
