import { PlayerPhysics } from "../physics";
import type { Camera } from "../renderer/camera";
import { HighlightRenderer } from "../renderer/highlight";
import type { InputManager } from "../renderer/input";
import type { EntitySnapshot } from "../worker/protocol";
import type { TargetHit } from "../target";
import { BlockCache } from "./block-cache";
import { ChunkStreamingController } from "./chunk-streaming";
import { findBlockTarget, findEntityTarget, pickNearestTarget } from "./targeting";

interface GameplayRuntimeOptions {
  camera: Camera;
  input: InputManager;
  physics: PlayerPhysics;
  blockCache: BlockCache;
  chunkStreaming: ChunkStreamingController;
  highlight: HighlightRenderer;
  device: GPUDevice;
  playerFeet: [number, number, number];
  eyeHeight: number;
  maxInteractDistance: number;
  chunkSize: number;
  chunksPerFrame: number;
}

interface TickPayload {
  dt: number;
  playerPos: { x: number; y: number; z: number };
  isSheltered: boolean;
}

export interface GameplayStepResult {
  fps: number;
  targetHit: TargetHit;
  tickPayload: TickPayload | null;
}

export class GameplayRuntime {
  private lastTime = performance.now();
  private tickAccumulator = 0;
  private fpsCounter = 0;
  private fpsElapsed = 0;
  private fpsValue = 0;
  private targetHit: TargetHit = null;

  constructor(private readonly options: GameplayRuntimeOptions) {}

  step(now: number, entitySnapshots: EntitySnapshot[], workerReady: boolean): GameplayStepResult {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    let tickPayload: TickPayload | null = null;

    if (this.options.input.locked) {
      this.updatePlayerView();
      this.updatePlayerMovement(dt);

      if (workerReady) {
        this.options.chunkStreaming.updateFocus(
          this.options.camera.position[0],
          this.options.camera.position[2],
          this.options.chunkSize,
        );
        this.options.chunkStreaming.flush(this.options.chunksPerFrame);
      }

      this.targetHit = this.resolveTarget(entitySnapshots);
      this.updateHighlight();

      this.tickAccumulator += dt;
      if (workerReady && this.tickAccumulator >= 0.05) {
        tickPayload = {
          dt: this.tickAccumulator,
          playerPos: {
            x: this.options.camera.position[0],
            y: this.options.camera.position[1],
            z: this.options.camera.position[2],
          },
          isSheltered: this.isPlayerSheltered(),
        };
        this.tickAccumulator = 0;
      }
    }

    this.fpsCounter += 1;
    this.fpsElapsed += dt;
    if (this.fpsElapsed >= 0.25) {
      this.fpsValue = this.fpsCounter / this.fpsElapsed;
      this.fpsCounter = 0;
      this.fpsElapsed = 0;
    }

    return {
      fps: this.fpsValue,
      targetHit: this.targetHit,
      tickPayload,
    };
  }

  getPlayerFeet(): [number, number, number] {
    return this.options.playerFeet;
  }

  setPlayerPose(pose: { x: number; y: number; z: number; yaw?: number; pitch?: number }) {
    this.options.playerFeet[0] = pose.x;
    this.options.playerFeet[1] = pose.y;
    this.options.playerFeet[2] = pose.z;
    this.options.camera.position[0] = pose.x;
    this.options.camera.position[1] = pose.y + this.options.eyeHeight;
    this.options.camera.position[2] = pose.z;
    if (typeof pose.yaw === "number") this.options.camera.yaw = pose.yaw;
    if (typeof pose.pitch === "number") this.options.camera.pitch = pose.pitch;
  }

  sampleTarget(entitySnapshots: EntitySnapshot[]): TargetHit {
    this.targetHit = this.resolveTarget(entitySnapshots);
    this.updateHighlight();
    return this.targetHit;
  }

  private updatePlayerView() {
    const { dx, dy } = this.options.input.consumeDelta();
    this.options.camera.yaw += dx;
    this.options.camera.pitch = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, this.options.camera.pitch - dy),
    );
  }

  private updatePlayerMovement(dt: number) {
    this.options.physics.tick(
      this.options.playerFeet,
      this.options.camera.yaw,
      this.options.input.keys,
      dt,
      this.options.blockCache.isSolid.bind(this.options.blockCache),
    );
    this.options.camera.position[0] = this.options.playerFeet[0];
    this.options.camera.position[1] = this.options.playerFeet[1] + this.options.eyeHeight;
    this.options.camera.position[2] = this.options.playerFeet[2];
  }

  private resolveTarget(entitySnapshots: EntitySnapshot[]): TargetHit {
    const blockTarget = findBlockTarget(
      this.options.camera,
      this.options.maxInteractDistance,
      this.options.blockCache.isTargetable.bind(this.options.blockCache),
      this.options.blockCache.getBlockTypeAt.bind(this.options.blockCache),
    );
    const entityTarget = findEntityTarget(this.options.camera, entitySnapshots, this.options.maxInteractDistance);
    return pickNearestTarget(blockTarget, entityTarget);
  }

  private updateHighlight() {
    if (this.targetHit?.kind === "block") {
      this.options.highlight.setTarget(this.options.device, {
        minX: this.targetHit.hit.worldX,
        minY: this.targetHit.hit.worldY,
        minZ: this.targetHit.hit.worldZ,
        maxX: this.targetHit.hit.worldX + 1,
        maxY: this.targetHit.hit.worldY + 1,
        maxZ: this.targetHit.hit.worldZ + 1,
      });
      return;
    }

    if (this.targetHit?.kind === "entity") {
      const entity = this.targetHit.entity;
      this.options.highlight.setTarget(this.options.device, {
        minX: entity.position.x - entity.radius,
        minY: entity.position.y,
        minZ: entity.position.z - entity.radius,
        maxX: entity.position.x + entity.radius,
        maxY: entity.position.y + entity.halfHeight * 2,
        maxZ: entity.position.z + entity.radius,
      });
      return;
    }

    this.options.highlight.setTarget(this.options.device, null);
  }

  private isPlayerSheltered(): boolean {
    const x = this.options.camera.position[0];
    const y = this.options.camera.position[1];
    const z = this.options.camera.position[2];
    return (
      this.options.blockCache.isSolid(x, y + 0.4, z) ||
      this.options.blockCache.isSolid(x, y + 1.0, z) ||
      this.options.blockCache.isSolid(x, y + 1.8, z)
    );
  }
}
