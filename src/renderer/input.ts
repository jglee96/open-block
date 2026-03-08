export class InputManager {
  keys = new Set<string>();
  deltaX = 0;
  deltaY = 0;
  locked = false;

  private canvas: HTMLCanvasElement;
  private mouseSensitivity = 0.002;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    canvas.addEventListener("click", () => {
      canvas.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
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
