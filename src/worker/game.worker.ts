import {
  BLOCK_TYPE,
  getEdibleHunger,
  getHarvestRule,
  getPlaceableBlockType,
  getRecipe,
  type ItemId,
} from "../gameplay/items";
import type {
  EntitySnapshot,
  MainToWorker,
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

interface WorkerFrameDiagnostics {
  frameErrorCount: number;
  lastErrorCode: string | null;
}

let wasmWorld: import("mc-core").WasmWorld | null = null;
let initialized = false;
let nextEntityId = 1;

const inventory = new Map<ItemId, number>();
let smelting: SmeltingState | null = null;

const stats = {
  health: 20,
  maxHealth: 20,
  hunger: 20,
  maxHunger: 20,
  timeOfDay: 6_000,
  isNight: false,
  isSheltered: false,
};

const frameDiagnostics: WorkerFrameDiagnostics = {
  frameErrorCount: 0,
  lastErrorCode: null,
};

const entities: EntityRuntime[] = [];
const blockOverrides = new Map<string, { x: number; y: number; z: number; blockType: number }>();

let latestPlayerPos: Vec3 = { x: 8, y: 62, z: 8 };
let lastBroadcastMs = 0;
let lastStateSnapshotMs = 0;

self.onmessage = async (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case "INIT": {
        const mcCore = await import("mc-core");
        await mcCore.default();
        wasmWorld = new mcCore.WasmWorld(msg.seed);
        initialized = true;
        hydrateDefaultState();
        ensureEntityPopulation(latestPlayerPos);
        post({ type: "READY" });
        broadcastGameplay(true);
        postStateSnapshot();
        break;
      }

      case "GENERATE_CHUNK": {
        const { chunkX, chunkZ } = msg;
        const reply = buildChunkReply(chunkX, chunkZ);
        post(reply, [reply.buffer, reply.blockData]);
        break;
      }

      case "SET_BLOCK": {
        const world = getWorld();
        world.set_block(msg.worldX, msg.worldY, msg.worldZ, msg.blockType);
        setBlockOverride(msg.worldX, msg.worldY, msg.worldZ, msg.blockType);
        remeshTouchedChunks(msg.worldX, msg.worldZ);
        break;
      }

      case "BREAK_BLOCK": {
        if (!initialized) break;
        breakBlock(msg.worldX, msg.worldY, msg.worldZ);
        broadcastGameplay(true);
        break;
      }

      case "PLACE_ITEM": {
        if (!initialized) break;
        placeItem(msg.worldX, msg.worldY, msg.worldZ, msg.itemId);
        broadcastGameplay(true);
        break;
      }

      case "TICK": {
        if (!initialized) break;
        latestPlayerPos = msg.playerPos;
        stats.isSheltered = msg.isSheltered;
        advanceWorld(msg.dt, msg.playerPos);
        maybeBroadcastGameplay();
        break;
      }

      case "CRAFT": {
        if (!initialized) break;
        craft(msg.recipeId, msg.quantity);
        broadcastGameplay(true);
        break;
      }

      case "SMELT_START": {
        if (!initialized) break;
        startSmelting(msg.inputItem, msg.fuelItem);
        broadcastGameplay(true);
        break;
      }

      case "SMELT_COLLECT": {
        if (!initialized) break;
        collectSmeltedOutput();
        broadcastGameplay(true);
        break;
      }

      case "INTERACT_ENTITY": {
        if (!initialized) break;
        interactEntity(msg.entityId, msg.action);
        broadcastGameplay(true);
        break;
      }

      case "COLLECT_ITEM": {
        if (!initialized) break;
        addItem(msg.itemId, msg.count);
        broadcastGameplay(true);
        break;
      }

      case "CONSUME_ITEM": {
        if (!initialized) break;
        consumeItem(msg.itemId);
        broadcastGameplay(true);
        break;
      }

      case "SLEEP": {
        if (!initialized) break;
        sleepIfPossible();
        broadcastGameplay(true);
        break;
      }

      case "LOAD_STATE": {
        if (!initialized) break;
        loadState(msg.state);
        broadcastGameplay(true);
        postStateSnapshot();
        break;
      }

      case "REQUEST_STATE": {
        if (!initialized) break;
        postStateSnapshot();
        break;
      }
    }
  } catch (err) {
    handleError(msg.type, err);
  }
};

