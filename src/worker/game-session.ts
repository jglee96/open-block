import {
  BLOCK_TYPE,
  getCropStage,
  getEdibleHunger,
  getHarvestRule,
  isCropBlockType,
  getPlaceableBlockType,
  getRecipe,
  type ItemId,
} from "../gameplay/items";
import type {
  EntitySnapshot,
  FrameDiagnostics,
  SavedState,
  SmeltingState,
  Vec3,
  WorkerToMain,
} from "./protocol";

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const SAVE_STATE_VERSION = 1 as const;
const DAY_LENGTH_TICKS = 24_000;
const FULL_DAY_SECONDS = 600;
const NIGHT_START = 13_000;
const NIGHT_END = 23_000;

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
  nextGrowthAtMs: number;
}

type WasmWorld = import("mc-core").WasmWorld;

export class GameSession {
  private wasmWorld: WasmWorld | null = null;
  private initialized = false;
  private nextEntityId = 1;
  private readonly inventory = new Map<ItemId, number>();
  private smelting: SmeltingState | null = null;
  private readonly entities: EntityRuntime[] = [];
  private readonly blockOverrides = new Map<string, { x: number; y: number; z: number; blockType: number }>();
  private readonly cropPlots = new Map<string, CropPlotState>();
  private latestPlayerPos: Vec3 = { x: 8, y: 62, z: 8 };
  private lastBroadcastMs = 0;
  private lastStateSnapshotMs = 0;
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
    this.ensureEntityPopulation(this.latestPlayerPos);
    this.post({ type: "READY" });
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
    this.post(reply, [reply.buffer, reply.blockData]);
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
    if (!rule || (!rule.breakableByHand && !this.hasRequiredTool(blockType))) return;
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

    if (rule.drops) this.addItem(rule.drops, 1);
    if (blockType === BLOCK_TYPE.grass && Math.random() < 0.35) {
      this.addItem("wheat_seeds", 1);
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

    const world = this.getWorld();
    world.set_block(worldX, worldY, worldZ, blockType);
    this.setBlockOverride(worldX, worldY, worldZ, blockType);
    this.removeItem(itemId, 1);
    this.remeshTouchedChunks(worldX, worldZ);
    this.broadcastGameplay(true);
  }

  tick(dt: number, playerPos: Vec3, isSheltered: boolean) {
    this.latestPlayerPos = playerPos;
    this.stats.isSheltered = isSheltered;
    this.advanceWorld(dt, playerPos);
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

  interactEntity(entityId: string, action: "attack" | "interact") {
    const idx = this.entities.findIndex((entity) => entity.id === entityId);
    if (idx < 0) return;
    const entity = this.entities[idx];

    if (action === "interact") {
      if (entity.kind === "sheep") this.addItem("wool", 1);
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
      this.addItem("raw_meat", 2);
    } else if (entity.kind === "sheep") {
      this.addItem("wool", 2);
      this.addItem("raw_meat", 1);
    } else if (entity.kind === "zombie") {
      this.addItem("coal", 1);
    }

    this.entities.splice(idx, 1);
    this.broadcastGameplay(true);
  }

  collectItem(itemId: ItemId, count: number) {
    this.addItem(itemId, count);
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
    if (state.version !== SAVE_STATE_VERSION) return;

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
      this.entities.push({ ...entity, vx: 0, vz: 0, wanderTimer: 0 });
    }

    this.blockOverrides.clear();
    for (const override of state.blockOverrides) {
      this.setBlockOverride(override.x, override.y, override.z, override.blockType);
    }

    this.cropPlots.clear();
    for (const crop of state.cropPlots ?? []) {
      this.cropPlots.set(this.coordKey(crop.x, crop.y, crop.z), { ...crop });
    }

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

  private applyOverridesForChunk(cx: number, cz: number) {
    if (!this.wasmWorld || this.blockOverrides.size === 0) return;
    for (const override of this.blockOverrides.values()) {
      const cc = this.chunkCoordsFromWorld(override.x, override.z);
      if (cc.cx === cx && cc.cz === cz) {
        this.wasmWorld.set_block(override.x, override.y, override.z, override.blockType);
      }
    }
  }

  private buildChunkReply(chunkX: number, chunkZ: number) {
    const world = this.getWorld();
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      this.applyOverridesForChunk(chunkX + dx, chunkZ + dz);
    }

    const floats = world.build_chunk_mesh(chunkX, chunkZ);
    const buffer = floats.buffer.slice(0) as ArrayBuffer;
    const vertexCount = floats.length / 9;
    const blockDataJs = world.get_chunk_blocks(chunkX, chunkZ);
    const blockData = blockDataJs ? (blockDataJs.buffer.slice(0) as ArrayBuffer) : new ArrayBuffer(0);

    return {
      type: "CHUNK_MESH" as const,
      chunkX,
      chunkZ,
      buffer,
      vertexCount,
      blockData,
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
      this.post(reply, [reply.buffer, reply.blockData]);
    }
  }

