import { getBlockDropItem } from "./gameplay/items";
import { HotbarManager } from "./hotbar";
import { PlayerPhysics } from "./physics";
import { raycast } from "./raycast";
import { initGpu } from "./renderer/gpu";
import { HighlightRenderer } from "./renderer/highlight";
import { InputManager } from "./renderer/input";
import { createPipeline, UNIFORM_BUFFER_SIZE } from "./renderer/pipeline";
import { Camera } from "./renderer/camera";
import { Scene } from "./renderer/scene";
import type { TargetHit, EntityTargetHit } from "./target";
import type {
  EntitySnapshot,
  FrameDiagnostics,
  InventoryEntry,
  MainToWorker,
  PlayerStats,
  SavedState,
  SmeltingState,
  WorkerToMain,
} from "./worker/protocol";

const RENDER_RADIUS = 4;
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const EYE_HEIGHT = 1.62;
const MAX_INTERACT_DIST = 5;
const FOG_NEAR = 40;
const FOG_FAR = 80;
const SKY_R = 0.53, SKY_G = 0.81, SKY_B = 0.98;
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

const targetEl = ensureHudLine("target", "Target: none");
const fpsEl = ensureHudLine("fps", "FPS: 0");
const statsEl = ensureHudLine("stats", "HP: 20 | Hunger: 20 | Day");
const invEl = ensureHudLine("inventory", "Inventory: -");
const diagEl = ensureHudLine("diag", "FrameErr(main/worker): 0/0");

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

const blockCache = new Map<string, Uint8Array>();

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function getBlockTypeAt(wx: number, wy: number, wz: number): number {
  if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
  const bx = Math.floor(wx);
  const by = Math.floor(wy);
  const bz = Math.floor(wz);
  const cx = Math.floor(bx / CHUNK_SIZE);
  const cz = Math.floor(bz / CHUNK_SIZE);
  const data = blockCache.get(chunkKey(cx, cz));
  if (!data) return 0;
  const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const idx = by * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
  return data[idx] ?? 0;
}

function setBlockTypeInCache(wx: number, wy: number, wz: number, blockType: number) {
  if (wy < 0 || wy >= CHUNK_HEIGHT) return;
  const bx = Math.floor(wx);
  const by = Math.floor(wy);
  const bz = Math.floor(wz);
  const cx = Math.floor(bx / CHUNK_SIZE);
  const cz = Math.floor(bz / CHUNK_SIZE);
  const key = chunkKey(cx, cz);
  const data = blockCache.get(key);
  if (!data) return;

  const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const idx = by * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
  data[idx] = blockType;
}

function isSolid(wx: number, wy: number, wz: number): boolean {
  if (wy < 0) return true;
  const block = getBlockTypeAt(wx, wy, wz);
  return block !== 0 && block !== 5;
}

let depthTexture: GPUTexture | null = null;

