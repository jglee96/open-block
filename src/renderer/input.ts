export class InputManager {
  keys = new Set<string>();
  deltaX = 0;
  deltaY = 0;
  private pointerLocked = false;
  private lockedOverride: boolean | null = null;

  private canvas: HTMLCanvasElement;
  private mouseSensitivity = 0.002;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    canvas.addEventListener("click", () => {
      canvas.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });

    document.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      e.preventDefault();
    });
    document.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.deltaX += e.movementX * this.mouseSensitivity;
      this.deltaY += e.movementY * this.mouseSensitivity;
    });
  }

  get locked(): boolean {
    return this.lockedOverride ?? this.pointerLocked;
  }

  setLockedForTest(nextLocked: boolean) {
    this.lockedOverride = nextLocked;
  }

  setKeyStateForTest(code: string, pressed: boolean) {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
  }

  addLookDeltaForTest(dx: number, dy: number) {
    this.deltaX += dx;
    this.deltaY += dy;
  }

  clearTestInput() {
    this.keys.clear();
    this.deltaX = 0;
    this.deltaY = 0;
  }

  /** Call at the start of each frame to consume accumulated mouse movement. */
  consumeDelta(): { dx: number; dy: number } {
    const dx = this.deltaX;
    const dy = this.deltaY;
    this.deltaX = 0;
    this.deltaY = 0;
    return { dx, dy };
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }
}