  private hydrateDefaultState() {
    this.inventory.clear();
    this.cropPlots.clear();
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
    const { cx, cz } = this.chunkCoordsFromWorld(wx, wz);
    this.ensureChunkGenerated(cx, cz);
    const chunk = this.getWorld().get_chunk_blocks(cx, cz);
    if (!chunk) return BLOCK_TYPE.air;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const idx = wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    return chunk[idx] ?? BLOCK_TYPE.air;
  }

  private plantSeeds(worldX: number, worldY: number, worldZ: number) {
    if (!this.hasItem("wheat_seeds", 1)) return;
    if (this.getBlockTypeAtWorld(worldX, worldY, worldZ) !== BLOCK_TYPE.air) return;

    const soilBlock = this.getBlockTypeAtWorld(worldX, worldY - 1, worldZ);
    if (soilBlock !== BLOCK_TYPE.dirt && soilBlock !== BLOCK_TYPE.grass && soilBlock !== BLOCK_TYPE.farmland) return;

    const world = this.getWorld();
    world.set_block(worldX, worldY - 1, worldZ, BLOCK_TYPE.farmland);
    world.set_block(worldX, worldY, worldZ, BLOCK_TYPE.wheatCrop0);
    this.setBlockOverride(worldX, worldY - 1, worldZ, BLOCK_TYPE.farmland);
    this.setBlockOverride(worldX, worldY, worldZ, BLOCK_TYPE.wheatCrop0);
    this.cropPlots.set(this.coordKey(worldX, worldY, worldZ), {
      x: worldX,
      y: worldY,
      z: worldZ,
      stage: 0,
      nextGrowthAtMs: Date.now() + 15_000,
    });
    this.removeItem("wheat_seeds", 1);
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
      this.addItem("wheat", 2);
      this.addItem("wheat_seeds", 1);
      return;
    }

    this.addItem("wheat_seeds", 1);
  }

  private advanceCropGrowth() {
    if (this.cropPlots.size === 0) return;
    const now = Date.now();
    const world = this.getWorld();

    for (const crop of this.cropPlots.values()) {
      if (crop.stage >= 3 || now < crop.nextGrowthAtMs) continue;
      crop.stage += 1;
      crop.nextGrowthAtMs = now + 15_000;
      const blockType = this.blockTypeForCropStage(crop.stage);
      world.set_block(crop.x, crop.y, crop.z, blockType);
      this.setBlockOverride(crop.x, crop.y, crop.z, blockType);
      this.remeshTouchedChunks(crop.x, crop.z);
    }
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
      { kind: "sheep", x: playerPos.x + 3, y: 62, z: playerPos.z - 4, hostile: false },
      { kind: "pig", x: playerPos.x - 5, y: 62, z: playerPos.z + 2, hostile: false },
      { kind: "zombie", x: playerPos.x + 8, y: 62, z: playerPos.z + 7, hostile: true },
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
        vx: 0,
        vz: 0,
        wanderTimer: 0,
      });
    }
  }

  private advanceWorld(dt: number, playerPos: Vec3) {
    const safeDt = Math.max(0, Math.min(0.2, dt));
    this.ensureEntityPopulation(playerPos);
    this.advanceCropGrowth();

    const dayTickPerSecond = DAY_LENGTH_TICKS / FULL_DAY_SECONDS;
    this.stats.timeOfDay = (this.stats.timeOfDay + safeDt * dayTickPerSecond) % DAY_LENGTH_TICKS;
    this.stats.isNight = this.stats.timeOfDay >= NIGHT_START && this.stats.timeOfDay <= NIGHT_END;
    this.stats.hunger = this.clamp(this.stats.hunger - safeDt * 0.03, 0, this.stats.maxHunger);

    for (const entity of this.entities) {
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

    if (this.smelting && Date.now() >= this.smelting.readyAtMs + 30_000) {
      this.smelting = null;
    }

    if (this.stats.health <= 0) {
      this.stats.health = this.stats.maxHealth;
      this.stats.hunger = this.stats.maxHunger;
      this.stats.timeOfDay = 6_000;
      this.latestPlayerPos = { ...playerPos };
    }
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

    this.post({ type: "INVENTORY_SYNC", entries: this.inventoryEntries(), smelting: this.smelting });
    this.post({
      type: "ENTITY_SNAPSHOT",
      entities: this.entities.map(({ vx: _vx, vz: _vz, wanderTimer: _wt, ...snapshot }) => snapshot),
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
    };
  }

  private postStateSnapshot() {
    this.post({ type: "STATE_SNAPSHOT", state: this.saveState() });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
