use std::collections::HashMap;
use noise::{NoiseFn, Perlin};
use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_SIZE, CHUNK_HEIGHT};
use crate::mesher::Mesher;

pub struct World {
    chunks: HashMap<(i32, i32), Chunk>,
    noise: Perlin,
}

impl World {
    pub fn new(seed: u32) -> Self {
        Self {
            chunks: HashMap::new(),
            noise: Perlin::new(seed),
        }
    }

    /// Returns the surface height at world coordinates (wx, wz) in [4, CHUNK_HEIGHT-4].
    fn surface_height(&self, wx: f64, wz: f64) -> usize {
        let scale1 = 0.03;
        let scale2 = 0.07;
        let scale3 = 0.15;

        let n = self.noise.get([wx * scale1, wz * scale1]) * 0.60
              + self.noise.get([wx * scale2, wz * scale2]) * 0.25
              + self.noise.get([wx * scale3, wz * scale3]) * 0.15;

        let base = (CHUNK_HEIGHT / 2) as f64;
        let range = (CHUNK_HEIGHT as f64 - 16.0) / 2.0;
        (base + n * range).clamp(4.0, (CHUNK_HEIGHT - 4) as f64) as usize
    }

    pub fn generate_chunk(&mut self, chunk_x: i32, chunk_z: i32) -> &Chunk {
        if !self.chunks.contains_key(&(chunk_x, chunk_z)) {
            // Pre-compute heights so we don't hold &self.noise and &mut self.chunks simultaneously
            let mut heights = [[0usize; CHUNK_SIZE]; CHUNK_SIZE];
            for lz in 0..CHUNK_SIZE {
                for lx in 0..CHUNK_SIZE {
                    let wx = (chunk_x * CHUNK_SIZE as i32 + lx as i32) as f64;
                    let wz = (chunk_z * CHUNK_SIZE as i32 + lz as i32) as f64;
                    heights[lz][lx] = self.surface_height(wx, wz);
                }
            }

            let mut chunk = Chunk::new();
            for lz in 0..CHUNK_SIZE {
                for lx in 0..CHUNK_SIZE {
                    let surface = heights[lz][lx];
                    for y in 0..CHUNK_HEIGHT {
                        let block = if y == 0 {
                            BlockType::Bedrock
                        } else if y < surface.saturating_sub(4) {
                            BlockType::Stone
                        } else if y < surface {
                            BlockType::Dirt
                        } else if y == surface {
                            if surface < 12 {
                                BlockType::Sand
                            } else if surface > 50 {
                                BlockType::Snow
                            } else {
                                BlockType::Grass
                            }
                        } else {
                            BlockType::Air
                        };
                        chunk.set(lx, y, lz, block);
                    }
                }
            }

            let mut placed_tree = false;
            for lz in 2..(CHUNK_SIZE - 2) {
                for lx in 2..(CHUNK_SIZE - 2) {
                    let wx = chunk_x * CHUNK_SIZE as i32 + lx as i32;
                    let wz = chunk_z * CHUNK_SIZE as i32 + lz as i32;
                    if Self::should_place_tree(wx, wz) {
                        placed_tree |= Self::place_tree(&mut chunk, &heights, lx, lz, false);
                    }
                }
            }

            if chunk_x == 0 && chunk_z == 0 && !placed_tree {
                Self::place_tree(&mut chunk, &heights, 11, 8, true);
            }

            self.chunks.insert((chunk_x, chunk_z), chunk);
        }
        self.chunks.get(&(chunk_x, chunk_z)).unwrap()
    }

    pub fn get_chunk(&self, chunk_x: i32, chunk_z: i32) -> Option<&Chunk> {
        self.chunks.get(&(chunk_x, chunk_z))
    }

