# Capability: coding-tools

## ADDED Requirements

### Requirement: 内置编码工具集

运行时 SHALL 提供 `read_file`、`write_file`、`list_directory`、`search_files`
四个内置编码工具，并可通过 `createCodingTools(cwd)` 一次性创建注册。
所有工具 MUST 是自包含的 `ToolContract`（含 JSON Schema）。

#### Scenario: 读取文件与行范围

- **WHEN** 模型调用 `read_file` 且仅提供 `path`
- **THEN** 工具 SHALL 返回文件完整文本内容
- **WHEN** 提供 `startLine` / `endLine`（1-based，含边界）
- **THEN** 工具 SHALL 仅返回该区间内容；非法区间（start > end）SHALL 抛出错误

#### Scenario: 列目录与内容搜索

- **WHEN** 模型调用 `list_directory`
- **THEN** 工具 SHALL 返回按名称排序的条目，目录以 `[dir]`、文件以 `[file]` 标记
- **WHEN** 模型调用 `search_files` 提供正则 `pattern`
- **THEN** 工具 SHALL 返回 `file:line: text` 格式的匹配行，跳过 node_modules/.git/dist/coverage 与二进制文件
- **AND** 遍历文件数与匹配数 MUST 存在上限，防止超大仓库阻塞会话

### Requirement: 写操作授权

`write_file` MUST 标记 `requiresApproval: true`，执行前经由
`add-tool-approval` 定义的 HITL 流程获得用户授权。

#### Scenario: 写文件触发授权

- **WHEN** 模型调用 `write_file`
- **THEN** 会话 SHALL 先发出 `tool_approval_requested`，授权通过后才创建/覆盖文件并自动建立父目录

### Requirement: 工作区沙箱

所有工具的文件路径 MUST 被解析并限制在工作区根目录内。
任何逃逸路径（`..` 相对路径或工作区外绝对路径）SHALL 抛出错误；
该错误属于 Tool 级错误，MUST 以字符串交还 LLM 而非中断会话。

#### Scenario: 越界路径被拒绝

- **WHEN** 任一工具收到 `../outside.txt` 这类逃逸路径
- **THEN** 工具 SHALL 抛出 "escapes the workspace root" 错误
- **AND** 会话 SHALL 继续运行，错误信息出现在下一轮模型请求的 `tool` 消息中
