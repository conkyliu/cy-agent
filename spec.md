这里是融合了人机交互授权（Human-in-the-loop）机制的完整规范文件。你可以直接将以下内容完整覆盖保存至：
`openspec/changes/bootstrap-agent-runtime/specs/agent-session/spec.md`

---

# Spec: Agent Session & Runtime Core

**Status:** Approved Draft

**Domain:** Agent Runtime

**Target Phase:** Phase 1 (Headless Agent Core)

**File Location:** `openspec/changes/bootstrap-agent-runtime/specs/agent-session/spec.md`

---

## 1. 概述 (Overview)

本规范定义了 `cy-agent` 的无头（Headless）核心运行时（Runtime）。该核心必须完全与具体的 UI 框架、桌面 shell（Electron）或命令行界面（CLI）解耦。它负责管理从用户输入、模型流式生成、高危工具人机授权（Human-in-the-loop），到工具调用与结果回传的完整生命周期（Agent Loop）。

### 1.1 核心设计原则

* **Headless & UI-Agnostic**：不依赖任何 DOM 或 Node.js 独有 UI API，通过单向事件流（AsyncGenerator）与外部通信。
* **Explicit Security Boundary**：默认支持工具级权限拦截，高危操作必须等待宿主环境解析授权。
* **Resilient Loop**：工具执行错误或用户拒绝授权均视为“模型可见的上下文变化”，而非抛出致命异常中断 Session。

### 1.2 非目标 (Out of Scope)

* Electron 主进程 IPC 与跨进程状态同步。
* MCP (Model Context Protocol) 协议的 Client 端解包实现（Phase 5）。
* 会话历史在磁盘上的 JSON/SQLite 持久化（Phase 2）。
* 代码 AST 解析、Git 差异计算等特定业务工具实现。

---

## 2. 数据结构与消息契约 (Data Protocol)

所有跨包传递的数据类型必须在 `packages/protocol` 中统一暴露，确保跨端类型一致。

### 2.1 基础消息模型 (`packages/protocol/src/messages.ts`)

```typescript
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // 标准 JSON 字符串，例如 '{"path": "src/index.ts"}'
}

export interface Message {
  id: string;
  role: Role;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string; // 仅当 role === 'tool' 时存在，用于向大模型关联对应的 Tool Call
}

```

### 2.2 全局事件流 (`packages/protocol/src/events.ts`)

`AgentSession` 执行过程中对外抛出的所有原子状态事件。

```typescript
export type AgentEvent =
  | { type: 'session_started'; sessionId: string }
  | { type: 'text_chunk'; text: string }
  // --- 授权与工具执行阶段 ---
  | { type: 'tool_approval_requested'; toolCallId: string; name: string; args: any }
  | { type: 'tool_execution_started'; toolCallId: string; name: string; args: any }
  | { type: 'tool_execution_completed'; toolCallId: string; result: any }
  | { type: 'tool_execution_failed'; toolCallId: string; error: string }
  // --- 生命周期终结阶段 ---
  | { type: 'session_completed'; finalMessages: Message[] }
  | { type: 'session_cancelled' }
  | { type: 'session_error'; error: Error };

```

---

## 3. 核心抽象接口 (Core Contracts)

### 3.1 模型提供商契约 (`packages/agent/src/contracts/provider.ts`)

```typescript
import { Message, ToolCall } from '@cy-agent/protocol';
import { ToolContract } from './tool';

export interface GenerateOptions {
  messages: Message[];
  tools?: ToolContract[];
  signal?: AbortSignal;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_chunk'; toolCallId: string; delta: string }
  | { type: 'tool_call_end'; toolCallId: string };

export interface ProviderContract {
  name: string;
  /**
   * 将不同厂商（OpenAI, Anthropic 等）的底层 SSE 转换统一为 AsyncGenerator
   */
  generateStream(options: GenerateOptions): AsyncGenerator<ProviderChunk, void, unknown>;
}

```

### 3.2 工具契约与注册表 (`packages/agent/src/contracts/tool.ts`)

```typescript
export interface ToolContract<TArgs = any, TResult = any> {
  name: string;
  description: string;
  /** 标准 JSON Schema，用于发送给 LLM */
  parameters: Record<string, any>;

  /** 是否需要用户显式授权（如：写入文件、执行 Shell） */
  requiresApproval?: boolean;

  execute: (args: TArgs, signal?: AbortSignal) => Promise<TResult>;
}

export interface ToolRegistry {
  register(tool: ToolContract): void;
  unregister(name: string): void;
  get(name: string): ToolContract | undefined;
  getAll(): ToolContract[];
}

```

---

## 4. Session 接口与人机授权 (HITL) 机制

### 4.1 会话类接口 (`packages/agent/src/session.ts`)

