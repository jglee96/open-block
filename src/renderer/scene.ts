import type { GpuContext } from "./gpu";
import type { RenderPipelines } from "./pipeline";
import { getItemRenderColor, type ItemId } from "../gameplay/items";
import type { DroppedItemSnapshot, EntitySnapshot, Vec3 } from "../worker/protocol";

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

const DROPPED_ITEM_INTERPOLATION_MS = 60;
const ENTITY_INTERPOLATION_MS = 90;

const PIG_BODY_COLOR: [number, number, number] = [0.94, 0.68, 0.74];
const PIG_HEAD_COLOR: [number, number, number] = [0.98, 0.75, 0.81];
const SHEEP_BODY_COLOR: [number, number, number] = [0.92, 0.93, 0.89];
const SHEEP_HEAD_COLOR: [number, number, number] = [0.28, 0.24, 0.2];
const ZOMBIE_BODY_COLOR: [number, number, number] = [0.2, 0.47, 0.82];
const ZOMBIE_HEAD_COLOR: [number, number, number] = [0.45, 0.7, 0.36];
const LEG_COLOR: [number, number, number] = [0.22, 0.16, 0.14];

interface DroppedItemRenderState {
  snapshot: DroppedItemSnapshot;
  fromPosition: Vec3;
  toPosition: Vec3;
  updatedAtMs: number;
}

interface EntityRenderState {
  snapshot: EntitySnapshot;
  fromPosition: Vec3;
  toPosition: Vec3;
  updatedAtMs: number;
}

export class Scene {
  private device: GPUDevice;
  private chunks = new Map<string, ChunkBuffer>();
  private entities: EntityRenderState[] = [];
  private entityBuffer: GPUBuffer | null = null;
  private entityBufferSize = 0;
  private entityVertexCount = 0;
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