function post(msg: WorkerToMain, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, { transfer });
    return;
  }
  self.postMessage(msg);
}

function getWorld(): import("mc-core").WasmWorld {
  if (!wasmWorld) {
    throw new Error("World not initialised — send INIT first");
  }
  return wasmWorld;
}

function coordKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function chunkCoordsFromWorld(wx: number, wz: number): { cx: number; cz: number } {
  return { cx: Math.floor(wx / CHUNK_SIZE), cz: Math.floor(wz / CHUNK_SIZE) };
}

function setBlockOverride(x: number, y: number, z: number, blockType: number) {
  const key = coordKey(x, y, z);
  blockOverrides.set(key, { x, y, z, blockType });
}

function applyOverridesForChunk(cx: number, cz: number) {
  if (!wasmWorld || blockOverrides.size === 0) return;
  const world = wasmWorld;
  for (const override of blockOverrides.values()) {
    const cc = chunkCoordsFromWorld(override.x, override.z);
    if (cc.cx === cx && cc.cz === cz) {
      world.set_block(override.x, override.y, override.z, override.blockType);
    }
  }
}

function buildChunkReply(chunkX: number, chunkZ: number) {
  const world = getWorld();
  for (const [dx, dz] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    applyOverridesForChunk(chunkX + dx, chunkZ + dz);
  }

  const floats = world.build_chunk_mesh(chunkX, chunkZ);
  const buffer = floats.buffer.slice(0) as ArrayBuffer;
  const vertexCount = floats.length / 9;

  const blockDataJs = world.get_chunk_blocks(chunkX, chunkZ);
  const blockData = blockDataJs
    ? (blockDataJs.buffer.slice(0) as ArrayBuffer)
    : new ArrayBuffer(0);

  return {
    type: "CHUNK_MESH" as const,
    chunkX,
    chunkZ,
    buffer,
    vertexCount,
    blockData,
  };
}

function remeshTouchedChunks(worldX: number, worldZ: number) {
  getWorld();
  const { cx, cz } = chunkCoordsFromWorld(worldX, worldZ);
  const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((worldZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

  const chunksToRemesh: [number, number][] = [[cx, cz]];
  if (lx === 0) chunksToRemesh.push([cx - 1, cz]);
  if (lx === CHUNK_SIZE - 1) chunksToRemesh.push([cx + 1, cz]);
  if (lz === 0) chunksToRemesh.push([cx, cz - 1]);
  if (lz === CHUNK_SIZE - 1) chunksToRemesh.push([cx, cz + 1]);

  for (const [rcx, rcz] of chunksToRemesh) {
    const reply = buildChunkReply(rcx, rcz);
    post(reply, [reply.buffer, reply.blockData]);
  }
}

function hydrateDefaultState() {
  inventory.clear();
  stats.health = 20;
  stats.hunger = 20;
  stats.timeOfDay = 6_000;
  stats.isNight = false;
  stats.isSheltered = false;
  smelting = null;
}

function addItem(itemId: ItemId, count: number) {
  if (count <= 0) return;
  inventory.set(itemId, (inventory.get(itemId) ?? 0) + count);
}

function hasItem(itemId: ItemId, count: number): boolean {
  return (inventory.get(itemId) ?? 0) >= count;
}

function removeItem(itemId: ItemId, count: number): boolean {
  const now = inventory.get(itemId) ?? 0;
  if (now < count) return false;
  const next = now - count;
  if (next === 0) inventory.delete(itemId);
  else inventory.set(itemId, next);
  return true;
}

function inventoryEntries() {
  return [...inventory.entries()]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, count]) => ({ itemId, count }));
}

function hasCraftingTableAccess(): boolean {
  return hasItem("crafting_table", 1);
}

