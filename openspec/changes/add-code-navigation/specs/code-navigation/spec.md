# Spec Delta: add-code-navigation

## ADDED Requirements

### Requirement: 语言感知符号抽取

系统 SHALL 在装配时扫描工作区源码，按文件扩展名分派容错正则抽取器，
将符号定义（名称、种类、相对路径、行号）收集为内存索引。

支持的语言与符号种类：

- TypeScript/JavaScript（`.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs`）：
  function、class、method、interface、type、const（导出常量）
- Python（`.py`）：function（含 async）、class
- Go（`.go`）：function、type
- Rust（`.rs`）：function、struct、enum、type（impl 块内方法）

约束：零第三方依赖；单文件读取或解析异常 MUST 跳过该文件不中断整体
扫描；扫描 MUST 沿用既有跳过目录（node_modules、.git、dist、coverage）、
隐藏文件与文件大小上限。

#### Scenario: 多语言符号抽取

- **WHEN** 工作区含 TS（class/interface/const）、Python（def/class）与
  Go（func/type）源码文件
- **THEN** 索引包含各文件符号的名称、种类、相对路径与行号
- **AND** 索引构建成功，filesIndexed 等于实际索引文件数

#### Scenario: 单文件异常不中断扫描

- **WHEN** 工作区某源文件不可读或超出文件大小上限
- **THEN** 该文件被跳过
- **AND** 其余文件的符号仍正常入索引

### Requirement: find_symbol 符号定位工具

系统 SHALL 提供只读免授权工具 `find_symbol`，按名称查询符号定义清单。

工具契约：

- 参数：`{ name: string, kind?: SymbolKind }`；kind 存在时按种类过滤
- 命中输出 `file:line [kind]` 清单（相对路径，上限条数截断并提示收窄查询）
- 未命中 MUST 返回提示文本，引导模型改用 search_files

#### Scenario: 按名称定位定义

- **WHEN** 模型调用 find_symbol 查询已索引符号名
- **THEN** 返回全部匹配定义的 `file:line [kind]` 清单

#### Scenario: kind 过滤与未命中引导

- **WHEN** 查询指定 kind 且无该种类匹配，或名称完全未命中
- **THEN** 返回提示文本（含改用 search_files 的建议），不抛异常

### Requirement: 文件依赖解析工具

系统 SHALL 提供只读免授权工具 `file_dependencies`，解析指定文件的
导入依赖。

工具契约：

- 参数：`{ path: string }`（相对工作区路径，沙箱校验）
- 支持 TS/JS（import/export-from/require）与 Python（import/from）
- 相对导入 MUST 按扩展名与 index 文件探测解析为工作区内实际文件；
  无法解析的依赖原样输出并标注 `(external)`
- 不支持的语言与不存在的文件 MUST 返回错误文本

#### Scenario: 相对导入解析

- **WHEN** 查询文件含 `import { x } from './sibling'` 且
  `sibling.ts` 存在于工作区
- **THEN** 输出解析后的工作区相对路径（如 `src/sibling.ts`）

#### Scenario: 外部依赖标注

- **WHEN** 查询文件含 `import fs from 'node:fs'` 与包名导入
- **THEN** 这些依赖原样输出并标注 `(external)`

#### Scenario: 非支持语言与越权路径

- **WHEN** 查询 `.go` 等未支持语言文件，或路径越出工作区边界
- **THEN** 返回错误文本，不执行解析、不抛异常

### Requirement: 索引边界与装配集成

符号索引 SHALL 有界构建，并经既有扩展装配路径注册导航工具与注入概览。

约束与行为：

- 索引上限（文件数与符号条目数）超限 MUST 截断并置 truncated 标记
- `loadExtensions` MUST 构建索引并在有符号时注册 `find_symbol` 与
  `file_dependencies`；`Extensions` 结果新增 `symbolIndex` 字段
- `buildWorkspaceOverviewSection` MUST 追加
  `Symbol index: N symbols from M files (use find_symbol)` 行
  （无符号时不输出；截断时附 truncated 标注）
- 工作区切换 MUST 随扩展重建重新索引（复用既有切换逻辑）
- `packages/agent` 与 `packages/protocol` MUST 零改动

#### Scenario: 截断与概览注入

- **WHEN** 工作区符号量超过上限且索引被截断
- **THEN** 索引置 truncated 标记
- **AND** 系统概览输出符号索引行且包含 truncated 标注

#### Scenario: 工作区切换重新索引

- **WHEN** 桌面端切换到含源码的新工作区
- **THEN** 新工作区的符号索引随扩展装配重建
- **AND** find_symbol 查询返回新工作区的符号定义

#### Scenario: 无源码工作区不注册导航工具

- **WHEN** 工作区无任何可索引源码文件
- **THEN** 索引为空，不注册导航工具，概览不输出符号索引行
