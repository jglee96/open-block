import {
  BLOCK_TYPE,
  getCropStage,
  getEdibleHunger,
  getHarvestRule,
  getPlaceableBlockType,
  getRecipe,
  isCropBlockType,
  isPlantBlockType,
  isHoeItem,
  type ItemId,
} from "../gameplay/items";
import type {
  DroppedItemSnapshot,
  EntitySnapshot,
  FrameDiagnostics,
  SavedState,
  SmeltingState,
  Vec3,
  WorkerToMain,
} from "./protocol";

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const SAVE_STATE_VERSION = 2 as const;
const DAY_LENGTH_TICKS = 24_000;
const FULL_DAY_SECONDS = 600;
const NIGHT_START = 13_000;
const NIGHT_END = 23_000;
const CROP_GROWTH_MS = 15_000;
const FARMLAND_DRY_MS = 20_000;
const ITEM_PICKUP_DELAY_MS = 500;
const ITEM_PICKUP_RADIUS = 1.35;
const DROPPED_ITEM_GRAVITY = 18;
const DROPPED_ITEM_MAX_FALL_SPEED = 14;
const DEFAULT_SPAWN_X = 8.5;
const DEFAULT_SPAWN_Z = 8.5;
const FLUID_STEP_MAX_UPDATES = 512;
const PLAYER_HALF_WIDTH = 0.3;
const PLAYER_HEIGHT = 1.8;

interface EntityRuntime extends EntitySnapshot {
  vx: number;
  vz: number;
  wanderTimer: number;
}

interface PostMessageFn {
  (msg: WorkerToMain, transfer?: Transferable[]): void;
}

interface WorkerFrameDiagnostics {
  frameErrorCount: number;
  lastErrorCode: string | null;
}

interface CropPlotState {
  x: number;
  y: number;
  z: number;
  stage: number;
  growthMsRemaining: number;
}

interface FarmlandPlotState {
  x: number;
  y: number;
  z: number;
  dryMsRemaining: number | null;
}

interface DroppedItemRuntime {
  id: string;
  itemId: ItemId;
  count: number;
  position: Vec3;
  pickupDelayMs: number;
  vy: number;
}

type WasmWorld = import("mc-core").WasmWorld;

export class GameSession {
  private wasmWorld: WasmWorld | null = null;
  private initialized = false;
  private nextEntityId = 1;
  private nextDroppedItemId = 1;
  private readonly inventory = new Map<ItemId, number>();
  private smelting: SmeltingState | null = null;
  private readonly entities: EntityRuntime[] = [];
  private readonly droppedItems: DroppedItemRuntime[] = [];
  private readonly blockOverrides = new Map<string, { x: number; y: number; z: number; blockType: number }>();
  private readonly cropPlots = new Map<string, CropPlotState>();
  private readonly farmlandPlots = new Map<string, FarmlandPlotState>();
  private latestPlayerPos: Vec3 = { x: DEFAULT_SPAWN_X, y: 0, z: DEFAULT_SPAWN_Z };
  private lastBroadcastMs = 0;
  private lastStateSnapshotMs = 0;
  private pendingPickedUpItemId: ItemId | null = null;
  private queuedStatusMessage: string | null = null;
  private readonly stats = {
    health: 20,
    maxHealth: 20,
    hunger: 20,
    maxHunger: 20,
    timeOfDay: 6_000,
    isNight: false,
    isSheltered: false,
  };
  private readonly frameDiagnostics: WorkerFrameDiagnostics = {
    frameErrorCount: 0,
    lastErrorCode: null,
  };

  constructor(private readonly post: PostMessageFn) {}

  async init(seed: number) {
    const mcCore = await import("mc-core");
    await mcCore.default();
    this.wasmWorld = new mcCore.WasmWorld(seed);
    this.initialized = true;
    this.hydrateDefaultState();
    this.latestPlayerPos = this.getSpawnPosition();
    this.ensureEntityPopulation(this.latestPlayerPos);
    this.post({ type: "READY", spawn: this.latestPlayerPos });
    this.broadcastGameplay(true);
    this.postStateSnapshot();
  }

  requireReady() {
    if (!this.initialized) {
      throw new Error("World not initialised — send INIT first");
    }
  }

  generateChunk(chunkX: number, chunkZ: number) {
    const reply = this.buildChunkReply(chunkX, chunkZ);
    this.post(reply, [reply.solidBuffer, reply.waterBuffer, reply.blockData, reply.fluidData]);
  }

  setBlock(worldX: number, worldY: number, worldZ: number, blockType: number) {
    const world = this.getWorld();
    world.set_block(worldX, worldY, worldZ, blockType);
    this.setBlockOverride(worldX, worldY, worldZ, blockType);
    this.remeshTouchedChunks(worldX, worldZ);
  }

  breakBlock(worldX: number, worldY: number, worldZ: number) {
    const blockType = this.getBlockTypeAtWorld(worldX, worldY, worldZ);
    const rule = getHarvestRule(blockType);
    if (!rule) return;
    if (!rule.breakableByHand && !this.hasRequiredTool(blockType)) {
      this.setStatusMessage("This block needs a pickaxe.");
      this.broadcastGameplay(true);
      return;
    }
    if (blockType === BLOCK_TYPE.air || blockType === BLOCK_TYPE.bedrock) return;

    if (isCropBlockType(blockType)) {
      this.harvestCrop(worldX, worldY, worldZ, blockType);
      this.broadcastGameplay(true);
      return;
    }

    const world = this.getWorld();
    world.set_block(worldX, worldY, worldZ, BLOCK_TYPE.air);
    this.setBlockOverride(worldX, worldY, worldZ, BLOCK_TYPE.air);
    this.remeshTouchedChunks(worldX, worldZ);

    if (rule.drops) {
      this.spawnDrop(rule.drops, 1, {
        x: worldX + 0.5,
        y: worldY + 0.2,
        z: worldZ + 0.5,
      });
    }
    if (blockType === BLOCK_TYPE.shortGrass && this.shortGrassDropsSeeds(worldX, worldY, worldZ)) {
      this.spawnDrop("wheat_seeds", 1, {
        x: worldX + 0.5,
        y: worldY + 0.1,
        z: worldZ + 0.5,
      });
    }
    this.broadcastGameplay(true);
  }

