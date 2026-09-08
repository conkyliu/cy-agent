# Spec: Precise File Editing (`edit_file`)

## Overview
The `edit_file` tool allows the agent to modify existing files by replacing a targeted block of text with new content. It ensures safety through uniqueness checks, sandbox boundary enforcement, Git blob snapshots, and explicit user approval (HITL).

## Requirements

### Tool Definition (`edit_file`)
- **Name**: `edit_file`
- **Description**: Replaces a target block of text in an existing file with replacement text.
- **Requires Approval**: `true` (modifying files is a state-changing operation).
- **Parameters**:
  - `path` (`string`, required): File path relative to workspace root.
  - `targetContent` (`string`, required): The exact text block to find and replace.
  - `replacementContent` (`string`, required): The new text to substitute in place of `targetContent`.
  - `allowMultiple` (`boolean`, optional, default `false`): If true, all occurrences of `targetContent` will be replaced; otherwise, multiple matches will result in an error to avoid ambiguous edits.

### Execution Semantics & Validation
1. **Sandbox Validation**: The target `path` MUST be resolved safely within the workspace sandbox using `resolveInWorkspaceSafe`. Path traversal (e.g. `../`) or symlink escapes MUST be rejected.
2. **File Existence**: The target file MUST already exist. Attempting to edit a nonexistent file MUST throw a clear error informing the agent to use `write_file` for new files.
3. **Target Match Validation**:
   - If `targetContent` is not found in the file, execution MUST fail with an explanatory message instructing the agent to re-read the file.
   - If `targetContent` matches more than once and `allowMultiple` is not `true`, execution MUST fail with an error stating the count of occurrences and asking for more surrounding context.
4. **Git Snapshot**: If the target file resides in a Git repository, a read-only Git Blob snapshot MUST be created before modifying the file, and the blob SHA MUST be returned in the completion summary.
5. **Diff Generation**:
   - The system MUST provide a utility to compute line-level unified diffs (`computeUnifiedDiff`) between old and new contents.
   - The CLI and Desktop HITL approval dialogs MUST visually format the diff so reviewers can clearly see lines added (`+`) and removed (`-`).
