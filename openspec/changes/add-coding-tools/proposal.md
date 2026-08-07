# Change: add-coding-tools

## Why

Phase 2（Coding Agent CLI）的第一步是让 Agent 具备最基本的代码操作能力。
`bootstrap-agent-runtime` 与 `add-tool-approval` 已提供运行时与授权机制，
现在需要一组内置编码工具（读、写、列目录、内容搜索），并保证所有文件操作
被沙箱化在工作区根目录内。

## What Changes

- 新增 `packages/tools`（`@cy-agent/tools`）：
  - `read_file`：读取文本文件，支持 1-based 行范围。
  - `write_file`：创建/覆盖文件，自动建立父目录；`requiresApproval: true`（高危操作走 HITL 授权）。
  - `list_directory`：列出目录条目（`[dir]` / `[file]` 标记，按名称排序）。
  - `search_files`：正则内容搜索，输出 `file:line: text`；跳过 node_modules/.git/dist/coverage 与二进制文件，限制遍历文件数与匹配数。
  - `createCodingTools(cwd)` 工厂：一次性注册全部工具。
- 工作区沙箱：`resolveInWorkspace` 拒绝任何逃逸工作区根目录的路径，
  错误经由 Agent Loop 的 Tool 级错误通道交还 LLM（不中断会话）。

## Impact

- Affected specs: `coding-tools`（新增能力）
- Affected code: 新增 `packages/tools/**`；`packages/agent/src/contracts/tool.ts`
  将 `execute` 调整为方法签名（双变），使具体参数类型的工具可赋值给通用 `ToolContract`
- 依赖：`@cy-agent/tools` 依赖 `@cy-agent/agent`（ToolContract 类型）
