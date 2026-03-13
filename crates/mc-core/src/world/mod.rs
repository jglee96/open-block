mod foliage;
mod terrain;

use std::collections::{HashMap, HashSet, VecDeque};

use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_HEIGHT, CHUNK_SIZE, FLUID_LEVEL_EMPTY, FLUID_LEVEL_MAX};
use crate::mesher::Mesher;
use terrain::{TerrainDensitySampler, SPAWN_X, SPAWN_Z};

pub struct World {
    chunks: HashMap<(i32, i32), Chunk>,
    terrain: TerrainDensitySampler,
    fluid_frontier: VecDeque<(i32, i32, i32)>,
    fluid_frontier_set: HashSet<(i32, i32, i32)>,
}

impl World {
    pub fn new(seed: u32) -> Self {
        Self {
            chunks: HashMap::new(),
            terrain: TerrainDensitySampler::new(seed),
            fluid_frontier: VecDeque::new(),
            fluid_frontier_set: HashSet::new(),
        }
    }

    pub fn generate_chunk(&mut self, chunk_x: i32, chunk_z: i32) -> &Chunk {
        if !self.chunks.contains_key(&(chunk_x, chunk_z)) {
            let mut columns = self.terrain.sample_chunk_columns(chunk_x, chunk_z);
            let mut chunk = Chunk::new();
            self.terrain
                .fill_chunk_from_density(&mut chunk, &mut columns, chunk_x, chunk_z);
            foliage::place_trees(&mut chunk, &columns, chunk_x, chunk_z);
            self.chunks.insert((chunk_x, chunk_z), chunk);
            self.enqueue_chunk_sources(chunk_x, chunk_z);
        }

        self.chunks.get(&(chunk_x, chunk_z)).unwrap()
    }

    pub fn get_chunk(&self, chunk_x: i32, chunk_z: i32) -> Option<&Chunk> {
        self.chunks.get(&(chunk_x, chunk_z))
    }

    pub fn surface_height_at(&self, wx: i32, wz: i32) -> usize {
        self.terrain.surface_height_at(wx, wz)
    }

    pub fn spawn_point(&self) -> (i32, usize, i32) {
        (
            SPAWN_X,
            self.surface_height_at(SPAWN_X, SPAWN_Z) + 1,
            SPAWN_Z,
        )
    }

    pub fn build_chunk_mesh_neighbors(&mut self, cx: i32, cz: i32) -> Vec<f32> {
        self.ensure_meshing_neighbors(cx, cz);

        let chunk = self.chunks.get(&(cx, cz)).unwrap();
        let px = self.chunks.get(&(cx + 1, cz));
        let nx = self.chunks.get(&(cx - 1, cz));
        let pz = self.chunks.get(&(cx, cz + 1));
        let nz = self.chunks.get(&(cx, cz - 1));
        let world_x = cx * CHUNK_SIZE as i32;
        let world_z = cz * CHUNK_SIZE as i32;
        Mesher::build_solid_mesh_with_neighbors(chunk, px, nx, pz, nz, world_x, world_z)
    }

    pub fn build_water_mesh_neighbors(&mut self, cx: i32, cz: i32) -> Vec<f32> {
        self.ensure_meshing_neighbors(cx, cz);

        let chunk = self.chunks.get(&(cx, cz)).unwrap();
        let px = self.chunks.get(&(cx + 1, cz));
        let nx = self.chunks.get(&(cx - 1, cz));
        let pz = self.chunks.get(&(cx, cz + 1));
        let nz = self.chunks.get(&(cx, cz - 1));
        let world_x = cx * CHUNK_SIZE as i32;
        let world_z = cz * CHUNK_SIZE as i32;
        Mesher::build_water_mesh_with_neighbors(chunk, px, nx, pz, nz, world_x, world_z)
    }

    pub fn set_block_at(&mut self, wx: i32, wy: i32, wz: i32, block: BlockType) {
        if !Self::in_world_height(wy) {
            return;
        }
        let (cx, cz, lx, ly, lz) = Self::split_world_coords(wx, wy, wz);
        self.generate_chunk(cx, cz);
        if let Some(chunk) = self.chunks.get_mut(&(cx, cz)) {
            chunk.set(lx, ly, lz, block);
            if !block.is_fluid() {
                chunk.set_fluid(lx, ly, lz, FLUID_LEVEL_EMPTY);
            } else {
                chunk.set_fluid(lx, ly, lz, FLUID_LEVEL_MAX);
            }
        }
        self.enqueue_fluid_neighbors(wx, wy, wz);
    }

