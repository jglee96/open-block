use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockType {
    Air = 0,
    Stone = 1,
    Dirt = 2,
    Grass = 3,
    Sand = 4,
    Water = 5,
    Snow = 6,
    Bedrock = 7,
    Log = 8,
    Leaves = 9,
}

impl BlockType {
    pub fn color(self) -> [f32; 3] {
        match self {
            BlockType::Air     => [0.0, 0.0, 0.0],
            BlockType::Stone   => [0.5, 0.5, 0.5],
            BlockType::Dirt    => [0.55, 0.37, 0.21],
            BlockType::Grass   => [0.30, 0.65, 0.20],
            BlockType::Sand    => [0.93, 0.87, 0.60],
            BlockType::Water   => [0.20, 0.45, 0.85],
            BlockType::Snow    => [0.95, 0.97, 1.00],
            BlockType::Bedrock => [0.15, 0.15, 0.15],
            BlockType::Log     => [0.43, 0.29, 0.16],
            BlockType::Leaves  => [0.18, 0.55, 0.18],
        }
    }

    pub fn is_opaque(self) -> bool {
        !matches!(self, BlockType::Air | BlockType::Water)
    }

    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => BlockType::Stone,
            2 => BlockType::Dirt,
            3 => BlockType::Grass,
            4 => BlockType::Sand,
            5 => BlockType::Water,
            6 => BlockType::Snow,
            7 => BlockType::Bedrock,
            8 => BlockType::Log,
            9 => BlockType::Leaves,
            _ => BlockType::Air,
        }
    }
}
