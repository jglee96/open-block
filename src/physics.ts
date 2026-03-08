/// Player AABB: 0.6 × 1.8 × 0.6 (Minecraft standard)
const HALF_W = 0.3;  // half width / depth
const HEIGHT  = 1.8;

const GRAVITY    = -28; // blocks/s²
const JUMP_VEL   =   8; // blocks/s
const WALK_SPEED = 4.3; // blocks/s
const H_FRICTION = 0.8; // horizontal velocity multiplier when no input (per-tick decay)

type IsSolid = (x: number, y: number, z: number) => boolean;

/** Returns true if the AABB [minX..maxX, minY..maxY, minZ..maxZ] overlaps any solid block. */
function overlapsWorld(
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
  isSolid: IsSolid,
): boolean {
  const x0 = Math.floor(minX), x1 = Math.floor(maxX);
  const y0 = Math.floor(minY), y1 = Math.floor(maxY);
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

export class PlayerPhysics {
  vx = 0; vy = 0; vz = 0;
  onGround = false;

  /**
   * Advance physics by dt seconds.
   * @param feet - player feet position [x, y, z], mutated in place
   * @param yaw  - camera yaw (radians) for movement direction
   * @param keys - currently pressed key codes
   * @param dt   - delta time (seconds), should be capped to ~0.05
   * @param isSolid - block solidity query
   */
  tick(
    feet: [number, number, number],
    yaw: number,
    keys: Set<string>,
    dt: number,
    isSolid: IsSolid,
  ): void {
    // ── Gravity ────────────────────────────────────────────────────────────
    this.vy += GRAVITY * dt;

    // ── Jump ───────────────────────────────────────────────────────────────
    if (keys.has("Space") && this.onGround) {
      this.vy = JUMP_VEL;
      this.onGround = false;
    }

    // ── Horizontal movement ────────────────────────────────────────────────
    const fwdX = Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rgtX = Math.cos(yaw);
    const rgtZ = Math.sin(yaw);

    let mx = 0, mz = 0;
    if (keys.has("KeyW")) { mx += fwdX; mz += fwdZ; }
    if (keys.has("KeyS")) { mx -= fwdX; mz -= fwdZ; }
    if (keys.has("KeyA")) { mx -= rgtX; mz -= rgtZ; }
    if (keys.has("KeyD")) { mx += rgtX; mz += rgtZ; }

    const hLen = Math.sqrt(mx * mx + mz * mz);
    if (hLen > 0) {
      this.vx = (mx / hLen) * WALK_SPEED;
      this.vz = (mz / hLen) * WALK_SPEED;
    } else {
      this.vx *= H_FRICTION;
      this.vz *= H_FRICTION;
    }

    // ── Sweep X ────────────────────────────────────────────────────────────
    const dx = this.vx * dt;
    const nx = feet[0] + dx;
    if (!overlapsWorld(
      nx - HALF_W, nx + HALF_W,
      feet[1], feet[1] + HEIGHT,
      feet[2] - HALF_W, feet[2] + HALF_W,
      isSolid,
    )) {
      feet[0] = nx;
    } else {
      this.vx = 0;
    }

    // ── Sweep Y ────────────────────────────────────────────────────────────
    const dy = this.vy * dt;
    const ny = feet[1] + dy;
    if (!overlapsWorld(
      feet[0] - HALF_W, feet[0] + HALF_W,
      ny, ny + HEIGHT,
      feet[2] - HALF_W, feet[2] + HALF_W,
      isSolid,
    )) {
      feet[1] = ny;
      this.onGround = false;
    } else {
      if (dy < 0) this.onGround = true; // landed on floor
      this.vy = 0;
    }

    // ── Sweep Z ────────────────────────────────────────────────────────────
    const dz = this.vz * dt;
    const nz = feet[2] + dz;
    if (!overlapsWorld(
      feet[0] - HALF_W, feet[0] + HALF_W,
      feet[1], feet[1] + HEIGHT,
      nz - HALF_W, nz + HALF_W,
      isSolid,
    )) {
      feet[2] = nz;
    } else {
      this.vz = 0;
    }
  }
}
