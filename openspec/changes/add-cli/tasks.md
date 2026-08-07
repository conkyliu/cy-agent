# Tasks: add-cli

## 1. 包与工程

- [x] 1.1 新建 `packages/cli`（bin: `cy-agent`），接入 workspace 构建与 vitest 别名

## 2. 配置

- [x] 2.1 `parseCliArgs`：`--key=value` 解析，未知参数忽略，支持无值开关
- [x] 2.2 `loadConfig`：参数 > 环境变量 > 默认值；缺失 API Key 抛 Fatal 错误

## 3. 渲染

- [x] 3.1 `renderEvent`：9 种 AgentEvent → 终端文本（纯函数，可选 ANSI 颜色）
- [x] 3.2 `preview`：单行压缩 + 超长截断，穷尽事件类型检查

## 4. REPL 主循环

- [x] 4.1 行输入驱动 `session.run()`，实时渲染事件流，`/exit` 退出
- [x] 4.2 授权宿主：授权事件 → 原地提问 y/N → `resolveApproval`
- [x] 4.3 LineReader 队列统一读行（规避 readline 迭代器与 question 冲突）
- [x] 4.4 SIGINT：运行中取消当前轮，空闲退出
- [x] 4.5 `main.ts` 组装 Provider/Registry/Session 与系统提示词

## 5. 测试与验证

- [x] 5.1 config 解析/优先级/缺 Key 报错测试
- [x] 5.2 renderer 各事件类型/颜色/截断测试
- [x] 5.3 REPL 端到端测试：注入 PassThrough 流，授权放行与拒绝两条链路
