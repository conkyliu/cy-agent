import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { AppUpdater, type UpdaterDelegate } from '../main/updater';
import type { IpcUpdaterStatus } from '../shared/ipc';

class MockUpdaterDelegate extends EventEmitter implements UpdaterDelegate {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  checkForUpdates = vi.fn().mockResolvedValue(null);
  downloadUpdate = vi.fn().mockResolvedValue(null);
  quitAndInstall = vi.fn();
}

describe('AppUpdater', () => {
  it('初始状态为 idle', () => {
    const mock = new MockUpdaterDelegate();
    const updater = new AppUpdater(mock);
    expect(updater.getStatus()).toEqual({ type: 'idle' });
  });

  it('监听 checking 与 available 事件并向订阅者分发状态', () => {
    const mock = new MockUpdaterDelegate();
    const updater = new AppUpdater(mock);
    const statuses: IpcUpdaterStatus[] = [];

    updater.attachEmit((s) => statuses.push(s));

    mock.emit('checking-for-update');
    mock.emit('update-available', {
      version: '1.2.0',
      releaseDate: '2026-08-19',
      releaseNotes: 'Bug fixes and performance improvements',
    });

    expect(statuses).toEqual([
      { type: 'checking' },
      {
        type: 'available',
        version: '1.2.0',
        releaseDate: '2026-08-19',
        releaseNotes: 'Bug fixes and performance improvements',
      },
    ]);
  });

  it('正确解析数组形态的 releaseNotes', () => {
    const mock = new MockUpdaterDelegate();
    const updater = new AppUpdater(mock);
    const statuses: IpcUpdaterStatus[] = [];

    updater.attachEmit((s) => statuses.push(s));

    mock.emit('update-available', {
      version: '1.2.0',
      releaseNotes: [{ note: 'Line 1' }, { note: 'Line 2' }],
    });

    expect(statuses).toEqual([
      {
        type: 'available',
        version: '1.2.0',
        releaseNotes: 'Line 1\nLine 2',
      },
    ]);
  });

  it('分发 download-progress 与 update-downloaded 事件', () => {
    const mock = new MockUpdaterDelegate();
    const updater = new AppUpdater(mock);
    const statuses: IpcUpdaterStatus[] = [];

    updater.attachEmit((s) => statuses.push(s));

    mock.emit('download-progress', {
      percent: 45.67,
      bytesPerSecond: 1024000,
      transferred: 4567000,
      total: 10000000,
    });
    mock.emit('update-downloaded', {
      version: '1.2.0',
    });

    expect(statuses).toEqual([
      {
        type: 'downloading',
        percent: 45.7,
        bytesPerSecond: 1024000,
        transferred: 4567000,
        total: 10000000,
      },
      {
        type: 'downloaded',
        version: '1.2.0',
      },
    ]);
  });

  it('捕获 error 事件并分发给订阅者', () => {
    const mock = new MockUpdaterDelegate();
    const updater = new AppUpdater(mock);
    const statuses: IpcUpdaterStatus[] = [];

    updater.attachEmit((s) => statuses.push(s));

    mock.emit('error', new Error('Network timeout'));

    expect(statuses).toEqual([
      {
        type: 'error',
        message: 'Network timeout',
      },
    ]);
  });

  it('方法透传给 delegate', async () => {
    const mock = new MockUpdaterDelegate();
    const updater = new AppUpdater(mock);

    await updater.checkForUpdates();
    expect(mock.checkForUpdates).toHaveBeenCalledTimes(1);

    await updater.downloadUpdate();
    expect(mock.downloadUpdate).toHaveBeenCalledTimes(1);

    updater.installUpdate();
    expect(mock.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
