# OpenCode Orchestrator Skill — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Approach:** Skill + Helper Script (Approach 2)

## Overview

A global Claude Code skill that enables a two-tier agent system: Claude Code acts as the orchestrator (architecture, discovery, reasoning, review) while OpenCode handles mechanical, repetitive tasks (bulk generation, boilerplate, test writing, repetitive edits). This maximizes cost efficiency by using Claude Code's expensive tokens for thinking and OpenCode's cheap high-volume tokens for execution.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Task types | All mechanical work | Bulk generation, repetitive edits, tests, boilerplate, scaffolding |
| Handoff mode | Fully automatic | Claude Code dispatches, collects, reviews — user doesn't interact with OpenCode |
| Verification | Read and review | Claude Code reads output, fixes minor issues, re-dispatches for major |
| Worker model | MiniMax-M2.5-highspeed | High token credits, fast, cost-effective for mechanical tasks |
| Context passing | Task file + project directory | Task file for instructions/reference code, project dir for natural awareness |
| Execution | Sequential with smart batching | One OpenCode process at a time, but batch related work into single dispatches |
| Activation | Explicit + auto-detect | `/opencode` for manual, plus proactive detection for qualifying tasks |

## 1. Skill Identity & Triggers

**Name:** `opencode`
**Invocation:** `/opencode` or auto-detected
**Location:** `~/.claude/skills/opencode/SKILL.md`
**Scope:** Global (all projects)

### Auto-Detection Triggers

Claude Code should proactively consider delegation when encountering:

- **Bulk file creation** — 3+ files following a consistent pattern
- **Repetitive edits** — Same transformation applied across multiple files
- **Boilerplate/scaffolding** — CRUD operations, route handlers, model definitions
- **Test writing** — Unit/integration tests for existing code
- **Mechanical refactoring** — Renames, format changes, migration patterns

### Never Delegate (stays with Claude Code)

- Architecture decisions and system design
- Debugging and root cause analysis
- Code review and quality judgment
- Codebase discovery and exploration
- Multi-file behavioral reasoning
- Security-sensitive code
- Anything requiring understanding of *why*, not just *what*

## 2. Orchestration Workflow

```
IDENTIFY → PLAN → PREPARE → DISPATCH → REVIEW → REPORT
```

### Step 1: IDENTIFY
Claude Code detects a delegatable task (via auto-detection or explicit `/opencode` invocation).

### Step 2: PLAN
- Break work into batched tasks
- Group related files into single dispatches (e.g., "all test files for this package" = one dispatch)
- Read reference code from the project to include as examples
- Determine which files need to be created vs. modified

### Step 3: PREPARE
Write a task file to `/tmp/opencode-task-<uuid>.md` containing:
- Goal description
- Explicit file list (create/modify)
- Reference code (copy-pasted from project)
- Source files to read
- Conventions and constraints

### Step 4: DISPATCH
Run the helper script:
```bash
~/.claude/skills/opencode/opencode-dispatch.sh /tmp/opencode-task-<uuid>.md <working-dir> 120
```

