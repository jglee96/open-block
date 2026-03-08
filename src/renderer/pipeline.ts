import terrainWgsl from "./shaders/terrain.wgsl?raw";

export interface Pipeline {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  bindGroupLayout: GPUBindGroupLayout;
}

/** Stride in bytes: position(12) + normal(12) + color(12) = 36 */
export const VERTEX_STRIDE = 36;

/** Uniform buffer layout (128 bytes / 32 floats):
 *  offset   0: mat4x4f view_proj  (64 bytes)
 *  offset  64: vec3f   camera_pos (12 bytes) + 4 pad
 *  offset  80: vec3f   light_dir  (12 bytes) + 4 (ambient f32)
 *  offset  96: f32     fog_near
 *  offset 100: f32     fog_far
 *  offset 104: vec3f   sky_color  (12 bytes) + 4 pad
 *  total = 120 bytes → padded to 128 for 16-byte alignment
 */
export const UNIFORM_BUFFER_SIZE = 128;

export function createPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
): Pipeline {
  const shader = device.createShaderModule({ code: terrainWgsl });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shader,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0,  format: "float32x3" }, // position
            { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
            { shaderLocation: 2, offset: 24, format: "float32x3" }, // color
          ],
        },
      ],
    },
    fragment: {
      module: shader,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "back",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BUFFER_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  return { pipeline, uniformBuffer, bindGroup, bindGroupLayout };
}
