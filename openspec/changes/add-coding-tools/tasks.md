# Tasks: add-coding-tools

## 1. 包与工程

- [x] 1.1 新建 `packages/tools`（`@cy-agent/tools`），接入 workspace 构建与 vitest 别名
- [x] 1.2 `ToolContract.execute` 调整为方法签名，解决泛型逆变赋值问题

## 2. 工作区沙箱

- [x] 2.1 `resolveInWorkspace`：路径解析 + 逃逸检测（`..` / 绝对路径）
- [x] 2.2 定义遍历跳过目录集合（node_modules / .git / dist / coverage）

## 3. 内置工具

- [x] 3.1 `read_file`：全文读取与 1-based 行范围，非法区间报错
- [x] 3.2 `write_file`：自动创建父目录，`requiresApproval: true`
- [x] 3.3 `list_directory`：类型标记 + 排序 + 空目录提示
- [x] 3.4 `search_files`：正则逐行匹配、include 过滤、跳过二进制与大文件、文件数/匹配数上限、支持 AbortSignal

## 4. 测试与验证

- [x] 4.1 read/write/list/search 各工具行为测试（含错误路径）
- [x] 4.2 沙箱越界防护测试（四个工具全覆盖）
- [x] 4.3 与 `AgentSession` 端到端集成测试（MockProvider → read_file → 完成）
