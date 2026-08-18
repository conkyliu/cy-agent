# Change: add-code-navigation

## Why

Phase 1–5 中模型定位代码只有两个手段：`search_files`（正则全文扫描，
结果按行截断、噪声大）与 `read_file`（需先猜对路径）。在中大型仓库中，
「找到 `Foo` 的定义在哪」「这个文件依赖谁」这类高频问题需要多轮搜索试错，
浪费往返与 token。Phase 6 引入语言感知的符号索引与文件依赖解析：
模型可按名称直达定义位置、按文件查询依赖关系，将代码导航从「搜文本」
升级为「查索引」。

## What Changes

- **符号索引**：
  - 新增 `symbol-index.ts`（packages/tools）：工作区扫描 + 按语言正则抽取器
    （TypeScript/JavaScript、Python、Go、Rust；覆盖函数、类、方法、
    接口、类型别名、导出常量），构建内存索引（名称 → 定义位置列表）。
  - 零第三方依赖（不引入 tree-sitter）：抽取器为容错正则，单文件解析
    失败跳过；沿用 `SKIPPED_DIRECTORIES`、文件大小上限与条目总数上限，
    大仓库索引截断并标注。
- **导航工具**（只读免授权）：
  - `find_symbol(name, kind?)`：按名称返回 `file:line [kind]` 定义清单
    （上限截断）；未命中返回错误文本提示改用 search_files。
  - `file_dependencies(path)`：抽取 TS/JS/Python 的 import/require/from
    语句，相对导入解析为工作区内实际文件（扩展名/index 探测），
    外部依赖标注 `(external)`；非支持语言返回错误文本。
- **装配与注入**：
  - `loadExtensions` 在装配时构建索引（有符号时注册两个导航工具），
    概览追加 `Symbol index: N symbols from M files (use find_symbol)` 行；
    CLI 与桌面端经既有装配路径自动获得，工作区切换随扩展重建重新索引。
- **索引时机**：会话启动与工作区切换时全量重建（同步、有界、容错）；
  不做后台增量监听（超出本期范围，概览行已提示模型索引为启动时快照）。

## Impact

- Affected specs：新增 capability `code-navigation`；`extension-system`
  装配结果增加符号索引（增量修订，装配契约扩展非破坏）。
- Affected code：`packages/tools` 新增 symbols / 依赖解析与工具、扩展装配；
  CLI 与桌面端零额外改动（经 `loadExtensions` 透明获得）。
- 边界保持：`packages/agent` / `packages/protocol` 零改动
  （导航工具实现既有 `ToolBase`，经 `ToolRegistry.register` 挂载）。
- 安全：两工具均只读；依赖解析仅读取文件首段文本，路径经工作区沙箱校验。
