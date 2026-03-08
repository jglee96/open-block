import {
  getEdibleHunger,
  isEdibleItem,
  RECIPES,
  type RecipeId,
} from "../gameplay/items";
import { getTutorialChecklist, getTutorialHint } from "../gameplay/tutorial";
import type {
  FrameDiagnostics,
  InventoryEntry,
  PlayerStats,
  SmeltingState,
} from "../worker/protocol";
import type { TargetHit } from "../target";

interface GameUiElements {
  overlay: HTMLElement;
  status: HTMLElement;
  crosshair: HTMLElement;
  hud: HTMLElement;
  hotbar: HTMLElement;
  inventoryPanel: HTMLElement;
  inventoryGrid: HTMLElement;
  recipeList: HTMLElement;
  furnacePanel: HTMLElement;
  actionList: HTMLElement;
  checklistList: HTMLElement;
  pos: HTMLElement;
  chunks: HTMLElement;
}

interface DiagnosticsViewModel {
  frameErrorCount: number;
  lastErrorCode: string | null;
  lastGpuError: string | null;
}

interface HudRenderModel {
  target: TargetHit;
  fps: number;
  stats: PlayerStats | null;
  inventory: InventoryEntry[];
  smelting: SmeltingState | null;
  mainDiag: DiagnosticsViewModel;
  workerDiag: FrameDiagnostics;
  selectedItemName: string;
  selectedCount: number;
  chunkCount: number;
  cameraPos: ArrayLike<number>;
}

function ensureHudLine(hud: HTMLElement, id: string, initialText: string): HTMLElement {
  const existing = document.getElementById(id);
  if (existing) return existing;
  const line = document.createElement("div");
  line.id = id;
  line.textContent = initialText;
  hud.appendChild(line);
  return line;
}

function inventoryCounts(entries: InventoryEntry[]): Map<InventoryEntry["itemId"], number> {
  return new Map(entries.map((entry) => [entry.itemId, entry.count]));
}

export function preferredFuel(entries: InventoryEntry[]): InventoryEntry["itemId"] | null {
  const counts = inventoryCounts(entries);
  if ((counts.get("coal") ?? 0) > 0) return "coal";
  if ((counts.get("log") ?? 0) > 0) return "log";
  if ((counts.get("planks") ?? 0) > 0) return "planks";
  return null;
}

export class GameUi {
  private readonly targetEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly inventoryEl: HTMLElement;
  private readonly guideEl: HTMLElement;
  private readonly diagnosticsEl: HTMLElement;
  private lastInventoryPanelKey = "";

  constructor(private readonly elements: GameUiElements) {
    this.targetEl = ensureHudLine(elements.hud, "target", "Target: none");
    this.fpsEl = ensureHudLine(elements.hud, "fps", "FPS: 0");
    this.statsEl = ensureHudLine(elements.hud, "stats", "HP: 20 | Hunger: 20 | Day");
    this.inventoryEl = ensureHudLine(elements.hud, "inventory", "Inventory: -");
    this.guideEl = ensureHudLine(elements.hud, "guide", "Guide: Break a tree to collect your first logs.");
    this.diagnosticsEl = ensureHudLine(elements.hud, "diag", "FrameErr(main/worker): 0/0");
  }

  setStatus(message: string) {
    this.elements.status.textContent = message;
  }

  setOverlayTitle(title: string) {
    const heading = this.elements.overlay.querySelector("h1");
    if (heading) heading.textContent = title;
  }

  syncVisibility({ locked, inventoryOpen }: { locked: boolean; inventoryOpen: boolean }) {
    const paused = !locked && !inventoryOpen;
    this.elements.overlay.classList.toggle("hidden", !paused);
    this.elements.inventoryPanel.classList.toggle("visible", inventoryOpen);
    this.elements.inventoryPanel.setAttribute("aria-hidden", inventoryOpen ? "false" : "true");
    this.elements.crosshair.style.display = locked ? "block" : "none";
    this.elements.hud.style.display = paused ? "none" : "block";
    this.elements.hotbar.style.display = locked ? "flex" : "none";
  }

