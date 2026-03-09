import {
  HOTBAR_ITEMS,
  PLACEABLE_ITEM_COLORS,
  type ItemId,
  type HotbarItemId,
} from "./gameplay/items";
import type { InventoryEntry } from "./worker/protocol";

function countByItem(entries: InventoryEntry[]): Map<ItemId, number> {
  return new Map(entries.map((entry) => [entry.itemId, entry.count]));
}

export class HotbarManager {
  private selectedIndex = 0;
  private slots: HTMLElement[] = [];
  private counts = new Map<ItemId, number>();

  constructor() {
    this.buildDOM();
    this.bindKeys();
  }

  get selectedItemId(): HotbarItemId | null {
    return HOTBAR_ITEMS[this.selectedIndex];
  }

  get selectedItemName(): string {
    return this.selectedItemId ? this.selectedItemId.replace("_", " ") : "empty";
  }

  get selectedIndexValue(): number {
    return this.selectedIndex;
  }

  getSelectedCount(): number {
    const itemId = this.selectedItemId;
    return itemId ? this.counts.get(itemId) ?? 0 : 0;
  }

  selectIndex(index: number) {
    this.select(index);
  }

  syncInventory(entries: InventoryEntry[], pickedUpItemId: ItemId | null = null) {
    const previousSelectedCount = this.getSelectedCount();
    const previousCounts = this.counts;
    this.counts = countByItem(entries);
    if (pickedUpItemId && previousSelectedCount <= 0) {
      const slotIndex = HOTBAR_ITEMS.findIndex((itemId) => itemId === pickedUpItemId);
      if (slotIndex >= 0 && (previousCounts.get(pickedUpItemId) ?? 0) < (this.counts.get(pickedUpItemId) ?? 0)) {
        this.select(slotIndex);
      }
    }
    this.slots.forEach((slot, index) => {
      const itemId = HOTBAR_ITEMS[index];
      const countEl = slot.querySelector(".slot-count") as HTMLElement | null;
      const nameEl = slot.querySelector(".slot-name") as HTMLElement | null;
      if (!itemId) {
        slot.classList.add("empty");
        if (countEl) countEl.textContent = "";
        if (nameEl) nameEl.textContent = "";
        return;
      }

      slot.classList.remove("empty");
      const count = this.counts.get(itemId) ?? 0;
      if (countEl) countEl.textContent = count > 0 ? `${count}` : "";
      if (nameEl) nameEl.textContent = itemId.replace("_", " ");
      slot.classList.toggle("depleted", count === 0);
    });
  }

  private buildDOM() {
    const hotbar = document.getElementById("hotbar");
    if (!hotbar) return;

    HOTBAR_ITEMS.forEach((itemId, index) => {
      const slot = hotbar.children[index] as HTMLElement | undefined;
      if (!slot) return;

      const color = itemId ? PLACEABLE_ITEM_COLORS[itemId] ?? "#666" : "#222";
      slot.style.setProperty("--block-color", color);
      slot.dataset.itemId = itemId ?? "";

      const nameEl = slot.querySelector(".slot-name") as HTMLElement | null;
      if (nameEl) {
        nameEl.textContent = itemId ? itemId.replace("_", " ") : "";
      }

      const countEl = document.createElement("span");
      countEl.className = "slot-count";
      countEl.style.position = "absolute";
      countEl.style.right = "4px";
      countEl.style.bottom = "4px";
      countEl.style.fontFamily = "monospace";
      countEl.style.fontSize = "10px";
      countEl.style.color = "#fff";
      countEl.style.textShadow = "1px 1px 1px #000";
      slot.appendChild(countEl);

      this.slots.push(slot);
    });

    this.updateSelection();
  }

  private select(index: number) {
    this.selectedIndex = ((index % HOTBAR_ITEMS.length) + HOTBAR_ITEMS.length) % HOTBAR_ITEMS.length;
    this.updateSelection();
  }

  private updateSelection() {
    this.slots.forEach((slot, index) => {
      slot.classList.toggle("selected", index === this.selectedIndex);
    });
  }

  private bindKeys() {
    document.addEventListener("keydown", (e) => {
      if (!e.code.startsWith("Digit")) return;
      const number = Number.parseInt(e.code.replace("Digit", ""), 10);
      if (number >= 1 && number <= HOTBAR_ITEMS.length) {
        this.select(number - 1);
      }
    });

    document.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.select(this.selectedIndex + (e.deltaY > 0 ? 1 : -1));
      },
      { passive: false },
    );
  }
}
