struct Uniforms {
    view_proj  : mat4x4f,
    camera_pos : vec3f,
    _pad0      : f32,
    light_dir  : vec3f,
    ambient    : f32,
    fog_near   : f32,
    fog_far    : f32,
    sky_color  : vec3f,
    _pad3      : f32,
}

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VertexIn {
    @location(0) position : vec3f,
    @location(1) normal   : vec3f,
    @location(2) color    : vec3f,
}

struct VertexOut {
    @builtin(position) clip_pos : vec4f,
    @location(0) normal         : vec3f,
    @location(1) color          : vec3f,
    @location(2) world_pos      : vec3f,
}

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_pos  = u.view_proj * vec4f(in.position, 1.0);
    out.normal    = in.normal;
    out.color     = in.color;
    out.world_pos = in.position;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    let n = normalize(in.normal);
    let diffuse = max(dot(n, normalize(u.light_dir)), 0.0);
    let lighting = u.ambient + (1.0 - u.ambient) * diffuse;
    let base = in.color * lighting;
    let dist = length(u.camera_pos - in.world_pos);
    let fog_t = clamp((dist - u.fog_near) / (u.fog_far - u.fog_near), 0.0, 1.0);
    let tinted = mix(base, vec3f(0.35, 0.62, 0.92), 0.35);
    return vec4f(mix(tinted, u.sky_color, fog_t), 0.72);
}