function hasRequiredTool(blockType: number): boolean {
  const rule = getHarvestRule(blockType);
  if (!rule) return false;
  if (rule.requiresTool === "none") return true;
  if (rule.requiresTool === "wooden_pickaxe") {
    return hasItem("wooden_pickaxe", 1) || hasItem("stone_pickaxe", 1);
  }
  return false;
}

function craft(recipeId: string, quantity: number) {
  const recipe = getRecipe(recipeId as never);
  if (!recipe) return;
  if (recipe.requiresCraftingTable && !hasCraftingTableAccess()) return;

  const safeQty = Math.max(1, Math.floor(quantity));
  for (let i = 0; i < safeQty; i++) {
    const canCraft = Object.entries(recipe.inputs).every(([itemId, count]) => hasItem(itemId as ItemId, count ?? 0));
    if (!canCraft) break;

    for (const [itemId, count] of Object.entries(recipe.inputs)) {
      if (!count) continue;
      removeItem(itemId as ItemId, count);
    }
    for (const [itemId, count] of Object.entries(recipe.outputs)) {
      if (!count) continue;
      addItem(itemId as ItemId, count);
    }
  }
}

function ensureChunkGenerated(cx: number, cz: number) {
  const world = getWorld();
  if (!world.get_chunk_blocks(cx, cz)) {
    world.build_chunk_mesh(cx, cz);
  }
}

function getBlockTypeAtWorld(wx: number, wy: number, wz: number): number {
  if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK_TYPE.air;
  const { cx, cz } = chunkCoordsFromWorld(wx, wz);
  ensureChunkGenerated(cx, cz);
  const chunk = getWorld().get_chunk_blocks(cx, cz);
  if (!chunk) return BLOCK_TYPE.air;
  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const idx = wy * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
  return chunk[idx] ?? BLOCK_TYPE.air;
}

function breakBlock(worldX: number, worldY: number, worldZ: number) {
  const blockType = getBlockTypeAtWorld(worldX, worldY, worldZ);
  const rule = getHarvestRule(blockType);
  if (!rule || !rule.breakableByHand && !hasRequiredTool(blockType)) return;
  if (rule.breakableByHand === false && !hasRequiredTool(blockType)) return;
  if (blockType === BLOCK_TYPE.air || blockType === BLOCK_TYPE.bedrock) return;

  const world = getWorld();
  world.set_block(worldX, worldY, worldZ, BLOCK_TYPE.air);
  setBlockOverride(worldX, worldY, worldZ, BLOCK_TYPE.air);
  remeshTouchedChunks(worldX, worldZ);

  if (rule.drops) {
    addItem(rule.drops, 1);
  }
}

function placeItem(worldX: number, worldY: number, worldZ: number, itemId: ItemId) {
  const blockType = getPlaceableBlockType(itemId);
  if (blockType === null) return;
  if (!hasItem(itemId, 1)) return;
  if (getBlockTypeAtWorld(worldX, worldY, worldZ) !== BLOCK_TYPE.air) return;

  const world = getWorld();
  world.set_block(worldX, worldY, worldZ, blockType);
  setBlockOverride(worldX, worldY, worldZ, blockType);
  removeItem(itemId, 1);
  remeshTouchedChunks(worldX, worldZ);
}

function consumeItem(itemId: ItemId) {
  const hungerGain = getEdibleHunger(itemId);
  if (hungerGain <= 0) return;
  if (!removeItem(itemId, 1)) return;
  stats.hunger = clamp(stats.hunger + hungerGain, 0, stats.maxHunger);
}

function startSmelting(inputItem: ItemId, fuelItem: ItemId) {
  if (smelting) return;
  if (!hasItem("furnace", 1)) return;
  if (inputItem !== "raw_meat") return;
  if (!hasItem(inputItem, 1) || !hasItem(fuelItem, 1)) return;
  if (fuelItem !== "coal" && fuelItem !== "log" && fuelItem !== "planks") return;

  removeItem(inputItem, 1);
  removeItem(fuelItem, 1);

  const now = Date.now();
  smelting = {
    inputItem,
    outputItem: "cooked_meat",
    fuelItem,
    startedAtMs: now,
    readyAtMs: now + 6_000,
  };
}

