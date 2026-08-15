# Capability: code-workspace（代码工作区）

## ADDED Requirements

### Requirement: 核心边界不可侵入

工作区能力 MUST 在既有宿主层与 `packages/tools` 内实现：
`packages/agent` 与 `packages/protocol` MUST NOT 因本能力产生任何代码改动
或新增依赖。工作区概览 MUST 由宿主在构造 `systemPrompt` 时拼接注入，
核心 Agent Loop MUST NOT 感知工作区概念。

#### Scenario: 核心包零污染验证

- **WHEN** 构建并对比 `packages/agent` / `packages/protocol` 的源码与依赖
- **THEN** SHALL NOT 出现任何因工作区能力产生的改动

### Requirement: 工作区可选择与切换（桌面端）

桌面端 MUST 通过 `workspace:get` / `workspace:select` IPC 通道提供工作区
查询与切换；`workspace:select` MUST 经系统目录选择对话框完成，用户取消时
返回空结果且不改变当前工作区。UI MUST 常驻展示当前工作区路径与切换入口。
最后选择的工作区 MUST 持久化，并在下次启动时恢复；无记忆时沿用
`CY_AGENT_CWD` / 默认目录回退链。

#### Scenario: 选择并切换工作区

- **WHEN** 用户经「打开文件夹」选择一个新的有效目录
- **THEN** 当前工作区 SHALL 变更为该目录，UI 工作区栏 SHALL 即时更新
- **AND** 后续新建会话的编码工具 SHALL 以新目录为沙箱根
- **AND** transcript SHALL 出现工作区变更的系统通知

#### Scenario: 用户取消选择

- **WHEN** 用户在目录选择对话框中取消
- **THEN** 当前工作区 SHALL 保持不变，不产生任何状态变更或错误提示

#### Scenario: 启动恢复记忆

- **WHEN** 上次会话中用户手动选择过工作区并重启应用
- **THEN** 启动后的当前工作区 SHALL 为上次选择的目录

### Requirement: 工作区切换的竞态防护

会话运行期间 MUST NOT 允许切换工作区（工具闭包绑定切换前的 cwd，中途
切换会造成新旧沙箱混用）。被拒绝的切换 MUST 以明确信息反馈至 UI 而非
静默忽略。

#### Scenario: 运行中切换被拒绝

- **WHEN** 会话正在运行（含未决授权挂起）时用户触发切换工作区
- **THEN** 切换 SHALL 被拒绝并反馈"运行中不可切换"类提示
- **AND** 当前工作区与运行中的会话 SHALL 均不受影响

### Requirement: 工作区概览注入

宿主 MUST 在构造会话 `systemPrompt` 时追加工作区概览文本，内容包含：
工作区根路径、受限深度的目录树（跳过 `SKIPPED_DIRECTORIES`）、git 分支
（不可用时省略）、关键标记文件存在性。概览生成 MUST 对 IO 失败降级
（对应段落省略），MUST NOT 抛出异常阻塞会话启动。新建会话、打开存档、
切换工作区时 MUST 重新生成概览。

#### Scenario: 首轮对话即具工作区感知

- **WHEN** 用户在含 package.json 的 git 仓库工作区发起新会话并询问项目结构
- **THEN** 模型 SHALL 能直接引用概览中的目录与分支信息作答，
      无需先调用 `list_directory` 探索

#### Scenario: 概览生成容错

- **WHEN** 工作区目录不可读或非 git 仓库
- **THEN** 概览 SHALL 省略失败段落（如 git 分支），会话 SHALL 正常启动

### Requirement: 符号链接沙箱防护

编码工具的路径解析 MUST 在相对路径防逃逸之外，进一步校验目标路径经
`realpath` 解析后的真实位置仍在工作区内。指向工作区之外的符号链接
（含链接目录下的子路径）MUST 被拒绝，错误以工具结果字符串交还 LLM，
MUST NOT 中断会话。

#### Scenario: 符号链接逃逸被拒绝

- **WHEN** 工作区内存在指向外部目录的符号链接，`read_file` 请求该链接下的文件
- **THEN** 工具 SHALL 返回含"逃逸工作区"语义的错误文本
- **AND** 外部文件内容 SHALL NOT 被读取，会话 SHALL 继续

#### Scenario: 工作区内链接正常放行

- **WHEN** 符号链接的目标仍在工作区内
- **THEN** 读写操作 SHALL 正常完成
