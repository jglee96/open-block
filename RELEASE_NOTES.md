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
- [x] Proper recipe progression UX (inventory/crafting table UI)
- [ ] Full survival balancing (damage/hunger/day-night tuning)

### P2 quality/scale
- [x] Save/load message flow (`STATE_SNAPSHOT`, `LOAD_STATE`, `REQUEST_STATE`)
- [x] Local persistence in browser (`localStorage`)
- [x] Worker restart/reconnect loop
- [x] Chunk request batching queue
- [ ] Stress-tested entity scale target (50 entities stable FPS)
- [ ] Robust device-lost state restoration

## Tutorial Coverage Checklist

Status values: `Done`, `Partial`, `Missing`, `Deferred`.

### Onboarding & first day
- [x] Done: gather wood from world trees
- [x] Done: open inventory and craft first tools from UI
- [x] Done: place gathered blocks from hotbar/inventory counts
- [ ] Partial: first-night shelter loop (manual building + sleep item)
- [ ] Missing: explicit step-by-step onboarding/tutorial prompts

### Resource gathering & mining
- [x] Done: hand-break basic surface blocks and logs
- [x] Done: stone gated behind pickaxe progression
- [ ] Partial: mining loop stops at stone-tier tools only
- [ ] Missing: ore generation and ore-specific progression

### Crafting & workstations
- [x] Done: inventory crafting UI
- [x] Done: crafting-table-gated recipe progression
- [x] Done: furnace UI and smelt collect flow
- [ ] Partial: crafting table / furnace exist as inventory stations, not world blocks

### Food / hunger / smelting
- [x] Done: hunger drain and food consumption
- [x] Done: raw vs cooked meat hunger recovery
- [ ] Partial: manual smelting with limited fuel/input set
- [ ] Missing: renewable food sources and crop loop

### Shelter / night / combat
- [x] Done: day/night state and hostile night pressure
- [x] Done: bed-owned sleep action
- [ ] Partial: simple entity combat and drops
- [ ] Missing: defensive shelter validation beyond basic cover check

### Exploration & progression
- [ ] Partial: chunk exploration and save/load persistence
- [ ] Missing: biome-driven progression goals, villages, structures

### Farming / renewable food
- [ ] Missing: crops, seeds, water-based farming, animal breeding

### Advanced progression
- [ ] Missing: armor, durability, ore tiers beyond stone
- [ ] Missing: Nether / End progression
- [ ] Missing: redstone, enchanting, automation
- [ ] Deferred: entity renderer and advanced combat feedback

## Release Log

## [Unreleased]

### Added
- Protocol expansion for gameplay and diagnostics:
  - Main->Worker: `TICK`, `CRAFT`, `SMELT_START`, `SMELT_COLLECT`, `INTERACT_ENTITY`, `COLLECT_ITEM`, `SLEEP`, `LOAD_STATE`, `REQUEST_STATE`
  - Worker->Main: `INVENTORY_SYNC`, `ENTITY_SNAPSHOT`, `PLAYER_STATS`, `FRAME_DIAGNOSTICS`, `STATE_SNAPSHOT`
- `TargetHit` type and entity/block target arbitration.
- New gameplay item/recipe module for minimal crafting loop.
- Save snapshot persistence key: `open-block/save-v1`.
- Worker-authoritative survival actions: `BREAK_BLOCK`, `PLACE_ITEM`, `CONSUME_ITEM`.
- Inventory overlay with crafting, furnace, and action panels.
- Tree world generation with `Log` / `Leaves` blocks and spawn-adjacent wood access.

### Changed
- Project naming switched from `web-minecraft` to `open-block`.
- Highlight rendering now uses its own uniform/bind group and validates bounds.
- Raycast returns `distance` for nearest target arbitration.
- HUD now reports target, fps, stats, inventory summary, and diagnostics.
- Survival progression now starts from empty inventory instead of seeded resources.
- Block breaking, drops, and block placement are validated in the worker rather than the client.
- Hotbar now reflects inventory-backed placeable items only.

### Fixed
- Guarded render path against invalid target coordinates and frame exceptions that could cause black-screen behavior.
- Removed client-side fake progression where breaking, drops, and placement bypassed inventory/tool rules.

### Verification
- 2026-03-08: `npm run build` passed.
- 2026-03-08: `cargo test` passed (6 tests).
- 2026-03-08: `npm run wasm` passed.

### Known Gaps
- Entity visuals are logic-synced, but no dedicated entity mesh renderer yet.
- Survival systems are intentionally simplified and need balancing.
- Crafting table, furnace, and bed are inventory-state abstractions rather than placed world blocks.

### Next Priority
1. Add entity renderer and culling for visible feedback parity.
2. Add renewable food / farming loop so hunger progression does not rely only on mob drops.
3. Add device-lost recovery state replay tests.

