import { BLOCK_TYPE, isCropBlockType, isPlantBlockType } from "../gameplay/items";

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export interface WaterMediumSample {
  submersion: number;
  flowX: number;
  flowY: number;
  flowZ: number;
}

export class BlockCache {
  private chunks = new Map<string, Uint8Array>();
  private fluids = new Map<string, Uint8Array>();

  storeChunk(chunkX: number, chunkZ: number, data: ArrayBuffer) {
    if (data.byteLength === 0) return;
    this.chunks.set(chunkKey(chunkX, chunkZ), new Uint8Array(data));
  }

  storeFluidChunk(chunkX: number, chunkZ: number, data: ArrayBuffer) {
    if (data.byteLength === 0) return;
    this.fluids.set(chunkKey(chunkX, chunkZ), new Uint8Array(data));
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

  getFluidLevelAt(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const bx = Math.floor(wx);
    const by = Math.floor(wy);
    const bz = Math.floor(wz);
    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const chunk = this.fluids.get(chunkKey(cx, cz));
    if (!chunk) return 0;

    const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const idx = by * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    return chunk[idx] ?? 0;
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

  sampleWater(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): WaterMediumSample {
    const x0 = Math.floor(minX);
    const x1 = Math.floor(maxX);
    const y0 = Math.floor(minY);
    const y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ);
    const z1 = Math.floor(maxZ);
    const bodyHeight = Math.max(0.001, maxY - minY);
    const footprintArea = Math.max(1, (x1 - x0 + 1) * (z1 - z0 + 1));
    let overlap = 0;
    let flowX = 0;
    let flowZ = 0;

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const level = this.getFluidLevelAt(x, y, z);
          if (level <= 0) continue;
          const surfaceY = y + level / 8;
          const overlapY = Math.max(0, Math.min(maxY, surfaceY) - Math.max(minY, y));
          if (overlapY <= 0) continue;
          overlap += overlapY;
          const flow = this.getFlowVectorAt(x, y, z, level);
          flowX += flow.x * overlapY;
          flowZ += flow.z * overlapY;
        }
      }
    }

    const normalizedSubmersion = Math.min(1, overlap / (bodyHeight * footprintArea));
    const weight = overlap > 0 ? 1 / overlap : 0;
    return {
      submersion: normalizedSubmersion,
      flowX: flowX * weight,
      flowY: normalizedSubmersion > 0 ? -0.04 : 0,
      flowZ: flowZ * weight,
    };
  }

  evictDistant(centerChunkX: number, centerChunkZ: number, radius: number, onEvict?: (cx: number, cz: number) => void) {
    for (const key of this.chunks.keys()) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(cx - centerChunkX) <= radius && Math.abs(cz - centerChunkZ) <= radius) continue;
      this.chunks.delete(key);
      this.fluids.delete(key);
      onEvict?.(cx, cz);
    }
  }

  private getFlowVectorAt(wx: number, wy: number, wz: number, level: number): { x: number; z: number } {
    const currentHeight = level / 8;
    let flowX = 0;
    let flowZ = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const neighborLevel = this.getFluidLevelAt(wx + dx, wy, wz + dz);
      const neighborHeight = neighborLevel / 8;
      if (neighborHeight >= currentHeight) continue;
      const delta = currentHeight - neighborHeight;
      flowX += dx * delta;
      flowZ += dz * delta;
    }
    return { x: flowX, z: flowZ };
  }
}