```typescript
import { AgentEvent } from '@cy-agent/protocol';

export interface AgentSession {
  readonly id: string;

  /**
   * 启动/继续 Session 执行循环，通过异步生成器实时推送事件
   */
  start(): AsyncGenerator<AgentEvent, void, unknown>;

  /**
   * 外部宿主（CLI 提示符或 Electron 弹窗）响应授权请求
   * @param toolCallId 待授权的工具调用 ID
   * @param approved true 为放行，false 为拒绝
   */
  resolveApproval(toolCallId: string, approved: boolean): void;

  /**
   * 手动中断当前会话
   */
  cancel(): void;
}

```

### 4.2 授权挂起（Deferred Async Control）工作流

当工具的 `requiresApproval === true` 时，内部执行链如下：

```text
[ Agent Loop ]                    [ 宿主环境 (CLI / UI) ]
      │                                       │
      ├─► 发现需授权的 Tool Call              │
      ├─► 创建 Deferred Promise               │
      ├─► yield tool_approval_requested ────► │ (收到事件，弹出对话框)
      │                                       │
      │ ◄─── Await Deferred Promise ─────────┤ (等待用户点击)
      │                                       │
      │                                       ├─► 用户点击同意/拒绝
      │ ◄─── resolveApproval(id, approved) ───┘
      │
┌─────┴──────────────────────────────┐
│ [Approved === true]               │
│  ► yield tool_execution_started   │
│  ► 执行 tool.execute()             │
│                                    │
│ [Approved === false]              │
│  ► 跳过 execute()                  │
│  ► 伪造结果: "User rejected..."     │
│  ► yield tool_execution_completed │
└─────┬──────────────────────────────┘
      │
      ▼
将结果追加到 Context (role: 'tool') ───────► 继续请求 LLM

```

---

## 5. Agent Loop 状态机执行算法

`AgentSession.start()` 必须严格实现以下双层循环算法：

1. **会话初始化**：抛出 `session_started`。
2. **主循环 (Outer Loop)**：
* 检查 `AbortSignal`，若已被取消，抛出 `session_cancelled` 并终止。
* 调用 `provider.generateStream()`，向大模型发送当前完整 `messages` 列表及工具 Snapshot。


3. **流式消费 (Inner Stream Loop)**：
* 实时消费 `ProviderChunk`：
* `text`: 实时向外 `yield { type: 'text_chunk', text }`。
* `tool_call_*`: 拼接并组装成完整的目标 `ToolCall` 对象数组。




4. **决策判定 (Branching)**：
* **若模型仅输出了文本，未产生任何 ToolCall**：
* 将模型输出追加为 `role: 'assistant'` 的消息。
* 抛出 `session_completed` 事件，**退出 Outer Loop**，完成单次交互。


* **若模型输出了一个或多个 ToolCall**：
* 将此包含 `toolCalls` 的消息追加到 `messages` 历史中（`role: 'assistant'`）。
* 进入**工具调度算法**。




5. **工具调度算法 (Tool Execution)**：
* 遍历每个 `ToolCall`：
* 查找 `ToolRegistry`。若找不到目标工具，生成错误信息 `"Error: Tool not found"` 视同执行失败。
* **安全检查**：
* 若 `tool.requiresApproval === true`：
* 向外 `yield { type: 'tool_approval_requested', toolCallId, name, args }`。
* **挂起当前 Loop**，等待外部调用 `resolveApproval()`。


* 若 `tool.requiresApproval === false` 或 `approved === true`：
* 抛出 `tool_execution_started`。
* 执行 `tool.execute(args, signal)`。
* 成功则 `yield tool_execution_completed`。
* 捕获工具内抛出的 Exception，`yield tool_execution_failed`。


* 若 `approved === false`（用户拒绝）：
* 跳过真实 `execute`。
* 伪造结果为字符串 `"System: The user explicitly denied the execution of this tool."`。
* `yield tool_execution_completed`。




* 将工具执行结果（或拒绝提示/错误提示）封装为 `role: 'tool'` 的 Message，关联 `toolCallId` 追加到 `messages` 历史中。




6. **循环回溯**：跳回步骤 2，带着包含了工具执行结果的新 `messages` 自动发起下一轮 LLM 请求。

---

## 6. 异常防护与取消机制 (Resilience & Safety)

### 6.1 Abort Signal 强传播

* `AgentSession` 内部持有单一的 `AbortController` 实例。
* 当调用 `session.cancel()` 时：
* 触发 `abortController.abort()`。
* 将 `signal` 深度透传给当前正在进行的 `fetch` 网络请求，以及正在运行的 `tool.execute(args, signal)`。
* 清空正在挂起的授权 Deferred Promise，防止内存泄漏。



### 6.2 异常分类隔离

* **不可恢复异常 (Fatal Exceptions)**：
* 如 API Key 配置缺失、网络断连、无效的 JSON Body。
* **处理机制**：中断 Loop，抛出 `session_error` 事件，保留现有 `messages` 不变。


* **可恢复异常 (Recoverable Tool Exceptions)**：
* 如文件路径不存在、Shell 执行命令返回 non-zero exit code。
* **处理机制**：**严禁终止 Loop**。必须将 Error 格式化为字符串写回 `role: 'tool'` 消息中，交由 LLM 进行自我修正（Self-Correction）或再次重试。
