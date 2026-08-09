import { useEffect } from 'react';
import type { PendingApproval } from '../state/events';

export interface ApprovalModalProps {
  approval: PendingApproval;
  onResolve: (approved: boolean) => void;
}

/** HITL 授权模态：展示工具名与格式化参数，允许 / 拒绝二选一。 */
export function ApprovalModal({ approval, onResolve }: ApprovalModalProps) {
  // Esc 视为拒绝，避免弹窗挂起阻塞会话。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onResolve(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResolve]);

  let argsText: string;
  try {
    argsText = JSON.stringify(approval.args, null, 2) ?? '';
  } catch {
    argsText = String(approval.args);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/30">
      <div className="w-[480px] max-w-[90%] rounded-(--radius-card) bg-surface p-5 shadow-xl">
        <h2 className="text-sm font-semibold">需要执行授权</h2>
        <p className="mt-1 text-xs text-secondary">
          工具 <span className="font-mono font-semibold text-primary">{approval.name}</span>{' '}
          请求执行以下操作：
        </p>
        <pre className="mt-3 max-h-56 overflow-y-auto rounded-(--radius-control) bg-surface-muted p-3 font-mono text-[11px] text-secondary">
          {argsText}
        </pre>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="rounded-(--radius-control) border border-surface-border px-4 py-1.5 text-xs font-medium text-secondary hover:bg-surface-muted"
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className="rounded-(--radius-control) bg-accent px-4 py-1.5 text-xs font-medium text-surface hover:bg-accent-hover"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
