# Tasks: add-desktop-shell

## 1. 包骨架与构建链

- [x] 1.1 `packages/desktop` 初始化：package.json（依赖 agent/protocol/storage/
      tools/openai-provider 的 workspace 引用）、tsconfig 继承根 base
- [x] 1.2 Vite 构建渲染进程（React + TS）、esbuild/tsc 构建主进程与 preload；
      产出 `dist/main`、`dist/preload`、`dist/renderer`
- [x] 1.3 根脚本：`pnpm desktop:dev`（Vite dev server + Electron 主进程）、
      `pnpm desktop:build`（全量构建）；workspace `allowBuilds` 放行 electron/esbuild
- [x] 1.4 验证：`packages/agent` 与 `packages/protocol` 无任何新增依赖与改动

## 2. 主进程：运行时装配与 IPC 桥

- [x] 2.1 Provider / ToolRegistry / SessionStore 装配，复用 CLI 的环境变量
      与系统提示词约定；配置缺失时经事件流反馈而非崩溃
- [x] 2.2 会话管理器：单活动会话 + `AgentSessionOptions.id` 恢复存档会话；
      send/cancel/resolve-approval 的并发与竞态防护（发送中禁止切换会话）
- [x] 2.3 IPC invoke 通道注册：`session:send`、`session:cancel`、
      `session:resolve-approval`、`sessions:list|new|open|delete`、`config:get`
- [x] 2.4 事件转发：消费 `AgentSession` 事件流，`session_error` 的 Error
      序列化为 `{ name, message }` 后经 `agent:event` 推送；`usage_reported` 透传
- [x] 2.5 安全基线：`contextIsolation: true`、`nodeIntegration: false`、
      拦截导航与 `window.open`、CSP meta 限制脚本来源

## 3. preload 与类型契约

- [x] 3.1 `contextBridge` 白名单 API：invoke 方法 + `onAgentEvent` 订阅（返回退订函数）
- [x] 3.2 IPC 通道名与载荷类型集中定义（`ipc.ts`），主/渲染双端共享类型，
      序列化后的 `AgentEvent` 变体（`error: { name, message }`）单一定义

## 4. 渲染进程：UI 与主题

- [x] 4.1 Tailwind theme 扩展：Islands Light 色板与圆角 Token（主色 #3574F0 类、
      8px+ 圆角、中性灰层次），组件层零裸颜色值
- [x] 4.2 布局骨架：会话侧边栏 + 对话区 + 底部输入框（发送 / 停止切换）
- [x] 4.3 事件流状态机（reducer）：`text_chunk` 流式拼接、工具卡片
      started→completed/failed、`context_compacted` 提示、usage 徽标、
      `session_error` / `session_cancelled` 终态渲染
- [x] 4.4 HITL 授权模态：`tool_approval_requested` 展示工具名 + 格式化 args +
      允许/拒绝按钮；会话切换或取消时未决授权自动按拒绝处理
- [x] 4.5 多会话面板：列表（标题 + 时间倒序）、新建、切换、删除（活动会话
      删除禁用），语义对齐 CLI `/new` `/open` `/delete`

## 5. 打包与发布

- [x] 5.1 electron-builder 配置：macOS dmg 产物、应用图标与元数据
      （图标暂用 Electron 默认，待品牌资源到位后替换 icns）
- [x] 5.2 `pnpm desktop:release` 脚本与产物冒烟验证（启动、单轮对话、授权弹窗）
      （dmg 与 app 产物生成成功并可启动；单轮对话/授权弹窗由 6.3 手工验收覆盖）

## 6. 测试与验证

- [x] 6.1 主进程单测：IPC 载荷序列化（Error → 纯对象）、会话管理器竞态
      （发送中切换被拒）、未决授权在 cancel 时按拒绝落库
- [x] 6.2 渲染进程单测：事件 reducer 各事件类型的状态迁移、授权模态交互
- [x] 6.3 手工验收清单：流式输出、工具卡片、授权允许/拒绝、多会话切换、
      取消运行、配置缺失引导（已实机验收通过）
- [x] 6.4 `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` 全绿
