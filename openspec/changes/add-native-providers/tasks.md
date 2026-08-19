# Tasks: add-native-providers

## 1. Anthropic Native Provider（packages/anthropic-provider）

- [x] 1.1 `package.json` 与 `tsconfig.json` 初始化，依赖 `@cy-agent/agent` 与 `@cy-agent/protocol`
- [x] 1.2 `messages.ts`：实现 `toAnthropicMessages` 与 `toAnthropicTools`，支持提取 system、合并相邻同角色 turns、将 tool 结果映射为 `user` 角色下的 `tool_result`
- [x] 1.3 `anthropic-provider.ts`：实现 `AnthropicProvider`，解析 Anthropic SSE 事件（`content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`），产生标准 `ProviderChunk`（text、tool_call_*、usage）
- [x] 1.4 `index.ts` 导出公共 API
- [x] 1.5 单元测试：文本流式分块、tool_use 拼接、system 提取与 usage 统计、错误处理与 AbortSignal

## 2. Gemini Native Provider（packages/gemini-provider）

- [x] 2.1 `package.json` 与 `tsconfig.json` 初始化
- [x] 2.2 `messages.ts`：实现 `toGeminiContents` 与 `toGeminiTools`，支持提取 `systemInstruction`、将 tool 映射为 `functionResponse`
- [x] 2.3 `gemini-provider.ts`：实现 `GeminiProvider`，解析 Gemini REST SSE 事件流与 `usageMetadata`
- [x] 2.4 `index.ts` 导出公共 API
- [x] 2.5 单元测试：文本流式输出、functionCall 解析与 usage 统计、错误处理

## 3. CLI 与桌面端集成（packages/cli & packages/desktop）

- [x] 3.1 `packages/cli`：添加新包依赖，在 `config.ts` 中增加 `--provider` 与环境变量（`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`）解析与自动推断，在 `main.ts` 中完成分发
- [x] 3.2 `packages/desktop`：添加新包依赖，在 `config.ts` 中支持新环境变量读取与 Provider 推断，在 `main/index.ts` 动态实例化
- [x] 3.3 Vitest 别名与多 Provider 配置单测补充

## 4. 验证与文档

- [x] 4.1 全量构建与类型检查：`pnpm build && pnpm typecheck`
- [x] 4.2 全量单元测试：`pnpm test`（23 test files, 183 tests 全绿）
- [x] 4.3 规范检查：`pnpm lint && pnpm format:check`
- [x] 4.4 更新 `README.md` 与 `openspec/project.md`
