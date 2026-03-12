import type { GpuContext } from "./gpu";
import type { RenderPipelines } from "./pipeline";
import { getItemRenderColor, type ItemId } from "../gameplay/items";
import type { DroppedItemSnapshot, Vec3 } from "../worker/protocol";

export interface ChunkKey {
  x: number;
  z: number;
}

interface ChunkBuffer {
  solidVertexBuffer: GPUBuffer | null;
  solidVertexCount: number;
  waterVertexBuffer: GPUBuffer | null;
  waterVertexCount: number;
}

const CHUNK_SIZE = 16;
const DROPPED_ITEM_INTERPOLATION_MS = 60;

interface DroppedItemRenderState {
  snapshot: DroppedItemSnapshot;
  fromPosition: Vec3;
  toPosition: Vec3;
  updatedAtMs: number;
}

export class Scene {
  private device: GPUDevice;
  private chunks = new Map<string, ChunkBuffer>();
  private droppedItems: DroppedItemRenderState[] = [];
  private droppedItemBuffer: GPUBuffer | null = null;
  private droppedItemBufferSize = 0;
  private droppedItemVertexCount = 0;

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
    solidBuffer: ArrayBuffer,
    solidVertexCount: number,
    waterBuffer: ArrayBuffer,
    waterVertexCount: number,
  ) {
    const key = this.key(chunkX, chunkZ);
    const previous = this.chunks.get(key);
    previous?.solidVertexBuffer?.destroy();
    previous?.waterVertexBuffer?.destroy();

    const nextChunk: ChunkBuffer = {
      solidVertexBuffer: null,
      solidVertexCount,
      waterVertexBuffer: null,
      waterVertexCount,
    };

    if (solidVertexCount > 0) {
      nextChunk.solidVertexBuffer = this.device.createBuffer({
        size: solidBuffer.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(nextChunk.solidVertexBuffer, 0, solidBuffer);
    }

    if (waterVertexCount > 0) {
      nextChunk.waterVertexBuffer = this.device.createBuffer({
        size: waterBuffer.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(nextChunk.waterVertexBuffer, 0, waterBuffer);
    }

    if (solidVertexCount === 0 && waterVertexCount === 0) {
      this.chunks.delete(key);
      return;
    }

    this.chunks.set(key, nextChunk);
  }

  /** Remove chunks further than `radius` chunks from (playerChunkX, playerChunkZ). */
  evictDistant(playerChunkX: number, playerChunkZ: number, radius: number) {
    for (const [key, chunk] of this.chunks) {
      const [cx, cz] = key.split(",").map(Number);
      if (
        Math.abs(cx - playerChunkX) > radius ||
        Math.abs(cz - playerChunkZ) > radius
      ) {
        chunk.solidVertexBuffer?.destroy();
        chunk.waterVertexBuffer?.destroy();
        this.chunks.delete(key);
      }
    }
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  setDroppedItems(items: DroppedItemSnapshot[], nowMs = performance.now()) {
    const previousStates = new Map(this.droppedItems.map((item) => [item.snapshot.id, item] as const));
    this.droppedItems = items.map((snapshot) => {
      const previous = previousStates.get(snapshot.id);
      const currentPosition = previous
        ? this.interpolateDroppedItemPosition(previous, nowMs)
        : snapshot.position;
      return {
        snapshot,
        fromPosition: currentPosition,
        toPosition: snapshot.position,
        updatedAtMs: nowMs,
      };
    });
  }

  /** Encode all draw calls into an existing render pass. */
  draw(pass: GPURenderPassEncoder, pipelines: RenderPipelines, nowMs: number) {
    pass.setPipeline(pipelines.terrainPipeline);
    pass.setBindGroup(0, pipelines.bindGroup);

    for (const chunk of this.chunks.values()) {
      if (!chunk.solidVertexBuffer || chunk.solidVertexCount === 0) continue;
      pass.setVertexBuffer(0, chunk.solidVertexBuffer);
      pass.draw(chunk.solidVertexCount);
    }

    this.updateDroppedItemBuffer(nowMs);
    if (this.droppedItemBuffer && this.droppedItemVertexCount > 0) {
      pass.setVertexBuffer(0, this.droppedItemBuffer);
      pass.draw(this.droppedItemVertexCount);
    }

    pass.setPipeline(pipelines.waterPipeline);
    pass.setBindGroup(0, pipelines.bindGroup);
    for (const chunk of this.chunks.values()) {
      if (!chunk.waterVertexBuffer || chunk.waterVertexCount === 0) continue;
      pass.setVertexBuffer(0, chunk.waterVertexBuffer);
      pass.draw(chunk.waterVertexCount);
    }
  }

  private updateDroppedItemBuffer(nowMs: number) {
    if (this.droppedItems.length === 0) {
      this.droppedItemVertexCount = 0;
      return;
    }

    const verts: number[] = [];
    for (const item of this.droppedItems) {
      this.pushDroppedItemVerts(verts, item, nowMs);
    }
    this.droppedItemVertexCount = verts.length / 9;
    const data = new Float32Array(verts);
    const requiredSize = data.byteLength;
    if (!this.droppedItemBuffer || this.droppedItemBufferSize < requiredSize) {
      this.droppedItemBuffer?.destroy();
      this.droppedItemBuffer = this.device.createBuffer({
        size: Math.max(requiredSize, 36 * 6 * 8),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.droppedItemBufferSize = Math.max(requiredSize, 36 * 6 * 8);
    }
    this.device.queue.writeBuffer(this.droppedItemBuffer, 0, data);
  }

  private pushDroppedItemVerts(verts: number[], item: DroppedItemRenderState, nowMs: number) {
    const position = this.interpolateDroppedItemPosition(item, nowMs);
    const bob = Math.sin((nowMs + position.x * 100 + position.z * 70) / 220) * 0.06;
    const halfW = 0.18;
    const height = 0.36;
    const x = position.x;
    const y = position.y + bob;
    const z = position.z;
    const color = getItemRenderColor(item.snapshot.itemId as ItemId);
    const quads = [
      {
        normal: [0.707, 0, 0.707] as [number, number, number],
        points: [
          [x - halfW, y, z - halfW],
          [x - halfW, y + height, z - halfW],
          [x + halfW, y + height, z + halfW],
          [x + halfW, y, z + halfW],
        ],
      },
      {
        normal: [-0.707, 0, 0.707] as [number, number, number],
        points: [
          [x + halfW, y, z - halfW],
          [x + halfW, y + height, z - halfW],
          [x - halfW, y + height, z + halfW],
          [x - halfW, y, z + halfW],
        ],
      },
    ];

    for (const quad of quads) {
      this.pushQuad(verts, quad.points, quad.normal, color);
      this.pushQuad(verts, [quad.points[2], quad.points[1], quad.points[0], quad.points[3]], [-quad.normal[0], 0, -quad.normal[2]], color);
    }
  }

  private interpolateDroppedItemPosition(item: DroppedItemRenderState, nowMs: number): Vec3 {
    const alpha = Math.max(0, Math.min(1, (nowMs - item.updatedAtMs) / DROPPED_ITEM_INTERPOLATION_MS));
    return {
      x: item.fromPosition.x + (item.toPosition.x - item.fromPosition.x) * alpha,
      y: item.fromPosition.y + (item.toPosition.y - item.fromPosition.y) * alpha,
      z: item.fromPosition.z + (item.toPosition.z - item.fromPosition.z) * alpha,
    };
  }

  private pushQuad(
    verts: number[],
    points: number[][],
    normal: [number, number, number],
    color: [number, number, number],
  ) {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = points[index];
      verts.push(point[0], point[1], point[2], normal[0], normal[1], normal[2], color[0], color[1], color[2]);
    }
  }
}
