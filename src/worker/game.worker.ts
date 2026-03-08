import { GameSession } from "./game-session";
import type { MainToWorker, WorkerToMain } from "./protocol";

function post(msg: WorkerToMain, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, { transfer });
    return;
  }
  self.postMessage(msg);
}

const session = new GameSession(post);

self.onmessage = async (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case "INIT":
        await session.init(msg.seed);
        break;

      case "GENERATE_CHUNK":
        session.requireReady();
        session.generateChunk(msg.chunkX, msg.chunkZ);
        break;

      case "SET_BLOCK":
        session.requireReady();
        session.setBlock(msg.worldX, msg.worldY, msg.worldZ, msg.blockType);
        break;

      case "BREAK_BLOCK":
        session.requireReady();
        session.breakBlock(msg.worldX, msg.worldY, msg.worldZ);
        break;

      case "PLACE_ITEM":
        session.requireReady();
        session.placeItem(msg.worldX, msg.worldY, msg.worldZ, msg.itemId);
        break;

      case "TICK":
        session.requireReady();
        session.tick(msg.dt, msg.playerPos, msg.isSheltered);
        break;

      case "CRAFT":
        session.requireReady();
        session.craft(msg.recipeId, msg.quantity);
        break;

      case "SMELT_START":
        session.requireReady();
        session.startSmelting(msg.inputItem, msg.fuelItem);
        break;

      case "SMELT_COLLECT":
        session.requireReady();
        session.collectSmeltedOutput();
        break;

      case "INTERACT_ENTITY":
        session.requireReady();
        session.interactEntity(msg.entityId, msg.action);
        break;

      case "COLLECT_ITEM":
        session.requireReady();
        session.collectItem(msg.itemId, msg.count);
        break;

      case "CONSUME_ITEM":
        session.requireReady();
        session.consumeItem(msg.itemId);
        break;

      case "SLEEP":
        session.requireReady();
        session.sleep();
        break;

      case "LOAD_STATE":
        session.requireReady();
        session.loadState(msg.state);
        break;

      case "REQUEST_STATE":
        session.requireReady();
        session.requestState();
        break;
    }
  } catch (err) {
    session.handleError(msg.type, err);
  }
};
