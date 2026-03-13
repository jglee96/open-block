use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GravityMode {
    Static,
    Falling,
}

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
    Farmland = 10,
    WheatCrop0 = 11,
    WheatCrop1 = 12,
    WheatCrop2 = 13,
    WheatCrop3 = 14,
    ShortGrass = 15,
}

impl BlockType {
    pub fn color(self) -> [f32; 3] {
        match self {
            BlockType::Air => [0.0, 0.0, 0.0],
            BlockType::Stone => [0.5, 0.5, 0.5],
            BlockType::Dirt => [0.55, 0.37, 0.21],
            BlockType::Grass => [0.30, 0.65, 0.20],
            BlockType::Sand => [0.93, 0.87, 0.60],
            BlockType::Water => [0.20, 0.45, 0.85],
            BlockType::Snow => [0.95, 0.97, 1.00],
            BlockType::Bedrock => [0.15, 0.15, 0.15],
            BlockType::Log => [0.43, 0.29, 0.16],
            BlockType::Leaves => [0.18, 0.55, 0.18],
            BlockType::Farmland => [0.42, 0.28, 0.12],
            BlockType::WheatCrop0 => [0.35, 0.55, 0.15],
            BlockType::WheatCrop1 => [0.45, 0.65, 0.18],
            BlockType::WheatCrop2 => [0.62, 0.72, 0.20],
            BlockType::WheatCrop3 => [0.82, 0.70, 0.28],
            BlockType::ShortGrass => [0.42, 0.76, 0.24],
        }
    }

    pub fn is_opaque(self) -> bool {
        self.is_solid()
    }

    pub fn is_solid(self) -> bool {
        !matches!(self, BlockType::Air | BlockType::Water) && !self.is_decorative()
    }

    pub fn is_fluid(self) -> bool {
        matches!(self, BlockType::Water)
    }

    pub fn is_decorative(self) -> bool {
        matches!(
            self,
            BlockType::WheatCrop0
                | BlockType::WheatCrop1
                | BlockType::WheatCrop2
                | BlockType::WheatCrop3
                | BlockType::ShortGrass
        )
    }

    pub fn gravity_mode(self) -> GravityMode {
        match self {
            BlockType::Air
            | BlockType::Stone
            | BlockType::Dirt
            | BlockType::Grass
            | BlockType::Sand
            | BlockType::Water
            | BlockType::Snow
            | BlockType::Bedrock
            | BlockType::Log
            | BlockType::Leaves
            | BlockType::Farmland
            | BlockType::WheatCrop0
            | BlockType::WheatCrop1
            | BlockType::WheatCrop2
            | BlockType::WheatCrop3
            | BlockType::ShortGrass => GravityMode::Static,
        }
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
            10 => BlockType::Farmland,
            11 => BlockType::WheatCrop0,
            12 => BlockType::WheatCrop1,
            13 => BlockType::WheatCrop2,
            14 => BlockType::WheatCrop3,
            15 => BlockType::ShortGrass,
            _ => BlockType::Air,
        }
    }
}
