import type { ItemId, RecipeId } from "../gameplay/items";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerStats {
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  timeOfDay: number;
  isNight: boolean;
  isSheltered: boolean;
}

export interface FrameDiagnostics {
  frameErrorCount: number;
  lastErrorCode: string | null;
}

export type EntityKind = "sheep" | "pig" | "zombie";

export interface EntitySnapshot {
  id: string;
  kind: EntityKind;
  position: Vec3;
  radius: number;
  halfHeight: number;
  health: number;
  maxHealth: number;
  hostile: boolean;
}

export interface InventoryEntry {
  itemId: ItemId;
  count: number;
}

export interface SmeltingState {
  inputItem: ItemId;
  outputItem: ItemId;
  fuelItem: ItemId;
  readyAtMs: number;
  startedAtMs: number;
}

export interface SavedState {
  version: 1;
  stats: PlayerStats;
  inventory: InventoryEntry[];
  smelting: SmeltingState | null;
  entities: EntitySnapshot[];
  blockOverrides: Array<{ x: number; y: number; z: number; blockType: number }>;
}

// ── Main → Worker ──────────────────────────────────────────────────────────

export interface InitMsg {
  type: "INIT";
  seed: number;
}

export interface GenerateChunkMsg {
  type: "GENERATE_CHUNK";
  chunkX: number;
  chunkZ: number;
}

export interface SetBlockMsg {
  type: "SET_BLOCK";
  worldX: number;
  worldY: number;
  worldZ: number;
  blockType: number;
}

export interface BreakBlockMsg {
  type: "BREAK_BLOCK";
  worldX: number;
  worldY: number;
  worldZ: number;
}

export interface PlaceItemMsg {
  type: "PLACE_ITEM";
  worldX: number;
  worldY: number;
  worldZ: number;
  itemId: ItemId;
}

export interface TickMsg {
  type: "TICK";
  dt: number;
  playerPos: Vec3;
  isSheltered: boolean;
}

export interface CraftMsg {
  type: "CRAFT";
  recipeId: RecipeId;
  quantity: number;
}

export interface SmeltStartMsg {
  type: "SMELT_START";
  inputItem: ItemId;
  fuelItem: ItemId;
}

export interface SmeltCollectMsg {
  type: "SMELT_COLLECT";
}

export interface InteractEntityMsg {
  type: "INTERACT_ENTITY";
  entityId: string;
  action: "attack" | "interact";
}

export interface CollectItemMsg {
  type: "COLLECT_ITEM";
  itemId: ItemId;
  count: number;
}

export interface ConsumeItemMsg {
  type: "CONSUME_ITEM";
  itemId: ItemId;
}

export interface SleepMsg {
  type: "SLEEP";
}

export interface LoadStateMsg {
  type: "LOAD_STATE";
  state: SavedState;
}

export interface RequestStateMsg {
  type: "REQUEST_STATE";
}

export type MainToWorker =
  | InitMsg
  | GenerateChunkMsg
  | SetBlockMsg
  | BreakBlockMsg
  | PlaceItemMsg
  | TickMsg
  | CraftMsg
  | SmeltStartMsg
  | SmeltCollectMsg
  | InteractEntityMsg
  | CollectItemMsg
  | ConsumeItemMsg
  | SleepMsg
  | LoadStateMsg
  | RequestStateMsg;

// ── Worker → Main ──────────────────────────────────────────────────────────

export interface ReadyMsg {
  type: "READY";
}

export interface ChunkMeshMsg {
  type: "CHUNK_MESH";
  chunkX: number;
  chunkZ: number;
  /** Transferable vertex buffer — zero-copy */
  buffer: ArrayBuffer;
  vertexCount: number;
  /** Raw block data 16×64×16 = 16 384 bytes — for physics collision */
  blockData: ArrayBuffer;
}

export interface InventorySyncMsg {
  type: "INVENTORY_SYNC";
  entries: InventoryEntry[];
  smelting: SmeltingState | null;
}

export interface EntitySnapshotMsg {
  type: "ENTITY_SNAPSHOT";
  entities: EntitySnapshot[];
}

export interface PlayerStatsMsg {
  type: "PLAYER_STATS";
  stats: PlayerStats;
}

export interface FrameDiagnosticsMsg {
  type: "FRAME_DIAGNOSTICS";
  diagnostics: FrameDiagnostics;
}

export interface StateSnapshotMsg {
  type: "STATE_SNAPSHOT";
  state: SavedState;
}

export interface ErrorMsg {
  type: "ERROR";
  message: string;
}

export type WorkerToMain =
  | ReadyMsg
  | ChunkMeshMsg
  | InventorySyncMsg
  | EntitySnapshotMsg
  | PlayerStatsMsg
  | FrameDiagnosticsMsg
  | StateSnapshotMsg
  | ErrorMsg;
