# Change: Add Sub-agent Multi-Agent Subtask Delegation

## Why
In large-scale codebases, complex exploration tasks (e.g. cross-package dependency analysis, multi-module symbol usage research) can generate hundreds of tool calls and intermediate inspection turns. If performed in the parent session, the main conversation context rapidly accumulates tokens and loses focus.

Sub-agent delegation allows the primary agent to delegate focused, autonomous subtasks to an isolated child session (`delegate_task`), receive a concise final summary, and keep the main session context clean and token-efficient.

## What Changes
- Implement `createDelegateTaskTool` in `@cy-agent/tools` (`packages/tools/src/subagent.ts`).
- Provide sub-agent isolation with read-only tools (`read_file`, `list_directory`, `search_files`, `find_symbol`, `file_dependencies`).
- Support recursion control (`maxDepth`, default 1) and turn limit (`maxIterations`, default 10).
- Support cascading cancellation via `AbortSignal`.
- Wire up `delegate_task` through `loadExtensions` into CLI and Desktop shell.

## Impact
- Main agent can delegate complex investigation tasks seamlessly.
- Context window of parent agent is preserved.
- Fully backward-compatible and non-breaking.