  bindRecipeSelect(handler: (recipeId: RecipeId) => void) {
    this.elements.recipeList.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-recipe-id]");
      const recipeId = button?.dataset.recipeId as RecipeId | undefined;
      if (recipeId) handler(recipeId);
    });
  }

  bindFurnaceAction(handler: (action: "start" | "collect") => void) {
    this.elements.furnacePanel.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-furnace-action]");
      const action = button?.dataset.furnaceAction;
      if (action === "start" || action === "collect") {
        handler(action);
      }
    });
  }

  bindAction(handler: (action: { type: "consume"; itemId: InventoryEntry["itemId"] } | { type: "sleep" }) => void) {
    this.elements.actionList.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!button) return;
      const consumeItem = button.dataset.consumeItem as InventoryEntry["itemId"] | undefined;
      if (consumeItem) {
        handler({ type: "consume", itemId: consumeItem });
        return;
      }
      if (button.dataset.action === "sleep") {
        handler({ type: "sleep" });
      }
    });
  }

  renderHud(model: HudRenderModel) {
    this.elements.pos.textContent = `XYZ: ${model.cameraPos[0].toFixed(1)}, ${model.cameraPos[1].toFixed(1)}, ${model.cameraPos[2].toFixed(1)}`;
    this.elements.chunks.textContent = `Chunks: ${model.chunkCount}`;

    const targetLabel = !model.target
      ? "none"
      : model.target.kind === "block"
        ? `block (${model.target.hit.worldX},${model.target.hit.worldY},${model.target.hit.worldZ})`
        : `${model.target.entity.isBaby ? "baby " : ""}${model.target.entity.kind}#${model.target.entity.id}`;
    this.targetEl.textContent = `Target: ${targetLabel} | Held: ${model.selectedItemName} x${model.selectedCount}`;
    this.fpsEl.textContent = `FPS: ${model.fps.toFixed(1)}`;

    if (model.stats) {
      this.statsEl.textContent =
        `HP: ${model.stats.health.toFixed(1)}/${model.stats.maxHealth} | Hunger: ${model.stats.hunger.toFixed(1)}/${model.stats.maxHunger} | ` +
        `Time: ${Math.floor(model.stats.timeOfDay)} (${model.stats.isNight ? "Night" : "Day"}) | Shelter: ${model.stats.isSheltered ? "yes" : "no"}`;
    } else {
      this.statsEl.textContent = "HP: - | Hunger: - | Time: -";
    }

    const counts = inventoryCounts(model.inventory);
    const invPreview = model.inventory.slice(0, 6).map((entry) => `${entry.itemId}:${entry.count}`).join(" ") || "-";
    const edibleAvailable = model.inventory.some((entry) => isEdibleItem(entry.itemId) && entry.count > 0) ? "yes" : "no";
    const breedingAvailable = (counts.get("wheat") ?? 0) > 0 ? "yes" : "no";
    const smeltReady = model.smelting ? Date.now() >= model.smelting.readyAtMs : false;
    const smeltLabel = model.smelting
      ? ` | Smelting: ${model.smelting.inputItem}->${model.smelting.outputItem} (${smeltReady ? "ready" : "running"})`
      : "";
    this.inventoryEl.textContent = `Inventory: ${invPreview} | Food: ${edibleAvailable} | Breed feed: ${breedingAvailable}${smeltLabel}`;
    this.guideEl.textContent = getTutorialHint(model.inventory, model.stats, model.smelting);

    this.diagnosticsEl.textContent =
      `FrameErr(main/worker): ${model.mainDiag.frameErrorCount}/${model.workerDiag.frameErrorCount} | ` +
      `Last(main): ${model.mainDiag.lastErrorCode ?? "-"} | Last(worker): ${model.workerDiag.lastErrorCode ?? "-"}` +
      (model.mainDiag.lastGpuError ? ` | GPU: ${model.mainDiag.lastGpuError}` : "");
  }

  renderInventoryPanel(inventory: InventoryEntry[], stats: PlayerStats | null, smelting: SmeltingState | null) {
    const counts = inventoryCounts(inventory);
    const smeltUiState = smelting
      ? {
          inputItem: smelting.inputItem,
          outputItem: smelting.outputItem,
          fuelItem: smelting.fuelItem,
          readyBucket: Math.max(0, Math.ceil((smelting.readyAtMs - Date.now()) / 1000)),
        }
      : null;
    const nextPanelKey = JSON.stringify({
      inventory,
      isNight: stats?.isNight ?? false,
      smelting: smeltUiState,
    });
    if (nextPanelKey === this.lastInventoryPanelKey) return;
    this.lastInventoryPanelKey = nextPanelKey;

    this.elements.inventoryGrid.innerHTML = inventory.length === 0
      ? '<div class="inventory-row empty-state"><span>Inventory empty</span><span>Break a tree to start</span></div>'
      : inventory
          .map((entry) => {
            const edible = isEdibleItem(entry.itemId) ? ` (+${getEdibleHunger(entry.itemId)} hunger)` : "";
            return `<div class="inventory-row"><span>${entry.itemId.replace("_", " ")}</span><span>${entry.count}${edible}</span></div>`;
          })
          .join("");

    this.elements.recipeList.innerHTML = RECIPES.map((recipe) => {
      const canCraft = Object.entries(recipe.inputs).every(([itemId, count]) => (counts.get(itemId as InventoryEntry["itemId"]) ?? 0) >= (count ?? 0));
      const hasStation = !recipe.requiresCraftingTable || (counts.get("crafting_table") ?? 0) > 0;
      const enabled = canCraft && hasStation;
      const inputs = Object.entries(recipe.inputs).map(([itemId, count]) => `${itemId}:${count}`).join(" ");
      const outputs = Object.entries(recipe.outputs).map(([itemId, count]) => `${itemId}:${count}`).join(" ");
      const requirement = recipe.requiresCraftingTable ? " | needs crafting table" : "";
      return `
        <div class="recipe-row ${enabled ? "" : "disabled"}">
          <div>
            <div>${recipe.id.replace("_", " ")}</div>
            <div class="panel-meta">${inputs} -> ${outputs}${requirement}</div>
          </div>
          <button data-recipe-id="${recipe.id}" ${enabled ? "" : "disabled"}>Craft</button>
        </div>`;
    }).join("");

    const fuel = preferredFuel(inventory);
    const canStartSmelting = !smelting && (counts.get("furnace") ?? 0) > 0 && (counts.get("raw_meat") ?? 0) > 0 && !!fuel;
    const smeltReady = smelting ? Date.now() >= smelting.readyAtMs : false;
    const smeltProgress = smelting
      ? `${Math.max(0, smelting.readyAtMs - Date.now()) <= 0 ? "Ready to collect" : `${Math.ceil(Math.max(0, smelting.readyAtMs - Date.now()) / 1000)}s remaining`}`
      : "Idle";
    this.elements.furnacePanel.innerHTML = `
      <div class="action-row ${canStartSmelting ? "" : "disabled"}">
        <div>
          <div>Cook raw meat</div>
          <div class="panel-meta">Needs furnace, raw meat, and fuel (${fuel ?? "none"})</div>
        </div>
        <button data-furnace-action="start" ${canStartSmelting ? "" : "disabled"}>Start</button>
      </div>
      <div class="action-row ${smelting && smeltReady ? "" : "disabled"}">
        <div>
          <div>${smelting ? `${smelting.inputItem} -> ${smelting.outputItem}` : "No active smelt"}</div>
          <div class="panel-meta">${smeltProgress}</div>
        </div>
        <button data-furnace-action="collect" ${smelting && smeltReady ? "" : "disabled"}>Collect</button>
      </div>`;

    const edibleRows = inventory
      .filter((entry) => entry.count > 0 && isEdibleItem(entry.itemId))
      .map((entry) => `
        <div class="action-row">
          <div>
            <div>Eat ${entry.itemId.replace("_", " ")}</div>
            <div class="panel-meta">Restores ${getEdibleHunger(entry.itemId)} hunger</div>
          </div>
          <button data-consume-item="${entry.itemId}">Eat</button>
        </div>`)
      .join("");

    const canSleep = !!stats?.isNight && (counts.get("bed") ?? 0) > 0;
    this.elements.actionList.innerHTML = `
      ${edibleRows || '<div class="action-row disabled"><div><div>No food ready</div><div class="panel-meta">Cook meat or hunt animals</div></div><button disabled>Eat</button></div>'}
      <div class="action-row ${canSleep ? "" : "disabled"}">
        <div>
          <div>Sleep</div>
          <div class="panel-meta">${stats?.isNight ? "Night time" : "Only available at night"}${(counts.get("bed") ?? 0) > 0 ? "" : " | bed required"}</div>
        </div>
        <button data-action="sleep" ${canSleep ? "" : "disabled"}>Sleep</button>
      </div>`;

    const checklist = getTutorialChecklist(inventory, stats, smelting);
    this.elements.checklistList.innerHTML = checklist.map((entry) => {
      const marker = entry.status === "done" ? "[x]" : entry.status === "active" ? "[>]" : "[ ]";
      return `
        <div class="checklist-row ${entry.status}">
          <div class="checklist-header">
            <span>${marker}</span>
            <span>${entry.label}</span>
          </div>
          <div class="panel-meta">${entry.detail}</div>
        </div>`;
    }).join("");
  }
}
