import type { BlockCache } from "./block-cache";
import type { Scene } from "../renderer/scene";

interface ChunkCoords {
  cx: number;
  cz: number;
}

interface ChunkStreamingOptions {
  renderRadius: number;
  retentionRadius: number;
  scene: Scene;
  blockCache: BlockCache;
  requestChunk: (coords: ChunkCoords) => void;
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class ChunkStreamingController {
  private readonly requestedChunks = new Set<string>();
  private readonly queuedChunkRequests = new Set<string>();
  private readonly chunkRequestQueue: ChunkCoords[] = [];

  constructor(private readonly options: ChunkStreamingOptions) {}

  updateFocus(worldX: number, worldZ: number, chunkSize: number) {
    const playerChunkX = Math.floor(worldX / chunkSize);
    const playerChunkZ = Math.floor(worldZ / chunkSize);

    this.options.scene.evictDistant(playerChunkX, playerChunkZ, this.options.retentionRadius);
    this.options.blockCache.evictDistant(
      playerChunkX,
      playerChunkZ,
      this.options.retentionRadius,
      (cx, cz) => {
        this.requestedChunks.delete(chunkKey(cx, cz));
      },
    );

    for (const key of [...this.requestedChunks]) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(cx - playerChunkX) > this.options.retentionRadius || Math.abs(cz - playerChunkZ) > this.options.retentionRadius) {
        this.requestedChunks.delete(key);
      }
    }

    for (let dz = -this.options.renderRadius; dz <= this.options.renderRadius; dz++) {
      for (let dx = -this.options.renderRadius; dx <= this.options.renderRadius; dx++) {
        const cx = playerChunkX + dx;
        const cz = playerChunkZ + dz;
        const key = chunkKey(cx, cz);
        if (this.requestedChunks.has(key) || this.queuedChunkRequests.has(key)) continue;
        this.queuedChunkRequests.add(key);
        this.chunkRequestQueue.push({ cx, cz });
      }
    }
  }

  flush(maxPerFrame: number) {
    let sent = 0;
    while (this.chunkRequestQueue.length > 0 && sent < maxPerFrame) {
      const next = this.chunkRequestQueue.shift();
      if (!next) break;
      const key = chunkKey(next.cx, next.cz);
      this.queuedChunkRequests.delete(key);
      if (this.requestedChunks.has(key)) continue;
      this.requestedChunks.add(key);
      this.options.requestChunk(next);
      sent += 1;
    }
  }
}
