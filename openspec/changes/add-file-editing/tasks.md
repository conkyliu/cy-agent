# Tasks: Add File Editing Tool and Diff Visualization

- [x] Implement `computeUnifiedDiff` and line diff calculation in `packages/tools/src/diff.ts` <!-- id: 0 -->
- [x] Implement `createEditFileTool` and add to `createCodingTools` in `packages/tools/src/coding-tools.ts` <!-- id: 1 -->
- [x] Guard subagent isolation in `packages/tools/src/subagent.ts` to exclude `edit_file` <!-- id: 2 -->
- [x] Export `createEditFileTool`, `EditFileArgs`, and diff utilities in `packages/tools/src/index.ts` <!-- id: 3 -->
- [x] Add unit tests for `diff.ts` and `edit_file` in `packages/tools/test/` <!-- id: 4 -->
- [x] Update system prompt and add colorized diff preview in CLI `packages/cli/src/renderer.ts` and `main.ts` <!-- id: 5 -->
- [x] Update system prompt in Desktop `main/index.ts` and render visual diff card in `ApprovalModal.tsx` <!-- id: 6 -->
- [x] Run full monorepo validation (test, typecheck, lint, format) <!-- id: 7 -->
