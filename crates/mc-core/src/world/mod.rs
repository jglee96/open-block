mod foliage;
mod terrain;

use std::collections::HashMap;

use noise::Perlin;

use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_HEIGHT, CHUNK_SIZE};
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

    pub fn generate_chunk(&mut self, chunk_x: i32, chunk_z: i32) -> &Chunk {
        if !self.chunks.contains_key(&(chunk_x, chunk_z)) {
            let heights = terrain::build_height_map(&self.noise, chunk_x, chunk_z);
            let mut chunk = Chunk::new();
            terrain::fill_chunk_terrain(&mut chunk, &heights);
            foliage::place_trees(&mut chunk, &heights, chunk_x, chunk_z);
            self.chunks.insert((chunk_x, chunk_z), chunk);
        }

        self.chunks.get(&(chunk_x, chunk_z)).unwrap()
    }

    pub fn get_chunk(&self, chunk_x: i32, chunk_z: i32) -> Option<&Chunk> {
        self.chunks.get(&(chunk_x, chunk_z))
    }

    pub fn build_chunk_mesh_neighbors(&mut self, cx: i32, cz: i32) -> Vec<f32> {
        for (dx, dz) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)] {
            self.generate_chunk(cx + dx, cz + dz);
        }

        let chunk = self.chunks.get(&(cx, cz)).unwrap();
        let px = self.chunks.get(&(cx + 1, cz));
        let nx = self.chunks.get(&(cx - 1, cz));
        let pz = self.chunks.get(&(cx, cz + 1));
        let nz = self.chunks.get(&(cx, cz - 1));
        let world_x = cx * CHUNK_SIZE as i32;
        let world_z = cz * CHUNK_SIZE as i32;
        Mesher::build_mesh_with_neighbors(chunk, px, nx, pz, nz, world_x, world_z)
    }

    pub fn set_block_at(&mut self, wx: i32, wy: i32, wz: i32, block: BlockType) {
        let cx = wx.div_euclid(CHUNK_SIZE as i32);
        let cz = wz.div_euclid(CHUNK_SIZE as i32);
        let lx = wx.rem_euclid(CHUNK_SIZE as i32) as usize;
        let lz = wz.rem_euclid(CHUNK_SIZE as i32) as usize;
        self.generate_chunk(cx, cz);
        if let Some(chunk) = self.chunks.get_mut(&(cx, cz)) {
            if (wy as usize) < CHUNK_HEIGHT {
                chunk.set(lx, wy as usize, lz, block);
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
        assert_eq!(chunk.get(0, 0, 0), BlockType::Bedrock);
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

    #[test]
    fn nearby_chunks_can_contain_water() {
        let mut world = World::new(42);
        let mut found_water = false;

        for cz in -2..=2 {
            for cx in -2..=2 {
                let chunk = world.generate_chunk(cx, cz);
                for y in 0..CHUNK_HEIGHT {
                    for z in 0..CHUNK_SIZE {
                        for x in 0..CHUNK_SIZE {
                            found_water |= chunk.get(x, y, z) == BlockType::Water;
                        }
                    }
                }
            }
        }

        assert!(found_water);
    }
}
