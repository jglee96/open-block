import { mat4, vec3 } from "gl-matrix";

export class Camera {
  position: vec3 = vec3.fromValues(8, 40, 8);
  yaw   = 0;   // radians, rotation around Y
  pitch = 0;   // radians, rotation around X (clamped)

  private viewProj = mat4.create();
  private view     = mat4.create();
  private proj     = mat4.create();

  aspect = 1;
  fov    = (70 * Math.PI) / 180;
  near   = 0.1;
  far    = 1000;

  /** Returns the forward direction in world space. */
  get forward(): vec3 {
    return vec3.fromValues(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }

  get right(): vec3 {
    const f = this.forward;
    const up: vec3 = [0, 1, 0];
    const r = vec3.create();
    vec3.cross(r, f, up);
    vec3.normalize(r, r);
    return r;
  }

  updateAspect(width: number, height: number) {
    this.aspect = width / height;
  }

  /** Compute and return the view-projection matrix (column-major Float32Array). */
  getViewProj(): Float32Array {
    const target = vec3.create();
    vec3.add(target, this.position, this.forward);

    mat4.lookAt(this.view, this.position, target, [0, 1, 0]);
    mat4.perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);
    return this.viewProj as Float32Array;
  }
}
