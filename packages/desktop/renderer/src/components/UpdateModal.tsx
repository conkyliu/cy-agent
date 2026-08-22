import { useEffect } from 'react';
import type { IpcUpdaterStatus } from '../../../shared/ipc';

export interface UpdateModalProps {
  status: IpcUpdaterStatus;
  onClose: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

export function UpdateModal({ status, onClose, onDownload, onInstall }: UpdateModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (status.type === 'idle') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/30">
      <div className="w-[460px] max-w-[92%] rounded-(--radius-card) bg-surface p-5 shadow-xl">
        {status.type === 'checking' && (
          <div className="py-4 text-center">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <h3 className="mt-3 text-sm font-semibold text-primary">正在检查新版本…</h3>
            <p className="mt-1 text-xs text-faint">正在连接 GitHub Releases 校验更新元数据</p>
          </div>
        )}

        {status.type === 'not-available' && (
          <div>
            <h3 className="text-sm font-semibold text-primary">已是最新版本</h3>
            <p className="mt-2 text-xs text-secondary">
              当前运行版本（v{status.currentVersion}）已是最新，暂无可用更新。
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-(--radius-control) bg-accent px-4 py-1.5 text-xs font-medium text-surface hover:bg-accent-hover"
              >
                好的
              </button>
            </div>
          </div>
        )}

        {status.type === 'available' && (
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">发现新版本</h3>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                v{status.version}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-secondary">
              有新的版本可用，建议更新以体验最新功能与修复。
            </p>

            {status.releaseNotes && (
              <div className="mt-3">
                <div className="text-[11px] font-medium text-faint">更新日志：</div>
                <div className="mt-1 max-h-36 overflow-y-auto rounded-(--radius-control) bg-surface-muted p-2.5 text-xs leading-relaxed text-secondary whitespace-pre-wrap">
                  {status.releaseNotes}
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-(--radius-control) border border-surface-border px-3.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-muted"
              >
                稍后再说
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="rounded-(--radius-control) bg-accent px-4 py-1.5 text-xs font-medium text-surface hover:bg-accent-hover"
              >
                立即下载更新
              </button>
            </div>
          </div>
        )}

        {status.type === 'downloading' && (
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">正在下载更新…</h3>
              <span className="text-xs font-mono font-medium text-accent">{status.percent}%</span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-accent transition-all duration-200"
                style={{ width: `${Math.max(2, Math.min(100, status.percent))}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-faint">
              <span>
                {formatBytes(status.transferred)} / {formatBytes(status.total)}
              </span>
              <span>{formatBytes(status.bytesPerSecond)}/s</span>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-(--radius-control) border border-surface-border px-3.5 py-1.5 text-xs text-secondary hover:bg-surface-muted"
              >
                后台下载
              </button>
            </div>
          </div>
        )}

        {status.type === 'downloaded' && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-success text-base">✓</span>
              <h3 className="text-sm font-semibold text-primary">更新已就绪 (v{status.version})</h3>
            </div>
            <p className="mt-2 text-xs text-secondary">
              新版本已下载完毕。点击「立即重启」即可退出应用并自动完成升级安装。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-(--radius-control) border border-surface-border px-3.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-muted"
              >
                稍后安装
              </button>
              <button
                type="button"
                onClick={onInstall}
                className="rounded-(--radius-control) bg-accent px-4 py-1.5 text-xs font-medium text-surface hover:bg-accent-hover"
              >
                立即重启安装
              </button>
            </div>
          </div>
        )}

        {status.type === 'error' && (
          <div>
            <h3 className="text-sm font-semibold text-danger">更新失败</h3>
            <p className="mt-2 max-h-28 overflow-y-auto rounded-(--radius-control) bg-danger-soft p-2.5 text-xs text-danger leading-relaxed">
              {status.message}
            </p>
            <div className="mt-4 flex items-center justify-between">
              <a
                href="https://github.com/conkyliu/cy-agent/releases"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                前往 GitHub 手动下载 ↗
              </a>
              <button
                type="button"
                onClick={onClose}
                className="rounded-(--radius-control) border border-surface-border px-4 py-1.5 text-xs font-medium text-secondary hover:bg-surface-muted"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)} ${units[i] ?? ''}`;
}
