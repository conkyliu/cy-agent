# Change: add-desktop-shell

## Why

Phase 1/2 已完成 Headless 核心与 CLI，但 CLI 的终端授权提示（y/N）、纯文本
渲染与单窗口形态无法承载后续代码工作区（Phase 4）的交互密度。需要引入
Electron 桌面壳层：主进程直接承载 Agent 运行时，渲染进程以 React 消费
`AgentEvent` 单向事件流，为 HITL 授权弹窗、流式富文本、多会话侧边栏提供
图形化载体。

## What Changes

- 新增 `packages/desktop`（monorepo 新包，pnpm workspace 已覆盖 `packages/*`）：
  - **主进程**（`main/`）：承载 `AgentSession`、`SessionStore`、`ToolRegistry`、
    Provider 装配；通过 `ipcMain.handle` 暴露 invoke 通道，通过
    `webContents.send` 推送事件流。
  - **preload**（`preload/`）：`contextBridge` 暴露**白名单 API**，
    `contextIsolation: true`、`nodeIntegration: false`。
  - **渲染进程**（`renderer/`）：React + Vite + TailwindCSS，纯事件流消费，
    无任何 Node/Electron API 直接访问。
- **IPC 协议**（桌面端新增契约）：
  - invoke 通道：`session:send`、`session:cancel`、`session:resolve-approval`、
    `sessions:list` / `sessions:new` / `sessions:open` / `sessions:delete`、
    `config:get`。
  - 事件通道：`agent:event` 单向推送序列化后的 `AgentEvent`；
    `session_error` 中的 `Error` 实例 MUST 序列化为 `{ name, message }` 纯对象
    （结构化克隆不可传 Error）。
- **HITL 授权 UI**：收到 `tool_approval_requested` 弹出模态授权卡片
  （工具名、格式化 args、允许/拒绝），响应经 `session:resolve-approval`
  回传；会话取消或切换时未决授权按拒绝处理。
- **UI 组成**（JetBrains Islands Light 主题）：
  - 会话侧边栏：标题、新建/切换/删除（对齐 CLI 多会话语义）。
  - 对话区：流式文本渲染、工具执行状态卡片（started/completed/failed）、
    usage 徽标、输入框（发送 / 停止）。
  - Design Token：Tailwind theme 扩展定义 Islands Light 色板与圆角
    （8px+ 圆角、中性灰层次、#3574F0 类主色），组件层不写裸颜色值。
- **配置**：复用 CLI 的环境变量约定（Provider base URL / API key / model），
  缺失时主进程以 `session_error` 反馈，UI 显示配置引导。
- **安全基线**：单窗口、禁用导航与 `window.open`、CSP 限制脚本来源；
  工具执行全部发生在主进程，渲染进程零文件系统权限。
- **打包**：electron-builder 产出 macOS dmg；开发态走 Vite dev server。

## Impact

- Affected specs: `desktop-shell`（新能力：IPC 桥、授权 UI、事件流渲染、主题 Token）
- Affected code: 新增 packages/desktop（main / preload / renderer）、
  根 package.json 增 desktop 相关脚本、pnpm-workspace `allowBuilds` 调整。
- **边界不变**：`packages/agent` / `packages/protocol` 零改动、零 Electron 依赖；
  desktop 仅作为既有契约的新宿主，CLI 行为不受影响。
