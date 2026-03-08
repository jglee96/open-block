import { HotbarManager } from "../hotbar";
import { isHoeItem } from "../gameplay/items";
import type { TargetHit } from "../target";
import type { MainToWorker } from "../worker/protocol";
import { wouldOverlapPlayer } from "./targeting";

type ConcreteTargetHit = Exclude<TargetHit, null>;

interface InteractionControllerOptions {
  hotbar: HotbarManager;
  playerFeet: [number, number, number];
  isWorkerReady: () => boolean;
  postToWorker: (msg: MainToWorker) => void;
}

export class InteractionController {
  constructor(private readonly options: InteractionControllerOptions) {}

  handleMouseDown(button: number, targetHit: TargetHit) {
    if (!this.options.isWorkerReady() || !targetHit) return;

    if (button === 0) {
      this.handlePrimaryInteraction(targetHit);
      return;
    }

    if (button === 2) {
      this.handleSecondaryInteraction(targetHit);
    }
  }

  private handlePrimaryInteraction(targetHit: ConcreteTargetHit) {
    if (targetHit.kind === "entity") {
      this.options.postToWorker({
        type: "INTERACT_ENTITY",
        entityId: targetHit.entity.id,
        action: "attack",
      });
      return;
    }

    this.options.postToWorker({
      type: "BREAK_BLOCK",
      worldX: targetHit.hit.worldX,
      worldY: targetHit.hit.worldY,
      worldZ: targetHit.hit.worldZ,
    });
  }

  private handleSecondaryInteraction(targetHit: ConcreteTargetHit) {
    if (targetHit.kind === "entity") {
      this.options.postToWorker({
        type: "INTERACT_ENTITY",
        entityId: targetHit.entity.id,
        action: "interact",
      });
      return;
    }

    const selectedItemId = this.options.hotbar.selectedItemId;
    if (!selectedItemId || this.options.hotbar.getSelectedCount() <= 0) return;

    if (isHoeItem(selectedItemId)) {
      this.options.postToWorker({
        type: "TILL_BLOCK",
        worldX: targetHit.hit.worldX,
        worldY: targetHit.hit.worldY,
        worldZ: targetHit.hit.worldZ,
        itemId: selectedItemId,
      });
      return;
    }

    const px = targetHit.hit.worldX + targetHit.hit.faceNormal[0];
    const py = targetHit.hit.worldY + targetHit.hit.faceNormal[1];
    const pz = targetHit.hit.worldZ + targetHit.hit.faceNormal[2];
    if (wouldOverlapPlayer(px, py, pz, this.options.playerFeet)) return;

    this.options.postToWorker({
      type: "PLACE_ITEM",
      worldX: px,
      worldY: py,
      worldZ: pz,
      itemId: selectedItemId,
    });
  }
}
