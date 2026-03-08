import { raycast } from "../raycast";
import type { TargetHit, EntityTargetHit } from "../target";
import type { Camera } from "../renderer/camera";
import type { EntitySnapshot } from "../worker/protocol";

interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function isFiniteVector(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

export function findBlockTarget(
  camera: Camera,
  maxInteractDistance: number,
  isSolid: (x: number, y: number, z: number) => boolean,
  getBlockTypeAt: (x: number, y: number, z: number) => number,
): TargetHit {
  const fwd = camera.forward as [number, number, number];
  const pos = camera.position as unknown as [number, number, number];

  if (!isFiniteVector(pos[0], pos[1], pos[2]) || !isFiniteVector(fwd[0], fwd[1], fwd[2])) {
    return null;
  }

  const hit = raycast(pos, fwd, maxInteractDistance, isSolid);
  if (!hit) return null;
  if (!Number.isFinite(hit.distance) || hit.distance < 0 || hit.distance > maxInteractDistance + 0.001) {
    return null;
  }

  return {
    kind: "block",
    hit,
    blockType: getBlockTypeAt(hit.worldX, hit.worldY, hit.worldZ),
  };
}

export function findEntityTarget(
  camera: Camera,
  entities: EntitySnapshot[],
  maxDist: number,
): EntityTargetHit | null {
  const origin: [number, number, number] = [camera.position[0], camera.position[1], camera.position[2]];
  const dir: [number, number, number] = [camera.forward[0], camera.forward[1], camera.forward[2]];

  if (!isFiniteVector(origin[0], origin[1], origin[2]) || !isFiniteVector(dir[0], dir[1], dir[2])) {
    return null;
  }

  let best: EntityTargetHit | null = null;

  for (const entity of entities) {
    const distance = rayAabb(origin, dir, {
      minX: entity.position.x - entity.radius,
      minY: entity.position.y,
      minZ: entity.position.z - entity.radius,
      maxX: entity.position.x + entity.radius,
      maxY: entity.position.y + entity.halfHeight * 2,
      maxZ: entity.position.z + entity.radius,
    }, maxDist);

    if (distance === null) continue;
    if (!best || distance < best.distance) {
      best = { kind: "entity", entity, distance };
    }
  }

  return best;
}

export function pickNearestTarget(blockTarget: TargetHit, entityTarget: EntityTargetHit | null): TargetHit {
  if (!blockTarget) return entityTarget;
  if (!entityTarget) return blockTarget;
  if (blockTarget.kind !== "block") return blockTarget;
  return entityTarget.distance < blockTarget.hit.distance ? entityTarget : blockTarget;
}

export function wouldOverlapPlayer(
  blockX: number,
  blockY: number,
  blockZ: number,
  feet: [number, number, number],
) {
  const playerMinX = feet[0] - 0.3;
  const playerMaxX = feet[0] + 0.3;
  const playerMinY = feet[1];
  const playerMaxY = feet[1] + 1.8;
  const playerMinZ = feet[2] - 0.3;
  const playerMaxZ = feet[2] + 0.3;

  return (
    playerMinX < blockX + 1 &&
    playerMaxX > blockX &&
    playerMinY < blockY + 1 &&
    playerMaxY > blockY &&
    playerMinZ < blockZ + 1 &&
    playerMaxZ > blockZ
  );
}

function rayAabb(origin: [number, number, number], dir: [number, number, number], aabb: Aabb, maxDist: number): number | null {
  let tMin = 0;
  let tMax = maxDist;

  const axes: Array<[number, number, number, number]> = [
    [origin[0], dir[0], aabb.minX, aabb.maxX],
    [origin[1], dir[1], aabb.minY, aabb.maxY],
    [origin[2], dir[2], aabb.minZ, aabb.maxZ],
  ];

  for (const [o, d, minB, maxB] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < minB || o > maxB) return null;
      continue;
    }

    const inv = 1 / d;
    let t1 = (minB - o) * inv;
    let t2 = (maxB - o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (!Number.isFinite(tMin) || tMin < 0 || tMin > maxDist) return null;
  return tMin;
}