## [2026-03-08 20:55 KST] Tutorial Coverage Checklist + Phase 1 Survival Loop
### Goal
- Replace fake first-day survival shortcuts with a worker-authoritative loop based on real world gathering, inventory UI, and tool-gated progression.

### Completed
- Added tutorial coverage checklist grouped by survival progression areas.
- Moved break/place/consume authority to the worker and removed client-side instant drop/place behavior.
- Added `Log` and `Leaves` blocks plus deterministic tree generation near spawn.
- Reworked progression rules for hand harvesting, pickaxe-gated stone, crafting-table-gated recipes, and inventory-backed hotbar placement.
- Added DOM inventory overlay for inventory, crafting, furnace, and player actions including eating and sleeping.

### Changed Files
- `RELEASE_NOTES.md`
- `index.html`
- `src/gameplay/items.ts`
- `src/hotbar.ts`
- `src/main.ts`
- `src/worker/game.worker.ts`
- `src/worker/protocol.ts`
- `crates/mc-core/src/block.rs`
- `crates/mc-core/src/world.rs`

### Verification
- Command: `npm run build`
- Result: passed
- Command: `cargo test`
- Result: passed (6 tests)
- Command: `npm run wasm`
- Result: passed

### Risks / Known Issues
- Existing browser saves using old seeded inventories still load because save version remains `1`; manual reset may be needed to experience the fresh-start loop cleanly.
- Workstations remain inventory abstractions, so tutorial parity is still partial.

### Next Actions
1. Add explicit onboarding prompts tied to tutorial checklist milestones.
2. Add renewable food systems and broader fuel/input support.
3. Add entity rendering so combat and hunting have visible world feedback.

## [2026-03-08 21:10 KST] Option 1 Architecture Cleanup
### Goal
- Keep the no-React path and reorganize the TypeScript and Rust code so rendering stays low-level while UI, worker orchestration, and world-generation rules have clearer boundaries.

### Completed
- Split browser-side responsibilities into `app` and `ui` modules so `src/main.ts` acts as a composition root instead of holding UI rendering, persistence, targeting, and cache logic directly.
- Moved worker simulation state and gameplay use cases into `GameSession`, leaving `game.worker.ts` as a thin message adapter.
- Refactored Rust world generation into `world/terrain.rs` and `world/foliage.rs` behind `world/mod.rs` so terrain filling and tree placement are isolated implementation modules.

### Changed Files
- `src/main.ts`
- `src/app/block-cache.ts`
- `src/app/persistence.ts`
- `src/app/targeting.ts`
- `src/ui/game-ui.ts`
- `src/worker/game.worker.ts`
- `src/worker/game-session.ts`
- `crates/mc-core/src/world/mod.rs`
- `crates/mc-core/src/world/terrain.rs`
- `crates/mc-core/src/world/foliage.rs`

### Verification
- Command: `npm run build`
- Result: passed
- Command: `cargo test`
- Result: passed (6 tests)
- Command: `npm run wasm`
- Result: passed

### Risks / Known Issues
- Architecture boundaries are cleaner, but the renderer and gameplay loop are still coupled through `src/main.ts`; further splitting into engine-specific modules is still possible if the code grows.
- The old `crates/mc-core/src/world.rs` path was replaced by a module directory, so any external references to that exact path would need updating.

### Next Actions
1. Extract chunk streaming and worker connection management from `src/main.ts` into dedicated engine/application modules.
2. Add lightweight unit tests for the new TypeScript pure helpers (`block-cache`, targeting, inventory UI mapping).
3. Reduce the remaining worker protocol surface by removing legacy `SET_BLOCK` and `COLLECT_ITEM` paths if they are no longer needed.

## [2026-03-08 21:20 KST] Main.ts Decomposition Follow-up
### Goal
- Continue the no-React cleanup by extracting chunk streaming and worker lifecycle code out of `src/main.ts`.

### Completed
- Added `ChunkStreamingController` to own chunk request queueing, retention, and streaming cadence.
- Added `GameWorkerClient` to own worker connection, ready-state dispatch, and restart logic.
- Simplified `src/main.ts` so it primarily wires renderer, input, UI, chunk streaming, and worker events together.

### Changed Files
- `src/main.ts`
- `src/app/chunk-streaming.ts`
- `src/app/game-worker-client.ts`

### Verification
- Command: `npm run build`
- Result: passed
- Command: `cargo test`
- Result: passed (6 tests)

### Risks / Known Issues
- `main.ts` is smaller, but input interaction and frame-loop gameplay orchestration still live in one file.
- Worker protocol still includes legacy messages that the new flow no longer needs in normal gameplay paths.

### Next Actions
1. Extract interaction handling (`break/place/entity interact`) and frame HUD orchestration from `src/main.ts`.
2. Remove legacy `SET_BLOCK` and `COLLECT_ITEM` messages if no remaining callers need them.
3. Add small TypeScript tests around the new controllers before further refactors.

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