    pub fn get_fluid_at(&mut self, wx: i32, wy: i32, wz: i32) -> u8 {
        if !Self::in_world_height(wy) {
            return FLUID_LEVEL_EMPTY;
        }
        let (cx, cz, lx, ly, lz) = Self::split_world_coords(wx, wy, wz);
        self.generate_chunk(cx, cz);
        self.chunks
            .get(&(cx, cz))
            .map(|chunk| chunk.get_fluid(lx, ly, lz))
            .unwrap_or(FLUID_LEVEL_EMPTY)
    }

    pub fn step_fluids(&mut self, max_updates: usize) -> Vec<i32> {
        let mut dirty_chunks = HashSet::new();
        let mut processed = 0usize;

        while processed < max_updates {
            let Some((wx, wy, wz)) = self.fluid_frontier.pop_front() else {
                break;
            };
            self.fluid_frontier_set.remove(&(wx, wy, wz));
            if !Self::in_world_height(wy) {
                continue;
            }

            let next_level = self.compute_fluid_level(wx, wy, wz);
            let current_level = self.peek_fluid_at(wx, wy, wz);
            if next_level == current_level {
                processed += 1;
                continue;
            }

            self.set_fluid_at(wx, wy, wz, next_level);
            let (cx, cz, _, _, _) = Self::split_world_coords(wx, wy, wz);
            dirty_chunks.insert((cx, cz));
            self.enqueue_fluid_neighbors(wx, wy, wz);
            processed += 1;
        }

        let mut out = Vec::with_capacity(dirty_chunks.len() * 2);
        for (cx, cz) in dirty_chunks {
            out.push(cx);
            out.push(cz);
        }
        out
    }

