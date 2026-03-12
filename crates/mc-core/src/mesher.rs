use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_HEIGHT, CHUNK_SIZE, FLUID_LEVEL_EMPTY, FLUID_LEVEL_MAX};

/// Vertex stride: position(3) + normal(3) + color(3) = 9 floats = 36 bytes
pub const FLOATS_PER_VERTEX: usize = 9;

/// Six face directions: +X, -X, +Y, -Y, +Z, -Z
const FACES: [([i32; 3], [f32; 3], [[f32; 3]; 4]); 6] = [
    ([1, 0, 0], [1.0, 0.0, 0.0], [[1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [1.0, 1.0, 1.0], [1.0, 0.0, 1.0]]),
    ([-1, 0, 0], [-1.0, 0.0, 0.0], [[0.0, 0.0, 1.0], [0.0, 1.0, 1.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]]),
    ([0, 1, 0], [0.0, 1.0, 0.0], [[0.0, 1.0, 0.0], [0.0, 1.0, 1.0], [1.0, 1.0, 1.0], [1.0, 1.0, 0.0]]),
    ([0, -1, 0], [0.0, -1.0, 0.0], [[0.0, 0.0, 1.0], [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 1.0]]),
    ([0, 0, 1], [0.0, 0.0, 1.0], [[1.0, 0.0, 1.0], [1.0, 1.0, 1.0], [0.0, 1.0, 1.0], [0.0, 0.0, 1.0]]),
    ([0, 0, -1], [0.0, 0.0, -1.0], [[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 1.0, 0.0], [1.0, 0.0, 0.0]]),
];

pub struct Mesher;

impl Mesher {
    pub fn build_mesh_with_neighbors(
        chunk: &Chunk,
        px: Option<&Chunk>,
        nx: Option<&Chunk>,
        pz: Option<&Chunk>,
        nz: Option<&Chunk>,
        world_x: i32,
        world_z: i32,
    ) -> Vec<f32> {
        Self::build_solid_mesh_with_neighbors(chunk, px, nx, pz, nz, world_x, world_z)
    }

    pub fn build_solid_mesh_with_neighbors(
        chunk: &Chunk,
        px: Option<&Chunk>,
        nx: Option<&Chunk>,
        pz: Option<&Chunk>,
        nz: Option<&Chunk>,
        world_x: i32,
        world_z: i32,
    ) -> Vec<f32> {
        let mut verts: Vec<f32> = Vec::with_capacity(50_000);
        let wx0 = world_x as f32;
        let wz0 = world_z as f32;

        for y in 0..CHUNK_HEIGHT {
            for z in 0..CHUNK_SIZE {
                for x in 0..CHUNK_SIZE {
                    let block = chunk.get(x, y, z);
                    if block == BlockType::Air || block.is_fluid() {
                        continue;
                    }
                    if Self::is_cross_plant(block) {
                        Self::push_cross_plant(&mut verts, [wx0 + x as f32, y as f32, wz0 + z as f32], block);
                        continue;
                    }
                    let color = block.color();

                    for (dir, normal, quad) in &FACES {
                        let neighbor = Self::neighbor_block(chunk, px, nx, pz, nz, x as i32 + dir[0], y as i32 + dir[1], z as i32 + dir[2]);
                        let transparent = match neighbor {
                            Some(block) => !block.is_solid(),
                            None => dir[1] > 0,
                        };
                        if !transparent {
                            continue;
                        }

                        let v: [[f32; 3]; 4] = [
                            [wx0 + x as f32 + quad[0][0], y as f32 + quad[0][1], wz0 + z as f32 + quad[0][2]],
                            [wx0 + x as f32 + quad[1][0], y as f32 + quad[1][1], wz0 + z as f32 + quad[1][2]],
                            [wx0 + x as f32 + quad[2][0], y as f32 + quad[2][1], wz0 + z as f32 + quad[2][2]],
                            [wx0 + x as f32 + quad[3][0], y as f32 + quad[3][1], wz0 + z as f32 + quad[3][2]],
                        ];

                        Self::push_quad(&mut verts, v, *normal, color);
                    }
                }
            }
        }

        verts
    }

    pub fn build_water_mesh_with_neighbors(
        chunk: &Chunk,
        px: Option<&Chunk>,
        nx: Option<&Chunk>,
        pz: Option<&Chunk>,
        nz: Option<&Chunk>,
        world_x: i32,
        world_z: i32,
    ) -> Vec<f32> {
        let mut verts: Vec<f32> = Vec::with_capacity(24_000);
        let wx0 = world_x as f32;
        let wz0 = world_z as f32;
        let color = BlockType::Water.color();

        for y in 0..CHUNK_HEIGHT {
            for z in 0..CHUNK_SIZE {
                for x in 0..CHUNK_SIZE {
                    let level = chunk.get_fluid(x, y, z);
                    if level == FLUID_LEVEL_EMPTY {
                        continue;
                    }
                    let block = chunk.get(x, y, z);
                    if block.is_solid() || block.is_decorative() {
                        continue;
                    }

                    let h = Self::fluid_height(level);
                    let world_origin = [wx0 + x as f32, y as f32, wz0 + z as f32];

                    let above_fluid = Self::neighbor_fluid(chunk, px, nx, pz, nz, x as i32, y as i32 + 1, z as i32);
                    let above_block = Self::neighbor_block(chunk, px, nx, pz, nz, x as i32, y as i32 + 1, z as i32);
                    let show_top = above_fluid == FLUID_LEVEL_EMPTY && above_block.map(|candidate| !candidate.is_solid()).unwrap_or(true);
                    if show_top {
                        Self::push_quad(
                            &mut verts,
                            [
                                [world_origin[0], world_origin[1] + h, world_origin[2]],
                                [world_origin[0], world_origin[1] + h, world_origin[2] + 1.0],
                                [world_origin[0] + 1.0, world_origin[1] + h, world_origin[2] + 1.0],
                                [world_origin[0] + 1.0, world_origin[1] + h, world_origin[2]],
                            ],
                            [0.0, 1.0, 0.0],
                            color,
                        );
                    }

                    for (dir, normal) in [([1, 0, 0], [1.0, 0.0, 0.0]), ([-1, 0, 0], [-1.0, 0.0, 0.0]), ([0, 0, 1], [0.0, 0.0, 1.0]), ([0, 0, -1], [0.0, 0.0, -1.0])] {
                        let neighbor_block = Self::neighbor_block(chunk, px, nx, pz, nz, x as i32 + dir[0], y as i32 + dir[1], z as i32 + dir[2]);
                        if neighbor_block.map(|candidate| candidate.is_solid()).unwrap_or(false) {
                            continue;
                        }

                        let neighbor_level = Self::neighbor_fluid(chunk, px, nx, pz, nz, x as i32 + dir[0], y as i32 + dir[1], z as i32 + dir[2]);
                        let neighbor_h = Self::fluid_height(neighbor_level);
                        if neighbor_h >= h {
                            continue;
                        }

                        let quad = match dir {
                            [1, 0, 0] => [
                                [world_origin[0] + 1.0, world_origin[1] + neighbor_h, world_origin[2]],
                                [world_origin[0] + 1.0, world_origin[1] + h, world_origin[2]],
                                [world_origin[0] + 1.0, world_origin[1] + h, world_origin[2] + 1.0],
                                [world_origin[0] + 1.0, world_origin[1] + neighbor_h, world_origin[2] + 1.0],
                            ],
                            [-1, 0, 0] => [
                                [world_origin[0], world_origin[1] + neighbor_h, world_origin[2] + 1.0],
                                [world_origin[0], world_origin[1] + h, world_origin[2] + 1.0],
                                [world_origin[0], world_origin[1] + h, world_origin[2]],
                                [world_origin[0], world_origin[1] + neighbor_h, world_origin[2]],
                            ],
                            [0, 0, 1] => [
                                [world_origin[0] + 1.0, world_origin[1] + neighbor_h, world_origin[2] + 1.0],
                                [world_origin[0] + 1.0, world_origin[1] + h, world_origin[2] + 1.0],
                                [world_origin[0], world_origin[1] + h, world_origin[2] + 1.0],
                                [world_origin[0], world_origin[1] + neighbor_h, world_origin[2] + 1.0],
                            ],
                            _ => [
                                [world_origin[0], world_origin[1] + neighbor_h, world_origin[2]],
                                [world_origin[0], world_origin[1] + h, world_origin[2]],
                                [world_origin[0] + 1.0, world_origin[1] + h, world_origin[2]],
                                [world_origin[0] + 1.0, world_origin[1] + neighbor_h, world_origin[2]],
                            ],
                        };
                        Self::push_quad(&mut verts, quad, normal, color);
                    }
                }
            }
        }

        verts
    }

    pub fn build_mesh(chunk: &Chunk) -> Vec<f32> {
        let mut verts: Vec<f32> = Vec::new();

        for y in 0..CHUNK_HEIGHT {
            for z in 0..CHUNK_SIZE {
                for x in 0..CHUNK_SIZE {
                    let block = chunk.get(x, y, z);
                    if block == BlockType::Air || block.is_fluid() {
                        continue;
                    }
                    if Self::is_cross_plant(block) {
                        Self::push_cross_plant(&mut verts, [x as f32, y as f32, z as f32], block);
                        continue;
                    }

                    let color = block.color();
                    for (dir, normal, quad) in &FACES {
                        let nbx = x as i32 + dir[0];
                        let nby = y as i32 + dir[1];
                        let nbz = z as i32 + dir[2];

                        let neighbour_transparent = if nbx < 0
                            || nbx >= CHUNK_SIZE as i32
                            || nby < 0
                            || nby >= CHUNK_HEIGHT as i32
                            || nbz < 0
                            || nbz >= CHUNK_SIZE as i32
                        {
                            true
                        } else {
                            !chunk.get(nbx as usize, nby as usize, nbz as usize).is_solid()
                        };

                        if !neighbour_transparent {
                            continue;
                        }

                        let v: [[f32; 3]; 4] = [
                            [x as f32 + quad[0][0], y as f32 + quad[0][1], z as f32 + quad[0][2]],
                            [x as f32 + quad[1][0], y as f32 + quad[1][1], z as f32 + quad[1][2]],
                            [x as f32 + quad[2][0], y as f32 + quad[2][1], z as f32 + quad[2][2]],
                            [x as f32 + quad[3][0], y as f32 + quad[3][1], z as f32 + quad[3][2]],
                        ];
                        Self::push_quad(&mut verts, v, *normal, color);
                    }
                }
            }
        }

        verts
    }

    pub fn build_water_mesh(chunk: &Chunk) -> Vec<f32> {
        Self::build_water_mesh_with_neighbors(chunk, None, None, None, None, 0, 0)
    }

    fn fluid_height(level: u8) -> f32 {
        if level == FLUID_LEVEL_EMPTY {
            0.0
        } else {
            level as f32 / FLUID_LEVEL_MAX as f32
        }
    }

    fn neighbor_block(
        chunk: &Chunk,
        px: Option<&Chunk>,
        nx: Option<&Chunk>,
        pz: Option<&Chunk>,
        nz: Option<&Chunk>,
        nbx: i32,
        nby: i32,
        nbz: i32,
    ) -> Option<BlockType> {
        if nby < 0 {
            return Some(BlockType::Bedrock);
        }
        if nby >= CHUNK_HEIGHT as i32 {
            return None;
        }
        if nbx < 0 {
            return nx.map(|chunk| chunk.get(CHUNK_SIZE - 1, nby as usize, nbz as usize));
        }
        if nbx >= CHUNK_SIZE as i32 {
            return px.map(|chunk| chunk.get(0, nby as usize, nbz as usize));
        }
        if nbz < 0 {
            return nz.map(|chunk| chunk.get(nbx as usize, nby as usize, CHUNK_SIZE - 1));
        }
        if nbz >= CHUNK_SIZE as i32 {
            return pz.map(|chunk| chunk.get(nbx as usize, nby as usize, 0));
        }
        Some(chunk.get(nbx as usize, nby as usize, nbz as usize))
    }

    fn neighbor_fluid(
        chunk: &Chunk,
        px: Option<&Chunk>,
        nx: Option<&Chunk>,
        pz: Option<&Chunk>,
        nz: Option<&Chunk>,
        nbx: i32,
        nby: i32,
        nbz: i32,
    ) -> u8 {
        if nby < 0 || nby >= CHUNK_HEIGHT as i32 {
            return FLUID_LEVEL_EMPTY;
        }
        if nbx < 0 {
            return nx.map(|chunk| chunk.get_fluid(CHUNK_SIZE - 1, nby as usize, nbz as usize)).unwrap_or(FLUID_LEVEL_EMPTY);
        }
        if nbx >= CHUNK_SIZE as i32 {
            return px.map(|chunk| chunk.get_fluid(0, nby as usize, nbz as usize)).unwrap_or(FLUID_LEVEL_EMPTY);
        }
        if nbz < 0 {
            return nz.map(|chunk| chunk.get_fluid(nbx as usize, nby as usize, CHUNK_SIZE - 1)).unwrap_or(FLUID_LEVEL_EMPTY);
        }
        if nbz >= CHUNK_SIZE as i32 {
            return pz.map(|chunk| chunk.get_fluid(nbx as usize, nby as usize, 0)).unwrap_or(FLUID_LEVEL_EMPTY);
        }
        chunk.get_fluid(nbx as usize, nby as usize, nbz as usize)
    }

    fn push_quad(verts: &mut Vec<f32>, quad: [[f32; 3]; 4], normal: [f32; 3], color: [f32; 3]) {
        for &vi in &[0usize, 1, 2] {
            Self::push_vertex(verts, quad[vi], normal, color);
        }
        for &vi in &[0usize, 2, 3] {
            Self::push_vertex(verts, quad[vi], normal, color);
        }
    }

    #[inline(always)]
    fn push_vertex(verts: &mut Vec<f32>, pos: [f32; 3], normal: [f32; 3], color: [f32; 3]) {
        #[cfg(target_feature = "simd128")]
        unsafe {
            Self::push_vertex_simd(verts, pos, normal, color);
        }

        #[cfg(not(target_feature = "simd128"))]
        {
            verts.extend_from_slice(&pos);
            verts.extend_from_slice(&normal);
            verts.extend_from_slice(&color);
        }
    }

    #[cfg(target_feature = "simd128")]
    #[inline(always)]
    unsafe fn push_vertex_simd(
        verts: &mut Vec<f32>,
        pos: [f32; 3],
        normal: [f32; 3],
        color: [f32; 3],
    ) {
        use std::arch::wasm32::*;
        let len = verts.len();
        verts.reserve(9);
        let ptr = verts.as_mut_ptr().add(len) as *mut u8;
        let v0: v128 = core::mem::transmute([pos[0], pos[1], pos[2], normal[0]]);
        v128_store(ptr as *mut v128, v0);
        let v1: v128 = core::mem::transmute([normal[1], normal[2], color[0], color[1]]);
        v128_store(ptr.add(16) as *mut v128, v1);
        *(ptr.add(32) as *mut f32) = color[2];
        verts.set_len(len + 9);
    }

    fn is_cross_plant(block: BlockType) -> bool {
        block.is_decorative()
    }

    fn crop_height(block: BlockType) -> f32 {
        match block {
            BlockType::WheatCrop0 => 0.35,
            BlockType::WheatCrop1 => 0.55,
            BlockType::WheatCrop2 => 0.75,
            BlockType::WheatCrop3 => 0.95,
            BlockType::ShortGrass => 0.8,
            _ => 1.0,
        }
    }

    fn push_cross_plant(verts: &mut Vec<f32>, origin: [f32; 3], block: BlockType) {
        let color = block.color();
        let h = Self::crop_height(block);
        let planes = [
            (
                [
                    [origin[0] + 0.15, origin[1], origin[2] + 0.15],
                    [origin[0] + 0.15, origin[1] + h, origin[2] + 0.15],
                    [origin[0] + 0.85, origin[1] + h, origin[2] + 0.85],
                    [origin[0] + 0.85, origin[1], origin[2] + 0.85],
                ],
                [0.707, 0.0, 0.707],
            ),
            (
                [
                    [origin[0] + 0.85, origin[1], origin[2] + 0.15],
                    [origin[0] + 0.85, origin[1] + h, origin[2] + 0.15],
                    [origin[0] + 0.15, origin[1] + h, origin[2] + 0.85],
                    [origin[0] + 0.15, origin[1], origin[2] + 0.85],
                ],
                [-0.707, 0.0, 0.707],
            ),
        ];

        for (quad, normal) in planes {
            Self::push_quad(verts, quad, normal, color);
            let back_normal = [-normal[0], -normal[1], -normal[2]];
            Self::push_quad(verts, [quad[2], quad[1], quad[0], quad[3]], back_normal, color);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunk::Chunk;

    #[test]
    fn single_block_has_six_faces() {
        let mut chunk = Chunk::new();
        chunk.set(8, 8, 8, BlockType::Stone);
        let mesh = Mesher::build_mesh(&chunk);
        assert_eq!(mesh.len(), 6 * 6 * FLOATS_PER_VERTEX);
    }

    #[test]
    fn two_adjacent_blocks_share_face_culled() {
        let mut chunk = Chunk::new();
        chunk.set(0, 8, 0, BlockType::Stone);
        chunk.set(1, 8, 0, BlockType::Stone);
        let mesh = Mesher::build_mesh(&chunk);
        assert_eq!(mesh.len(), 10 * 6 * FLOATS_PER_VERTEX);
    }

    #[test]
    fn neighbor_culls_boundary_face() {
        let mut chunk = Chunk::new();
        chunk.set(0, 8, 8, BlockType::Stone);

        let mut solid_nx = Chunk::new();
        solid_nx.set(CHUNK_SIZE - 1, 8, 8, BlockType::Stone);
        let mesh_solid = Mesher::build_mesh_with_neighbors(&chunk, None, Some(&solid_nx), None, None, 0, 0);

        let air_nx = Chunk::new();
        let mesh_air = Mesher::build_mesh_with_neighbors(&chunk, None, Some(&air_nx), None, None, 0, 0);

        assert!(mesh_air.len() > mesh_solid.len());
        assert_eq!(mesh_air.len() - mesh_solid.len(), 6 * FLOATS_PER_VERTEX);
    }

    #[test]
    fn crop_blocks_emit_crossed_quads() {
        let mut chunk = Chunk::new();
        chunk.set(8, 8, 8, BlockType::WheatCrop3);
        let mesh = Mesher::build_mesh(&chunk);
        assert_eq!(mesh.len(), 24 * FLOATS_PER_VERTEX);
    }

    #[test]
    fn water_mesh_uses_height_from_fluid_level() {
        let mut chunk = Chunk::new();
        chunk.set(8, 8, 8, BlockType::Water);
        chunk.set_fluid(8, 8, 8, 4);
        let mesh = Mesher::build_water_mesh(&chunk);

        let top_y = mesh
            .chunks_exact(FLOATS_PER_VERTEX)
            .filter(|vertex| (vertex[4] - 1.0).abs() < f32::EPSILON)
            .map(|vertex| vertex[1])
            .fold(0.0, f32::max);

        assert!((top_y - 8.5).abs() < 0.001);
    }

    #[test]
    fn water_mesh_culls_shared_topology_between_water_cells() {
        let mut chunk = Chunk::new();
        chunk.set(8, 8, 8, BlockType::Water);
        chunk.set(9, 8, 8, BlockType::Water);
        chunk.set_fluid(8, 8, 8, FLUID_LEVEL_MAX);
        chunk.set_fluid(9, 8, 8, FLUID_LEVEL_MAX);

        let mesh = Mesher::build_water_mesh(&chunk);
        assert_eq!(mesh.len(), 8 * 6 * FLOATS_PER_VERTEX);
    }
}