### Step 5: REVIEW
First, read the log file to verify OpenCode completed without errors. Then read each created/modified file and check:
1. Do all specified files exist?
2. Does code follow the reference pattern?
3. Are project conventions respected?
4. No unintended side effects (files modified that shouldn't be)?

**Important:** Exit 0 from the dispatch script only means OpenCode ran without crashing. It does NOT guarantee the task was done correctly. Claude Code must always perform its full review regardless of exit code.

Decision matrix:
- Minor issues (imports, naming) → Claude Code fixes inline
- Major issues (wrong pattern, missing files) → Re-dispatch with feedback (max 2 retries)
- 3 total failures → Claude Code takes over and does the work itself

### Step 6: REPORT
Brief summary to user:
```
Delegated to OpenCode: Created 5 test files (internal/api/handlers/*_test.go)
  - Reviewed: 4 passed, 1 had incorrect import — fixed inline
  - Model: MiniMax-M2.5-highspeed | Time: 34s
```

## 3. Task File Format

The task file is the contract between Claude Code and OpenCode. It must be self-contained — OpenCode should not need to explore the codebase.

**Size guideline:** Reference code should be kept under 500 lines total. For larger contexts, prefer listing source file paths under "Source Files" rather than inlining code. OpenCode can read those files itself.

```markdown
# OpenCode Task

## Goal
[Clear, specific description of what to produce]

## Files to Create
- path/to/file1.ext
- path/to/file2.ext

## Files to Modify
- path/to/existing.ext (describe what to change)

## Reference Code (follow this pattern exactly)
[Copy-pasted code from actual project files, wrapped in fenced code blocks.
Keep under 500 lines. For larger references, use Source Files instead.]

## Source Files (read these for context)
- path/to/source1.ext
- path/to/source2.ext

## Conventions
[Project-specific rules: naming, imports, patterns, style]

## Constraints
[Guard rails: what NOT to do, what NOT to modify]
```

**Note:** Model and working directory are NOT specified in the task file — they are passed as CLI flags to the dispatch script. The task file focuses on *what* to do, the script handles *how* to invoke.

On retry, Claude Code:
1. Updates "Files to Create/Modify" to reflect current state (some files may already exist from prior attempt)
2. Appends a feedback section:
```markdown
## Previous Attempt Feedback
[What went wrong, which specific files need correction, what to fix]
```

## 4. Helper Script

**File:** `~/.claude/skills/opencode/opencode-dispatch.sh`

### Interface
```bash
opencode-dispatch.sh <task-file> <working-dir> [timeout-seconds]
# timeout defaults to 120
# Exit 0 = opencode process completed (does NOT guarantee task quality)
# Exit 1 = opencode failed or timed out
# Exit 2 = pre-flight failure (opencode not found, bad working dir)
# Always prints log file path to stdout
```

### Pre-Flight Checks
1. Verify `opencode` binary is in PATH — exit 2 with descriptive error if not found
2. Verify working directory exists and is accessible — exit 2 if not

### Invocation
The script invokes OpenCode using proper CLI flags:
```bash
opencode run \
  -m "MiniMax-M2.5-highspeed" \
  --dir "$working_dir" \
  -f "$task_file" \
  -- "Execute all instructions in the attached task file. Do not ask questions, just execute."
```

Key details:
- `-m` flag selects the model (not specified in the task file)
- `--dir` sets the working directory (not `cd`)
- `-f` attaches the task file directly (more reliable than asking the agent to read a path)
- `--` separates flags from the positional prompt message
- All variables are properly quoted to prevent shell escaping issues

### Other Responsibilities
- Generate UUID via `uuidgen` (fallback: `date +%s%N`)
- Enforce timeout (kill OpenCode if it exceeds limit)
- Capture stdout+stderr to `/tmp/opencode-log-<uuid>.txt`
- Print log file path to stdout

### Does NOT Handle
- Task file content (Claude Code writes this)
- Review logic (Claude Code reads and judges output)
- Retry decisions (Claude Code decides)
- Cleanup — Claude Code deletes task file and log file when done (they may be needed for retries)

## 5. Review Protocol

```
OpenCode exits
├── Non-zero exit / timeout
│   └── Read log → diagnose
│       ├── Unclear prompt → rewrite task file, retry
│       └── Capability issue → Claude Code does it
│
└── Exit 0
    ├── CHECK 1: Files exist as specified?
    │   └── Missing → retry with reminder
    ├── CHECK 2: Follows reference pattern?
    │   └── Minor deviation → fix inline
    │   └── Major deviation → retry with stricter instructions
    ├── CHECK 3: Conventions respected?
    │   └── Minor → fix inline, Major → retry
    └── CHECK 4: No unintended changes?
        └── Extra modifications → revert, retry or do manually
```

**Retry budget:** 2 retries max (3 total attempts). Feedback from each failed attempt is appended to the task file for the next attempt.

**Fallback:** After 3 failures, Claude Code takes over silently. No infinite delegation loops.

## 6. File Structure

### Skill (global)
```
~/.claude/skills/opencode/
├── SKILL.md                    # Main skill document
├── opencode-dispatch.sh        # Helper script
└── references/
    └── task-file-template.md   # Template for task files
```

### Spec docs (per-project, for discoverability)
Copy the design spec into `docs/superpowers/specs/` in each major codebase:
- `control-plane-go/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `agent-factory/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `agent-factory-go/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `starboard/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `control-plane-ui/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `claude-agent-sdk-go/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `claude-agent-sdk-python/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `otaku/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`
- `tripper/docs/superpowers/specs/2026-03-16-opencode-orchestrator-design.md`

## 7. Configuration (Hardcoded for v1)

| Parameter | Value | Location |
|-----------|-------|----------|
| Default model | MiniMax-M2.5-highspeed | Script -m flag |
| Timeout | 120 seconds | Script argument |
| Max retries | 2 | SKILL.md logic |
| Task file location | /tmp/opencode-task-*.md | Script |
| Log file location | /tmp/opencode-log-*.txt | Script |

## Future Considerations (v2)

- Parallel dispatch for truly independent task groups
- Config file for model/timeout/retry preferences per project
- Task history log (JSON) for analytics on delegation patterns
- Model fallback chain (try fast model first, fall back to capable model on failure)
