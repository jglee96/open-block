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
}
