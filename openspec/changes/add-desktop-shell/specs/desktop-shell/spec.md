# Capability: desktop-shell (Electron 桌面壳层)

## ADDED Requirements

### Requirement: 核心边界不可侵入

`packages/desktop` MUST 作为既有契约的消费方存在：`packages/agent` 与
`packages/protocol` MUST NOT 引入 Electron、React、DOM 相关依赖或代码改动。
渲染进程 MUST NOT 直接访问 Node.js 或 Electron API，仅能通过 preload 暴露的
白名单接口通信。

#### Scenario: 核心包零污染验证

- **WHEN** 构建并检查 `packages/agent` / `packages/protocol` 的依赖与产物
- **THEN** SHALL NOT 出现任何 electron / react / dom 相关依赖或引用
- **AND** 渲染进程代码 SHALL NOT import `electron`、`node:*` 模块

### Requirement: IPC 单向事件流桥接

主进程 MUST 将 `AgentSession` 的 `AgentEvent` 流经 `agent:event` 通道单向推送
至渲染进程，事件顺序 MUST 与核心产出顺序一致。`session_error` 事件中的
`Error` 实例 MUST 序列化为 `{ name: string; message: string }` 纯对象后传输。

#### Scenario: 流式事件保序到达

- **WHEN** 一轮会话依次产出 `session_started`、多个 `text_chunk`、`session_completed`
- **THEN** 渲染进程 SHALL 按相同顺序收到全部事件，无丢失、无重排

#### Scenario: 错误事件可序列化

- **WHEN** 会话产出 `session_error` 且携带 Error 实例
- **THEN** 渲染进程收到的载荷 SHALL 为含 `name` 与 `message` 字符串的纯对象
- **AND** UI SHALL 渲染错误终态而非崩溃

### Requirement: Invoke 通道白名单

preload MUST 仅暴露以下 invoke 通道：`session:send`、`session:cancel`、
`session:resolve-approval`、`sessions:list`、`sessions:new`、`sessions:open`、
`sessions:delete`、`config:get`。未列入白名单的通道 MUST NOT 可达。

#### Scenario: 未知通道被拒绝

- **WHEN** 渲染进程尝试调用白名单外的 IPC 通道
- **THEN** 调用 SHALL NOT 到达主进程任何处理器

### Requirement: HITL 授权模态

渲染进程收到 `tool_approval_requested` 时 MUST 弹出模态授权卡片，展示工具名
与格式化后的参数，提供允许 / 拒绝操作，并经 `session:resolve-approval` 回传。
活动会话被取消或切换时，所有未决授权 MUST 按拒绝处理，防止挂起泄漏。

#### Scenario: 用户允许工具执行

- **WHEN** 授权卡片上点击"允许"
- **THEN** 后续 SHALL 收到该工具的 `tool_execution_started` 与结果事件

#### Scenario: 用户拒绝工具执行

- **WHEN** 授权卡片上点击"拒绝"
- **THEN** SHALL NOT 收到该工具的 `tool_execution_started`
- **AND** 会话 SHALL 继续（拒绝信息作为 tool 结果交还模型）

#### Scenario: 会话取消清理未决授权

- **WHEN** 存在未决授权且用户取消会话或切换会话
- **THEN** 未决授权 SHALL 以拒绝结果回传核心
- **AND** 授权卡片 SHALL 从 UI 移除，无残留挂起状态

### Requirement: 会话管理语义对齐

多会话操作 MUST 对齐 CLI 语义：新建时存档当前会话并开空会话；切换时存档当前
并以原会话 ID 载入目标（后续存档写回同一文件）；活动会话 MUST NOT 可被删除。

#### Scenario: 切换后存档连续性

- **WHEN** 用户从会话 A 切换到会话 B 再切回 A 继续对话
- **THEN** A 的后续存档 SHALL 写回原文件，不产生新会话副本

### Requirement: Islands Light 主题 Token

视觉样式 MUST 通过 Tailwind theme 扩展的 Design Token 表达：主色采用
#3574F0 类低饱和蓝、控件圆角 ≥ 8px、中性灰背景层次。组件层 MUST NOT 书写
裸颜色值，后续主题切换只需替换 Token 层。

#### Scenario: 组件无裸颜色值

- **WHEN** 审查渲染进程组件源码
- **THEN** 颜色表达 SHALL 全部引用 theme Token，不存在内联十六进制色值

### Requirement: 安全基线

BrowserWindow MUST 启用 `contextIsolation` 并禁用 `nodeIntegration`；主进程
MUST 拦截页面内导航与 `window.open`；渲染进程 HTML MUST 携带限制脚本来源的
CSP。工具执行 MUST 全部发生在主进程。

#### Scenario: 窗口劫持被拦截

- **WHEN** 渲染进程内容尝试触发跳转或打开新窗口
- **THEN** 主进程 SHALL 拒绝该行为，不产生新 BrowserWindow 或页面跳转
