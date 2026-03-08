use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_SIZE, CHUNK_HEIGHT};

/// Vertex stride: position(3) + normal(3) + color(3) = 9 floats = 36 bytes
pub const FLOATS_PER_VERTEX: usize = 9;

/// Six face directions: +X, -X, +Y, -Y, +Z, -Z
const FACES: [([i32; 3], [f32; 3], [[f32; 3]; 4]); 6] = [
    // +X face
    ([1, 0, 0], [1.0, 0.0, 0.0],
     [[1.0,0.0,0.0],[1.0,1.0,0.0],[1.0,1.0,1.0],[1.0,0.0,1.0]]),
    // -X face
    ([-1, 0, 0], [-1.0, 0.0, 0.0],
     [[0.0,0.0,1.0],[0.0,1.0,1.0],[0.0,1.0,0.0],[0.0,0.0,0.0]]),
    // +Y face
    ([0, 1, 0], [0.0, 1.0, 0.0],
     [[0.0,1.0,0.0],[0.0,1.0,1.0],[1.0,1.0,1.0],[1.0,1.0,0.0]]),
    // -Y face
    ([0, -1, 0], [0.0, -1.0, 0.0],
     [[0.0,0.0,1.0],[0.0,0.0,0.0],[1.0,0.0,0.0],[1.0,0.0,1.0]]),
    // +Z face
    ([0, 0, 1], [0.0, 0.0, 1.0],
     [[1.0,0.0,1.0],[1.0,1.0,1.0],[0.0,1.0,1.0],[0.0,0.0,1.0]]),
    // -Z face
    ([0, 0, -1], [0.0, 0.0, -1.0],
     [[0.0,0.0,0.0],[0.0,1.0,0.0],[1.0,1.0,0.0],[1.0,0.0,0.0]]),
];

pub struct Mesher;

impl Mesher {
    /// Build mesh with neighbor chunk data for boundary face culling.
    /// Vertex positions are in world space (chunk world offset applied).
    /// Boundary faces adjacent to missing neighbors are culled (not drawn).
    pub fn build_mesh_with_neighbors(
        chunk: &Chunk,
        px: Option<&Chunk>,  // +X neighbor
        nx: Option<&Chunk>,  // -X neighbor
        pz: Option<&Chunk>,  // +Z neighbor
        nz: Option<&Chunk>,  // -Z neighbor
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
                    if block == BlockType::Air {
                        continue;
                    }
                    let color = block.color();

                    for (dir, normal, quad) in &FACES {
                        let nbx = x as i32 + dir[0];
                        let nby = y as i32 + dir[1];
                        let nbz = z as i32 + dir[2];

                        let transparent = if nby < 0 {
                            // Below chunk bottom: treat as solid (bedrock below world)
                            false
                        } else if nby >= CHUNK_HEIGHT as i32 {
                            // Above chunk top: always transparent
                            true
                        } else if nbx < 0 {
                            match nx {
                                Some(c) => !c.get(CHUNK_SIZE - 1, nby as usize, z).is_opaque(),
                                None => false,
                            }
                        } else if nbx >= CHUNK_SIZE as i32 {
                            match px {
                                Some(c) => !c.get(0, nby as usize, z).is_opaque(),
                                None => false,
                            }
                        } else if nbz < 0 {
                            match nz {
                                Some(c) => !c.get(x, nby as usize, CHUNK_SIZE - 1).is_opaque(),
                                None => false,
                            }
                        } else if nbz >= CHUNK_SIZE as i32 {
                            match pz {
                                Some(c) => !c.get(x, nby as usize, 0).is_opaque(),
                                None => false,
                            }
                        } else {
                            !chunk.get(nbx as usize, nby as usize, nbz as usize).is_opaque()
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

                        for &vi in &[0usize, 1, 2] {
                            Self::push_vertex(&mut verts, v[vi], *normal, color);
                        }
                        for &vi in &[0usize, 2, 3] {
                            Self::push_vertex(&mut verts, v[vi], *normal, color);
                        }
                    }
                }
            }
        }

        verts
    }

    /// Original build_mesh preserved for tests (OOB boundary = always draw, local coords).
    pub fn build_mesh(chunk: &Chunk) -> Vec<f32> {
        let mut verts: Vec<f32> = Vec::new();

        for y in 0..CHUNK_HEIGHT {
            for z in 0..CHUNK_SIZE {
                for x in 0..CHUNK_SIZE {
                    let block = chunk.get(x, y, z);
                    if block == BlockType::Air {
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
                            !chunk.get(nbx as usize, nby as usize, nbz as usize).is_opaque()
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

                        for &vi in &[0usize, 1, 2] {
                            Self::push_vertex(&mut verts, v[vi], *normal, color);
                        }
                        for &vi in &[0usize, 2, 3] {
                            Self::push_vertex(&mut verts, v[vi], *normal, color);
                        }
                    }
                }
            }
        }

        verts
    }

    #[inline(always)]
    fn push_vertex(verts: &mut Vec<f32>, pos: [f32; 3], normal: [f32; 3], color: [f32; 3]) {
        #[cfg(target_feature = "simd128")]
        // SAFETY: reserve ensures capacity; set_len reflects actual written elements.
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
        // [pos.x, pos.y, pos.z, normal.x] → 16 bytes
        let v0: v128 = core::mem::transmute([pos[0], pos[1], pos[2], normal[0]]);
        v128_store(ptr as *mut v128, v0);
        // [normal.y, normal.z, color.x, color.y] → 16 bytes
        let v1: v128 = core::mem::transmute([normal[1], normal[2], color[0], color[1]]);
        v128_store(ptr.add(16) as *mut v128, v1);
        // color.z → 4 bytes
        *(ptr.add(32) as *mut f32) = color[2];
        verts.set_len(len + 9);
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
        // 6 faces × 6 verts × 9 floats
        assert_eq!(mesh.len(), 6 * 6 * FLOATS_PER_VERTEX);
    }

    #[test]
    fn two_adjacent_blocks_share_face_culled() {
        let mut chunk = Chunk::new();
        chunk.set(0, 8, 0, BlockType::Stone);
        chunk.set(1, 8, 0, BlockType::Stone);
        let mesh = Mesher::build_mesh(&chunk);
        // Each block: 6 faces, shared face culled (×2 = -2 faces)
        // = 10 faces × 6 verts × 9 floats
        assert_eq!(mesh.len(), 10 * 6 * FLOATS_PER_VERTEX);
    }

    #[test]
    fn neighbor_culls_boundary_face() {
        let mut chunk = Chunk::new();
        chunk.set(0, 8, 8, BlockType::Stone); // on -X boundary

        // Solid -X neighbor: -X face is culled
        let mut solid_nx = Chunk::new();
        solid_nx.set(CHUNK_SIZE - 1, 8, 8, BlockType::Stone);
        let mesh_solid = Mesher::build_mesh_with_neighbors(
            &chunk, None, Some(&solid_nx), None, None, 0, 0,
        );

        // Air -X neighbor: -X face is drawn
        let air_nx = Chunk::new(); // all air
        let mesh_air = Mesher::build_mesh_with_neighbors(
            &chunk, None, Some(&air_nx), None, None, 0, 0,
        );

        // With solid neighbor, -X face culled → fewer vertices
        assert!(mesh_air.len() > mesh_solid.len());
        // Air neighbor adds exactly 1 face = 6 verts × 9 floats
        assert_eq!(mesh_air.len() - mesh_solid.len(), 6 * FLOATS_PER_VERTEX);
    }
}