  placeItem(worldX: number, worldY: number, worldZ: number, itemId: ItemId) {
    if (itemId === "wheat_seeds") {
      this.plantSeeds(worldX, worldY, worldZ);
      this.broadcastGameplay(true);
      return;
    }

    const blockType = getPlaceableBlockType(itemId);
    if (blockType === null) return;
    if (!this.hasItem(itemId, 1)) return;
    if (this.getBlockTypeAtWorld(worldX, worldY, worldZ) !== BLOCK_TYPE.air) return;
    if (this.getFluidLevelAtWorld(worldX, worldY, worldZ) > 0) return;

    const world = this.getWorld();
    world.set_block(worldX, worldY, worldZ, blockType);
    this.setBlockOverride(worldX, worldY, worldZ, blockType);
    this.removeItem(itemId, 1);
    this.remeshTouchedChunks(worldX, worldZ);
    this.broadcastGameplay(true);
  }

  tillBlock(worldX: number, worldY: number, worldZ: number, itemId: ItemId) {
    if (!isHoeItem(itemId) || !this.hasItem(itemId, 1)) {
      this.setStatusMessage("Equip a hoe before tilling soil.");
      this.broadcastGameplay(true);
      return;
    }
    const blockType = this.getBlockTypeAtWorld(worldX, worldY, worldZ);
    if (blockType !== BLOCK_TYPE.dirt && blockType !== BLOCK_TYPE.grass) {
      this.setStatusMessage("Till dirt or grass blocks to start farming.");
      this.broadcastGameplay(true);
      return;
    }
    if (this.getBlockTypeAtWorld(worldX, worldY + 1, worldZ) !== BLOCK_TYPE.air) {
      this.setStatusMessage("Clear the block above before tilling.");
      this.broadcastGameplay(true);
      return;
    }

    const world = this.getWorld();
    world.set_block(worldX, worldY, worldZ, BLOCK_TYPE.farmland);
    this.setBlockOverride(worldX, worldY, worldZ, BLOCK_TYPE.farmland);
    this.farmlandPlots.set(this.coordKey(worldX, worldY, worldZ), {
      x: worldX,
      y: worldY,
      z: worldZ,
      dryMsRemaining: null,
    });
    if (!this.isFarmlandHydrated(worldX, worldY, worldZ)) {
      this.setStatusMessage("Dry farmland won't grow crops. Move closer to water.");
    }
    this.remeshTouchedChunks(worldX, worldZ);
    this.broadcastGameplay(true);
  }

  tick(dt: number, playerPos: Vec3, isSheltered: boolean) {
    this.latestPlayerPos = playerPos;
    this.stats.isSheltered = isSheltered;
    const changed = this.advanceWorld(dt, playerPos);
    if (changed) {
      this.broadcastGameplay(true);
    }
    this.maybeBroadcastGameplay();
  }

  craft(recipeId: string, quantity: number) {
    const recipe = getRecipe(recipeId as never);
    if (!recipe) return;
    if (recipe.requiresCraftingTable && !this.hasItem("crafting_table", 1)) return;

    const safeQty = Math.max(1, Math.floor(quantity));
    for (let i = 0; i < safeQty; i++) {
      const canCraft = Object.entries(recipe.inputs).every(([itemId, count]) => this.hasItem(itemId as ItemId, count ?? 0));
      if (!canCraft) break;

      for (const [itemId, count] of Object.entries(recipe.inputs)) {
        if (count) this.removeItem(itemId as ItemId, count);
      }
      for (const [itemId, count] of Object.entries(recipe.outputs)) {
        if (count) this.addItem(itemId as ItemId, count);
      }
    }

    this.broadcastGameplay(true);
  }

  startSmelting(inputItem: ItemId, fuelItem: ItemId) {
    if (this.smelting) return;
    if (!this.hasItem("furnace", 1)) return;
    if (inputItem !== "raw_meat") return;
    if (!this.hasItem(inputItem, 1) || !this.hasItem(fuelItem, 1)) return;
    if (fuelItem !== "coal" && fuelItem !== "log" && fuelItem !== "planks") return;

    this.removeItem(inputItem, 1);
    this.removeItem(fuelItem, 1);

    const now = Date.now();
    this.smelting = {
      inputItem,
      outputItem: "cooked_meat",
      fuelItem,
      startedAtMs: now,
      readyAtMs: now + 6_000,
    };
    this.broadcastGameplay(true);
  }

  collectSmeltedOutput() {
    if (!this.smelting) return;
    if (Date.now() < this.smelting.readyAtMs) return;
    this.addItem(this.smelting.outputItem, 1);
    this.smelting = null;
    this.broadcastGameplay(true);
  }

