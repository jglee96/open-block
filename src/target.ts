import type { RayHit } from "./raycast";
import type { EntitySnapshot } from "./worker/protocol";

export interface BlockTargetHit {
  kind: "block";
  hit: RayHit;
  blockType: number;
}

export interface EntityTargetHit {
  kind: "entity";
  entity: EntitySnapshot;
  distance: number;
}

export type TargetHit = BlockTargetHit | EntityTargetHit | null;
