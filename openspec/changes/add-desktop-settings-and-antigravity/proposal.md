# Change: Add Desktop Settings Modal, Embedded Terminal Drawer, and google/antigravity Model Support

## Why
1. **Desktop Configuration Friction**: API keys, models, providers, and base URLs currently require environment variables or CLI flags, creating a significant barrier for Electron desktop users who expect a graphical configuration experience.
2. **Missing Embedded Workspace Terminal**: Users must toggle to external terminals (e.g. iTerm, Terminal.app) to inspect workspace states, run build commands, or diagnose environment issues.
3. **google/antigravity Model Integration**: As the Antigravity ecosystem evolves, `cy-agent` should first-class support `google/antigravity` as a recommended model option across Gemini native endpoints and OpenAI-compatible gateways (e.g. OpenRouter).

## What Changes
- **OpenSpec Documentation**: Formalize changes in `openspec/changes/add-desktop-settings-and-antigravity/`.
- **Model Routing & Compatibility**: Clean `google/` prefixes in `GeminiProvider` when routing to Google's `models/*` path; enhance CLI and Desktop config inference for `google/antigravity`.
- **Desktop IPC Contracts**: Add `config:update` and `terminal:*` (`init`, `write`, `resize`, `kill`, `data`) channels in `@cy-agent/desktop/shared/ipc.ts`.
- **Settings Persistence & Hot-Reload**: Implement `SettingsStore` to persist configuration to Electron `userData/settings.json`, and support hot-reloading `ProviderContract` in `SessionManager` and `WorkspaceManager` without application restarts.
- **Embedded Terminal Drawer**: Integrate `@xterm/xterm` and `@xterm/addon-fit` with a bi-directional main process shell process (`TerminalManager`), providing an integrated bottom drawer console bound to the active workspace.
- **Settings Modal Component**: Create `SettingsModal.tsx` in JetBrains Islands Light style with provider switching, preset model picker (highlighting `google/antigravity`), API key management, custom base URL, and system prompt tuning.

## Impact
- Full visual autonomy in the desktop application without needing shell environment variables.
- Direct interactive command execution alongside AI coding sessions.
- Out-of-the-box support for `google/antigravity` model across all provider types.