    /// Generate chunk + its 4 neighbors, then build mesh with proper boundary culling.
    /// Vertex positions are in world space.
    pub fn build_chunk_mesh_neighbors(&mut self, cx: i32, cz: i32) -> Vec<f32> {
        // Generate all 5 chunks with mutable borrows first
        for (dx, dz) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)] {
            self.generate_chunk(cx + dx, cz + dz);
        }
        // Multiple immutable borrows are fine after all mutable work is done
        let chunk = self.chunks.get(&(cx, cz)).unwrap();
        let px = self.chunks.get(&(cx + 1, cz));
        let nx = self.chunks.get(&(cx - 1, cz));
        let pz = self.chunks.get(&(cx, cz + 1));
        let nz = self.chunks.get(&(cx, cz - 1));
        let world_x = cx * CHUNK_SIZE as i32;
        let world_z = cz * CHUNK_SIZE as i32;
        Mesher::build_mesh_with_neighbors(chunk, px, nx, pz, nz, world_x, world_z)
    }

    /// Set a block at world coordinates and mark the chunk as modified.
    pub fn set_block_at(&mut self, wx: i32, wy: i32, wz: i32, block: BlockType) {
        let cx = wx.div_euclid(CHUNK_SIZE as i32);
        let cz = wz.div_euclid(CHUNK_SIZE as i32);
        let lx = wx.rem_euclid(CHUNK_SIZE as i32) as usize;
        let lz = wz.rem_euclid(CHUNK_SIZE as i32) as usize;
        self.generate_chunk(cx, cz);
        if let Some(c) = self.chunks.get_mut(&(cx, cz)) {
            if (wy as usize) < CHUNK_HEIGHT {
                c.set(lx, wy as usize, lz, block);
            }
        }
    }

    fn should_place_tree(wx: i32, wz: i32) -> bool {
        let mut hash = wx.wrapping_mul(374761393) ^ wz.wrapping_mul(668265263);
        hash = (hash ^ (hash >> 13)).wrapping_mul(1274126177);
        hash.rem_euclid(23) == 0
    }

    fn place_tree(
        chunk: &mut Chunk,
        heights: &[[usize; CHUNK_SIZE]; CHUNK_SIZE],
        lx: usize,
        lz: usize,
        force_ground: bool,
    ) -> bool {
        let surface = heights[lz][lx];
        if surface + 6 >= CHUNK_HEIGHT {
            return false;
        }

        let top_block = chunk.get(lx, surface, lz);
        if top_block != BlockType::Grass {
            if !force_ground {
                return false;
            }
            chunk.set(lx, surface, lz, BlockType::Grass);
        }

        let trunk_height = 4;
        for y in (surface + 1)..=(surface + trunk_height) {
            chunk.set(lx, y, lz, BlockType::Log);
        }

        let canopy_base = surface + trunk_height - 1;
        for y in canopy_base..=(canopy_base + 2) {
            for dz in -2..=2 {
                for dx in -2..=2 {
                    let nx = lx as i32 + dx;
                    let nz = lz as i32 + dz;
                    if nx < 0 || nz < 0 || nx >= CHUNK_SIZE as i32 || nz >= CHUNK_SIZE as i32 {
                        continue;
                    }
                    let dist = dx.abs() + dz.abs();
                    if dist > 3 {
                        continue;
                    }
                    let ux = nx as usize;
                    let uz = nz as usize;
                    if chunk.get(ux, y, uz) == BlockType::Air {
                        chunk.set(ux, y, uz, BlockType::Leaves);
                    }
                }
            }
        }

        chunk.set(lx, surface + trunk_height + 2, lz, BlockType::Leaves);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_chunk() {
        let mut world = World::new(42);
        let chunk = world.generate_chunk(0, 0);
        // Bedrock at y=0
        assert_eq!(chunk.get(0, 0, 0), BlockType::Bedrock);
        // Top should be Air
        assert_eq!(chunk.get(0, CHUNK_HEIGHT - 1, 0), BlockType::Air);
    }

    #[test]
    fn spawn_chunk_contains_tree_blocks() {
        let mut world = World::new(42);
        let chunk = world.generate_chunk(0, 0);
        let mut found_log = false;
        let mut found_leaves = false;

        for y in 0..CHUNK_HEIGHT {
            for z in 0..CHUNK_SIZE {
                for x in 0..CHUNK_SIZE {
                    let block = chunk.get(x, y, z);
                    found_log |= block == BlockType::Log;
                    found_leaves |= block == BlockType::Leaves;
                }
            }
        }

        assert!(found_log);
        assert!(found_leaves);
    }
}
