const SHADER = /* wgsl */`
struct Uniforms { view_proj: mat4x4f }
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@location(0) pos: vec3f) -> @builtin(position) vec4f {
  return u.view_proj * vec4f(pos, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(1.0, 0.92, 0.2, 1.0);
}
`;

/** 12 edges of a unit cube as line-list pairs (indices into corners array). */
const EDGE_PAIRS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export interface HighlightBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export class HighlightRenderer {
  private hlPipeline: GPURenderPipeline;
  private vertexBuffer: GPUBuffer;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private visible = false;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    const shader = device.createShaderModule({ code: SHADER });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" },
      }],
    });

    this.hlPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shader,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: { topology: "line-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
    });

    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.vertexBuffer = device.createBuffer({
      size: 288,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  updateViewProj(device: GPUDevice, viewProj: Float32Array) {
    if (viewProj.length < 16) return;
    const data = new Float32Array(16);
    data.set(viewProj.subarray(0, 16));
    device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  setTarget(device: GPUDevice, bounds: HighlightBounds | null) {
    if (!bounds) {
      this.visible = false;
      return;
    }

    const values = [
      bounds.minX,
      bounds.minY,
      bounds.minZ,
      bounds.maxX,
      bounds.maxY,
      bounds.maxZ,
    ];
    if (values.some((v) => !Number.isFinite(v))) {
      this.visible = false;
      return;
    }

    this.visible = true;
    const d = 0.002;
    const x0 = bounds.minX - d;
    const y0 = bounds.minY - d;
    const z0 = bounds.minZ - d;
    const x1 = bounds.maxX + d;
    const y1 = bounds.maxY + d;
    const z1 = bounds.maxZ + d;

    const corners: [number, number, number][] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];

    const data = new Float32Array(24 * 3);
    EDGE_PAIRS.forEach(([a, b], i) => {
      data.set(corners[a], i * 6);
      data.set(corners[b], i * 6 + 3);
    });

    device.queue.writeBuffer(this.vertexBuffer, 0, data);
  }

  draw(pass: GPURenderPassEncoder) {
    if (!this.visible) return;
    pass.setPipeline(this.hlPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(24);
  }
}