function collectSmeltedOutput() {
  if (!smelting) return;
  if (Date.now() < smelting.readyAtMs) return;
  addItem(smelting.outputItem, 1);
  smelting = null;
}

function ensureEntityPopulation(playerPos: Vec3) {
  if (entities.length > 0) return;

  const spawn: Array<{ kind: EntityRuntime["kind"]; x: number; y: number; z: number; hostile: boolean }> = [
    { kind: "sheep", x: playerPos.x + 3, y: 62, z: playerPos.z - 4, hostile: false },
    { kind: "pig", x: playerPos.x - 5, y: 62, z: playerPos.z + 2, hostile: false },
    { kind: "zombie", x: playerPos.x + 8, y: 62, z: playerPos.z + 7, hostile: true },
  ];

  for (const item of spawn) {
    entities.push({
      id: `e${nextEntityId++}`,
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

function advanceWorld(dt: number, playerPos: Vec3) {
  const safeDt = Math.max(0, Math.min(0.2, dt));
  ensureEntityPopulation(playerPos);

  const dayTickPerSecond = DAY_LENGTH_TICKS / FULL_DAY_SECONDS;
  stats.timeOfDay = (stats.timeOfDay + safeDt * dayTickPerSecond) % DAY_LENGTH_TICKS;
  stats.isNight = stats.timeOfDay >= NIGHT_START && stats.timeOfDay <= NIGHT_END;

  stats.hunger = clamp(stats.hunger - safeDt * 0.03, 0, stats.maxHunger);

  for (const entity of entities) {
    const dx = playerPos.x - entity.position.x;
    const dz = playerPos.z - entity.position.z;
    const dist = Math.hypot(dx, dz);

    if (entity.hostile && stats.isNight && dist < 12) {
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

    // Keep entities near the player for simple gameplay.
    if (Math.abs(entity.position.x - playerPos.x) > 20 || Math.abs(entity.position.z - playerPos.z) > 20) {
      entity.position.x = playerPos.x + (Math.random() * 8 - 4);
      entity.position.z = playerPos.z + (Math.random() * 8 - 4);
    }
  }

  const hostileNear = entities.some((entity) => {
    if (!entity.hostile || !stats.isNight) return false;
    const dx = playerPos.x - entity.position.x;
    const dz = playerPos.z - entity.position.z;
    return Math.hypot(dx, dz) < 2.2;
  });

  if (hostileNear && !stats.isSheltered) {
    stats.health = clamp(stats.health - safeDt * 2.0, 0, stats.maxHealth);
  } else if (stats.hunger > 14) {
    stats.health = clamp(stats.health + safeDt * 0.6, 0, stats.maxHealth);
  }

  if (stats.hunger <= 0) {
    stats.health = clamp(stats.health - safeDt * 0.5, 0, stats.maxHealth);
  }

  if (smelting && Date.now() >= smelting.readyAtMs + 30_000) {
    // Auto-cancel stale smelting job after enough delay.
    smelting = null;
  }

  // Respawn loop for simple survival play.
  if (stats.health <= 0) {
    stats.health = stats.maxHealth;
    stats.hunger = stats.maxHunger;
    stats.timeOfDay = 6_000;
    latestPlayerPos = { ...playerPos };
  }
}

function interactEntity(entityId: string, action: "attack" | "interact") {
  const idx = entities.findIndex((entity) => entity.id === entityId);
  if (idx < 0) return;
  const entity = entities[idx];

  if (action === "interact") {
    if (entity.kind === "sheep") {
      addItem("wool", 1);
    }
    return;
  }

  const damage = hasItem("stone_pickaxe", 1) ? 6 : hasItem("wooden_pickaxe", 1) ? 4 : 2;
  entity.health = Math.max(0, entity.health - damage);

  if (entity.health > 0) return;

  if (entity.kind === "pig") {
    addItem("raw_meat", 2);
  } else if (entity.kind === "sheep") {
    addItem("wool", 2);
    addItem("raw_meat", 1);
  } else if (entity.kind === "zombie") {
    addItem("coal", 1);
  }

  entities.splice(idx, 1);
}

function sleepIfPossible() {
  if (!stats.isNight) return;
  if (!hasItem("bed", 1)) return;
  stats.timeOfDay = 1_000;
  stats.isNight = false;
  stats.health = clamp(stats.health + 8, 0, stats.maxHealth);
}

function maybeBroadcastGameplay() {
  const now = Date.now();
  if (now - lastBroadcastMs > 120) {
    broadcastGameplay(false);
    lastBroadcastMs = now;
  }
  if (now - lastStateSnapshotMs > 3_000) {
    postStateSnapshot();
    lastStateSnapshotMs = now;
  }
}

function broadcastGameplay(force: boolean) {
  if (!force && Date.now() - lastBroadcastMs <= 120) return;

  post({
    type: "INVENTORY_SYNC",
    entries: inventoryEntries(),
    smelting,
  });

  post({
    type: "ENTITY_SNAPSHOT",
    entities: entities.map(({ vx: _vx, vz: _vz, wanderTimer: _wt, ...snapshot }) => snapshot),
  });

  post({
    type: "PLAYER_STATS",
    stats: {
      health: stats.health,
      maxHealth: stats.maxHealth,
      hunger: stats.hunger,
      maxHunger: stats.maxHunger,
      timeOfDay: stats.timeOfDay,
      isNight: stats.isNight,
      isSheltered: stats.isSheltered,
    },
  });

  post({
    type: "FRAME_DIAGNOSTICS",
    diagnostics: {
      frameErrorCount: frameDiagnostics.frameErrorCount,
      lastErrorCode: frameDiagnostics.lastErrorCode,
    },
  });
}

function saveState(): SavedState {
  return {
    version: SAVE_STATE_VERSION,
    stats: {
      health: stats.health,
      maxHealth: stats.maxHealth,
      hunger: stats.hunger,
      maxHunger: stats.maxHunger,
      timeOfDay: stats.timeOfDay,
      isNight: stats.isNight,
      isSheltered: stats.isSheltered,
    },
    inventory: inventoryEntries(),
    smelting,
    entities: entities.map(({ vx: _vx, vz: _vz, wanderTimer: _wt, ...snapshot }) => snapshot),
    blockOverrides: [...blockOverrides.values()],
  };
}

function loadState(state: SavedState) {
  if (state.version !== SAVE_STATE_VERSION) return;

  stats.health = clamp(state.stats.health, 0, state.stats.maxHealth);
  stats.maxHealth = Math.max(1, state.stats.maxHealth);
  stats.hunger = clamp(state.stats.hunger, 0, state.stats.maxHunger);
  stats.maxHunger = Math.max(1, state.stats.maxHunger);
  stats.timeOfDay = ((state.stats.timeOfDay % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS;
  stats.isNight = state.stats.isNight;
  stats.isSheltered = state.stats.isSheltered;

  inventory.clear();
  for (const entry of state.inventory) {
    if (entry.count > 0) addItem(entry.itemId, entry.count);
  }

  smelting = state.smelting;

  entities.length = 0;
  for (const entity of state.entities) {
    entities.push({
      ...entity,
      vx: 0,
      vz: 0,
      wanderTimer: 0,
    });
  }

  blockOverrides.clear();
  for (const override of state.blockOverrides) {
    setBlockOverride(override.x, override.y, override.z, override.blockType);
  }
}

function postStateSnapshot() {
  post({ type: "STATE_SNAPSHOT", state: saveState() });
}

function handleError(code: string, err: unknown) {
  frameDiagnostics.frameErrorCount += 1;
  frameDiagnostics.lastErrorCode = code;
  post({ type: "FRAME_DIAGNOSTICS", diagnostics: frameDiagnostics });
  post({ type: "ERROR", message: `${code}: ${String(err)}` });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
