# Capability: extension-system（扩展体系）

## ADDED Requirements

### Requirement: 核心边界不可侵入

扩展能力 MUST 在 `packages/mcp`、`packages/tools` 与宿主层内实现：
`packages/agent` 与 `packages/protocol` MUST NOT 因本能力产生任何代码改动
或新增依赖。所有扩展工具 MUST 实现既有 `ToolBase` 契约并经
`ToolRegistry.register` 挂载，核心 Agent Loop MUST NOT 感知扩展来源。

#### Scenario: 核心包零污染验证

- **WHEN** 构建并对比 `packages/agent` / `packages/protocol` 的源码与依赖
- **THEN** SHALL NOT 出现任何因扩展能力产生的改动

### Requirement: MCP 工具接入

宿主 MUST 支持经 Claude Desktop 风格配置文件声明 MCP server
（`{ "mcpServers": { name: { command, args, env } } }`），CLI 经
`--mcp-config=<file>` 或环境变量 `CY_AGENT_MCP_CONFIG` 指定，桌面端复用
同一环境变量。客户端 MUST 经 stdio JSON-RPC 完成 `initialize` 握手、
`tools/list` 枚举与 `tools/call` 调用。远程工具 MUST 以
`mcp_<server>_<tool>` 命名适配注册，参数 JSON Schema 透传，且
MUST 声明 `requiresApproval: true`。

#### Scenario: MCP 工具经授权调用

- **WHEN** 配置了可用 MCP server 且模型调用其适配工具
- **THEN** 宿主 SHALL 弹出授权提示；批准后工具调用 SHALL 经 tools/call
      完成并以字符串结果交还模型

#### Scenario: 单个 server 故障不阻塞启动

- **WHEN** 配置中某个 server 命令不存在或握手失败
- **THEN** 该 server SHALL 被跳过并产生告警，其余 server 与内置工具
      SHALL 正常可用，会话 SHALL 正常启动

### Requirement: 技能按需加载

工作区 `.cy-agent/skills/*.md` MUST 被识别为技能：文件名（去扩展名）为技能名，
首个非空行为描述。工作区概览 MUST 追加 Available skills 段落（名称与描述），
技能全文 MUST NOT 默认注入 systemPrompt；模型 MUST 能经只读工具
`load_skill` 按名取回全文。技能名 MUST 防路径穿越校验。

#### Scenario: 模型按需取用技能

- **WHEN** 工作区含技能文件且模型需要对应操作指引
- **THEN** 模型 SHALL 能从概览的技能清单选择目标并调用 `load_skill`
      获取全文，而非凭记忆猜测

#### Scenario: 技能名穿越被拒

- **WHEN** `load_skill` 收到含 `..` 或路径分隔符的名称
- **THEN** 工具 SHALL 返回错误文本，MUST NOT 读取工作区外文件

### Requirement: 本地插件加载

工作区 `.cy-agent/plugins/*.mjs` MUST 支持默认导出
`createTools({ workspace }) => ToolBase[]`，在宿主装配时经动态 `import()`
加载并注册；插件工具沿用其自声明的 `requiresApproval`。单个插件加载或
执行失败 MUST 降级跳过并告警，MUST NOT 中断启动。

#### Scenario: 插件工具注册与调用

- **WHEN** 工作区含合法插件文件
- **THEN** 其导出工具 SHALL 出现在模型可用工具集合并可正常调用

#### Scenario: 坏插件降级

- **WHEN** 某插件文件语法错误或缺少默认导出
- **THEN** 该插件 SHALL 被跳过并产生告警，其余插件与内置工具 SHALL 不受影响

### Requirement: 双宿主一致装配

CLI 与桌面端 MUST 经同一装配入口加载扩展（MCP 工具、插件工具、技能段），
行为语义一致。桌面端切换工作区时 MUST 随编码工具重建一同重扫新工作区的
插件与技能。扩展加载告警 MUST 可被用户观察到（CLI 输出 / 桌面端可见反馈）。

#### Scenario: 桌面端工作区切换后扩展刷新

- **WHEN** 用户切换至含不同插件与技能的工作区
- **THEN** 新会话可用工具集与概览技能段 SHALL 反映新工作区的扩展内容
