import { useEffect, useState } from 'react';
import type { IpcDesktopConfig, IpcUpdateConfigPayload } from '../../../shared/ipc';

export interface SettingsModalProps {
  config: IpcDesktopConfig;
  onClose: () => void;
  onSave: (payload: IpcUpdateConfigPayload) => Promise<void>;
}

const PRESET_MODELS: Record<string, Array<{ id: string; label: string; badge?: string }>> = {
  gemini: [
    { id: 'google/antigravity', label: 'google/antigravity', badge: '⭐ 推荐' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', badge: '强推理' },
    { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash', badge: '低延迟' },
  ],
  openai: [
    { id: 'google/antigravity', label: 'google/antigravity (OpenRouter)', badge: '⭐ 推荐' },
    { id: 'gpt-4o', label: 'gpt-4o' },
    { id: 'deepseek-chat', label: 'deepseek-chat' },
    { id: 'o3-mini', label: 'o3-mini' },
  ],
  anthropic: [
    { id: 'claude-3-7-sonnet-20250219', label: 'claude-3-7-sonnet', badge: '最新' },
    { id: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet' },
  ],
};

export function SettingsModal({ config, onClose, onSave }: SettingsModalProps) {
  const [provider, setProvider] = useState<string>(config.provider || 'openai');
  const [model, setModel] = useState<string>(config.model || '');
  const [apiKey, setApiKey] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState<string>(config.baseUrl || '');
  const [customSystemPrompt, setCustomSystemPrompt] = useState<string>(
    config.customSystemPrompt || '',
  );
  const [showKey, setShowKey] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    // 当切换 Provider 时，若当前模型不是预设模型，智能推荐该 Provider 的首选模型
    const presets = PRESET_MODELS[newProvider] ?? [];
    if (presets.length > 0 && presets[0] !== undefined) {
      setModel(presets[0].id);
    }
  };

  const handlePresetSelect = (selectedModelId: string) => {
    setModel(selectedModelId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: IpcUpdateConfigPayload = {
        provider,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
        customSystemPrompt: customSystemPrompt.trim(),
      };
      if (apiKey.trim().length > 0) {
        payload.apiKey = apiKey.trim();
      }
      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const currentPresets = PRESET_MODELS[provider] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/30">
      <div className="w-[540px] max-w-[94%] rounded-(--radius-card) bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-border pb-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-primary">应用设置</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              运行时热重载
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--radius-control) p-1 text-faint hover:bg-surface-muted hover:text-primary"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-(--radius-control) bg-danger-soft p-2.5 text-xs text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          {/* 提供商切换 */}
          <div>
            <label className="block font-semibold text-secondary">模型提供商 (Provider)</label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleProviderChange('gemini')}
                className={`rounded-(--radius-control) border p-2 text-left transition-all ${
                  provider === 'gemini'
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-surface-border hover:bg-surface-muted text-secondary'
                }`}
              >
                <div className="font-medium">Google Gemini</div>
                <div className="text-[10px] text-faint">/ Antigravity 原生</div>
              </button>
              <button
                type="button"
                onClick={() => handleProviderChange('openai')}
                className={`rounded-(--radius-control) border p-2 text-left transition-all ${
                  provider === 'openai'
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-surface-border hover:bg-surface-muted text-secondary'
                }`}
              >
                <div className="font-medium">OpenAI 兼容</div>
                <div className="text-[10px] text-faint">OpenRouter / DeepSeek</div>
              </button>
              <button
                type="button"
                onClick={() => handleProviderChange('anthropic')}
                className={`rounded-(--radius-control) border p-2 text-left transition-all ${
                  provider === 'anthropic'
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-surface-border hover:bg-surface-muted text-secondary'
                }`}
              >
                <div className="font-medium">Anthropic</div>
                <div className="text-[10px] text-faint">Claude 原生流式</div>
              </button>
            </div>
          </div>

          {/* 模型选择与预设推荐 */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-secondary">模型名称 (Model ID)</label>
              <span className="text-[11px] text-faint">可点击快捷填入或手动输入</span>
            </div>
            {currentPresets.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {currentPresets.map((preset) => {
                  const isSelected = model === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handlePresetSelect(preset.id)}
                      className={`flex items-center gap-1 rounded-(--radius-control) border px-2 py-1 text-[11px] transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent-soft text-accent font-medium'
                          : 'border-surface-border text-secondary hover:bg-surface-muted'
                      }`}
                    >
                      <span>{preset.label}</span>
                      {preset.badge && (
                        <span className="rounded bg-accent/20 px-1 py-0.2 text-[9px] font-bold text-accent">
                          {preset.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="如 google/antigravity 或 gpt-4o"
              className="mt-2 w-full rounded-(--radius-control) border border-surface-border bg-surface px-3 py-1.5 font-mono text-xs text-primary focus:border-accent focus:outline-none"
            />
          </div>

          {/* API Key */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-secondary">API 密钥 (API Key)</label>
              {config.apiKeyMasked && (
                <span className="text-[11px] text-faint">
                  当前已配置: <code className="font-mono text-accent">{config.apiKeyMasked}</code>
                </span>
              )}
            </div>
            <div className="relative mt-1.5">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  config.configured ? '留空保持当前已配置的 Key' : '输入 API Key（例如 sk-...）'
                }
                className="w-full rounded-(--radius-control) border border-surface-border bg-surface px-3 py-1.5 pr-14 font-mono text-xs text-primary focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] text-faint hover:bg-surface-muted hover:text-primary"
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-faint">
              密钥安全存储于本机应用目录（<code>userData/settings.json</code>
              ），不经过任何第三方云端。
            </p>
          </div>

          {/* Base URL */}
          <div>
            <label className="block font-semibold text-secondary">
              自定义接口地址 (Base URL，可选)
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === 'gemini'
                  ? '留空默认 https://generativelanguage.googleapis.com/v1beta'
                  : provider === 'openai'
                    ? '留空默认 OpenAI，若使用 OpenRouter 请填 https://openrouter.ai/api/v1'
                    : '留空默认 https://api.anthropic.com'
              }
              className="mt-1.5 w-full rounded-(--radius-control) border border-surface-border bg-surface px-3 py-1.5 font-mono text-xs text-primary focus:border-accent focus:outline-none"
            />
          </div>

          {/* 附加自定义 System Prompt */}
          <div>
            <label className="block font-semibold text-secondary">
              自定义附加指示 (Custom Instructions，可选)
            </label>
            <textarea
              rows={2}
              value={customSystemPrompt}
              onChange={(e) => setCustomSystemPrompt(e.target.value)}
              placeholder="为 Agent 注入额外全局指令，如优先语言、特定编码规范等..."
              className="mt-1.5 w-full rounded-(--radius-control) border border-surface-border bg-surface p-2.5 text-xs text-primary focus:border-accent focus:outline-none resize-none"
            />
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center justify-end gap-2 border-t border-surface-border pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-(--radius-control) border border-surface-border px-3.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-muted disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-(--radius-control) bg-accent px-4 py-1.5 text-xs font-medium text-surface hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? '保存并应用中…' : '保存并应用'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
