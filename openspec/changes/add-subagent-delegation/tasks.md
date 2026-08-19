# Tasks: Add Sub-agent Delegation

- [x] Create `packages/tools/src/subagent.ts` with `createDelegateTaskTool` and `SUBAGENT_SYSTEM_PROMPT` <!-- id: 0 -->
- [x] Export subagent types and factory in `packages/tools/src/index.ts` <!-- id: 1 -->
- [x] Integrate subagent tool into `loadExtensions` in `packages/tools/src/extensions.ts` <!-- id: 2 -->
- [x] Pass provider into `loadExtensions` in CLI `packages/cli/src/main.ts` <!-- id: 3 -->
- [x] Wire up provider in Desktop `workspace-manager.ts` and `main/index.ts` <!-- id: 4 -->
- [x] Add unit tests in `packages/tools/test/subagent.test.ts` <!-- id: 5 -->
- [x] Run full validation (build, typecheck, tests, lint, format) <!-- id: 6 -->
