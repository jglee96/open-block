import { BLOCK_TYPE, isCropBlockType, isPlantBlockType } from "../gameplay/items";

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class BlockCache {
  private chunks = new Map<string, Uint8Array>();

  storeChunk(chunkX: number, chunkZ: number, data: ArrayBuffer) {
    if (data.byteLength === 0) return;
    this.chunks.set(chunkKey(chunkX, chunkZ), new Uint8Array(data));
  }

  getBlockTypeAt(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK_TYPE.air;
    const bx = Math.floor(wx);
    const by = Math.floor(wy);
    const bz = Math.floor(wz);
    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return BLOCK_TYPE.air;

    const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const idx = by * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    return chunk[idx] ?? BLOCK_TYPE.air;
  }

  isSolid(wx: number, wy: number, wz: number): boolean {
    if (wy < 0) return true;
    const block = this.getBlockTypeAt(wx, wy, wz);
    return block !== BLOCK_TYPE.air && block !== BLOCK_TYPE.water && !isPlantBlockType(block);
  }

  isTargetable(wx: number, wy: number, wz: number): boolean {
    const block = this.getBlockTypeAt(wx, wy, wz);
    return block !== BLOCK_TYPE.air && block !== BLOCK_TYPE.water;
  }

  evictDistant(centerChunkX: number, centerChunkZ: number, radius: number, onEvict?: (cx: number, cz: number) => void) {
    for (const key of this.chunks.keys()) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(cx - centerChunkX) <= radius && Math.abs(cz - centerChunkZ) <= radius) continue;
      this.chunks.delete(key);
      onEvict?.(cx, cz);
    }
  }
}
