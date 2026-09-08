# Tasks: Add Streaming Shell Output and Safe Command Auto-Approval

- [x] Add `tool_output_chunk` event in `packages/protocol/src/events.ts` and `packages/desktop/shared/ipc.ts` <!-- id: 0 -->
- [x] Update `ToolBase` in `packages/agent/src/contracts/tool.ts` and support dynamic `requiresApproval` and streaming in `packages/agent/src/session.ts` <!-- id: 1 -->
- [x] Implement `isSafeCommand` rule engine in `packages/tools/src/safe-commands.ts` <!-- id: 2 -->
- [x] Update `packages/tools/src/shell-tool.ts` with streaming `onOutput` and dynamic `requiresApproval` <!-- id: 3 -->
- [x] Export `isSafeCommand` and safe command utilities in `packages/tools/src/index.ts` <!-- id: 4 -->
- [x] Render live streaming chunks in CLI `packages/cli/src/renderer.ts`, `repl.ts`, and `run-once.ts` <!-- id: 5 -->
- [x] Accumulate and display live streaming output in Desktop `Transcript.tsx` and `events.ts` <!-- id: 6 -->
- [x] Add comprehensive tests for `isSafeCommand` and streaming execution in `packages/tools/test/` and `packages/agent/test/` <!-- id: 7 -->
- [x] Run full monorepo validation (test, typecheck, lint, format, build) <!-- id: 8 -->
