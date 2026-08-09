import { useState, type KeyboardEvent } from 'react';

export interface ComposerProps {
  running: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}

/** 底部输入框：空闲时发送，运行中切换为停止按钮。 */
export function Composer({ running, onSend, onCancel }: ComposerProps) {
  const [text, setText] = useState('');

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || running) {
      return;
    }
    setText('');
    onSend(trimmed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-surface-border bg-surface px-4 py-3">
      <div className="flex items-end gap-2 rounded-(--radius-card) border border-surface-border bg-surface-soft px-3 py-2 focus-within:border-accent">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={running ? '正在运行…' : '输入消息，Enter 发送，Shift+Enter 换行'}
          disabled={running}
          rows={2}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-faint disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-(--radius-control) bg-danger px-4 py-1.5 text-xs font-medium text-surface hover:opacity-90"
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={text.trim().length === 0}
            className="rounded-(--radius-control) bg-accent px-4 py-1.5 text-xs font-medium text-surface hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