  interactEntity(entityId: string, action: "attack" | "interact" | "breed") {
    const idx = this.entities.findIndex((entity) => entity.id === entityId);
    if (idx < 0) return;
    const entity = this.entities[idx];

    if (action === "breed") {
      this.tryBreedEntity(entity);
      return;
    }

    if (action === "interact") {
      if (entity.kind === "sheep" && !entity.isBaby) this.addItem("wool", 1);
      this.broadcastGameplay(true);
      return;
    }

    const damage = this.hasItem("stone_pickaxe", 1) ? 6 : this.hasItem("wooden_pickaxe", 1) ? 4 : 2;
    entity.health = Math.max(0, entity.health - damage);
    if (entity.health > 0) {
      this.broadcastGameplay(true);
      return;
    }

    if (entity.kind === "pig") {
      this.spawnDrop("raw_meat", entity.isBaby ? 1 : 2, entity.position);
    } else if (entity.kind === "sheep") {
      this.spawnDrop("wool", entity.isBaby ? 1 : 2, entity.position);
      this.spawnDrop("raw_meat", 1, entity.position);
    } else if (entity.kind === "zombie") {
      this.spawnDrop("coal", 1, entity.position);
    }

    this.entities.splice(idx, 1);
    this.broadcastGameplay(true);
  }

  collectItem(itemId: ItemId, count: number) {
    this.addItem(itemId, count);
    this.pendingPickedUpItemId = itemId;
    this.broadcastGameplay(true);
  }

  consumeItem(itemId: ItemId) {
    const hungerGain = getEdibleHunger(itemId);
    if (hungerGain <= 0) return;
    if (!this.removeItem(itemId, 1)) return;
    this.stats.hunger = this.clamp(this.stats.hunger + hungerGain, 0, this.stats.maxHunger);
    this.broadcastGameplay(true);
  }

  sleep() {
    if (!this.stats.isNight) return;
    if (!this.hasItem("bed", 1)) return;
    this.stats.timeOfDay = 1_000;
    this.stats.isNight = false;
    this.stats.health = this.clamp(this.stats.health + 8, 0, this.stats.maxHealth);
    this.broadcastGameplay(true);
  }

