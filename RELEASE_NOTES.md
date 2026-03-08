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
- [ ] Partial: contextual next-step onboarding hints
- [ ] Missing: milestone-driven checklist UI with explicit completion tracking

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
- [x] Done: renewable food sources and crop loop

### Shelter / night / combat
- [x] Done: day/night state and hostile night pressure
- [x] Done: bed-owned sleep action
- [ ] Partial: simple entity combat and drops
- [ ] Missing: defensive shelter validation beyond basic cover check

### Exploration & progression
- [ ] Partial: chunk exploration and save/load persistence
- [ ] Missing: biome-driven progression goals, villages, structures

### Farming / renewable food
- [x] Done: crops and seeds
- [ ] Partial: water-aware farming
- [x] Done: animal breeding

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
- Basic crop growth and bread crafting extend the food loop beyond mob drops.
- Farming now includes hoe-based tilling and hydration checks using natural water pools.
- Animals can now breed with wheat, producing baby animals that grow into adults over time.

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
- Farming is still intentionally minimal: no durability and no explicit hydration HUD yet.

### Next Priority
1. Add entity renderer and culling for visible feedback parity.
2. Add entity feedback for fed/breed-ready animals.
3. Add device-lost recovery state replay tests.

## [2026-03-08 22:50 KST] Crop Rendering Pass
### Goal
- Make farm progress readable in-world by rendering crop stages as plants instead of full cubes.

### Completed
- Added mesher-side crop rendering that emits crossed plant quads for wheat stages instead of opaque cube faces.
- Varied crop height by growth stage so early and mature wheat look visually distinct without changing gameplay rules.
- Added a Rust mesh regression test that fixes the expected crossed-quad vertex count for crop blocks.

### Changed Files
- `RELEASE_NOTES.md`
- `crates/mc-core/src/mesher.rs`

### Verification
- Command: `cargo test`
- Result: passed (8 tests)
- Command: `npm run build`
- Result: passed
- Command: `npm run wasm`
- Result: passed

### Risks / Known Issues
- Crops now read correctly as plants, but there is still no dedicated entity renderer, so livestock state changes remain logic-only.
- The crossed-plane mesh is intentionally simple and does not yet include sway, texture variation, or instancing.

### Next Actions
1. Add simple visual feedback for fed/breed-ready animals.
2. Add a visible checklist panel for tutorial milestone completion.
3. Add device-lost recovery state replay tests.

## [2026-03-08 22:35 KST] Tutorial Hint Pass
### Goal
- Make the survival loop legible in-game so the tutorial-based progression remains discoverable without external keybind notes.

### Completed
- Added contextual tutorial hints that react to inventory, tools, furnace state, hunger pressure, and night-time bed availability.
- Updated the initial ready-state message to explicitly point players at `E` for the inventory and crafting flow.
- Moved onboarding logic into a small gameplay helper so UI text stays derived from actual progression state instead of hard-coded strings.

### Changed Files
- `RELEASE_NOTES.md`
- `src/gameplay/tutorial.ts`
- `src/main.ts`
- `src/ui/game-ui.ts`

### Verification
- Command: `npm run build`
- Result: pending

### Risks / Known Issues
- Hints are intentionally single-step and priority-ordered; they do not yet show a persistent checklist or completed milestones.
- The hint system is inventory-driven, so it can only infer progress, not explain spatial tasks like "build a 3-block-high wall" with precision.

### Next Actions
1. Promote tutorial hints into a visible checklist panel with completed milestone markers.
2. Add crop-specific rendering so farm progress reads clearly from a distance.
3. Add entity render feedback so breeding and combat state changes are visible in-world.

## [2026-03-08 22:20 KST] Animal Breeding Pass
### Goal
- Extend the tutorial-aligned renewable food loop from crops into livestock so wheat has a second progression use beyond bread.

### Completed
- Added `wheat` as a hotbar-selectable interaction item for animal feeding.
- Extended entity snapshots/save state with baby growth and breeding cooldown fields while preserving backward-compatible defaults for existing saves.
- Added `breed` as a worker interaction action for pigs and sheep, consuming wheat, pairing nearby fed adults, and spawning baby animals.
- Grew baby animals into adults over time and reduced drops from baby livestock so breeding has an actual progression tradeoff.

### Changed Files
- `RELEASE_NOTES.md`
- `src/app/interaction-controller.ts`
- `src/gameplay/items.ts`
- `src/ui/game-ui.ts`
- `src/worker/game-session.ts`
- `src/worker/protocol.ts`

### Verification
- Command: `npm run build`
- Result: passed
- Command: `cargo test`
- Result: passed (7 tests)

### Risks / Known Issues
- Breeding is intentionally simplified: animals do not path toward feed, and the "in love" state is only visible indirectly through the resulting baby spawn.
- There is still no dedicated entity renderer, so baby/adult differences are reflected in targeting/state only.

