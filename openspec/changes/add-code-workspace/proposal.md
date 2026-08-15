# Change: add-code-workspace

## Why

Phase 1–3 交付了核心、CLI 与桌面壳层，但"工作区"仍停留在隐式配置层面：
桌面端的工作区在启动时由 `CY_AGENT_CWD`（或 Documents 回退）固定，用户
无法在 UI 中选择或切换项目目录，甚至看不到 Agent 正在操作哪个目录；
模型对工作区结构零预知，每轮会话都要靠 `list_directory` 试探，浪费往返；
且 `resolveInWorkspace` 仅防御 `..` 相对路径逃逸，工作区内的符号链接
（如 `link -> /etc`）可被 `read_file` / `write_file` 穿透沙箱。
Phase 4 将"代码工作区"提升为一等公民：可感知、可选择、可防御。

## What Changes

- **工作区选择与切换（桌面端）**：
  - 新增 IPC 通道 `workspace:get`（返回当前工作区路径）、
    `workspace:select`（主进程 `dialog.showOpenDialog` 选择目录并切换）。
  - UI 顶部工作区栏：展示当前工作区路径（可点击缩短显示）与"打开文件夹"入口；
    切换成功后新会话即时生效，transcript 以系统通知标记工作区变更。
  - 竞态防护：会话运行中禁止切换（工具闭包绑定旧 cwd），语义对齐
    会话切换的门控；未决授权在切换前按拒绝清理。
  - 记忆策略：最后选择的工作区持久化到 userData 配置，下次启动恢复；
    未选择过时沿用 `CY_AGENT_CWD` / Documents 回退链。
- **工作区概览注入（感知能力）**：
  - `packages/tools` 新增 `workspace-context.ts`：生成工作区概览文本——
    顶层目录树（限深度、限条目、复用 `SKIPPED_DIRECTORIES`）、git 分支
    探测（失败静默）、标记文件探测（README / package.json / tsconfig 等）。
  - 概览以文本追加进 systemPrompt（宿主侧拼接，核心不感知），CLI 与桌面端
    共用同一生成器；会话重建（新建/打开/切换工作区）时重新生成。
- **符号链接逃逸防护（安全加固）**：
  - `packages/tools` 新增异步安全解析 `resolveInWorkspaceSafe`：在
    `resolveInWorkspace` 基础上对目标（及其已存在的父级）做 `realpath`
    校验，确认实际位置仍在工作区内，否则抛工具级错误交还 LLM。
  - `read_file` / `write_file` / `list_directory` / `search_files` 迁移至
    安全解析；`run_shell` 的 cwd 参数同样迁移。
- **CLI 对齐**：`--cwd` 语义不变，systemPrompt 注入同款工作区概览。

## Impact

- Affected specs: `code-workspace`（新能力：工作区选择、概览注入、沙箱加固）
- Affected code: `packages/tools`（workspace-context.ts 新增、workspace.ts
  加固、编码工具迁移）、`packages/desktop`（workspace IPC / UI / 记忆）、
  `packages/cli`（systemPrompt 拼接概览）。
- **边界不变**：`packages/agent` / `packages/protocol` 零改动；概览注入发生
  在宿主侧 systemPrompt 拼接层，核心 Agent Loop 不引入文件系统依赖。
- **不在本期范围**：会话与工作区的强绑定（存档恢复时自动切换工作区）、
  多工作区并行会话、文件树面板（UI 侧边树浏览）。