  loadState(state: SavedState) {
    if (state.version !== 1 && state.version !== SAVE_STATE_VERSION) return;

    this.stats.health = this.clamp(state.stats.health, 0, state.stats.maxHealth);
    this.stats.maxHealth = Math.max(1, state.stats.maxHealth);
    this.stats.hunger = this.clamp(state.stats.hunger, 0, state.stats.maxHunger);
    this.stats.maxHunger = Math.max(1, state.stats.maxHunger);
    this.stats.timeOfDay = ((state.stats.timeOfDay % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS;
    this.stats.isNight = state.stats.isNight;
    this.stats.isSheltered = state.stats.isSheltered;

    this.inventory.clear();
    for (const entry of state.inventory) {
      if (entry.count > 0) this.addItem(entry.itemId, entry.count);
    }

    this.smelting = state.smelting;

    this.entities.length = 0;
    for (const entity of state.entities) {
      this.entities.push({
        ...entity,
        isBaby: entity.isBaby ?? false,
        growUpAtMs: entity.growUpAtMs ?? null,
        breedReadyAtMs: entity.breedReadyAtMs ?? 0,
        loveUntilMs: entity.loveUntilMs ?? null,
        vx: 0,
        vz: 0,
        wanderTimer: 0,
      });
    }
    this.nextEntityId = this.computeNextEntityId();

    this.blockOverrides.clear();
    for (const override of state.blockOverrides) {
      this.setBlockOverride(override.x, override.y, override.z, override.blockType);
      this.getWorld().set_block(override.x, override.y, override.z, override.blockType);
    }

    this.cropPlots.clear();
    for (const crop of state.cropPlots ?? []) {
      this.cropPlots.set(this.coordKey(crop.x, crop.y, crop.z), {
        x: crop.x,
        y: crop.y,
        z: crop.z,
        stage: crop.stage,
        growthMsRemaining: crop.growthMsRemaining ?? Math.max(0, (crop.nextGrowthAtMs ?? 0) - Date.now()),
      });
    }

    this.farmlandPlots.clear();
    for (const plot of state.farmlandPlots ?? []) {
      this.farmlandPlots.set(this.coordKey(plot.x, plot.y, plot.z), {
        x: plot.x,
        y: plot.y,
        z: plot.z,
        dryMsRemaining: plot.dryMsRemaining ?? (plot.dryAtMs === null || plot.dryAtMs === undefined
          ? null
          : Math.max(0, plot.dryAtMs - Date.now())),
      });
    }

    this.droppedItems.length = 0;
    for (const item of state.droppedItems ?? []) {
      this.droppedItems.push({
        id: item.id,
        itemId: item.itemId,
        count: item.count,
        position: item.position,
        pickupDelayMs: item.pickupDelayMs ?? 0,
        vy: 0,
      });
    }
    this.nextDroppedItemId = this.computeNextDroppedItemId();
    this.latestPlayerPos = this.getSpawnPosition();

    this.broadcastGameplay(true);
    this.postStateSnapshot();
  }

  requestState() {
    this.postStateSnapshot();
  }

  handleError(code: string, err: unknown) {
    this.frameDiagnostics.frameErrorCount += 1;
    this.frameDiagnostics.lastErrorCode = code;
    this.post({ type: "FRAME_DIAGNOSTICS", diagnostics: this.frameDiagnostics });
    this.post({ type: "ERROR", message: `${code}: ${String(err)}` });
  }

  private getWorld(): WasmWorld {
    if (!this.wasmWorld) {
      throw new Error("World not initialised — send INIT first");
    }
    return this.wasmWorld;
  }

  private coordKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private chunkCoordsFromWorld(wx: number, wz: number): { cx: number; cz: number } {
    return { cx: Math.floor(wx / CHUNK_SIZE), cz: Math.floor(wz / CHUNK_SIZE) };
  }

  private setBlockOverride(x: number, y: number, z: number, blockType: number) {
    this.blockOverrides.set(this.coordKey(x, y, z), { x, y, z, blockType });
  }

  private buildChunkReply(chunkX: number, chunkZ: number) {
    const world = this.getWorld();
    const solidFloats = world.build_chunk_mesh(chunkX, chunkZ);
    const solidBuffer = solidFloats.buffer.slice(0) as ArrayBuffer;
    const solidVertexCount = solidFloats.length / 9;
    const waterFloats = world.build_water_mesh(chunkX, chunkZ);
    const waterBuffer = waterFloats.buffer.slice(0) as ArrayBuffer;
    const waterVertexCount = waterFloats.length / 9;
    const blockDataJs = world.get_chunk_blocks(chunkX, chunkZ);
    const blockData = blockDataJs ? (blockDataJs.buffer.slice(0) as ArrayBuffer) : new ArrayBuffer(0);
    const fluidDataJs = world.get_chunk_fluids(chunkX, chunkZ);
    const fluidData = fluidDataJs ? (fluidDataJs.buffer.slice(0) as ArrayBuffer) : new ArrayBuffer(0);

    return {
      type: "CHUNK_MESH" as const,
      chunkX,
      chunkZ,
      solidBuffer,
      solidVertexCount,
      waterBuffer,
      waterVertexCount,
      blockData,
      fluidData,
    };
  }

  private remeshTouchedChunks(worldX: number, worldZ: number) {
    this.getWorld();
    const { cx, cz } = this.chunkCoordsFromWorld(worldX, worldZ);
    const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((worldZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const chunksToRemesh: [number, number][] = [[cx, cz]];
    if (lx === 0) chunksToRemesh.push([cx - 1, cz]);
    if (lx === CHUNK_SIZE - 1) chunksToRemesh.push([cx + 1, cz]);
    if (lz === 0) chunksToRemesh.push([cx, cz - 1]);
    if (lz === CHUNK_SIZE - 1) chunksToRemesh.push([cx, cz + 1]);

    for (const [rcx, rcz] of chunksToRemesh) {
      const reply = this.buildChunkReply(rcx, rcz);
      this.post(reply, [reply.solidBuffer, reply.waterBuffer, reply.blockData, reply.fluidData]);
    }
  }

  private remeshChunkCoords(chunkCoords: Array<[number, number]>) {
    const seen = new Set<string>();
    for (const [chunkX, chunkZ] of chunkCoords) {
      const key = `${chunkX},${chunkZ}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reply = this.buildChunkReply(chunkX, chunkZ);
      this.post(reply, [reply.solidBuffer, reply.waterBuffer, reply.blockData, reply.fluidData]);
    }
  }

  private hydrateDefaultState() {
    this.inventory.clear();
    this.cropPlots.clear();
    this.farmlandPlots.clear();
    this.droppedItems.length = 0;
    this.entities.length = 0;
    this.nextEntityId = 1;
    this.nextDroppedItemId = 1;
    this.pendingPickedUpItemId = null;
    this.queuedStatusMessage = null;
    this.stats.health = 20;
    this.stats.hunger = 20;
    this.stats.timeOfDay = 6_000;
    this.stats.isNight = false;
    this.stats.isSheltered = false;
    this.smelting = null;
  }

  private addItem(itemId: ItemId, count: number) {
    if (count <= 0) return;
    this.inventory.set(itemId, (this.inventory.get(itemId) ?? 0) + count);
  }

  private hasItem(itemId: ItemId, count: number): boolean {
    return (this.inventory.get(itemId) ?? 0) >= count;
  }

  private removeItem(itemId: ItemId, count: number): boolean {
    const now = this.inventory.get(itemId) ?? 0;
    if (now < count) return false;
    const next = now - count;
    if (next === 0) this.inventory.delete(itemId);
    else this.inventory.set(itemId, next);
    return true;
  }

  private inventoryEntries() {
    return [...this.inventory.entries()]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([itemId, count]) => ({ itemId, count }));
  }

  private hasRequiredTool(blockType: number): boolean {
    const rule = getHarvestRule(blockType);
    if (!rule) return false;
    if (rule.requiresTool === "none") return true;
    if (rule.requiresTool === "wooden_pickaxe") {
      return this.hasItem("wooden_pickaxe", 1) || this.hasItem("stone_pickaxe", 1);
    }
    return false;
  }

  private ensureChunkGenerated(cx: number, cz: number) {
    const world = this.getWorld();
    if (!world.get_chunk_blocks(cx, cz)) {
      world.build_chunk_mesh(cx, cz);
    }
  }

  private getBlockTypeAtWorld(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK_TYPE.air;
    const override = this.blockOverrides.get(this.coordKey(wx, wy, wz));
    if (override) return override.blockType;
    const { cx, cz } = this.chunkCoordsFromWorld(wx, wz);
    this.ensureChunkGenerated(cx, cz);
    const chunk = this.getWorld().get_chunk_blocks(cx, cz);
    if (!chunk) return BLOCK_TYPE.air;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const idx = wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    return chunk[idx] ?? BLOCK_TYPE.air;
  }

  private getFluidLevelAtWorld(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const { cx, cz } = this.chunkCoordsFromWorld(wx, wz);
    this.ensureChunkGenerated(cx, cz);
    const chunk = this.getWorld().get_chunk_fluids(cx, cz);
    if (!chunk) return 0;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const idx = wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    return chunk[idx] ?? 0;
  }

  private isFluidAtWorld(wx: number, wy: number, wz: number): boolean {
    return this.getFluidLevelAtWorld(wx, wy, wz) > 0 || this.getBlockTypeAtWorld(wx, wy, wz) === BLOCK_TYPE.water;
  }

  private plantSeeds(worldX: number, worldY: number, worldZ: number) {
    if (!this.hasItem("wheat_seeds", 1)) {
      this.setStatusMessage("Break short grass to collect wheat seeds.");
      return;
    }
    if (this.getBlockTypeAtWorld(worldX, worldY, worldZ) !== BLOCK_TYPE.air) {
      this.setStatusMessage("Seeds need open space above the farmland.");
      return;
    }

    const soilBlock = this.getBlockTypeAtWorld(worldX, worldY - 1, worldZ);
    if (soilBlock !== BLOCK_TYPE.farmland) {
      this.setStatusMessage("Plant seeds on farmland, not raw dirt.");
      return;
    }

    const world = this.getWorld();
    world.set_block(worldX, worldY, worldZ, BLOCK_TYPE.wheatCrop0);
    this.setBlockOverride(worldX, worldY, worldZ, BLOCK_TYPE.wheatCrop0);
    this.farmlandPlots.set(this.coordKey(worldX, worldY - 1, worldZ), {
      x: worldX,
      y: worldY - 1,
      z: worldZ,
      dryMsRemaining: null,
    });
    this.cropPlots.set(this.coordKey(worldX, worldY, worldZ), {
      x: worldX,
      y: worldY,
      z: worldZ,
      stage: 0,
      growthMsRemaining: CROP_GROWTH_MS,
    });
    this.removeItem("wheat_seeds", 1);
    if (!this.isFarmlandHydrated(worldX, worldY - 1, worldZ)) {
      this.setStatusMessage("This crop needs water within four blocks to grow.");
    }
    this.remeshTouchedChunks(worldX, worldZ);
  }

  private harvestCrop(worldX: number, worldY: number, worldZ: number, blockType: number) {
    const stage = getCropStage(blockType) ?? 0;
    const world = this.getWorld();
    world.set_block(worldX, worldY, worldZ, BLOCK_TYPE.air);
    this.setBlockOverride(worldX, worldY, worldZ, BLOCK_TYPE.air);
    this.cropPlots.delete(this.coordKey(worldX, worldY, worldZ));
    this.remeshTouchedChunks(worldX, worldZ);

    if (stage >= 3) {
      this.spawnDrop("wheat", 2, { x: worldX + 0.5, y: worldY + 0.1, z: worldZ + 0.5 });
      this.spawnDrop("wheat_seeds", 1, { x: worldX + 0.5, y: worldY + 0.1, z: worldZ + 0.5 });
      return;
    }

    this.spawnDrop("wheat_seeds", 1, { x: worldX + 0.5, y: worldY + 0.1, z: worldZ + 0.5 });
  }

  private advanceCropGrowth(dt: number): boolean {
    const world = this.getWorld();
    const dtMs = dt * 1000;
    let changed = false;

    for (const farmland of [...this.farmlandPlots.values()]) {
      const cropBlock = this.getBlockTypeAtWorld(farmland.x, farmland.y + 1, farmland.z);
      const hydrated = this.isFarmlandHydrated(farmland.x, farmland.y, farmland.z);
      const hasCrop = isCropBlockType(cropBlock);

      if (hydrated) {
        farmland.dryMsRemaining = null;
        continue;
      }

      if (hasCrop) continue;
      if (farmland.dryMsRemaining === null) {
        farmland.dryMsRemaining = FARMLAND_DRY_MS;
        continue;
      }
      farmland.dryMsRemaining -= dtMs;
      if (farmland.dryMsRemaining > 0) continue;

      world.set_block(farmland.x, farmland.y, farmland.z, BLOCK_TYPE.dirt);
      this.setBlockOverride(farmland.x, farmland.y, farmland.z, BLOCK_TYPE.dirt);
      this.farmlandPlots.delete(this.coordKey(farmland.x, farmland.y, farmland.z));
      this.remeshTouchedChunks(farmland.x, farmland.z);
      changed = true;
    }

    for (const crop of this.cropPlots.values()) {
      if (crop.stage >= 3) continue;
      if (!this.isFarmlandHydrated(crop.x, crop.y - 1, crop.z)) continue;
      crop.growthMsRemaining -= dtMs;
      if (crop.growthMsRemaining > 0) continue;
      crop.stage += 1;
      crop.growthMsRemaining = CROP_GROWTH_MS;
      const blockType = this.blockTypeForCropStage(crop.stage);
      world.set_block(crop.x, crop.y, crop.z, blockType);
      this.setBlockOverride(crop.x, crop.y, crop.z, blockType);
      this.remeshTouchedChunks(crop.x, crop.z);
      changed = true;
    }
    return changed;
  }

  private blockTypeForCropStage(stage: number): number {
    switch (stage) {
      case 0:
        return BLOCK_TYPE.wheatCrop0;
      case 1:
        return BLOCK_TYPE.wheatCrop1;
      case 2:
        return BLOCK_TYPE.wheatCrop2;
      default:
        return BLOCK_TYPE.wheatCrop3;
    }
  }

  private ensureEntityPopulation(playerPos: Vec3) {
    if (this.entities.length > 0) return;

    const spawn: Array<{ kind: EntityRuntime["kind"]; x: number; y: number; z: number; hostile: boolean }> = [
      { kind: "sheep", x: playerPos.x + 3, y: this.surfaceYAt(playerPos.x + 3, playerPos.z - 4), z: playerPos.z - 4, hostile: false },
      { kind: "sheep", x: playerPos.x + 6, y: this.surfaceYAt(playerPos.x + 6, playerPos.z - 1), z: playerPos.z - 1, hostile: false },
      { kind: "pig", x: playerPos.x - 5, y: this.surfaceYAt(playerPos.x - 5, playerPos.z + 2), z: playerPos.z + 2, hostile: false },
      { kind: "pig", x: playerPos.x - 2, y: this.surfaceYAt(playerPos.x - 2, playerPos.z + 5), z: playerPos.z + 5, hostile: false },
      { kind: "zombie", x: playerPos.x + 8, y: this.surfaceYAt(playerPos.x + 8, playerPos.z + 7), z: playerPos.z + 7, hostile: true },
    ];

    for (const item of spawn) {
      this.entities.push({
        id: `e${this.nextEntityId++}`,
        kind: item.kind,
        position: { x: item.x, y: item.y, z: item.z },
        radius: 0.35,
        halfHeight: 0.9,
        health: item.kind === "zombie" ? 20 : 8,
        maxHealth: item.kind === "zombie" ? 20 : 8,
        hostile: item.hostile,
        isBaby: false,
        growUpAtMs: null,
        breedReadyAtMs: 0,
        loveUntilMs: null,
        vx: 0,
        vz: 0,
        wanderTimer: 0,
      });
    }
  }

  private advanceWorld(dt: number, playerPos: Vec3): boolean {
    const safeDt = Math.max(0, Math.min(0.2, dt));
    const now = Date.now();
    let changed = false;
    this.ensureEntityPopulation(playerPos);
    changed = this.advanceCropGrowth(safeDt) || changed;
    changed = this.advanceDroppedItems(safeDt, playerPos) || changed;
    const fluidDirtyPairs = Array.from(this.getWorld().step_fluids(FLUID_STEP_MAX_UPDATES)) as number[];
    if (fluidDirtyPairs.length > 0) {
      const dirtyChunks: Array<[number, number]> = [];
      for (let index = 0; index < fluidDirtyPairs.length; index += 2) {
        dirtyChunks.push([fluidDirtyPairs[index] ?? 0, fluidDirtyPairs[index + 1] ?? 0]);
      }
      this.remeshChunkCoords(dirtyChunks);
      changed = true;
    }

    const dayTickPerSecond = DAY_LENGTH_TICKS / FULL_DAY_SECONDS;
    this.stats.timeOfDay = (this.stats.timeOfDay + safeDt * dayTickPerSecond) % DAY_LENGTH_TICKS;
    this.stats.isNight = this.stats.timeOfDay >= NIGHT_START && this.stats.timeOfDay <= NIGHT_END;
    this.stats.hunger = this.clamp(this.stats.hunger - safeDt * 0.03, 0, this.stats.maxHunger);

    for (const entity of this.entities) {
      if (entity.isBaby && entity.growUpAtMs !== null && now >= entity.growUpAtMs) {
        entity.isBaby = false;
        entity.growUpAtMs = null;
        entity.radius = 0.35;
        entity.halfHeight = 0.9;
        entity.health = Math.max(entity.health, 8);
        entity.maxHealth = 8;
      }
      if (entity.loveUntilMs !== null && now >= entity.loveUntilMs) {
        entity.loveUntilMs = null;
      }

      const dx = playerPos.x - entity.position.x;
      const dz = playerPos.z - entity.position.z;
      const dist = Math.hypot(dx, dz);

      if (entity.hostile && this.stats.isNight && dist < 12) {
        const invDist = dist > 0.001 ? 1 / dist : 0;
        entity.vx = dx * invDist * 1.8;
        entity.vz = dz * invDist * 1.8;
      } else {
        entity.wanderTimer -= safeDt;
        if (entity.wanderTimer <= 0) {
          entity.wanderTimer = 1.5 + Math.random() * 2;
          const ang = Math.random() * Math.PI * 2;
          const speed = entity.hostile ? 0.8 : 0.5;
          entity.vx = Math.cos(ang) * speed;
          entity.vz = Math.sin(ang) * speed;
        }
      }

      entity.position.x += entity.vx * safeDt;
      entity.position.z += entity.vz * safeDt;

      if (Math.abs(entity.position.x - playerPos.x) > 20 || Math.abs(entity.position.z - playerPos.z) > 20) {
        entity.position.x = playerPos.x + (Math.random() * 8 - 4);
        entity.position.z = playerPos.z + (Math.random() * 8 - 4);
      }
    }

    const hostileNear = this.entities.some((entity) => {
      if (!entity.hostile || !this.stats.isNight) return false;
      const dx = playerPos.x - entity.position.x;
      const dz = playerPos.z - entity.position.z;
      return Math.hypot(dx, dz) < 2.2;
    });

    if (hostileNear && !this.stats.isSheltered) {
      this.stats.health = this.clamp(this.stats.health - safeDt * 2.0, 0, this.stats.maxHealth);
    } else if (this.stats.hunger > 14) {
      this.stats.health = this.clamp(this.stats.health + safeDt * 0.6, 0, this.stats.maxHealth);
    }

    if (this.stats.hunger <= 0) {
      this.stats.health = this.clamp(this.stats.health - safeDt * 0.5, 0, this.stats.maxHealth);
    }

    if (this.smelting && now >= this.smelting.readyAtMs + 30_000) {
      this.smelting = null;
      changed = true;
    }

    if (this.stats.health <= 0) {
      this.stats.health = this.stats.maxHealth;
      this.stats.hunger = this.stats.maxHunger;
      this.stats.timeOfDay = 6_000;
      this.latestPlayerPos = this.getSpawnPosition();
      this.setStatusMessage("You respawned at the campsite.");
      changed = true;
    }
    return changed;
  }

  private maybeBroadcastGameplay() {
    const now = Date.now();
    if (now - this.lastBroadcastMs > 120) {
      this.broadcastGameplay(false);
      this.lastBroadcastMs = now;
    }
    if (now - this.lastStateSnapshotMs > 3_000) {
      this.postStateSnapshot();
      this.lastStateSnapshotMs = now;
    }
  }

  private broadcastGameplay(force: boolean) {
    if (!force && Date.now() - this.lastBroadcastMs <= 120) return;

    this.post({
      type: "INVENTORY_SYNC",
      entries: this.inventoryEntries(),
      smelting: this.smelting,
      pickedUpItemId: this.pendingPickedUpItemId,
    });
    this.post({
      type: "ENTITY_SNAPSHOT",
      entities: this.entities.map(({ vx: _vx, vz: _vz, wanderTimer: _wt, ...snapshot }) => snapshot),
    });
    this.post({
      type: "DROPPED_ITEM_SNAPSHOT",
      items: this.droppedItemSnapshots(),
    });
    this.post({
      type: "PLAYER_STATS",
      stats: {
        health: this.stats.health,
        maxHealth: this.stats.maxHealth,
        hunger: this.stats.hunger,
        maxHunger: this.stats.maxHunger,
        timeOfDay: this.stats.timeOfDay,
        isNight: this.stats.isNight,
        isSheltered: this.stats.isSheltered,
      },
    });
    this.post({
      type: "FRAME_DIAGNOSTICS",
      diagnostics: {
        frameErrorCount: this.frameDiagnostics.frameErrorCount,
        lastErrorCode: this.frameDiagnostics.lastErrorCode,
      },
    });
    if (this.queuedStatusMessage) {
      this.post({ type: "STATUS", message: this.queuedStatusMessage });
      this.queuedStatusMessage = null;
    }
    this.pendingPickedUpItemId = null;
  }

  private saveState(): SavedState {
    return {
      version: SAVE_STATE_VERSION,
      stats: {
        health: this.stats.health,
        maxHealth: this.stats.maxHealth,
        hunger: this.stats.hunger,
        maxHunger: this.stats.maxHunger,
        timeOfDay: this.stats.timeOfDay,
        isNight: this.stats.isNight,
        isSheltered: this.stats.isSheltered,
      },
      inventory: this.inventoryEntries(),
      smelting: this.smelting,
      entities: this.entities.map(({ vx: _vx, vz: _vz, wanderTimer: _wt, ...snapshot }) => snapshot),
      blockOverrides: [...this.blockOverrides.values()],
      cropPlots: [...this.cropPlots.values()],
      farmlandPlots: [...this.farmlandPlots.values()],
      droppedItems: this.droppedItems.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        count: item.count,
        position: item.position,
        pickupDelayMs: item.pickupDelayMs,
      })),
    };
  }

  private postStateSnapshot() {
    this.post({ type: "STATE_SNAPSHOT", state: this.saveState() });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private isFarmlandHydrated(worldX: number, worldY: number, worldZ: number): boolean {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (this.isFluidAtWorld(worldX + dx, worldY, worldZ + dz)) {
          return true;
        }
      }
    }
    return false;
  }

  private advanceDroppedItems(dt: number, playerPos: Vec3): boolean {
    let moved = false;
    const collectedIndices: number[] = [];
    for (let i = 0; i < this.droppedItems.length; i++) {
      const item = this.droppedItems[i];
      moved = this.advanceDroppedItemPhysics(item, dt) || moved;
      item.pickupDelayMs = Math.max(0, item.pickupDelayMs - dt * 1000);
      if (item.pickupDelayMs > 0) continue;
      const dx = item.position.x - playerPos.x;
      const dy = item.position.y - playerPos.y;
      const dz = item.position.z - playerPos.z;
      if (Math.hypot(dx, dy * 0.5, dz) > ITEM_PICKUP_RADIUS) continue;
      this.addItem(item.itemId, item.count);
      this.pendingPickedUpItemId = item.itemId;
      this.setStatusMessage(`Picked up ${item.itemId.replace("_", " ")} x${item.count}.`);
      collectedIndices.push(i);
    }

    for (let i = collectedIndices.length - 1; i >= 0; i--) {
      this.droppedItems.splice(collectedIndices[i], 1);
    }
    return moved || collectedIndices.length > 0;
  }

  private droppedItemSnapshots(): DroppedItemSnapshot[] {
    return this.droppedItems.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      count: item.count,
      position: item.position,
      pickupReadyInMs: Math.max(0, item.pickupDelayMs),
    }));
  }

  private spawnDrop(itemId: ItemId, count: number, position: Vec3) {
    if (count <= 0) return;
    this.droppedItems.push({
      id: `d${this.nextDroppedItemId++}`,
      itemId,
      count,
      position: { x: position.x, y: position.y, z: position.z },
      pickupDelayMs: ITEM_PICKUP_DELAY_MS,
      vy: 0,
    });
  }

  private advanceDroppedItemPhysics(item: DroppedItemRuntime, dt: number): boolean {
    const prevY = item.position.y;
    const prevVy = item.vy;

    item.vy = Math.max(item.vy - DROPPED_ITEM_GRAVITY * dt, -DROPPED_ITEM_MAX_FALL_SPEED);
    const nextY = item.position.y + item.vy * dt;
    const landingY = this.findDroppedItemLandingY(item, nextY);

    if (landingY !== null) {
      item.position.y = landingY;
      item.vy = 0;
    } else {
      item.position.y = nextY;
    }

    return Math.abs(item.position.y - prevY) > 0.0001 || Math.abs(item.vy - prevVy) > 0.0001;
  }

  private findDroppedItemLandingY(item: DroppedItemRuntime, nextY: number): number | null {
    if (nextY > item.position.y) return null;

    const worldX = Math.floor(item.position.x);
    const worldZ = Math.floor(item.position.z);
    const startBlockY = Math.floor(item.position.y - 0.001);
    const endBlockY = Math.floor(nextY - 0.001);

    for (let worldY = startBlockY; worldY >= endBlockY; worldY--) {
      if (this.isDroppedItemSupportBlock(worldX, worldY, worldZ)) {
        return worldY + 1;
      }
    }

    return null;
  }

  private isDroppedItemSupportBlock(worldX: number, worldY: number, worldZ: number): boolean {
    if (worldY < 0) return true;
    const blockType = this.getBlockTypeAtWorld(worldX, worldY, worldZ);
    return blockType !== BLOCK_TYPE.air && !this.isFluidAtWorld(worldX, worldY, worldZ) && !isPlantBlockType(blockType);
  }

  private setStatusMessage(message: string) {
    this.queuedStatusMessage = message;
  }

  private shortGrassDropsSeeds(worldX: number, worldY: number, worldZ: number): boolean {
    let hash = Math.imul(worldX, 73_856_093) ^ Math.imul(worldY, 19_349_663) ^ Math.imul(worldZ, 83_492_791);
    hash ^= hash >>> 13;
    return Math.abs(hash) % 8 === 0;
  }

  private tryBreedEntity(entity: EntityRuntime) {
    if ((entity.kind !== "pig" && entity.kind !== "sheep") || entity.isBaby) return;
    if (!this.hasItem("wheat", 1)) return;

    const now = Date.now();
    if (entity.breedReadyAtMs > now) return;
    if (entity.loveUntilMs !== null && entity.loveUntilMs > now) return;

    this.removeItem("wheat", 1);
    entity.loveUntilMs = now + 12_000;

    const mate = this.entities.find((other) => {
      if (other.id === entity.id || other.kind !== entity.kind) return false;
      if (other.hostile || other.isBaby || other.breedReadyAtMs > now) return false;
      if (other.loveUntilMs === null || other.loveUntilMs <= now) return false;
      const dx = other.position.x - entity.position.x;
      const dz = other.position.z - entity.position.z;
      return Math.hypot(dx, dz) <= 6;
    });

    if (!mate) {
      this.broadcastGameplay(true);
      return;
    }

    entity.loveUntilMs = null;
    mate.loveUntilMs = null;
    entity.breedReadyAtMs = now + 45_000;
    mate.breedReadyAtMs = now + 45_000;

    this.entities.push({
      id: `e${this.nextEntityId++}`,
      kind: entity.kind,
      position: {
        x: (entity.position.x + mate.position.x) * 0.5 + (Math.random() - 0.5) * 0.8,
        y: entity.position.y,
        z: (entity.position.z + mate.position.z) * 0.5 + (Math.random() - 0.5) * 0.8,
      },
      radius: 0.2,
      halfHeight: 0.45,
      health: 4,
      maxHealth: 8,
      hostile: false,
      isBaby: true,
      growUpAtMs: now + 90_000,
      breedReadyAtMs: now + 90_000,
      loveUntilMs: null,
      vx: 0,
      vz: 0,
      wanderTimer: 0,
    });
    this.broadcastGameplay(true);
  }

  private computeNextEntityId(): number {
    let nextId = 1;
    for (const entity of this.entities) {
      const numericId = Number.parseInt(entity.id.replace(/^e/, ""), 10);
      if (Number.isFinite(numericId)) {
        nextId = Math.max(nextId, numericId + 1);
      }
    }
    return nextId;
  }

  private computeNextDroppedItemId(): number {
    let nextId = 1;
    for (const item of this.droppedItems) {
      const numericId = Number.parseInt(item.id.replace(/^d/, ""), 10);
      if (Number.isFinite(numericId)) {
        nextId = Math.max(nextId, numericId + 1);
      }
    }
    return nextId;
  }

  private getSpawnPosition(): Vec3 {
    const world = this.getWorld() as WasmWorld & { surface_height_at: (wx: number, wz: number) => number };
    const originX = Math.floor(DEFAULT_SPAWN_X);
    const originZ = Math.floor(DEFAULT_SPAWN_Z);

    for (let radius = 0; radius <= 4; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const blockX = originX + dx;
          const blockZ = originZ + dz;
          const feetX = blockX + 0.5;
          const feetZ = blockZ + 0.5;
          const surfaceY = world.surface_height_at(blockX, blockZ);

          for (let feetY = surfaceY + 1; feetY <= Math.min(surfaceY + 4, CHUNK_HEIGHT - 2); feetY++) {
            if (this.isSafePlayerSpawn(feetX, feetY, feetZ)) {
              return { x: feetX, y: feetY, z: feetZ };
            }
          }
        }
      }
    }

    const fallbackY = world.surface_height_at(originX, originZ) + 2;
    return { x: DEFAULT_SPAWN_X, y: fallbackY, z: DEFAULT_SPAWN_Z };
  }

  private surfaceYAt(worldX: number, worldZ: number): number {
    const world = this.getWorld() as WasmWorld & { surface_height_at: (wx: number, wz: number) => number };
    return world.surface_height_at(Math.floor(worldX), Math.floor(worldZ)) + 1;
  }

  private isSafePlayerSpawn(feetX: number, feetY: number, feetZ: number): boolean {
    const centerX = Math.floor(feetX);
    const centerZ = Math.floor(feetZ);
    const supportBlock = this.getBlockTypeAtWorld(centerX, feetY - 1, centerZ);
    if (!this.isSpawnSupportBlock(supportBlock) || this.getFluidLevelAtWorld(centerX, feetY - 1, centerZ) > 0) {
      return false;
    }

    const minX = Math.floor(feetX - PLAYER_HALF_WIDTH);
    const maxX = Math.floor(feetX + PLAYER_HALF_WIDTH);
    const minY = Math.floor(feetY);
    const maxY = Math.floor(feetY + PLAYER_HEIGHT - 0.001);
    const minZ = Math.floor(feetZ - PLAYER_HALF_WIDTH);
    const maxZ = Math.floor(feetZ + PLAYER_HALF_WIDTH);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const blockType = this.getBlockTypeAtWorld(x, y, z);
          if (blockType !== BLOCK_TYPE.air || this.getFluidLevelAtWorld(x, y, z) > 0) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private isSpawnSupportBlock(blockType: number): boolean {
    return blockType !== BLOCK_TYPE.air
      && blockType !== BLOCK_TYPE.water
      && blockType !== BLOCK_TYPE.leaves
      && blockType !== BLOCK_TYPE.shortGrass
      && !isCropBlockType(blockType);
  }
}
