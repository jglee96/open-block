use crate::block::BlockType;

pub const CHUNK_SIZE: usize = 16;
pub const CHUNK_HEIGHT: usize = 64;
pub const FLUID_LEVEL_EMPTY: u8 = 0;
pub const FLUID_LEVEL_MAX: u8 = 8;

/// A 16 × 64 × 16 chunk of blocks (x, y, z).
pub struct Chunk {
    // blocks[y][z][x]
    blocks: Vec<u8>,
    // fluid metadata[y][z][x] : 0 empty, 1..7 flowing, 8 source/full
    fluids: Vec<u8>,
}

impl Chunk {
    pub fn new() -> Self {
        Self {
            blocks: vec![0u8; CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE],
            fluids: vec![0u8; CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE],
        }
    }

    #[inline]
    fn idx(x: usize, y: usize, z: usize) -> usize {
        y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x
    }

    pub fn get(&self, x: usize, y: usize, z: usize) -> BlockType {
        BlockType::from_u8(self.blocks[Self::idx(x, y, z)])
    }

    pub fn set(&mut self, x: usize, y: usize, z: usize, block: BlockType) {
        self.blocks[Self::idx(x, y, z)] = block as u8;
    }

    pub fn get_fluid(&self, x: usize, y: usize, z: usize) -> u8 {
        self.fluids[Self::idx(x, y, z)]
    }

    pub fn set_fluid(&mut self, x: usize, y: usize, z: usize, fluid: u8) {
        self.fluids[Self::idx(x, y, z)] = fluid;
    }

    /// Raw block bytes for transfer to JS (physics collision cache).
    pub fn blocks_raw(&self) -> &[u8] {
        &self.blocks
    }

    pub fn fluids_raw(&self) -> &[u8] {
        &self.fluids
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get() {
        let mut c = Chunk::new();
        c.set(1, 5, 3, BlockType::Grass);
        assert_eq!(c.get(1, 5, 3), BlockType::Grass);
        assert_eq!(c.get(0, 0, 0), BlockType::Air);
    }
}
