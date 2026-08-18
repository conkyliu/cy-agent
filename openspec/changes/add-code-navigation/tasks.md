# Tasks: add-code-navigation

## 1. 符号索引核心（packages/tools/symbol-index.ts）

- [x] 1.1 `SymbolEntry`（name / kind / file / line）、`SymbolIndex`（条目列表 +
      filesIndexed + truncated）、`SymbolKind` 联合类型与 `LanguageExtractor`
      契约（按扩展名分派）
- [x] 1.2 TypeScript/JavaScript 抽取器：函数、类、方法（含对象方法）、
      接口、类型别名、导出常量（export/default 变体均覆盖）
- [x] 1.3 Python 抽取器：`def` / `class` / `async def`（含方法，顶层与
      缩进定义均记录）
- [x] 1.4 Go（`func` / `type`）与 Rust（`fn` / `struct` / `enum` / `impl` 块）
      抽取器（尽力而为）
- [x] 1.5 `buildSymbolIndex(workspace)`：目录递归扫描，沿用
      `SKIPPED_DIRECTORIES`、跳过隐藏文件与 `MAX_FILE_SIZE_BYTES` 超限文件，
      单文件异常跳过不中断；`MAX_INDEXED_FILES` / `MAX_SYMBOL_ENTRIES`
      上限截断并置 `truncated` 标记
- [x] 1.6 单测：多语言样例文件索引正确、跳过目录与超限文件、上限截断、
      空工作区返回空索引

## 2. 导航工具（packages/tools/navigation.ts）

- [x] 2.1 `createFindSymbolTool(index)`：只读免授权，参数
      `{ name: string, kind?: SymbolKind }`，按 kind 过滤，输出
      `file:line [kind]` 清单（`MAX_FIND_RESULTS` 上限截断并提示收窄），
      未命中返回提示文本引导改用 search_files
- [x] 2.2 依赖解析：TS/JS import/require、Python import/from 语句抽取；
      相对导入按扩展名与 index 文件探测解析为工作区内相对路径，
      无法解析时原样返回并标 `(external)`
- [x] 2.3 `createFileDependenciesTool(workspace)`：只读免授权，参数
      `{ path: string }`；路径沙箱校验；非支持语言与不存在文件返回错误文本
- [x] 2.4 单测：find_symbol 命中/过滤/未命中/截断；file_dependencies
      相对解析/外部标注/非支持语言/越权路径拒绝

## 3. 装配集成与概览（extensions.ts / workspace.ts）

- [x] 3.1 `loadExtensions` 构建符号索引（有符号时注册两个导航工具），
      `Extensions` 新增 `symbolIndex` 字段
- [x] 3.2 `buildWorkspaceOverviewSection` 追加
      `Symbol index: N symbols from M files (use find_symbol)` 行
      （无符号时不输出；截断时附 `truncated` 标注）
- [x] 3.3 CLI 与桌面端经既有装配路径自动获得导航工具；工作区切换
      时索引随扩展重建（复用既有切换逻辑，无新代码路径）
- [x] 3.4 单测：装配注册导航工具与概览符号行、工作区切换索引重建、
      无源码工作区不注册

## 4. 验证与收尾

- [x] 4.1 `packages/agent` / `packages/protocol` 零改动验证（diff 检查）
- [x] 4.2 `pnpm build && pnpm typecheck && pnpm test && pnpm lint &&
      pnpm format:check` 全绿
- [x] 4.3 手工验收：桌面端对真实仓库使用 find_symbol 直达定义、
      file_dependencies 正确解析相对/外部依赖（已实机验收通过）
