/// Player AABB: 0.6 × 1.8 × 0.6 (Minecraft standard)
const HALF_W = 0.3;  // half width / depth
const HEIGHT  = 1.8;

const GRAVITY    = -28; // blocks/s²
const JUMP_VEL   =   8; // blocks/s
const WALK_SPEED = 4.3; // blocks/s
const H_FRICTION = 0.8; // horizontal velocity multiplier when no input (per-tick decay)

type IsSolid = (x: number, y: number, z: number) => boolean;
type SampleMedium = (
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
) => { submersion: number; flowX: number; flowY: number; flowZ: number };

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
    sampleMedium: SampleMedium,
  ): void {
    const medium = sampleMedium(
      feet[0] - HALF_W, feet[0] + HALF_W,
      feet[1], feet[1] + HEIGHT,
      feet[2] - HALF_W, feet[2] + HALF_W,
    );
    const inWater = medium.submersion > 0.05;
    const swimming = medium.submersion > 0.45;

    const gravityScale = swimming ? 0.22 : inWater ? 0.55 : 1;
    this.vy += GRAVITY * gravityScale * dt;
    if (inWater) {
      this.vy = Math.max(this.vy, swimming ? -4.0 : -9.0);
      this.vx += medium.flowX * dt * 3.4;
      this.vz += medium.flowZ * dt * 3.4;
      this.vy += medium.flowY * dt;
    }

    // ── Jump ───────────────────────────────────────────────────────────────
    if (swimming && keys.has("Space")) {
      this.vy += 10 * dt;
      this.onGround = false;
    } else if (keys.has("Space") && this.onGround) {
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
    const moveSpeed = swimming ? 2.4 : inWater ? 3.2 : WALK_SPEED;
    if (hLen > 0) {
      const targetVx = (mx / hLen) * moveSpeed;
      const targetVz = (mz / hLen) * moveSpeed;
      const blend = swimming ? 0.24 : inWater ? 0.45 : 1;
      this.vx += (targetVx - this.vx) * blend;
      this.vz += (targetVz - this.vz) * blend;
    } else {
      const drag = swimming ? 0.86 : inWater ? 0.72 : H_FRICTION;
      this.vx *= drag;
      this.vz *= drag;
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
