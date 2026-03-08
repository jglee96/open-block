import { HotbarManager } from "./hotbar";
import { PlayerPhysics } from "./physics";
import { loadState, saveState } from "./app/persistence";
import {
  findBlockTarget,
  findEntityTarget,
  pickNearestTarget,
  wouldOverlapPlayer,
} from "./app/targeting";
import { BlockCache } from "./app/block-cache";
import { initGpu } from "./renderer/gpu";
import { HighlightRenderer } from "./renderer/highlight";
import { InputManager } from "./renderer/input";
import { createPipeline, UNIFORM_BUFFER_SIZE } from "./renderer/pipeline";
import { Camera } from "./renderer/camera";
import { Scene } from "./renderer/scene";
import type { TargetHit } from "./target";
import { GameUi, preferredFuel } from "./ui/game-ui";
import type {
  EntitySnapshot,
  FrameDiagnostics,
  InventoryEntry,
  MainToWorker,
  PlayerStats,
  SmeltingState,
  WorkerToMain,
} from "./worker/protocol";

const RENDER_RADIUS = 4;
const CHUNK_SIZE = 16;
const EYE_HEIGHT = 1.62;
const MAX_INTERACT_DIST = 5;
const FOG_NEAR = 40;
const FOG_FAR = 80;
const SKY_R = 0.53;
const SKY_G = 0.81;
const SKY_B = 0.98;
const LIGHT_DIR: [number, number, number] = [0.6, 1.0, 0.4];
const AMBIENT = 0.25;
const SAVE_KEY = "open-block/save-v1";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const crosshair = document.getElementById("crosshair") as HTMLElement;
const posEl = document.getElementById("pos") as HTMLElement;
const chunksEl = document.getElementById("chunks") as HTMLElement;
const hudEl = document.getElementById("hud") as HTMLElement;
const hotbarEl = document.getElementById("hotbar") as HTMLElement;
const inventoryPanelEl = document.getElementById("inventory-panel") as HTMLElement;
const inventoryGridEl = document.getElementById("inventory-grid") as HTMLElement;
const recipeListEl = document.getElementById("recipe-list") as HTMLElement;
const furnacePanelEl = document.getElementById("furnace-panel") as HTMLElement;
const actionListEl = document.getElementById("action-list") as HTMLElement;

let depthTexture: GPUTexture | null = null;

function ensureDepthTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  if (!depthTexture || depthTexture.width !== width || depthTexture.height !== height) {
    depthTexture?.destroy();
    depthTexture = device.createTexture({
      size: [width, height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  return depthTexture;
}

async function main() {
  const ui = new GameUi({
    overlay,
    status: statusEl,
    crosshair,
    hud: hudEl,
    hotbar: hotbarEl,
    inventoryPanel: inventoryPanelEl,
    inventoryGrid: inventoryGridEl,
    recipeList: recipeListEl,
    furnacePanel: furnacePanelEl,
    actionList: actionListEl,
    pos: posEl,
    chunks: chunksEl,
  });

  ui.setStatus("Initializing WebGPU...");

  const gpu = await initGpu(canvas);
  const { device, context, format } = gpu;

  const pipeline = createPipeline(device, format);
  const camera = new Camera();
  const input = new InputManager(canvas);
  const scene = new Scene(gpu);
  const highlight = new HighlightRenderer(device, format);
  const physics = new PlayerPhysics();
  const hotbar = new HotbarManager();
  const blockCache = new BlockCache();

  const requestedChunks = new Set<string>();
  const queuedChunkRequests = new Set<string>();
  const chunkRequestQueue: Array<{ cx: number; cz: number }> = [];

  let worker: Worker | null = null;
  let workerReady = false;
  let restartAttempts = 0;
  let inventoryOpen = false;

  let entitySnapshots: EntitySnapshot[] = [];
  let playerStats: PlayerStats | null = null;
  let inventoryEntries: InventoryEntry[] = [];
  let smeltingState: SmeltingState | null = null;
  let workerDiagnostics: FrameDiagnostics = { frameErrorCount: 0, lastErrorCode: null };
  let targetHit: TargetHit = null;

  const mainDiagnostics = {
    frameErrorCount: 0,
    lastErrorCode: null as string | null,
    lastGpuError: null as string | null,
  };

  device.addEventListener("uncapturederror", (event) => {
    mainDiagnostics.lastGpuError = event.error.message;
    mainDiagnostics.frameErrorCount += 1;
    mainDiagnostics.lastErrorCode = "GPU_UNCAPTURED_ERROR";
    console.error("WebGPU uncaptured error:", event.error.message);
  });

  const playerFeet: [number, number, number] = [8, 62, 8];
  camera.position[0] = playerFeet[0];
  camera.position[1] = playerFeet[1] + EYE_HEIGHT;
  camera.position[2] = playerFeet[2];

  function chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  function syncChromeVisibility() {
    ui.syncVisibility({ locked: input.locked, inventoryOpen });
  }

  function setInventoryOpen(nextOpen: boolean) {
    inventoryOpen = nextOpen;
    if (nextOpen && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
    if (!nextOpen) {
      ui.setOverlayTitle(workerReady ? "Paused" : "Open Block");
    }
    syncChromeVisibility();
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    camera.updateAspect(canvas.width, canvas.height);
  }

  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(canvas);

  const postToWorker = (msg: MainToWorker) => {
    worker?.postMessage(msg);
  };

  function evictDistantChunkState(centerChunkX: number, centerChunkZ: number) {
    scene.evictDistant(centerChunkX, centerChunkZ, RENDER_RADIUS + 2);
    blockCache.evictDistant(centerChunkX, centerChunkZ, RENDER_RADIUS + 2, (cx, cz) => {
      requestedChunks.delete(chunkKey(cx, cz));
    });

    for (const key of [...requestedChunks]) {
      const [cx, cz] = key.split(",").map(Number);
      if (Math.abs(cx - centerChunkX) > RENDER_RADIUS + 2 || Math.abs(cz - centerChunkZ) > RENDER_RADIUS + 2) {
        requestedChunks.delete(key);
      }
    }
  }

  function requestSurroundingChunks() {
    if (!workerReady) return;
    const cx = Math.floor(camera.position[0] / CHUNK_SIZE);
    const cz = Math.floor(camera.position[2] / CHUNK_SIZE);
    evictDistantChunkState(cx, cz);

    for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
        const targetChunkX = cx + dx;
        const targetChunkZ = cz + dz;
        const key = chunkKey(targetChunkX, targetChunkZ);
        if (requestedChunks.has(key) || queuedChunkRequests.has(key)) continue;
        queuedChunkRequests.add(key);
        chunkRequestQueue.push({ cx: targetChunkX, cz: targetChunkZ });
      }
    }
  }

  function flushChunkQueue(maxPerFrame: number) {
    if (!workerReady) return;
    let sent = 0;
    while (chunkRequestQueue.length > 0 && sent < maxPerFrame) {
      const next = chunkRequestQueue.shift();
      if (!next) break;
      const key = chunkKey(next.cx, next.cz);
      queuedChunkRequests.delete(key);
      if (requestedChunks.has(key)) continue;
      requestedChunks.add(key);
      postToWorker({ type: "GENERATE_CHUNK", chunkX: next.cx, chunkZ: next.cz });
      sent += 1;
    }
  }

  function connectWorker() {
    worker?.terminate();
    workerReady = false;

    worker = new Worker(new URL("./worker/game.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const msg = event.data;
      switch (msg.type) {
        case "READY": {
          workerReady = true;
          restartAttempts = 0;
          ui.setStatus("Ready — click to start");
          const saved = loadState(SAVE_KEY);
          if (saved) postToWorker({ type: "LOAD_STATE", state: saved });
          break;
        }

        case "CHUNK_MESH":
          scene.uploadChunk(msg.chunkX, msg.chunkZ, msg.buffer, msg.vertexCount);
          scene.storeBlockData(msg.chunkX, msg.chunkZ, msg.blockData);
          blockCache.storeChunk(msg.chunkX, msg.chunkZ, msg.blockData);
          break;

        case "ENTITY_SNAPSHOT":
          entitySnapshots = msg.entities;
          break;

        case "INVENTORY_SYNC":
          inventoryEntries = msg.entries;
          smeltingState = msg.smelting;
          hotbar.syncInventory(inventoryEntries);
          break;

        case "PLAYER_STATS":
          playerStats = msg.stats;
          break;

        case "FRAME_DIAGNOSTICS":
          workerDiagnostics = msg.diagnostics;
          break;

        case "STATE_SNAPSHOT":
          saveState(SAVE_KEY, msg.state);
          break;

        case "ERROR":
          console.error("Worker error:", msg.message);
          break;
      }
    };

    worker.onerror = (event) => {
      console.error("Worker crashed:", event.message);
      workerReady = false;
      scheduleWorkerRestart();
    };

    postToWorker({ type: "INIT", seed: 42 });
  }

  function scheduleWorkerRestart() {
    restartAttempts += 1;
    const delay = Math.min(4000, 500 * restartAttempts);
    ui.setStatus(`Worker restarting in ${Math.round(delay / 1000)}s...`);
    window.setTimeout(connectWorker, delay);
  }

  ui.bindRecipeSelect((recipeId) => {
    if (!workerReady) return;
    postToWorker({ type: "CRAFT", recipeId, quantity: 1 });
  });

  ui.bindFurnaceAction((action) => {
    if (!workerReady) return;
    if (action === "start") {
      const fuelItem = preferredFuel(inventoryEntries);
      if (!fuelItem) return;
      postToWorker({ type: "SMELT_START", inputItem: "raw_meat", fuelItem });
      return;
    }
    postToWorker({ type: "SMELT_COLLECT" });
  });

  ui.bindAction((action) => {
    if (!workerReady) return;
    if (action.type === "consume") {
      postToWorker({ type: "CONSUME_ITEM", itemId: action.itemId });
      return;
    }
    postToWorker({ type: "SLEEP" });
  });

  canvas.addEventListener("mousedown", (event) => {
    if (!input.locked || !workerReady || !targetHit) return;
    if (event.button === 0) {
      if (targetHit.kind === "entity") {
        postToWorker({ type: "INTERACT_ENTITY", entityId: targetHit.entity.id, action: "attack" });
        return;
      }
      postToWorker({
        type: "BREAK_BLOCK",
        worldX: targetHit.hit.worldX,
        worldY: targetHit.hit.worldY,
        worldZ: targetHit.hit.worldZ,
      });
      return;
    }

    if (event.button === 2) {
      if (targetHit.kind === "entity") {
        postToWorker({ type: "INTERACT_ENTITY", entityId: targetHit.entity.id, action: "interact" });
        return;
      }

      const selectedItemId = hotbar.selectedItemId;
      if (!selectedItemId || hotbar.getSelectedCount() <= 0) return;

      const px = targetHit.hit.worldX + targetHit.hit.faceNormal[0];
      const py = targetHit.hit.worldY + targetHit.hit.faceNormal[1];
      const pz = targetHit.hit.worldZ + targetHit.hit.faceNormal[2];
      if (wouldOverlapPlayer(px, py, pz, playerFeet)) return;

      postToWorker({ type: "PLACE_ITEM", worldX: px, worldY: py, worldZ: pz, itemId: selectedItemId });
    }
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyE" && workerReady) {
      event.preventDefault();
      setInventoryOpen(!inventoryOpen);
    }
  });

  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      inventoryOpen = false;
      ui.setOverlayTitle("Open Block");
    } else if (!inventoryOpen) {
      ui.setOverlayTitle("Paused");
      ui.setStatus("Click to resume");
    }
    syncChromeVisibility();
  });

  connectWorker();
  syncChromeVisibility();
  requestSurroundingChunks();
  window.setInterval(requestSurroundingChunks, 1000);
  window.setInterval(() => {
    if (workerReady) postToWorker({ type: "REQUEST_STATE" });
  }, 5000);
  window.addEventListener("beforeunload", () => {
    if (workerReady) postToWorker({ type: "REQUEST_STATE" });
  });

  const uniformData = new Float32Array(UNIFORM_BUFFER_SIZE / 4);
  const lightNorm = normalise3(LIGHT_DIR);

  function uploadUniforms() {
    const viewProj = camera.getViewProj();
    uniformData.set(viewProj, 0);
    uniformData.set(camera.position, 16);
    uniformData[19] = 0;
    uniformData.set(lightNorm, 20);
    uniformData[23] = AMBIENT;
    uniformData[24] = FOG_NEAR;
    uniformData[25] = FOG_FAR;
    uniformData[26] = SKY_R;
    uniformData[27] = SKY_G;
    uniformData[28] = SKY_B;
    uniformData[29] = 0;
    device.queue.writeBuffer(pipeline.uniformBuffer, 0, uniformData);
    return viewProj;
  }

  let lastTime = performance.now();
  let tickAccumulator = 0;
  let fpsCounter = 0;
  let fpsElapsed = 0;
  let fpsValue = 0;

  function frame() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    try {
      if (input.locked) {
        const { dx, dy } = input.consumeDelta();
        camera.yaw += dx;
        camera.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, camera.pitch - dy));

        physics.tick(playerFeet, camera.yaw, input.keys, dt, blockCache.isSolid.bind(blockCache));
        camera.position[0] = playerFeet[0];
        camera.position[1] = playerFeet[1] + EYE_HEIGHT;
        camera.position[2] = playerFeet[2];

        requestSurroundingChunks();
        flushChunkQueue(5);

        const blockTarget = findBlockTarget(
          camera,
          MAX_INTERACT_DIST,
          blockCache.isSolid.bind(blockCache),
          blockCache.getBlockTypeAt.bind(blockCache),
        );
        const entityTarget = findEntityTarget(camera, entitySnapshots, MAX_INTERACT_DIST);
        targetHit = pickNearestTarget(blockTarget, entityTarget);

        if (targetHit?.kind === "block") {
          highlight.setTarget(device, {
            minX: targetHit.hit.worldX,
            minY: targetHit.hit.worldY,
            minZ: targetHit.hit.worldZ,
            maxX: targetHit.hit.worldX + 1,
            maxY: targetHit.hit.worldY + 1,
            maxZ: targetHit.hit.worldZ + 1,
          });
        } else if (targetHit?.kind === "entity") {
          const entity = targetHit.entity;
          highlight.setTarget(device, {
            minX: entity.position.x - entity.radius,
            minY: entity.position.y,
            minZ: entity.position.z - entity.radius,
            maxX: entity.position.x + entity.radius,
            maxY: entity.position.y + entity.halfHeight * 2,
            maxZ: entity.position.z + entity.radius,
          });
        } else {
          highlight.setTarget(device, null);
        }

        tickAccumulator += dt;
        if (workerReady && tickAccumulator >= 0.05) {
          postToWorker({
            type: "TICK",
            dt: tickAccumulator,
            playerPos: { x: camera.position[0], y: camera.position[1], z: camera.position[2] },
            isSheltered: isPlayerSheltered(camera.position[0], camera.position[1], camera.position[2], blockCache),
          });
          tickAccumulator = 0;
        }
      }

      fpsCounter += 1;
      fpsElapsed += dt;
      if (fpsElapsed >= 0.25) {
        fpsValue = fpsCounter / fpsElapsed;
        fpsCounter = 0;
        fpsElapsed = 0;
      }

      const viewProj = uploadUniforms();
      highlight.updateViewProj(device, viewProj);

      const depth = ensureDepthTexture(device, canvas.width, canvas.height);
      const view = context.getCurrentTexture().createView();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: SKY_R, g: SKY_G, b: SKY_B, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      scene.draw(pass, pipeline);
      highlight.draw(pass);
      pass.end();
      device.queue.submit([encoder.finish()]);

      ui.renderHud({
        target: targetHit,
        fps: fpsValue,
        stats: playerStats,
        inventory: inventoryEntries,
        smelting: smeltingState,
        mainDiag: mainDiagnostics,
        workerDiag: workerDiagnostics,
        selectedItemName: hotbar.selectedItemName,
        selectedCount: hotbar.getSelectedCount(),
        chunkCount: scene.chunkCount,
        cameraPos: camera.position,
      });
      ui.renderInventoryPanel(inventoryEntries, playerStats, smeltingState);
    } catch (err) {
      mainDiagnostics.frameErrorCount += 1;
      mainDiagnostics.lastErrorCode = "FRAME_EXCEPTION";
      console.error("Frame loop error:", err);
      ui.setStatus(`Frame recovered: ${String(err)}`);
    } finally {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

function isPlayerSheltered(x: number, y: number, z: number, blockCache: BlockCache): boolean {
  return blockCache.isSolid(x, y + 0.4, z) || blockCache.isSolid(x, y + 1.0, z) || blockCache.isSolid(x, y + 1.8, z);
}

function normalise3(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  if (len < 1e-8 || !Number.isFinite(len)) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = `Fatal error: ${String(err)}`;
});
