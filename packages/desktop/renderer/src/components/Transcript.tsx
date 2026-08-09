import { useEffect, useRef } from 'react';
import type { ToolItem, TranscriptItem } from '../state/events';

export interface TranscriptProps {
  items: TranscriptItem[];
  notice: string | null;
  error: { name: string; message: string } | null;
}

/** 对话区：用户气泡、流式助手文本、工具执行卡片、通知与错误终态。 */
export function Transcript({ items, notice, error }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items, notice, error]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
      {items.length === 0 && error === null && (
        <p className="py-10 text-center text-sm text-faint">发送消息开始对话</p>
      )}
      {items.map((item) => {
        if (item.kind === 'user') {
          return (
            <div key={item.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-(--radius-card) bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-surface">
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === 'assistant') {
          return (
            <div key={item.id} className="flex justify-start">
              <div className="max-w-[80%] rounded-(--radius-card) bg-surface-muted px-3.5 py-2 text-sm whitespace-pre-wrap text-primary">
                {item.text}
              </div>
            </div>
          );
        }
        return <ToolCard key={item.toolCallId} item={item} />;
      })}
      {notice !== null && (
        <div className="rounded-(--radius-control) bg-warning-soft px-3 py-1.5 text-xs text-warning">
          {notice}
        </div>
      )}
      {error !== null && (
        <div className="rounded-(--radius-control) bg-danger-soft px-3 py-2 text-xs text-danger">
          <span className="font-semibold">{error.name}</span>：{error.message}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

const STATUS_LABEL: Record<ToolItem['status'], string> = {
  pending: '等待授权',
  running: '执行中',
  completed: '完成',
  failed: '失败',
};

const STATUS_CLASS: Record<ToolItem['status'], string> = {
  pending: 'text-warning',
  running: 'text-accent',
  completed: 'text-success',
  failed: 'text-danger',
};

/** 工具执行状态卡片：started → completed/failed 的状态迁移可视化。 */
function ToolCard({ item }: { item: ToolItem }) {
  const detail = item.error ?? item.result ?? '';
  return (
    <div className="rounded-(--radius-card) border border-surface-border bg-surface-soft px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono font-semibold text-primary">{item.name}</span>
        <span className={STATUS_CLASS[item.status]}>{STATUS_LABEL[item.status]}</span>
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-faint select-none">参数 / 结果</summary>
        {item.argsText.length > 0 && (
          <pre className="mt-1 max-h-40 overflow-y-auto rounded-(--radius-control) bg-surface-muted p-2 font-mono text-[11px] text-secondary">
            {item.argsText}
          </pre>
        )}
        {detail.length > 0 && (
          <pre
            className={`mt-1 max-h-40 overflow-y-auto rounded-(--radius-control) p-2 font-mono text-[11px] ${
              item.status === 'failed'
                ? 'bg-danger-soft text-danger'
                : 'bg-surface-muted text-secondary'
            }`}
          >
            {detail}
          </pre>
        )}
      </details>
    </div>
  );
}
