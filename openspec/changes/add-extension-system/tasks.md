# Tasks: add-extension-system

## 1. @cy-agent/mcp：stdio 客户端

- [x] 1.1 新增 `packages/mcp` 包骨架（package.json / tsconfig，仿 tools 包），
      纳入 pnpm-workspace 与根构建脚本
- [x] 1.2 JSON-RPC 2.0 stdio 传输层：spawn 子进程、按行编解码 JSON-RPC 消息、
      请求/响应按 id 配对、stderr 静默收集、`close()` 杀进程树
- [x] 1.3 `McpClient`：`initialize` 握手（protocolVersion/能力协商）、
      `listTools()`（tools/list）、`callTool(name, args)`（tools/call，
      content 数组提取 text 拼接为字符串结果）；超时与进程异常转为抛错
- [x] 1.4 `loadMcpTools(configFile)`：解析 Claude Desktop 风格配置，逐 server
      连接并适配为 `ToolBase[]`（命名 `mcp_<server>_<tool>`、参数 schema 透传、
      `requiresApproval: true`）；单 server 失败收集告警并跳过
- [x] 1.5 单测：内联 Node 脚本模拟 MCP server（回显 initialize/tools/list/
      tools/call），验证握手、工具适配命名、调用往返、异常 server 降级

## 2. 技能（Skills）

- [x] 2.1 `skills.ts`：`listSkills(workspace)` 扫描 `.cy-agent/skills/*.md`
      （名称=文件名去扩展名、描述=首个非空行、大小上限保护）；
      `readSkill(workspace, name)` 校验名称防路径穿越后返回全文
- [x] 2.2 内置工具 `load_skill`（免授权只读，未知技能返回错误文本）注册进
      编码工具集装配；工作区概览追加 `Available skills` 段（无技能则省略）
- [x] 2.3 单测：技能列表/描述解析、load_skill 往返、`../` 名称被拒、
      概览含技能段

## 3. 本地插件（Plugins）

- [x] 3.1 `plugins.ts`：`loadPluginTools(workspace)` 扫描
      `.cy-agent/plugins/*.mjs`，动态 `import()` 并调用默认导出
      `createTools({ workspace })`，返回 `ToolBase[]`；单插件失败告警跳过
- [x] 3.2 单测：临时插件文件注册成功、坏插件降级不影响其他插件、
      无插件目录返回空

## 4. 扩展装配与双宿主接入

- [x] 4.1 `loadExtensions(workspace, options)`（packages/tools）：聚合 MCP /
      插件工具与技能概览段，返回 `{ tools, skillsSection, warnings }`
- [x] 4.2 CLI：`--mcp-config=<file>`（env `CY_AGENT_MCP_CONFIG` 回退），
      main.ts 装配扩展工具并拼接技能段；启动行输出告警摘要
- [x] 4.3 desktop：主进程 bootstrap 与工作区切换路径接入同款装配
      （MCP 配置取自 CY_AGENT_MCP_CONFIG）；config:get 不暴露新敏感信息
- [x] 4.4 单测：装配聚合结果形状、CLI 配置解析（--mcp-config 优先于 env）

## 5. 验证与收尾

- [x] 5.1 `packages/agent` / `packages/protocol` 零改动验证（diff 检查）
- [x] 5.2 `pnpm build && pnpm typecheck && pnpm test && pnpm lint &&
      pnpm format:check` 全绿
- [x] 5.3 手工验收：配置真实 MCP server 工具可调用且经授权门控、技能被
      模型按需加载、坏插件/坏 server 不阻塞启动（已实机验收通过）
