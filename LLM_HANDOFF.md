# LLM Handoff Guide

Use this file to continue development with any LLM tool (Codex, Claude Code, Cursor, etc.).

## Read Order (must follow)
1. `RELEASE_NOTES.md`
2. `LLM_HANDOFF.md`
3. `src/worker/protocol.ts`
4. `src/main.ts`
5. `src/worker/game.worker.ts`

## Session Rules
- Do not start coding before reading the latest `Release Log` in `RELEASE_NOTES.md`.
- At end of each coding session, append a new entry using the template in `RELEASE_NOTES.md`.
- Keep milestone checkboxes current. Never mark done without verification evidence.
- If behavior changed but tests were not run, write it explicitly in Verification.

## Definition of Done for a Session
A session is complete only when all are true:
- Code changes are applied.
- `RELEASE_NOTES.md` is updated.
- Verification command output is summarized.
- Next actions are listed.

## Required Session Output Format
Every LLM session should end with this exact structure in `RELEASE_NOTES.md`:
- Goal
- Completed
- Changed Files
- Verification
- Risks / Known Issues
- Next Actions

## Branch / Commit Convention (recommended)
- Branch: `codex/<short-topic>`
- Commit title: `<scope>: <change summary>`

Examples:
- `render: guard invalid target bounds in highlight path`
- `worker: add inventory sync and player stats messages`

## Current Technical Notes
- Rendering: WebGPU terrain pipeline + separate highlight pipeline.
- World simulation: Rust/WASM chunk mesh generation in worker.
- Gameplay: currently minimal and simulation-oriented (not full production UX).
- Persistence: browser `localStorage` snapshot via worker messages.

## If Blocked
When blocked, write a blocker entry in `RELEASE_NOTES.md` with:
- exact error,
- what was attempted,
- smallest next unblocking step.