### Next Actions
1. Add crop-specific rendering so farmland and crop stages read clearly in the world.
2. Add simple visual feedback for fed/breed-ready animals.
3. Add a lightweight entity-state regression test path around save/load compatibility.

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

## [2026-03-08 21:30 KST] Main.ts Decomposition Interaction Pass
### Goal
- Continue slimming `src/main.ts` by extracting mouse interaction rules and per-frame gameplay state updates.

### Completed
- Added `GameplayRuntime` to own per-frame movement, targeting, highlight updates, FPS tracking, and worker tick payload generation.
- Added `InteractionController` to own break/place/entity interaction rules and hotbar-aware placement checks.
- Reduced `src/main.ts` to loop orchestration, render submission, and cross-module wiring.

### Changed Files
- `src/main.ts`
- `src/app/gameplay-runtime.ts`
- `src/app/interaction-controller.ts`

### Verification
- Command: `npm run build`
- Result: passed
- Command: `cargo test`
- Result: passed (6 tests)

### Risks / Known Issues
- `main.ts` still owns DOM event wiring and render-pass submission, so it remains the highest-change integration point.
- No TypeScript unit tests yet cover the new runtime/controller modules.

### Next Actions
1. Remove legacy `SET_BLOCK` and `COLLECT_ITEM` messages from protocol and worker if no code path still requires them.
2. Add TypeScript tests for `ChunkStreamingController`, `GameplayRuntime` helpers, and `InteractionController`.
3. Consider an `engine/bootstrap` module so `main.ts` becomes a minimal startup file.

## [2026-03-08 21:45 KST] Renewable Food Loop Pass
### Goal
- Continue gameplay implementation by adding a basic renewable food source so hunger progression no longer depends only on mob drops.

### Completed
- Added `wheat_seeds`, `wheat`, and `bread` items plus bread crafting and food values.
- Added farmland and staged wheat crop blocks, including seed planting from the hotbar, timed crop growth, and mature crop harvesting.
- Added grass seed drops and crop save/load persistence so farming survives normal world snapshots.
- Updated solidity/opacity rules so crop blocks do not behave like full collision cubes.

### Changed Files
- `src/gameplay/items.ts`
- `src/hotbar.ts`
- `src/app/block-cache.ts`
- `src/worker/protocol.ts`
- `src/worker/game-session.ts`
- `crates/mc-core/src/block.rs`
- `RELEASE_NOTES.md`

### Verification
- Command: `npm run build`
- Result: passed
- Command: `cargo test`
- Result: passed (6 tests)
- Command: `npm run wasm`
- Result: passed

### Risks / Known Issues
- Farming is deliberately simplified: seeds auto-till dirt/grass, crops do not check nearby water, and growth is purely timer-driven.
- Crop visuals still use cube meshing, so they read as blocky crop columns rather than Minecraft-style cross-plane plants.

### Next Actions
1. Add hydration/hoe rules and clearer farmland degradation behavior.
2. Add visual treatment for crops that does not rely on full cube geometry.
3. Add breeding or another renewable food source to deepen the survival loop.

## [2026-03-08 22:00 KST] Farming Rules Pass
### Goal
- Continue the renewable food implementation by turning farming from a placeholder into a more rule-based loop with tools and hydration.

### Completed
- Added `wooden_hoe` and `stone_hoe` recipes plus hotbar support for tool-based tilling.
- Added `TILL_BLOCK` flow so farmland is created by right-clicking dirt/grass with a hoe rather than auto-tilling on seed placement.
- Restricted seed planting to farmland only and added farmland hydration checks, drying timers, and reversion to dirt when unplanted soil stays dry.
- Added simple natural water generation in world terrain so hydration has real world inputs.

### Changed Files
- `src/gameplay/items.ts`
- `src/worker/protocol.ts`
- `src/worker/game.worker.ts`
- `src/worker/game-session.ts`
- `src/app/interaction-controller.ts`
- `crates/mc-core/src/world/terrain.rs`
- `crates/mc-core/src/world/mod.rs`
- `RELEASE_NOTES.md`

### Verification
- Command: `npm run build`
- Result: passed
- Command: `cargo test`
- Result: passed (7 tests)
- Command: `npm run wasm`
- Result: passed

### Risks / Known Issues
- Water generation is simple lowland flooding, so it behaves more like broad shallow pools than authored ponds or rivers.
- Crop blocks still use cube meshing, so hydrated farming plays correctly but does not yet look close to Minecraft crops.

### Next Actions
1. Add crop-specific rendering that avoids full cube silhouettes.
2. Add breeding or another non-crop renewable food loop.
3. Remove legacy `SET_BLOCK` and `COLLECT_ITEM` protocol paths if they are no longer necessary.

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
