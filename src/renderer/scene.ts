import type { GpuContext } from "./gpu";
import type { Pipeline } from "./pipeline";

export interface ChunkKey {
  x: number;
  z: number;
}

interface ChunkBuffer {
  vertexBuffer: GPUBuffer;
  vertexCount: number;
  worldOffsetX: number;
  worldOffsetZ: number;
}

const CHUNK_SIZE = 16;

export class Scene {
  private device: GPUDevice;
  private chunks = new Map<string, ChunkBuffer>();
  private blockDataMap = new Map<string, Uint8Array>();

  constructor(ctx: GpuContext) {
    this.device = ctx.device;
  }

  private key(x: number, z: number): string {
    return `${x},${z}`;
  }

  /** Upload mesh data for a chunk, replacing any existing buffer. */
  uploadChunk(
    chunkX: number,
    chunkZ: number,
    buffer: ArrayBuffer,
    vertexCount: number,
  ) {
    const key = this.key(chunkX, chunkZ);
    this.chunks.get(key)?.vertexBuffer.destroy();

    if (vertexCount === 0) {
      this.chunks.delete(key);
      return;
    }

    const vertexBuffer = this.device.createBuffer({
      size: buffer.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, buffer);

    this.chunks.set(key, {
      vertexBuffer,
      vertexCount,
      worldOffsetX: chunkX * CHUNK_SIZE,
      worldOffsetZ: chunkZ * CHUNK_SIZE,
    });
  }

  /** Store raw block data for physics / collision queries. */
  storeBlockData(chunkX: number, chunkZ: number, data: ArrayBuffer) {
    this.blockDataMap.set(this.key(chunkX, chunkZ), new Uint8Array(data));
  }

  getBlockData(chunkX: number, chunkZ: number): Uint8Array | undefined {
    return this.blockDataMap.get(this.key(chunkX, chunkZ));
  }

  /** Remove chunks further than `radius` chunks from (playerChunkX, playerChunkZ). */
  evictDistant(playerChunkX: number, playerChunkZ: number, radius: number) {
    for (const [key, chunk] of this.chunks) {
      const [cx, cz] = key.split(",").map(Number);
      if (
        Math.abs(cx - playerChunkX) > radius ||
        Math.abs(cz - playerChunkZ) > radius
      ) {
        chunk.vertexBuffer.destroy();
        this.chunks.delete(key);
        this.blockDataMap.delete(key);
      }
    }
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Encode all draw calls into an existing render pass. */
  draw(pass: GPURenderPassEncoder, pipeline: Pipeline) {
    pass.setPipeline(pipeline.pipeline);
    pass.setBindGroup(0, pipeline.bindGroup);

    for (const chunk of this.chunks.values()) {
      pass.setVertexBuffer(0, chunk.vertexBuffer);
      pass.draw(chunk.vertexCount);
    }
  }
}