    fn ensure_meshing_neighbors(&mut self, cx: i32, cz: i32) {
        for (dx, dz) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)] {
            self.generate_chunk(cx + dx, cz + dz);
        }
    }

    fn compute_fluid_level(&mut self, wx: i32, wy: i32, wz: i32) -> u8 {
        let block = self.peek_block_at(wx, wy, wz);
        if block.is_solid() || block.is_decorative() {
            return FLUID_LEVEL_EMPTY;
        }
        if block.is_fluid() {
            return FLUID_LEVEL_MAX;
        }

        let above_level = self.peek_fluid_at(wx, wy + 1, wz);
        if above_level > FLUID_LEVEL_EMPTY {
            return FLUID_LEVEL_MAX;
        }

        if self.can_fluid_occupy(wx, wy - 1, wz) {
            return FLUID_LEVEL_EMPTY;
        }

        let mut neighbor_max = FLUID_LEVEL_EMPTY;
        for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            neighbor_max = neighbor_max.max(self.peek_fluid_at(wx + dx, wy, wz + dz));
        }

        neighbor_max.saturating_sub(1)
    }

    fn can_fluid_occupy(&mut self, wx: i32, wy: i32, wz: i32) -> bool {
        if wy < 0 {
            return false;
        }
        if wy >= CHUNK_HEIGHT as i32 {
            return true;
        }
        let block = self.peek_block_at(wx, wy, wz);
        !block.is_solid() && !block.is_decorative()
    }

    fn enqueue_chunk_sources(&mut self, cx: i32, cz: i32) {
        let Some(chunk) = self.chunks.get(&(cx, cz)) else {
            return;
        };
        let mut source_positions = Vec::new();
        for y in 0..CHUNK_HEIGHT {
            for z in 0..CHUNK_SIZE {
                for x in 0..CHUNK_SIZE {
                    if chunk.get(x, y, z).is_fluid() {
                        let wx = cx * CHUNK_SIZE as i32 + x as i32;
                        let wz = cz * CHUNK_SIZE as i32 + z as i32;
                        source_positions.push((wx, y as i32, wz));
                    }
                }
            }
        }
        for (wx, wy, wz) in source_positions {
            self.enqueue_fluid_neighbors(wx, wy, wz);
        }
    }

    fn enqueue_fluid_neighbors(&mut self, wx: i32, wy: i32, wz: i32) {
        for (dx, dy, dz) in [
            (0, 0, 0),
            (1, 0, 0),
            (-1, 0, 0),
            (0, 0, 1),
            (0, 0, -1),
            (0, 1, 0),
            (0, -1, 0),
        ] {
            self.enqueue_fluid_cell(wx + dx, wy + dy, wz + dz);
        }
    }

    fn enqueue_fluid_cell(&mut self, wx: i32, wy: i32, wz: i32) {
        if !Self::in_world_height(wy) {
            return;
        }
        if self.fluid_frontier_set.insert((wx, wy, wz)) {
            self.fluid_frontier.push_back((wx, wy, wz));
        }
    }

    fn peek_block_at(&mut self, wx: i32, wy: i32, wz: i32) -> BlockType {
        if !Self::in_world_height(wy) {
            return BlockType::Air;
        }
        let (cx, cz, lx, ly, lz) = Self::split_world_coords(wx, wy, wz);
        self.generate_chunk(cx, cz);
        self.chunks
            .get(&(cx, cz))
            .map(|chunk| chunk.get(lx, ly, lz))
            .unwrap_or(BlockType::Air)
    }

    fn peek_fluid_at(&mut self, wx: i32, wy: i32, wz: i32) -> u8 {
        if !Self::in_world_height(wy) {
            return FLUID_LEVEL_EMPTY;
        }
        let (cx, cz, lx, ly, lz) = Self::split_world_coords(wx, wy, wz);
        self.generate_chunk(cx, cz);
        self.chunks
            .get(&(cx, cz))
            .map(|chunk| chunk.get_fluid(lx, ly, lz))
            .unwrap_or(FLUID_LEVEL_EMPTY)
    }

    fn set_fluid_at(&mut self, wx: i32, wy: i32, wz: i32, level: u8) {
        if !Self::in_world_height(wy) {
            return;
        }
        let (cx, cz, lx, ly, lz) = Self::split_world_coords(wx, wy, wz);
        self.generate_chunk(cx, cz);
        if let Some(chunk) = self.chunks.get_mut(&(cx, cz)) {
            if chunk.get(lx, ly, lz).is_fluid() {
                chunk.set_fluid(lx, ly, lz, FLUID_LEVEL_MAX);
                return;
            }
            chunk.set_fluid(lx, ly, lz, level);
        }
    }

    fn split_world_coords(wx: i32, wy: i32, wz: i32) -> (i32, i32, usize, usize, usize) {
        let cx = wx.div_euclid(CHUNK_SIZE as i32);
        let cz = wz.div_euclid(CHUNK_SIZE as i32);
        let lx = wx.rem_euclid(CHUNK_SIZE as i32) as usize;
        let ly = wy as usize;
        let lz = wz.rem_euclid(CHUNK_SIZE as i32) as usize;
        (cx, cz, lx, ly, lz)
    }

    fn in_world_height(wy: i32) -> bool {
        (0..CHUNK_HEIGHT as i32).contains(&wy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunk::FLUID_LEVEL_MAX;

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

    #[test]
    fn spawn_zone_is_flat_and_has_resources() {
        let mut world = World::new(42);
        let mut min_surface = usize::MAX;
        let mut max_surface = 0usize;
        let mut found_water = false;
        let mut found_short_grass = false;
        let mut tree_columns = 0usize;

        for cz in -1..=1 {
            for cx in -1..=1 {
                world.generate_chunk(cx, cz);
                for z in 0..CHUNK_SIZE {
                    for x in 0..CHUNK_SIZE {
                        let wx = cx * CHUNK_SIZE as i32 + x as i32;
                        let wz = cz * CHUNK_SIZE as i32 + z as i32;
                        let dist_sq = (wx - SPAWN_X).pow(2) + (wz - SPAWN_Z).pow(2);
                        if dist_sq > 24_i32.pow(2) {
                            continue;
                        }
                        let surface = world.surface_height_at(wx, wz);
                        let chunk = world.get_chunk(cx, cz).unwrap();
                        if dist_sq <= 8_i32.pow(2) && surface >= terrain::WATER_LEVEL {
                            min_surface = min_surface.min(surface);
                            max_surface = max_surface.max(surface);
                        }

                        for y in surface..=(surface + 2).min(CHUNK_HEIGHT - 1) {
                            found_water |= chunk.get(x, y, z) == BlockType::Water;
                        }
                        if surface + 1 < CHUNK_HEIGHT {
                            found_short_grass |=
                                chunk.get(x, surface + 1, z) == BlockType::ShortGrass;
                            let above = chunk.get(x, surface + 1, z);
                            tree_columns +=
                                usize::from(above == BlockType::Log || above == BlockType::Leaves);
                        }
                    }
                }
            }
        }

        assert!(max_surface - min_surface <= 5);
        assert!(found_water);
        assert!(found_short_grass);
        assert!(tree_columns >= 2);
    }

    #[test]
    fn generated_chunks_are_deterministic() {
        let mut world_a = World::new(42);
        let mut world_b = World::new(42);

        let chunk_a = world_a.generate_chunk(3, -2);
        let chunk_b = world_b.generate_chunk(3, -2);

        assert_eq!(chunk_a.blocks_raw(), chunk_b.blocks_raw());
        assert_eq!(chunk_a.fluids_raw(), chunk_b.fluids_raw());
    }

    #[test]
    fn sampled_surface_matches_generated_chunk_topology() {
        let mut world = World::new(42);

        for cz in 0..=1 {
            for cx in 0..=1 {
                world.generate_chunk(cx, cz);
            }
        }

        for cz in 0..=1 {
            for cx in 0..=1 {
                let chunk = world.get_chunk(cx, cz).unwrap();
                for z in 0..CHUNK_SIZE {
                    for x in 0..CHUNK_SIZE {
                        let wx = cx * CHUNK_SIZE as i32 + x as i32;
                        let wz = cz * CHUNK_SIZE as i32 + z as i32;
                        let sampled = world.surface_height_at(wx, wz);
                        let actual = (1..CHUNK_HEIGHT)
                            .rev()
                            .find(|&y| {
                                let block = chunk.get(x, y, z);
                                block.is_solid()
                                    && !matches!(block, BlockType::Log | BlockType::Leaves)
                            })
                            .unwrap_or(1);
                        assert_eq!(sampled, actual);
                    }
                }
            }
        }
    }

    #[test]
    fn spawn_zone_blocks_large_cave_entrances() {
        let mut world = World::new(42);

        for cz in -1..=1 {
            for cx in -1..=1 {
                world.generate_chunk(cx, cz);
            }
        }

        for cz in -1..=1 {
            for cx in -1..=1 {
                let chunk = world.get_chunk(cx, cz).unwrap();
                for z in 0..CHUNK_SIZE {
                    for x in 0..CHUNK_SIZE {
                        let wx = cx * CHUNK_SIZE as i32 + x as i32;
                        let wz = cz * CHUNK_SIZE as i32 + z as i32;
                        let dist_sq = (wx - SPAWN_X).pow(2) + (wz - SPAWN_Z).pow(2);
                        if dist_sq > 14_i32.pow(2) {
                            continue;
                        }
                        let surface = world.surface_height_at(wx, wz);
                        let min_y = surface.saturating_sub(4).max(1);
                        for y in min_y..surface {
                            assert_ne!(chunk.get(x, y, z), BlockType::Air);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn downward_priority_fills_cell_below_source() {
        let mut world = World::new(7);
        world.set_block_at(0, 29, 0, BlockType::Air);
        world.set_block_at(0, 30, 0, BlockType::Water);
        world.step_fluids(10_000);

        assert_eq!(world.get_fluid_at(0, 29, 0), FLUID_LEVEL_MAX);
    }

    #[test]
    fn lateral_spread_decreases_level_when_supported() {
        let mut world = World::new(7);
        world.set_block_at(0, 29, 0, BlockType::Air);
        world.set_block_at(1, 29, 0, BlockType::Air);
        world.set_block_at(2, 29, 0, BlockType::Air);
        world.set_block_at(0, 30, 0, BlockType::Water);
        world.set_block_at(0, 28, 0, BlockType::Stone);
        world.set_block_at(1, 28, 0, BlockType::Stone);
        world.set_block_at(2, 28, 0, BlockType::Stone);

        world.step_fluids(128);

        assert_eq!(world.get_fluid_at(1, 29, 0), FLUID_LEVEL_MAX - 1);
        assert_eq!(world.get_fluid_at(2, 29, 0), FLUID_LEVEL_MAX - 2);
    }

    #[test]
    fn source_refill_restores_level_after_manual_change() {
        let mut world = World::new(7);
        world.set_block_at(0, 30, 0, BlockType::Air);
        world.set_block_at(0, 30, 0, BlockType::Water);
        world.set_fluid_at(0, 30, 0, 2);

        world.enqueue_fluid_neighbors(0, 30, 0);
        world.step_fluids(8);

        assert_eq!(world.get_fluid_at(0, 30, 0), FLUID_LEVEL_MAX);
    }

    #[test]
    fn cross_chunk_propagation_marks_neighbor_chunk() {
        let mut world = World::new(7);
        world.set_block_at(15, 29, 0, BlockType::Air);
        world.set_block_at(16, 29, 0, BlockType::Air);
        for x in 15..=16 {
            world.set_block_at(x, 28, 0, BlockType::Stone);
        }
        world.set_block_at(15, 30, 0, BlockType::Water);

        let dirty = world.step_fluids(128);

        assert!(dirty.chunks_exact(2).any(|pair| pair == [1, 0]));
        assert!(world.get_fluid_at(16, 29, 0) > FLUID_LEVEL_EMPTY);
    }

    #[test]
    fn blocked_basin_settles_without_infinite_fill() {
        let mut world = World::new(7);
        for x in 0..=4 {
            world.set_block_at(x, 29, 0, BlockType::Air);
        }
        world.set_block_at(0, 28, 0, BlockType::Stone);
        world.set_block_at(1, 28, 0, BlockType::Stone);
        world.set_block_at(2, 28, 0, BlockType::Stone);
        world.set_block_at(3, 28, 0, BlockType::Stone);
        world.set_block_at(0, 30, 0, BlockType::Water);

        world.step_fluids(256);

        assert_eq!(world.get_fluid_at(3, 29, 0), FLUID_LEVEL_MAX - 3);
        assert_eq!(world.get_fluid_at(4, 29, 0), FLUID_LEVEL_EMPTY);
    }
}
