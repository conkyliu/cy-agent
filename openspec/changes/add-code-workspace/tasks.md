# Tasks: add-code-workspace

## 1. tools：沙箱加固与工作区概览

- [x] 1.1 `workspace.ts` 新增异步 `resolveInWorkspaceSafe`：先经
      `resolveInWorkspace` 防 `..` 逃逸，再对目标已存在的路径（逐级向上
      realpath）校验真实位置位于工作区内；符号链接逃逸抛工具级错误
- [x] 1.2 `read_file` / `write_file` / `list_directory` / `search_files`
      与 `run_shell`（cwd 参数）迁移至安全解析；原有 `..` 防御行为保持
- [x] 1.3 新增 `workspace-context.ts`：`buildWorkspaceOverview(cwd)` 生成
      概览文本——目录树（深度 ≤ 2、条目上限、跳过 SKIPPED_DIRECTORIES）、
      git 分支（spawn git 失败静默省略）、标记文件清单（README /
      package.json / tsconfig.json / go.mod 等存在性）；全部 IO 失败降级
      为空段不抛错
- [x] 1.4 单测：符号链接指向工作区外时读写被拒、合法链接路径放行、
      概览包含目录树与 git 分支、大目录截断不超时

## 2. desktop：工作区选择与切换

- [x] 2.1 主进程工作区管理：当前工作区状态 + 切换逻辑（重建编码工具并
      注册进 ToolRegistry）；运行中切换被拒绝；切换前未决授权按拒绝清理
- [x] 2.2 IPC 通道 `workspace:get` / `workspace:select`（dialog 目录选择，
      用户取消返回 null）；shared/ipc.ts 类型契约与 preload 白名单同步扩展
- [x] 2.3 渲染进程工作区栏：当前路径展示 + 「打开文件夹」按钮；切换后
      transcript 追加系统通知；运行中切换按钮禁用并提示
- [x] 2.4 记忆策略：最后选择的工作区写入 userData 配置文件，启动时
      恢复；无记忆时沿用 CY_AGENT_CWD / Documents 回退链
- [x] 2.5 单测：工作区管理器切换门控（运行中拒绝）、工具重建后新会话
      使用新 cwd、记忆读写往返

## 3. 工作区概览注入（双宿主）

- [x] 3.1 desktop 主进程：会话工厂构造 systemPrompt 时拼接
      `buildWorkspaceOverview`；工作区切换与新建会话时重新生成
- [x] 3.2 CLI：`main.ts` 以同款概览拼接 systemPrompt，`--cwd` 语义不变
- [x] 3.3 单测：概览注入后的 systemPrompt 含工作区路径与目录树段落

## 4. 验证与收尾

- [x] 4.1 `packages/agent` / `packages/protocol` 零改动验证（diff 检查）
- [x] 4.2 `pnpm build && pnpm typecheck && pnpm test && pnpm lint &&
      pnpm format:check` 全绿
- [x] 4.3 手工验收：打开文件夹切换目录、运行中切换被拒、新工作区会话
      首轮即体现概览（模型无需先 list_directory）、符号链接读写被拒
      （已实机验收通过）
