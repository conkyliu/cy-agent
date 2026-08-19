import { useCallback, useEffect, useReducer, useState } from 'react';
import type { IpcDesktopConfig, IpcSessionSummary, IpcUpdaterStatus } from '../../shared/ipc';
import { desktop } from './api';
import { ApprovalModal } from './components/ApprovalModal';
import { Composer } from './components/Composer';
import { SessionSidebar } from './components/SessionSidebar';
import { Transcript } from './components/Transcript';
import { UpdateModal } from './components/UpdateModal';
import {
  applyEvent,
  clearTranscript,
  clearTranscriptWithNotice,
  initialUiState,
  loadHistory,
  submitUserMessage,
  type UiState,
} from './state/events';

type UiAction =
  | { type: 'agent-event'; event: Parameters<typeof applyEvent>[1] }
  | { type: 'user-submitted'; text: string }
  | { type: 'history-loaded'; state: UiState }
  | { type: 'approval-cleared' }
  | { type: 'workspace-switched'; workspace: string };

function reducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'agent-event':
      return applyEvent(state, action.event);
    case 'user-submitted':
      return submitUserMessage(state, action.text);
    case 'history-loaded':
      return action.state;
    case 'approval-cleared':
      return { ...state, pendingApproval: null };
    case 'workspace-switched':
      // 切换后已存档旧会话并新开会话：清空 transcript 并追加系统通知。
      return clearTranscriptWithNotice(`工作区已切换至 ${action.workspace}`);
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialUiState);
  const [sessions, setSessions] = useState<IpcSessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [config, setConfig] = useState<IpcDesktopConfig | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<IpcUpdaterStatus>({ type: 'idle' });

  const refreshSessions = useCallback(async () => {
    try {
      const list = await desktop.listSessions();
      setSessions(list);
      if (activeId === null && list.length > 0 && list[0] !== undefined) {
        setActiveId(list[0].id);
      }
    } catch (error) {
      setActionError(toMessage(error));
    }
  }, [activeId]);

  useEffect(() => {
    const unsubscribeEvents = desktop.onAgentEvent((event) => {
      dispatch({ type: 'agent-event', event });
      if (
        event.type === 'session_completed' ||
        event.type === 'session_error' ||
        event.type === 'session_cancelled'
      ) {
        void refreshSessions();
      }
    });

    const unsubscribeUpdater = desktop.onUpdaterStatus((status) => {
      setUpdaterStatus(status);
    });

    void desktop
      .getConfig()
      .then(setConfig)
      .catch((error: unknown) => setActionError(toMessage(error)));
    void desktop
      .getWorkspace()
      .then((info) => setWorkspace(info.workspace))
      .catch((error: unknown) => setActionError(toMessage(error)));
    void refreshSessions();

    return () => {
      unsubscribeEvents();
      unsubscribeUpdater();
    };
  }, [refreshSessions]);

  const handleCheckUpdates = useCallback(() => {
    setUpdaterStatus({ type: 'checking' });
    desktop.checkForUpdates().catch((error: unknown) => setActionError(toMessage(error)));
  }, []);

  const handleDownloadUpdate = useCallback(() => {
    desktop.downloadUpdate().catch((error: unknown) => setActionError(toMessage(error)));
  }, []);

  const handleInstallUpdate = useCallback(() => {
    desktop.installUpdate().catch((error: unknown) => setActionError(toMessage(error)));
  }, []);

  const handleCloseUpdateModal = useCallback(() => {
    setUpdaterStatus({ type: 'idle' });
  }, []);

  const handleSend = useCallback((text: string) => {
    dispatch({ type: 'user-submitted', text });
    desktop.send(text).catch((error: unknown) => setActionError(toMessage(error)));
  }, []);

  const handleCancel = useCallback(() => {
    desktop.cancel().catch((error: unknown) => setActionError(toMessage(error)));
  }, []);

  const handleApproval = useCallback(
    (approved: boolean) => {
      const pending = state.pendingApproval;
      dispatch({ type: 'approval-cleared' });
      if (pending === null) {
        return;
      }
      desktop
        .resolveApproval(pending.toolCallId, approved)
        .catch((error: unknown) => setActionError(toMessage(error)));
    },
    [state.pendingApproval],
  );

  const handleNewSession = useCallback(async () => {
    try {
      const next = await desktop.newSession();
      setActiveId(next.id);
      dispatch({ type: 'history-loaded', state: clearTranscript() });
      await refreshSessions();
    } catch (error) {
      setActionError(toMessage(error));
    }
  }, [refreshSessions]);

  const handleOpenSession = useCallback(
    async (id: string) => {
      try {
        const opened = await desktop.openSession(id);
        setActiveId(opened.id);
        dispatch({ type: 'history-loaded', state: loadHistory(opened.messages) });
        await refreshSessions();
      } catch (error) {
        setActionError(toMessage(error));
      }
    },
    [refreshSessions],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await desktop.deleteSession(id);
        await refreshSessions();
      } catch (error) {
        setActionError(toMessage(error));
      }
    },
    [refreshSessions],
  );

  const handleSelectWorkspace = useCallback(async () => {
    try {
      const result = await desktop.selectWorkspace();
      if (result === null) {
        // 用户在对话框中取消：保持现状。
        return;
      }
      setWorkspace(result.workspace);
      setActiveId(result.sessionId);
      dispatch({ type: 'workspace-switched', workspace: result.workspace });
      await refreshSessions();
    } catch (error) {
      setActionError(toMessage(error));
    }
  }, [refreshSessions]);

  const running = state.status === 'running';

  return (
    <div className="flex h-full">
      <SessionSidebar
        sessions={sessions}
        activeId={activeId}
        disabled={running}
        version={config?.version}
        onNew={handleNewSession}
        onOpen={handleOpenSession}
        onDelete={handleDeleteSession}
        onCheckUpdates={handleCheckUpdates}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <header className="flex items-center justify-between border-b border-surface-border px-4 py-2">
          <div className="text-sm font-semibold">cy-agent</div>
          <div className="flex items-center gap-3 text-xs text-faint">
            {state.usage !== null && (
              <span>
                tokens ↑{state.usage.inputTokens} ↓{state.usage.outputTokens}
              </span>
            )}
            {config !== null && <span>{config.model}</span>}
          </div>
        </header>

        <div className="flex items-center gap-2 border-b border-surface-border px-4 py-1.5">
          <button
            type="button"
            disabled={running}
            onClick={() => void handleSelectWorkspace()}
            title={running ? '运行中不可切换工作区' : '选择工作区目录'}
            className="shrink-0 rounded-(--radius-control) bg-accent px-2.5 py-1 text-xs font-medium text-surface hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            打开文件夹
          </button>
          <span className="truncate text-xs text-faint" title={workspace ?? undefined}>
            {workspace ?? '加载中…'}
          </span>
          {running && <span className="shrink-0 text-xs text-faint">（运行中不可切换）</span>}
        </div>

        <Transcript items={state.items} notice={state.notice} error={state.error} />

        {config !== null && !config.configured && (
          <div className="mx-4 mb-2 rounded-(--radius-control) bg-warning-soft px-3 py-2 text-xs text-warning">
            未检测到 API Key：请设置环境变量 CY_AGENT_API_KEY（或 OPENAI_API_KEY）后重启应用。
          </div>
        )}
        {actionError !== null && (
          <div className="mx-4 mb-2 rounded-(--radius-control) bg-danger-soft px-3 py-2 text-xs text-danger">
            {actionError}
          </div>
        )}

        <Composer running={running} onSend={handleSend} onCancel={handleCancel} />
      </main>

      {state.pendingApproval !== null && (
        <ApprovalModal approval={state.pendingApproval} onResolve={handleApproval} />
      )}

      {updaterStatus.type !== 'idle' && (
        <UpdateModal
          status={updaterStatus}
          onClose={handleCloseUpdateModal}
          onDownload={handleDownloadUpdate}
          onInstall={handleInstallUpdate}
        />
      )}
    </div>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
