# Spec: Desktop Settings & Embedded Terminal Drawer

## Overview
This specification defines the graphical configuration interface and embedded terminal drawer for the `cy-agent` Electron desktop shell, alongside compatibility rules for `google/antigravity` model routing.

## Requirements

### 1. Model & Provider Routing
- When `model` is set to `google/antigravity` or prefixed with `google/`:
  - In `GeminiProvider`, the model name MUST be sanitized by removing the `google/` prefix before constructing the endpoint URL: `${baseUrl}/models/${cleanModel}:streamGenerateContent`.
  - In `OpenAICompatProvider`, the model name MUST be passed as-is to preserve OpenRouter and custom gateway model IDs.
  - In CLI and Desktop config loaders, if no provider is explicitly specified, `google/antigravity` MUST infer provider based on available keys (`gemini` if `GEMINI_API_KEY` present or default; `openai` if `OPENAI_API_KEY` present).

### 2. Desktop Settings Persistence & IPC
- The main process MUST maintain a `SettingsStore` saving user preferences to `<userData>/settings.json`.
- Channel `config:update` MUST accept `{ provider?, model?, apiKey?, baseUrl?, customSystemPrompt? }`.
- Updating settings MUST write to `settings.json`, instantiate the target `ProviderContract`, and update `SessionManager` and `WorkspaceManager` immediately.
- Channel `config:get` MUST return `{ version, model, provider, workspace, configured, baseUrl?, customSystemPrompt?, hasCustomKey? }`. Secret keys MUST NEVER be exposed raw to the renderer process.

### 3. Embedded Terminal Drawer
- IPC channels:
  - `terminal:init`: Spawns or resets a child shell process in the current workspace directory.
  - `terminal:write`: Sends keystroke input string to child process stdin.
  - `terminal:resize`: Notifies child process of terminal columns and rows.
  - `terminal:kill`: Terminates the current child shell process.
  - `terminal:data`: Unidirectional event pushing stdout/stderr string data to the renderer.
- The UI MUST render an interactive xterm.js console with auto-fit resizing, dark terminal theme, clear button, and minimize/expand toggle.
