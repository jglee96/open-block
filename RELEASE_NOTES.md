# Release Notes

This file is the single source of truth for feature status and development history.
All LLM tools and human developers should update this file at the end of each work session.

## Project
- Name: `open-block`
- Runtime: WebGPU (frontend) + Rust/WASM world worker
- Current package version: `0.1.0`

## Milestone Status (P0 -> P2)

| Milestone | Status | Scope | Last Updated |
| --- | --- | --- | --- |
| P0 Core stability | In Progress | render safety, interaction safety, HUD, diagnostics | 2026-03-08 |
| P1 First-day loop | In Progress | crafting, smelting, basic survival stats, basic entities | 2026-03-08 |
| P2 quality/scale | In Progress | save/load, worker recovery, chunk batching, optimization | 2026-03-08 |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## Feature Checklist

### P0 Core stability
- [x] Target data split (`block | entity | null`)
- [x] Invalid coordinate guard (`NaN`, `Infinity`) before render usage
- [x] Render loop exception isolation (`try/catch/finally`)
- [x] Unified interaction path (block break/place + entity interact)
- [x] HUD extension (target, fps, diagnostics)
- [x] Worker diagnostics channel (`FRAME_DIAGNOSTICS`)

### P1 First-day loop
- [x] Minimal crafting messages/protocol (`CRAFT`)
- [x] Minimal smelting protocol (`SMELT_START`, `SMELT_COLLECT`)
- [x] Basic player stats sync (`PLAYER_STATS`)
- [x] Basic entity snapshot sync (`ENTITY_SNAPSHOT`)
- [x] Minimal entity interaction (`INTERACT_ENTITY`)
- [ ] Proper recipe progression UX (inventory/crafting table UI)
- [ ] Full survival balancing (damage/hunger/day-night tuning)

### P2 quality/scale
- [x] Save/load message flow (`STATE_SNAPSHOT`, `LOAD_STATE`, `REQUEST_STATE`)
- [x] Local persistence in browser (`localStorage`)
- [x] Worker restart/reconnect loop
- [x] Chunk request batching queue
- [ ] Stress-tested entity scale target (50 entities stable FPS)
- [ ] Robust device-lost state restoration

## Release Log

## [Unreleased]

### Added
- Protocol expansion for gameplay and diagnostics:
  - Main->Worker: `TICK`, `CRAFT`, `SMELT_START`, `SMELT_COLLECT`, `INTERACT_ENTITY`, `COLLECT_ITEM`, `SLEEP`, `LOAD_STATE`, `REQUEST_STATE`
  - Worker->Main: `INVENTORY_SYNC`, `ENTITY_SNAPSHOT`, `PLAYER_STATS`, `FRAME_DIAGNOSTICS`, `STATE_SNAPSHOT`
- `TargetHit` type and entity/block target arbitration.
- New gameplay item/recipe module for minimal crafting loop.
- Save snapshot persistence key: `open-block/save-v1`.

### Changed
- Project naming switched from `web-minecraft` to `open-block`.
- Highlight rendering now uses its own uniform/bind group and validates bounds.
- Raycast returns `distance` for nearest target arbitration.
- HUD now reports target, fps, stats, inventory summary, and diagnostics.

### Fixed
- Guarded render path against invalid target coordinates and frame exceptions that could cause black-screen behavior.

### Verification
- 2026-03-08: `npm run build` passed.

### Known Gaps
- Entity visuals are logic-synced, but no dedicated entity mesh renderer yet.
- Crafting/smelting currently rely on keybind workflow, not full UI.
- Survival systems are intentionally simplified and need balancing.

### Next Priority
1. Add entity renderer and culling for visible feedback parity.
2. Add inventory/crafting/furnace UI flow (not only key shortcuts).
3. Add device-lost recovery state replay tests.

## Entry Template (copy for each session)

```md
## [YYYY-MM-DD HH:MM KST] Session Title
### Goal
- 

### Completed
- 

### Changed Files
- 

### Verification
- Command:
- Result:

### Risks / Known Issues
- 

### Next Actions
1. 
2. 
```
