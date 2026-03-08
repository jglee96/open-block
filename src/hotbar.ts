/** BlockType values matching Rust's BlockType enum */
const HOTBAR_BLOCKS: { type: number; name: string; color: string }[] = [
  { type: 1, name: "Stone",   color: "#808080" },
  { type: 2, name: "Dirt",    color: "#8c5e35" },
  { type: 3, name: "Grass",   color: "#4da633" },
  { type: 4, name: "Sand",    color: "#eded99" },
  { type: 5, name: "Water",   color: "#3373d9" },
  { type: 6, name: "Snow",    color: "#f2f7ff" },
  { type: 7, name: "Bedrock", color: "#262626" },
  { type: 1, name: "Stone",   color: "#808080" },
  { type: 2, name: "Dirt",    color: "#8c5e35" },
];

export class HotbarManager {
  private selectedIndex = 0;
  private slots: HTMLElement[] = [];

  constructor() {
    this.buildDOM();
    this.bindKeys();
  }

  get selectedBlockType(): number {
    return HOTBAR_BLOCKS[this.selectedIndex].type;
  }

  get selectedBlockName(): string {
    return HOTBAR_BLOCKS[this.selectedIndex].name;
  }

  setBlockCounts(blockCounts: Map<number, number>) {
    this.slots.forEach((slot, i) => {
      const blockType = HOTBAR_BLOCKS[i].type;
      const count = blockCounts.get(blockType) ?? 0;
      const countEl = slot.querySelector(".slot-count") as HTMLElement | null;
      if (countEl) countEl.textContent = count > 0 ? `${count}` : "";
    });
  }

  private buildDOM() {
    const hotbar = document.getElementById("hotbar");
    if (!hotbar) return;

    HOTBAR_BLOCKS.forEach((block, i) => {
      const slot = hotbar.children[i] as HTMLElement | undefined;
      if (!slot) return;
      slot.style.setProperty("--block-color", block.color);
      slot.querySelector(".slot-name")!.textContent = block.name;

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
    this.selectedIndex = ((index % 9) + 9) % 9;
    this.updateSelection();
  }

  private updateSelection() {
    this.slots.forEach((slot, i) => {
      slot.classList.toggle("selected", i === this.selectedIndex);
    });
  }

  private bindKeys() {
    document.addEventListener("keydown", (e) => {
      if (e.code.startsWith("Digit")) {
        const n = parseInt(e.code.replace("Digit", ""), 10);
        if (n >= 1 && n <= 9) this.select(n - 1);
      }
    });

    document.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.select(this.selectedIndex + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
  }
}
