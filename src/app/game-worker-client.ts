import type {
  ChunkMeshMsg,
  DroppedItemSnapshotMsg,
  EntitySnapshotMsg,
  FrameDiagnosticsMsg,
  InventorySyncMsg,
  MainToWorker,
  PlayerStatsMsg,
  StateSnapshotMsg,
  WorkerToMain,
} from "../worker/protocol";

interface GameWorkerClientOptions {
  workerUrl: URL;
  seed: number;
  onReady: (spawn: { x: number; y: number; z: number }) => void;
  onChunkMesh: (msg: ChunkMeshMsg) => void;
  onEntitySnapshot: (msg: EntitySnapshotMsg) => void;
  onDroppedItemSnapshot: (msg: DroppedItemSnapshotMsg) => void;
  onInventorySync: (msg: InventorySyncMsg) => void;
  onPlayerStats: (msg: PlayerStatsMsg) => void;
  onFrameDiagnostics: (msg: FrameDiagnosticsMsg) => void;
  onStateSnapshot: (msg: StateSnapshotMsg) => void;
  onErrorMessage: (message: string) => void;
  onStatusMessage: (message: string) => void;
  onRestarting: (delayMs: number) => void;
}

export class GameWorkerClient {
  private worker: Worker | null = null;
  private ready = false;
  private restartAttempts = 0;

  constructor(private readonly options: GameWorkerClientOptions) {}

  connect() {
    this.worker?.terminate();
    this.ready = false;

    this.worker = new Worker(this.options.workerUrl, { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const msg = event.data;
      switch (msg.type) {
        case "READY":
          this.ready = true;
          this.restartAttempts = 0;
          this.options.onReady(msg.spawn);
          break;
        case "CHUNK_MESH":
          this.options.onChunkMesh(msg);
          break;
        case "ENTITY_SNAPSHOT":
          this.options.onEntitySnapshot(msg);
          break;
        case "INVENTORY_SYNC":
          this.options.onInventorySync(msg);
          break;
        case "DROPPED_ITEM_SNAPSHOT":
          this.options.onDroppedItemSnapshot(msg);
          break;
        case "PLAYER_STATS":
          this.options.onPlayerStats(msg);
          break;
        case "FRAME_DIAGNOSTICS":
          this.options.onFrameDiagnostics(msg);
          break;
        case "STATE_SNAPSHOT":
          this.options.onStateSnapshot(msg);
          break;
        case "ERROR":
          this.options.onErrorMessage(msg.message);
          break;
        case "STATUS":
          this.options.onStatusMessage(msg.message);
          break;
      }
    };

    this.worker.onerror = (event) => {
      console.error("Worker crashed:", event.message);
      this.ready = false;
      this.scheduleReconnect();
    };

    this.send({ type: "INIT", seed: this.options.seed });
  }

  isReady(): boolean {
    return this.ready;
  }

  send(msg: MainToWorker) {
    this.worker?.postMessage(msg);
  }

  private scheduleReconnect() {
    this.restartAttempts += 1;
    const delay = Math.min(4000, 500 * this.restartAttempts);
    this.options.onRestarting(delay);
    window.setTimeout(() => this.connect(), delay);
  }
}
