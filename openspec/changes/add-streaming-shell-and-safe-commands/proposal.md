# Change: Add Streaming Shell Output and Safe Command Auto-Approval

## Why
1. **Interactive Feedback**: Currently, `run_shell` blocks silently until the spawned process completes, creating a "frozen" user experience during long-running tasks like test suites, package installs, and builds.
2. **Approval Fatigue**: `run_shell` unconditionally prompts for human-in-the-loop authorization (`requiresApproval: true`), even for benign read-only inspection commands (`git status`, `git diff`, `ls`, `cat`, etc.), causing severe friction during frequent interactions.

## What Changes
- Add `tool_output_chunk` event to `@cy-agent/protocol` and desktop IPC contract.
- Support dynamic `requiresApproval: boolean | ((args: any) => boolean)` and streaming output callback `onOutput?: (chunk: string) => void` in `@cy-agent/agent`.
- Bridge tool streaming output in `AgentSession.executeTool` via an async chunk queue, yielding real-time `tool_output_chunk` events.
- Implement `isSafeCommand(command: string): boolean` safe command rule engine in `@cy-agent/tools` with strict guards against redirection, chaining, and write subcommands.
- Update `run_shell` to auto-approve safe commands and stream stdout/stderr in real-time.
- Forward and render live streaming chunks in CLI (`repl.ts`, `renderer.ts`, `run-once.ts`) and Desktop (`Transcript.tsx`).
- Provide thorough unit and integration test coverage.

## Impact
- Instant visual feedback during shell command execution.
- Eliminates unnecessary approval prompts for safe inspection commands.
- Maintains strict workspace containment and authorization barriers for state-changing or dangerous commands.
