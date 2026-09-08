import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { desktop } from '../api';

export interface TerminalDrawerProps {
  workspace: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function TerminalDrawer({ workspace, isOpen, onClose }: TerminalDrawerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      theme: {
        background: '#18181b', // 深灰色配合 Islands Light 调和
        foreground: '#e4e4e7',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 初始化后端 Shell
    desktop.terminalInit(workspace ?? undefined).catch(() => {});

    // 监听输入
    const dataDisposable = term.onData((data) => {
      desktop.terminalWrite(data).catch(() => {});
    });

    // 监听主进程数据流
    const unsubscribeData = desktop.onTerminalData((data) => {
      term.write(data);
    });

    // 窗口大小变化自适应
    const handleResize = () => {
      try {
        fitAddon.fit();
        desktop.terminalResize(term.cols, term.rows).catch(() => {});
      } catch {
        // 容器隐藏时 fit 可能抛出尺寸计算异常，静默处理
      }
    };

    window.addEventListener('resize', handleResize);
    // 延迟再次 fit 确保 DOM 完全绘制
    const timer = setTimeout(handleResize, 100);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      dataDisposable.dispose();
      unsubscribeData();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isOpen, workspace]);

  // 高度调整后再次触发 fit
  useEffect(() => {
    if (isOpen && fitAddonRef.current && termRef.current) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (termRef.current) {
            desktop.terminalResize(termRef.current.cols, termRef.current.rows).catch(() => {});
          }
        } catch {
          // ignore
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleClear = () => {
    termRef.current?.clear();
  };

  const handleRestart = () => {
    termRef.current?.clear();
    desktop.terminalInit(workspace ?? undefined).catch(() => {});
  };

  return (
    <div
      className={`flex flex-col border-t border-surface-border bg-[#18181b] transition-all duration-200 ${
        isExpanded ? 'h-96' : 'h-60'
      }`}
    >
      {/* 终端控制顶栏 */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-zinc-700/60 bg-zinc-900/90 px-3 text-xs text-zinc-300">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-100 flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            内置终端
          </span>
          <span
            className="truncate text-[11px] text-zinc-400 max-w-[400px]"
            title={workspace ?? ''}
          >
            {workspace ?? '工作区未就绪'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            清屏
          </button>
          <button
            type="button"
            onClick={handleRestart}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            重启
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            {isExpanded ? '缩小' : '放大'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭终端"
            className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* xterm 挂载容器 */}
      <div className="relative min-h-0 flex-1 p-2">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