  setEntities(entities: EntitySnapshot[], nowMs = performance.now()) {
    const previousStates = new Map(this.entities.map((entity) => [entity.snapshot.id, entity] as const));
    this.entities = entities.map((snapshot) => {
      const previous = previousStates.get(snapshot.id);
      const currentPosition = previous
        ? this.interpolatePosition(previous.fromPosition, previous.toPosition, previous.updatedAtMs, nowMs, ENTITY_INTERPOLATION_MS)
        : snapshot.position;
      return {
        snapshot,
        fromPosition: currentPosition,
        toPosition: snapshot.position,
        updatedAtMs: nowMs,
      };
    });
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

    this.updateEntityBuffer(nowMs);
    if (this.entityBuffer && this.entityVertexCount > 0) {
      pass.setVertexBuffer(0, this.entityBuffer);
      pass.draw(this.entityVertexCount);
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

  private updateEntityBuffer(nowMs: number) {
    if (this.entities.length === 0) {
      this.entityVertexCount = 0;
      return;
    }

    const verts: number[] = [];
    for (const entity of this.entities) {
      this.pushEntityVerts(verts, entity, nowMs);
    }

    this.entityVertexCount = verts.length / 9;
    const data = new Float32Array(verts);
    const requiredSize = data.byteLength;
    if (!this.entityBuffer || this.entityBufferSize < requiredSize) {
      this.entityBuffer?.destroy();
      this.entityBuffer = this.device.createBuffer({
        size: Math.max(requiredSize, 36 * 6 * 24),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.entityBufferSize = Math.max(requiredSize, 36 * 6 * 24);
    }
    this.device.queue.writeBuffer(this.entityBuffer, 0, data);
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

  private pushEntityVerts(verts: number[], entity: EntityRenderState, nowMs: number) {
    const position = this.interpolatePosition(entity.fromPosition, entity.toPosition, entity.updatedAtMs, nowMs, ENTITY_INTERPOLATION_MS);
    const scale = entity.snapshot.isBaby ? 0.58 : 1;
    switch (entity.snapshot.kind) {
      case "pig":
        this.pushPigVerts(verts, position, entity.snapshot.radius, entity.snapshot.halfHeight, scale);
        break;
      case "sheep":
        this.pushSheepVerts(verts, position, entity.snapshot.radius, entity.snapshot.halfHeight, scale);
        break;
      case "zombie":
        this.pushZombieVerts(verts, position, entity.snapshot.radius, entity.snapshot.halfHeight, scale);
        break;
    }
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
    return this.interpolatePosition(item.fromPosition, item.toPosition, item.updatedAtMs, nowMs, DROPPED_ITEM_INTERPOLATION_MS);
  }

  private interpolatePosition(fromPosition: Vec3, toPosition: Vec3, updatedAtMs: number, nowMs: number, durationMs: number): Vec3 {
    const alpha = Math.max(0, Math.min(1, (nowMs - updatedAtMs) / durationMs));
    return {
      x: fromPosition.x + (toPosition.x - fromPosition.x) * alpha,
      y: fromPosition.y + (toPosition.y - fromPosition.y) * alpha,
      z: fromPosition.z + (toPosition.z - fromPosition.z) * alpha,
    };
  }

  private pushPigVerts(
    verts: number[],
    position: Vec3,
    radius: number,
    halfHeight: number,
    scale: number,
  ) {
    const bodyHalfX = radius * 0.95 * scale;
    const bodyHalfZ = radius * 0.72 * scale;
    const bodyMinY = position.y + halfHeight * 0.32 * scale;
    const bodyMaxY = bodyMinY + halfHeight * 0.62 * scale;
    const legHalf = radius * 0.16 * scale;
    const legHeight = bodyMinY - position.y;
    const headHalf = radius * 0.34 * scale;
    const headMinY = position.y + halfHeight * 0.44 * scale;
    const headMaxY = headMinY + halfHeight * 0.42 * scale;
    const headCenterX = position.x + radius * 1.02 * scale;

    this.pushBox(verts, position.x - bodyHalfX, bodyMinY, position.z - bodyHalfZ, position.x + bodyHalfX, bodyMaxY, position.z + bodyHalfZ, PIG_BODY_COLOR);
    this.pushBox(verts, headCenterX - headHalf, headMinY, position.z - headHalf, headCenterX + headHalf, headMaxY, position.z + headHalf, PIG_HEAD_COLOR);
    this.pushAnimalLegs(verts, position, bodyHalfX * 0.7, bodyHalfZ * 0.7, legHalf, legHeight, LEG_COLOR);
  }

  private pushSheepVerts(
    verts: number[],
    position: Vec3,
    radius: number,
    halfHeight: number,
    scale: number,
  ) {
    const bodyHalfX = radius * 1.02 * scale;
    const bodyHalfZ = radius * 0.82 * scale;
    const bodyMinY = position.y + halfHeight * 0.28 * scale;
    const bodyMaxY = bodyMinY + halfHeight * 0.82 * scale;
    const legHalf = radius * 0.14 * scale;
    const legHeight = bodyMinY - position.y;
    const headHalfX = radius * 0.28 * scale;
    const headHalfZ = radius * 0.22 * scale;
    const headMinY = position.y + halfHeight * 0.46 * scale;
    const headMaxY = headMinY + halfHeight * 0.44 * scale;
    const headCenterX = position.x + radius * 1.06 * scale;

    this.pushBox(verts, position.x - bodyHalfX, bodyMinY, position.z - bodyHalfZ, position.x + bodyHalfX, bodyMaxY, position.z + bodyHalfZ, SHEEP_BODY_COLOR);
    this.pushBox(verts, headCenterX - headHalfX, headMinY, position.z - headHalfZ, headCenterX + headHalfX, headMaxY, position.z + headHalfZ, SHEEP_HEAD_COLOR);
    this.pushAnimalLegs(verts, position, bodyHalfX * 0.72, bodyHalfZ * 0.72, legHalf, legHeight, LEG_COLOR);
  }

  private pushZombieVerts(
    verts: number[],
    position: Vec3,
    radius: number,
    halfHeight: number,
    scale: number,
  ) {
    const legHalfX = radius * 0.22 * scale;
    const legHalfZ = radius * 0.2 * scale;
    const legMaxY = position.y + halfHeight * 0.76 * scale;
    const torsoHalfX = radius * 0.62 * scale;
    const torsoHalfZ = radius * 0.34 * scale;
    const torsoMinY = legMaxY;
    const torsoMaxY = position.y + halfHeight * 1.58 * scale;
    const armHalfX = radius * 0.18 * scale;
    const armHalfZ = radius * 0.18 * scale;
    const armMinY = position.y + halfHeight * 0.78 * scale;
    const armMaxY = position.y + halfHeight * 1.44 * scale;
    const headHalf = radius * 0.42 * scale;
    const headMinY = torsoMaxY;
    const headMaxY = position.y + halfHeight * 2 * scale;

    this.pushBox(verts, position.x - legHalfX - radius * 0.18 * scale, position.y, position.z - legHalfZ, position.x - radius * 0.18 * scale + legHalfX, legMaxY, position.z + legHalfZ, [0.2, 0.28, 0.55]);
    this.pushBox(verts, position.x + radius * 0.18 * scale - legHalfX, position.y, position.z - legHalfZ, position.x + radius * 0.18 * scale + legHalfX, legMaxY, position.z + legHalfZ, [0.2, 0.28, 0.55]);
    this.pushBox(verts, position.x - torsoHalfX, torsoMinY, position.z - torsoHalfZ, position.x + torsoHalfX, torsoMaxY, position.z + torsoHalfZ, ZOMBIE_BODY_COLOR);
    this.pushBox(verts, position.x - torsoHalfX - armHalfX * 1.6, armMinY, position.z - armHalfZ, position.x - torsoHalfX + armHalfX * 0.4, armMaxY, position.z + armHalfZ, ZOMBIE_BODY_COLOR);
    this.pushBox(verts, position.x + torsoHalfX - armHalfX * 0.4, armMinY, position.z - armHalfZ, position.x + torsoHalfX + armHalfX * 1.6, armMaxY, position.z + armHalfZ, ZOMBIE_BODY_COLOR);
    this.pushBox(verts, position.x - headHalf, headMinY, position.z - headHalf, position.x + headHalf, headMaxY, position.z + headHalf, ZOMBIE_HEAD_COLOR);
  }

  private pushAnimalLegs(
    verts: number[],
    position: Vec3,
    offsetX: number,
    offsetZ: number,
    legHalf: number,
    legHeight: number,
    color: [number, number, number],
  ) {
    const legs: Array<[number, number]> = [
      [-offsetX, -offsetZ],
      [-offsetX, offsetZ],
      [offsetX, -offsetZ],
      [offsetX, offsetZ],
    ];
    for (const [xOffset, zOffset] of legs) {
      this.pushBox(
        verts,
        position.x + xOffset - legHalf,
        position.y,
        position.z + zOffset - legHalf,
        position.x + xOffset + legHalf,
        position.y + legHeight,
        position.z + zOffset + legHalf,
        color,
      );
    }
  }

  private pushBox(
    verts: number[],
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    color: [number, number, number],
  ) {
    this.pushQuad(verts, [
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ],
    ], [0, 0, 1], color);
    this.pushQuad(verts, [
      [maxX, minY, minZ],
      [minX, minY, minZ],
      [minX, maxY, minZ],
      [maxX, maxY, minZ],
    ], [0, 0, -1], color);
    this.pushQuad(verts, [
      [minX, minY, minZ],
      [minX, minY, maxZ],
      [minX, maxY, maxZ],
      [minX, maxY, minZ],
    ], [-1, 0, 0], color);
    this.pushQuad(verts, [
      [maxX, minY, maxZ],
      [maxX, minY, minZ],
      [maxX, maxY, minZ],
      [maxX, maxY, maxZ],
    ], [1, 0, 0], color);
    this.pushQuad(verts, [
      [minX, maxY, maxZ],
      [maxX, maxY, maxZ],
      [maxX, maxY, minZ],
      [minX, maxY, minZ],
    ], [0, 1, 0], color);
    this.pushQuad(verts, [
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, minY, maxZ],
      [minX, minY, maxZ],
    ], [0, -1, 0], color);
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
