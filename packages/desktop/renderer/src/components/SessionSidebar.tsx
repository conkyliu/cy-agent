import type { IpcSessionSummary } from '../../../shared/ipc';

export interface SessionSidebarProps {
  sessions: IpcSessionSummary[];
  activeId: string | null;
  /** 会话运行中禁用切换类操作。 */
  disabled: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

/** 会话侧边栏：语义对齐 CLI 的 /new、/open、/delete。 */
export function SessionSidebar({
  sessions,
  activeId,
  disabled,
  onNew,
  onOpen,
  onDelete,
}: SessionSidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-surface-border bg-surface-soft">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold text-secondary">会话</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onNew}
          className="rounded-(--radius-control) bg-accent px-2.5 py-1 text-xs font-medium text-surface hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          新建
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 && <p className="px-2 py-4 text-xs text-faint">暂无存档会话</p>}
        {sessions.map((session) => {
          const active = session.id === activeId;
          return (
            <div
              key={session.id}
              className={`group flex items-center gap-1 rounded-(--radius-control) px-2 py-1.5 ${
                active ? 'bg-accent-soft' : 'hover:bg-surface-muted'
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(session.id)}
                className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
              >
                <div
                  className={`truncate text-xs ${active ? 'font-semibold text-accent' : 'text-primary'}`}
                >
                  {session.title ?? '(未命名)'}
                </div>
                <div className="truncate text-[10px] text-faint">
                  {session.messageCount} 条 · {formatTime(session.updatedAt)}
                </div>
              </button>
              {!active && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDelete(session.id)}
                  aria-label="删除会话"
                  className="rounded-(--radius-control) px-1.5 py-0.5 text-xs text-faint opacity-0 hover:bg-danger-soft hover:text-danger group-hover:opacity-100 disabled:cursor-not-allowed"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
