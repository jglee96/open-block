import { HotbarManager } from "./hotbar";
import { PlayerPhysics } from "./physics";
import { loadState, saveState } from "./app/persistence";
import { GameWorkerClient } from "./app/game-worker-client";
import { ChunkStreamingController } from "./app/chunk-streaming";
import { BlockCache } from "./app/block-cache";
import { GameplayRuntime } from "./app/gameplay-runtime";
import { InteractionController } from "./app/interaction-controller";
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
  SavedState,
  SmeltingState,
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
const E2E_ENABLED = new URLSearchParams(window.location.search).has("e2e");

declare global {
  interface Window {
    __openBlockE2E?: {
      clearSave: () => void;
      getSnapshot: () => {
        ready: boolean;
        inventoryOpen: boolean;
        statusText: string;
        inventoryEntries: InventoryEntry[];
        playerStats: PlayerStats | null;
        smeltingState: SmeltingState | null;
        entitySnapshots: EntitySnapshot[];
        targetHit: TargetHit;
        hotbar: {
          selectedIndex: number;
          selectedItemId: string | null;
          selectedCount: number;
        };
      };
      requestState: () => void;
      seedSave: (state: SavedState) => void;
      sendToWorker: (msg: MainToWorker) => void;
      generateChunk: (chunkX: number, chunkZ: number) => void;
      getBlockTypeAt: (worldX: number, worldY: number, worldZ: number) => number;
      setPlayerPose: (pose: { x: number; y: number; z: number; yaw?: number; pitch?: number }) => void;
      selectHotbarIndex: (index: number) => void;
      sampleTarget: () => TargetHit;
      interactAtCurrentTarget: (button: number) => boolean;
    };
  }
}

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

  function syncChromeVisibility() {
    ui.syncVisibility({ locked: input.locked, inventoryOpen });
  }

  function setInventoryOpen(nextOpen: boolean) {
    inventoryOpen = nextOpen;
    if (nextOpen && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
    if (!nextOpen) {
      ui.setOverlayTitle(workerClient.isReady() ? "Paused" : "Open Block");
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

  const workerClient = new GameWorkerClient({
    workerUrl: new URL("./worker/game.worker.ts", import.meta.url),
    seed: 42,
    onReady: () => {
      ui.setStatus("Ready - click to start, press E for inventory");
      const saved = loadState(SAVE_KEY);
      if (saved) workerClient.send({ type: "LOAD_STATE", state: saved });
    },
    onChunkMesh: (msg) => {
      scene.uploadChunk(msg.chunkX, msg.chunkZ, msg.buffer, msg.vertexCount);
      scene.storeBlockData(msg.chunkX, msg.chunkZ, msg.blockData);
      blockCache.storeChunk(msg.chunkX, msg.chunkZ, msg.blockData);
    },
    onEntitySnapshot: (msg) => {
      entitySnapshots = msg.entities;
    },
    onInventorySync: (msg) => {
      inventoryEntries = msg.entries;
      smeltingState = msg.smelting;
      hotbar.syncInventory(inventoryEntries);
    },
    onPlayerStats: (msg) => {
      playerStats = msg.stats;
    },
    onFrameDiagnostics: (msg) => {
      workerDiagnostics = msg.diagnostics;
    },
    onStateSnapshot: (msg) => {
      saveState(SAVE_KEY, msg.state);
    },
    onErrorMessage: (message) => {
      console.error("Worker error:", message);
    },
    onRestarting: (delayMs) => {
      ui.setStatus(`Worker restarting in ${Math.round(delayMs / 1000)}s...`);
    },
  });

  const postToWorker = (msg: MainToWorker) => {
    workerClient.send(msg);
  };

  if (E2E_ENABLED) {
    window.__openBlockE2E = {
      clearSave: () => localStorage.removeItem(SAVE_KEY),
      getSnapshot: () => ({
        ready: workerClient.isReady(),
        inventoryOpen,
        statusText: statusEl.textContent ?? "",
        inventoryEntries,
        playerStats,
        smeltingState,
        entitySnapshots,
        targetHit,
        hotbar: {
          selectedIndex: hotbar.selectedIndexValue,
          selectedItemId: hotbar.selectedItemId,
          selectedCount: hotbar.getSelectedCount(),
        },
      }),
      requestState: () => {
        if (workerClient.isReady()) postToWorker({ type: "REQUEST_STATE" });
      },
      seedSave: (state) => {
        saveState(SAVE_KEY, state);
      },
      sendToWorker: (msg) => {
        if (workerClient.isReady()) postToWorker(msg);
      },
      generateChunk: (chunkX, chunkZ) => {
        if (workerClient.isReady()) postToWorker({ type: "GENERATE_CHUNK", chunkX, chunkZ });
      },
      getBlockTypeAt: (worldX, worldY, worldZ) => blockCache.getBlockTypeAt(worldX, worldY, worldZ),
      setPlayerPose: (pose) => {
        gameplayRuntime.setPlayerPose(pose);
      },
      selectHotbarIndex: (index) => {
        hotbar.selectIndex(index);
      },
      sampleTarget: () => {
        targetHit = gameplayRuntime.sampleTarget(entitySnapshots);
        return targetHit;
      },
      interactAtCurrentTarget: (button) => {
        targetHit = gameplayRuntime.sampleTarget(entitySnapshots);
        if (!targetHit) return false;
        interactionController.handleMouseDown(button, targetHit);
        return true;
      },
    };
  }

  const chunkStreaming = new ChunkStreamingController({
    renderRadius: RENDER_RADIUS,
    retentionRadius: RENDER_RADIUS + 2,
    scene,
    blockCache,
    requestChunk: ({ cx, cz }) => {
      postToWorker({ type: "GENERATE_CHUNK", chunkX: cx, chunkZ: cz });
    },
  });
  const gameplayRuntime = new GameplayRuntime({
    camera,
    input,
    physics,
    blockCache,
    chunkStreaming,
    highlight,
    device,
    playerFeet,
    eyeHeight: EYE_HEIGHT,
    maxInteractDistance: MAX_INTERACT_DIST,
    chunkSize: CHUNK_SIZE,
    chunksPerFrame: 5,
  });
  const interactionController = new InteractionController({
    hotbar,
    playerFeet: gameplayRuntime.getPlayerFeet(),
    isWorkerReady: () => workerClient.isReady(),
    postToWorker,
  });

  ui.bindRecipeSelect((recipeId) => {
    if (!workerClient.isReady()) return;
    postToWorker({ type: "CRAFT", recipeId, quantity: 1 });
  });

  ui.bindFurnaceAction((action) => {
    if (!workerClient.isReady()) return;
    if (action === "start") {
      const fuelItem = preferredFuel(inventoryEntries);
      if (!fuelItem) return;
      postToWorker({ type: "SMELT_START", inputItem: "raw_meat", fuelItem });
      return;
    }
    postToWorker({ type: "SMELT_COLLECT" });
  });

  ui.bindAction((action) => {
    if (!workerClient.isReady()) return;
    if (action.type === "consume") {
      postToWorker({ type: "CONSUME_ITEM", itemId: action.itemId });
      return;
    }
    postToWorker({ type: "SLEEP" });
  });

  canvas.addEventListener("mousedown", (event) => {
    if (!input.locked) return;
    interactionController.handleMouseDown(event.button, targetHit);
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyE" && workerClient.isReady()) {
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

  workerClient.connect();
  syncChromeVisibility();
  chunkStreaming.updateFocus(camera.position[0], camera.position[2], CHUNK_SIZE);
  window.setInterval(() => {
    if (workerClient.isReady()) {
      chunkStreaming.updateFocus(camera.position[0], camera.position[2], CHUNK_SIZE);
    }
  }, 1000);
  window.setInterval(() => {
    if (workerClient.isReady()) postToWorker({ type: "REQUEST_STATE" });
  }, 5000);
  window.addEventListener("beforeunload", () => {
    if (workerClient.isReady()) postToWorker({ type: "REQUEST_STATE" });
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

  function frame() {
    const now = performance.now();

    try {
      const step = gameplayRuntime.step(now, entitySnapshots, workerClient.isReady());
      targetHit = step.targetHit;

      if (step.tickPayload) {
        postToWorker({
          type: "TICK",
          dt: step.tickPayload.dt,
          playerPos: step.tickPayload.playerPos,
          isSheltered: step.tickPayload.isSheltered,
        });
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
        fps: step.fps,
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

function normalise3(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  if (len < 1e-8 || !Number.isFinite(len)) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = `Fatal error: ${String(err)}`;
});
