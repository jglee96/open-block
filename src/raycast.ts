export interface RayHit {
  worldX: number;
  worldY: number;
  worldZ: number;
  /** Normal of the face that was hit (points away from the block). */
  faceNormal: [number, number, number];
  /** Travel distance from ray origin to first hit surface. */
  distance: number;
}

/**
 * Amanatides & Woo DDA raycast.
 * Steps through voxels along the ray until a solid block is hit.
 *
 * @param origin  - ray start position [x, y, z]
 * @param dir     - ray direction (need not be normalised, but should be non-zero)
 * @param maxDist - maximum distance to travel
 * @param isHitBlock - block hit query (integer coords)
 */
export function raycast(
  origin: [number, number, number],
  dir: [number, number, number],
  maxDist: number,
  isHitBlock: (x: number, y: number, z: number) => boolean,
): RayHit | null {
  const INF = 1e30;
  let bx = Math.floor(origin[0]);
  let by = Math.floor(origin[1]);
  let bz = Math.floor(origin[2]);

  const sx = dir[0] > 0 ? 1 : -1;
  const sy = dir[1] > 0 ? 1 : -1;
  const sz = dir[2] > 0 ? 1 : -1;

  const tdx = Math.abs(dir[0]) < 1e-10 ? INF : Math.abs(1.0 / dir[0]);
  const tdy = Math.abs(dir[1]) < 1e-10 ? INF : Math.abs(1.0 / dir[1]);
  const tdz = Math.abs(dir[2]) < 1e-10 ? INF : Math.abs(1.0 / dir[2]);

  let tMaxX = Math.abs(dir[0]) < 1e-10 ? INF : ((sx > 0 ? bx + 1 : bx) - origin[0]) / dir[0];
  let tMaxY = Math.abs(dir[1]) < 1e-10 ? INF : ((sy > 0 ? by + 1 : by) - origin[1]) / dir[1];
  let tMaxZ = Math.abs(dir[2]) < 1e-10 ? INF : ((sz > 0 ? bz + 1 : bz) - origin[2]) / dir[2];

  let normal: [number, number, number] = [0, 0, 0];
  let traveled = 0;

  while (Math.min(tMaxX, tMaxY, tMaxZ) <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      bx += sx;
      traveled = tMaxX;
      tMaxX += tdx;
      normal = [-sx, 0, 0];
    } else if (tMaxY < tMaxZ) {
      by += sy;
      traveled = tMaxY;
      tMaxY += tdy;
      normal = [0, -sy, 0];
    } else {
      bz += sz;
      traveled = tMaxZ;
      tMaxZ += tdz;
      normal = [0, 0, -sz];
    }

    if (traveled > maxDist) break;

    if (isHitBlock(bx, by, bz)) {
      return {
        worldX: bx,
        worldY: by,
        worldZ: bz,
        faceNormal: normal,
        distance: traveled,
      };
    }
  }

  return null;
}
