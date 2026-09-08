# Change: Add Precise File Editing Tool (`edit_file`) and Diff Visualization

## Why
Currently, file modifications in `cy-agent` rely exclusively on `write_file` (full file overwrite). In large codebases and files spanning dozens or hundreds of lines, this introduces significant issues:
1. **Severe Token Waste**: Modifying a few lines requires generating and sending back the entire file content.
2. **Hallucination & Code Loss**: Full overwrites frequently cause the model to inadvertently omit unchanged sections or introduce unintended regressions.
3. **Suboptimal Review Experience**: In Human-in-the-loop (HITL) approval, reviewers cannot easily see the exact lines modified from a raw full-file dump.

Adding a targeted block replacement tool (`edit_file`) paired with Git snapshot safety and visual diff rendering resolves these challenges.

## What Changes
- Implement `createEditFileTool` in `@cy-agent/tools` (`packages/tools/src/coding-tools.ts`) supporting exact block replacement (`targetContent` -> `replacementContent`) with uniqueness checks.
- Implement zero-dependency line-based unified diff utility in `@cy-agent/tools` (`packages/tools/src/diff.ts`).
- Ensure `edit_file` inherits workspace sandbox containment and pre-write Git Blob snapshotting (`snapshotBeforeOverwrite`).
- Prevent sub-agents from executing `edit_file` to preserve read-only isolation in `subagent.ts`.
- Export `createEditFileTool`, `EditFileArgs`, and diff helpers in `packages/tools/src/index.ts`.
- Update system prompts in CLI and Desktop shell guiding the agent to prefer `edit_file` for modifying existing files.
- Enhance HITL approval rendering in CLI (`packages/cli/src/renderer.ts`) and Desktop (`ApprovalModal.tsx`) with colorized line diff previews.
- Add unit tests covering exact replacement, uniqueness validation, multi-line blocks, Git snapshots, and diff generation.

## Impact
- Significantly reduces token consumption during coding tasks.
- Minimizes risk of code destruction during edits.
- Dramatically improves user experience during HITL approval review.
- Fully backward-compatible; `write_file` remains available for creating new files or full overwrites.
