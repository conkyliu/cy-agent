# Tasks: Add Desktop Settings, Embedded Terminal, and google/antigravity Model

- [x] Add `@xterm/xterm` and `@xterm/addon-fit` to `@cy-agent/desktop` <!-- id: 0 -->
- [x] Implement `google/` model prefix sanitization in `packages/gemini-provider/src/gemini-provider.ts` <!-- id: 1 -->
- [x] Enhance model and provider inference for `google/antigravity` in `packages/cli/src/config.ts` and `packages/desktop/main/config.ts` <!-- id: 2 -->
- [x] Define IPC channels and payloads in `packages/desktop/shared/ipc.ts` and expose via `packages/desktop/preload/index.ts` <!-- id: 3 -->
- [x] Implement `SettingsStore` in `packages/desktop/main/settings-store.ts` <!-- id: 4 -->
- [x] Implement `TerminalManager` in `packages/desktop/main/terminal-manager.ts` <!-- id: 5 -->
- [x] Update `SessionManager` and `WorkspaceManager` with provider hot-reload capabilities <!-- id: 6 -->
- [x] Wire `config:update` and `terminal:*` handlers in `packages/desktop/main/ipc-handlers.ts` and `main/index.ts` <!-- id: 7 -->
- [x] Implement `SettingsModal.tsx` and `TerminalDrawer.tsx` in `packages/desktop/renderer/src/components/` <!-- id: 8 -->
- [x] Integrate settings and terminal triggers into `SessionSidebar.tsx` and `App.tsx` <!-- id: 9 -->
- [x] Add tests for `settings-store`, `terminal-manager`, and `gemini-provider` <!-- id: 10 -->
- [x] Validate full monorepo (test, typecheck, lint, format, build) <!-- id: 11 -->