function ensureDepthTexture(device: GPUDevice, w: number, h: number): GPUTexture {
  if (!depthTexture || depthTexture.width !== w || depthTexture.height !== h) {
    depthTexture?.destroy();
    depthTexture = device.createTexture({
      size: [w, h],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  return depthTexture;
}

async function main() {
  setStatus("Initializing WebGPU...");
  const gpu = await initGpu(canvas);
  const { device, context, format } = gpu;

  const pipeline = createPipeline(device, format);
  const camera = new Camera();
  const input = new InputManager(canvas);
  const scene = new Scene(gpu);
  const highlight = new HighlightRenderer(device, format);
  const physics = new PlayerPhysics();
  const hotbar = new HotbarManager();

  const requestedChunks = new Set<string>();
  const queuedChunkRequests = new Set<string>();
  const chunkRequestQueue: Array<{ cx: number; cz: number }> = [];

  let worker: Worker | null = null;
  let workerReady = false;
  let restartAttempts = 0;

  let entitySnapshots: EntitySnapshot[] = [];
  let playerStats: PlayerStats | null = null;
  let inventoryEntries: InventoryEntry[] = [];
  let smeltingState: SmeltingState | null = null;
  let workerDiagnostics: FrameDiagnostics = { frameErrorCount: 0, lastErrorCode: null };

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

  const connectWorker = () => {
    worker?.terminate();
    workerReady = false;

    worker = new Worker(new URL("./worker/game.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (e: MessageEvent<WorkerToMain>) => {
      const msg = e.data;
      switch (msg.type) {
        case "READY": {
          workerReady = true;
          restartAttempts = 0;
          setStatus("Ready — click to start");
          overlay.classList.remove("hidden");
          const loaded = loadSavedState();
          if (loaded) {
            postToWorker({ type: "LOAD_STATE", state: loaded });
          }
          break;
        }

        case "CHUNK_MESH": {
          scene.uploadChunk(msg.chunkX, msg.chunkZ, msg.buffer, msg.vertexCount);
          scene.storeBlockData(msg.chunkX, msg.chunkZ, msg.blockData);
          if (msg.blockData.byteLength > 0) {
            blockCache.set(chunkKey(msg.chunkX, msg.chunkZ), new Uint8Array(msg.blockData));
          }
          break;
        }

        case "ENTITY_SNAPSHOT":
          entitySnapshots = msg.entities;
          break;

        case "INVENTORY_SYNC":
          inventoryEntries = msg.entries;
          smeltingState = msg.smelting;
          hotbar.setBlockCounts(toBlockCounts(inventoryEntries));
          break;

        case "PLAYER_STATS":
          playerStats = msg.stats;
          break;

        case "FRAME_DIAGNOSTICS":
          workerDiagnostics = msg.diagnostics;
          break;

        case "STATE_SNAPSHOT":
          saveState(msg.state);
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
  };

  const scheduleWorkerRestart = () => {
    restartAttempts += 1;
    const delay = Math.min(4000, 500 * restartAttempts);
    setStatus(`Worker restarting in ${Math.round(delay / 1000)}s...`);
    window.setTimeout(() => {
      connectWorker();
    }, delay);
  };

  connectWorker();

  window.setInterval(() => {
    if (workerReady) postToWorker({ type: "REQUEST_STATE" });
  }, 5000);

  window.addEventListener("beforeunload", () => {
    if (workerReady) postToWorker({ type: "REQUEST_STATE" });
  });

  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      overlay.classList.add("hidden");
      crosshair.style.display = "block";
      hudEl.style.display = "block";
      hotbarEl.style.display = "flex";
    } else {
      overlay.classList.remove("hidden");
      overlay.querySelector("h1")!.textContent = "Paused";
      setStatus("Click to resume");
      crosshair.style.display = "none";
      hudEl.style.display = "none";
      hotbarEl.style.display = "none";
    }
  });

  let targetHit: TargetHit = null;

  canvas.addEventListener("mousedown", (e) => {
    if (!input.locked) return;
    if (e.button === 0) {
      handlePrimaryInteraction(targetHit);
    } else if (e.button === 2) {
      handleSecondaryInteraction(targetHit);
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("keydown", (e) => {
    if (!input.locked) return;
    switch (e.code) {
      case "KeyC":
        postToWorker({ type: "CRAFT", recipeId: "planks", quantity: 1 });
        setStatus("Crafted planks (if resources available)");
        break;
      case "KeyV":
        postToWorker({ type: "CRAFT", recipeId: "crafting_table", quantity: 1 });
        setStatus("Crafted crafting table (if resources available)");
        break;
      case "KeyB":
        postToWorker({ type: "CRAFT", recipeId: "sticks", quantity: 1 });
        setStatus("Crafted sticks (if resources available)");
        break;
      case "KeyN":
        postToWorker({ type: "CRAFT", recipeId: "wooden_pickaxe", quantity: 1 });
        setStatus("Crafted wooden pickaxe (if resources available)");
        break;
      case "KeyM":
        postToWorker({ type: "CRAFT", recipeId: "furnace", quantity: 1 });
        setStatus("Crafted furnace (if resources available)");
        break;
      case "KeyK":
        postToWorker({ type: "CRAFT", recipeId: "bed", quantity: 1 });
        setStatus("Crafted bed (if resources available)");
        break;
      case "KeyF":
        postToWorker({ type: "SMELT_START", inputItem: "raw_meat", fuelItem: "coal" });
        setStatus("Smelting started (needs furnace/raw_meat/fuel)");
        break;
      case "KeyG":
        postToWorker({ type: "SMELT_COLLECT" });
        setStatus("Collected smelted item (if ready)");
        break;
      case "KeyL":
        postToWorker({ type: "SLEEP" });
        setStatus("Tried sleeping (requires night + bed)");
        break;
    }
  });

  function handlePrimaryInteraction(target: TargetHit) {
    if (!target || !workerReady) return;

    if (target.kind === "entity") {
      postToWorker({ type: "INTERACT_ENTITY", entityId: target.entity.id, action: "attack" });
      return;
    }

    const { worldX, worldY, worldZ } = target.hit;
    const blockType = getBlockTypeAt(worldX, worldY, worldZ);

    postToWorker({
      type: "SET_BLOCK",
      worldX,
      worldY,
      worldZ,
      blockType: 0,
    });

    setBlockTypeInCache(worldX, worldY, worldZ, 0);

    const drop = getBlockDropItem(blockType);
    if (drop) {
      postToWorker({ type: "COLLECT_ITEM", itemId: drop, count: 1 });
    }
  }

  function handleSecondaryInteraction(target: TargetHit) {
    if (!target || !workerReady) return;

    if (target.kind === "entity") {
      postToWorker({ type: "INTERACT_ENTITY", entityId: target.entity.id, action: "interact" });
      return;
    }

    const px = target.hit.worldX + target.hit.faceNormal[0];
    const py = target.hit.worldY + target.hit.faceNormal[1];
    const pz = target.hit.worldZ + target.hit.faceNormal[2];

    if (wouldOverlapPlayer(px, py, pz, playerFeet)) return;

    postToWorker({
      type: "SET_BLOCK",
      worldX: px,
      worldY: py,
      worldZ: pz,
      blockType: hotbar.selectedBlockType,
    });

    setBlockTypeInCache(px, py, pz, hotbar.selectedBlockType);
  }

  function requestSurroundingChunks() {
    if (!workerReady) return;
    const cx = Math.floor(camera.position[0] / CHUNK_SIZE);
    const cz = Math.floor(camera.position[2] / CHUNK_SIZE);

    scene.evictDistant(cx, cz, RENDER_RADIUS + 2);

    for (const k of blockCache.keys()) {
      const [kx, kz] = k.split(",").map(Number);
      if (Math.abs(kx - cx) > RENDER_RADIUS + 2 || Math.abs(kz - cz) > RENDER_RADIUS + 2) {
        blockCache.delete(k);
        requestedChunks.delete(k);
      }
    }

    for (const k of [...requestedChunks]) {
      const [kx, kz] = k.split(",").map(Number);
      if (Math.abs(kx - cx) > RENDER_RADIUS + 2 || Math.abs(kz - cz) > RENDER_RADIUS + 2) {
        requestedChunks.delete(k);
      }
    }

    for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        const key = chunkKey(tx, tz);
        if (requestedChunks.has(key) || queuedChunkRequests.has(key)) continue;
        queuedChunkRequests.add(key);
        chunkRequestQueue.push({ cx: tx, cz: tz });
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

  requestSurroundingChunks();
  window.setInterval(requestSurroundingChunks, 1000);

  const uniformData = new Float32Array(UNIFORM_BUFFER_SIZE / 4);
  const lightNorm = normalise3(LIGHT_DIR);

  function uploadUniforms() {
    const vp = camera.getViewProj();
    uniformData.set(vp, 0);
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
    return vp;
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
        camera.pitch = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, camera.pitch - dy),
        );

        physics.tick(playerFeet, camera.yaw, input.keys, dt, isSolid);
        camera.position[0] = playerFeet[0];
        camera.position[1] = playerFeet[1] + EYE_HEIGHT;
        camera.position[2] = playerFeet[2];

        requestSurroundingChunks();
        flushChunkQueue(5);

        const blockTarget = findBlockTarget(camera);
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
            playerPos: {
              x: camera.position[0],
              y: camera.position[1],
              z: camera.position[2],
            },
            isSheltered: isPlayerSheltered(camera.position[0], camera.position[1], camera.position[2]),
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

      const vp = uploadUniforms();
      highlight.updateViewProj(device, vp);

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
      renderHud(targetHit, fpsValue, playerStats, inventoryEntries, smeltingState, mainDiagnostics, workerDiagnostics, hotbar.selectedBlockName, scene.chunkCount, camera.position);
    } catch (err) {
      mainDiagnostics.frameErrorCount += 1;
      mainDiagnostics.lastErrorCode = "FRAME_EXCEPTION";
      console.error("Frame loop error:", err);
      setStatus(`Frame recovered: ${String(err)}`);
    } finally {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

function findBlockTarget(camera: Camera): TargetHit {
  const fwd = camera.forward as [number, number, number];
  const pos = camera.position as unknown as [number, number, number];

  if (!isFiniteVector(pos[0], pos[1], pos[2]) || !isFiniteVector(fwd[0], fwd[1], fwd[2])) {
    return null;
  }

  const hit = raycast(pos, fwd, MAX_INTERACT_DIST, isSolid);
  if (!hit) return null;

  if (!Number.isFinite(hit.distance) || hit.distance < 0 || hit.distance > MAX_INTERACT_DIST + 0.001) {
    return null;
  }

  return {
    kind: "block",
    hit,
    blockType: getBlockTypeAt(hit.worldX, hit.worldY, hit.worldZ),
  };
}

function findEntityTarget(camera: Camera, entities: EntitySnapshot[], maxDist: number): EntityTargetHit | null {
  const origin: [number, number, number] = [camera.position[0], camera.position[1], camera.position[2]];
  const dir: [number, number, number] = [camera.forward[0], camera.forward[1], camera.forward[2]];

  if (!isFiniteVector(origin[0], origin[1], origin[2]) || !isFiniteVector(dir[0], dir[1], dir[2])) {
    return null;
  }

  let best: EntityTargetHit | null = null;

  for (const entity of entities) {
    const t = rayAabb(origin, dir, {
      minX: entity.position.x - entity.radius,
      minY: entity.position.y,
      minZ: entity.position.z - entity.radius,
      maxX: entity.position.x + entity.radius,
      maxY: entity.position.y + entity.halfHeight * 2,
      maxZ: entity.position.z + entity.radius,
    }, maxDist);

    if (t === null) continue;
    if (!best || t < best.distance) {
      best = { kind: "entity", entity, distance: t };
    }
  }

  return best;
}

function pickNearestTarget(blockTarget: TargetHit, entityTarget: EntityTargetHit | null): TargetHit {
  if (!blockTarget) return entityTarget;
  if (!entityTarget) return blockTarget;

  if (blockTarget.kind !== "block") return blockTarget;
  return entityTarget.distance < blockTarget.hit.distance ? entityTarget : blockTarget;
}

interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
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

function wouldOverlapPlayer(blockX: number, blockY: number, blockZ: number, feet: [number, number, number]): boolean {
  const playerMinX = feet[0] - 0.3;
  const playerMaxX = feet[0] + 0.3;
  const playerMinY = feet[1];
  const playerMaxY = feet[1] + 1.8;
  const playerMinZ = feet[2] - 0.3;
  const playerMaxZ = feet[2] + 0.3;

  const blockMinX = blockX;
  const blockMaxX = blockX + 1;
  const blockMinY = blockY;
  const blockMaxY = blockY + 1;
  const blockMinZ = blockZ;
  const blockMaxZ = blockZ + 1;

  return (
    playerMinX < blockMaxX &&
    playerMaxX > blockMinX &&
    playerMinY < blockMaxY &&
    playerMaxY > blockMinY &&
    playerMinZ < blockMaxZ &&
    playerMaxZ > blockMinZ
  );
}

function isPlayerSheltered(x: number, y: number, z: number): boolean {
  return isSolid(x, y + 0.4, z) || isSolid(x, y + 1.0, z) || isSolid(x, y + 1.8, z);
}

function renderHud(
  target: TargetHit,
  fps: number,
  stats: PlayerStats | null,
  inventory: InventoryEntry[],
  smelting: SmeltingState | null,
  mainDiag: { frameErrorCount: number; lastErrorCode: string | null; lastGpuError: string | null },
  workerDiag: FrameDiagnostics,
  selectedBlockName: string,
  chunkCount: number,
  cameraPos: ArrayLike<number>,
) {
  posEl.textContent = `XYZ: ${cameraPos[0].toFixed(1)}, ${cameraPos[1].toFixed(1)}, ${cameraPos[2].toFixed(1)}`;
  chunksEl.textContent = `Chunks: ${chunkCount}`;

  const targetLabel = !target
    ? "none"
    : target.kind === "block"
      ? `block (${target.hit.worldX},${target.hit.worldY},${target.hit.worldZ})`
      : `${target.entity.kind}#${target.entity.id}`;
  targetEl.textContent = `Target: ${targetLabel} | Held: ${selectedBlockName}`;

  fpsEl.textContent = `FPS: ${fps.toFixed(1)}`;

  if (stats) {
    statsEl.textContent =
      `HP: ${stats.health.toFixed(1)}/${stats.maxHealth} | Hunger: ${stats.hunger.toFixed(1)}/${stats.maxHunger} | ` +
      `Time: ${Math.floor(stats.timeOfDay)} (${stats.isNight ? "Night" : "Day"}) | ` +
      `Shelter: ${stats.isSheltered ? "yes" : "no"}`;
  } else {
    statsEl.textContent = "HP: - | Hunger: - | Time: -";
  }

  const invPreview = inventory.slice(0, 6).map((entry) => `${entry.itemId}:${entry.count}`).join(" ") || "-";
  const smeltLabel = smelting ? ` | Smelting: ${smelting.inputItem}->${smelting.outputItem}` : "";
  invEl.textContent = `Inventory: ${invPreview}${smeltLabel}`;

  diagEl.textContent =
    `FrameErr(main/worker): ${mainDiag.frameErrorCount}/${workerDiag.frameErrorCount} | ` +
    `Last(main): ${mainDiag.lastErrorCode ?? "-"} | Last(worker): ${workerDiag.lastErrorCode ?? "-"}` +
    (mainDiag.lastGpuError ? ` | GPU: ${mainDiag.lastGpuError}` : "");
}

function ensureHudLine(id: string, initialText: string): HTMLElement {
  const existing = document.getElementById(id);
  if (existing) return existing;
  const line = document.createElement("div");
  line.id = id;
  line.textContent = initialText;
  hudEl.appendChild(line);
  return line;
}

function toBlockCounts(entries: InventoryEntry[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const entry of entries) {
    switch (entry.itemId) {
      case "cobblestone":
        map.set(1, entry.count);
        break;
      case "dirt":
        map.set(2, entry.count);
        break;
      case "sand":
        map.set(4, entry.count);
        break;
      default:
        break;
    }
  }
  return map;
}

function saveState(state: SavedState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Failed to save state:", err);
  }
}

function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedState;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch (err) {
    console.warn("Failed to load saved state:", err);
    return null;
  }
}

function isFiniteVector(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function normalise3(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  if (len < 1e-8 || !Number.isFinite(len)) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

main().catch((err) => {
  console.error(err);
  setStatus(`Fatal error: ${String(err)}`);
});
