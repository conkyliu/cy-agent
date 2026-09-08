# Spec: Streaming Shell Output & Safe Command Auto-Approval

## Overview
This specification defines the real-time event streaming of tool process output and the safe command classification mechanism that automatically approves low-risk read-only commands while strictly gating dangerous operations.

## Requirements

### Protocol: Tool Output Chunk Event
- Add `{ type: 'tool_output_chunk'; toolCallId: string; chunk: string }` to `AgentEvent`.
- When an executing tool emits incremental stdout/stderr output, the runtime MUST yield `tool_output_chunk` events before emitting `tool_execution_completed` or `tool_execution_failed`.
- The desktop IPC layer MUST serialize and forward `tool_output_chunk` without modification.

### Tool Contract & Runtime Integration
- `ToolBase.requiresApproval` MUST support a function signature `(args: any) => boolean` in addition to `boolean`.
- If `requiresApproval` evaluates to `false`, the session MUST bypass HITL prompt/modal and immediately execute the tool.
- `ToolBase.execute` MUST accept an optional `onOutput?: (chunk: string) => void` callback.
- `AgentSession.executeTool` MUST queue chunks from `onOutput` and yield `tool_output_chunk` events asynchronously without blocking execution.

### Safe Command Auto-Approval Engine (`isSafeCommand`)
- A command MUST be classified as safe ONLY IF:
  1. It begins with an allowed read-only utility (e.g. `git status`, `git diff`, `git log`, `git show`, `git branch`, `pwd`, `ls`, `cat`, `head`, `tail`, `wc`, `which`, `node -v`, `pnpm -v`, `npm -v`, `echo`, `env`, `uname`).
  2. It contains NO redirection operators (`>`, `>>`, `&>`).
  3. It contains NO piping operators (`|`).
  4. It contains NO command chaining operators (`;`, `&&`, `||`).
  5. It contains NO shell command substitution constructs (`$(...)`, `` `...` ``).
  6. For `git`, any mutating subcommands (e.g. `commit`, `push`, `reset`, `rebase`, `checkout`, `clean`, `rm`, `merge`) MUST NOT be classified as safe.
- Any command failing these criteria MUST require user approval.
