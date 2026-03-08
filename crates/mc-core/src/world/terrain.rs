use noise::{NoiseFn, Perlin};

use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_HEIGHT, CHUNK_SIZE};

pub type HeightMap = [[usize; CHUNK_SIZE]; CHUNK_SIZE];

pub fn build_height_map(noise: &Perlin, chunk_x: i32, chunk_z: i32) -> HeightMap {
    let mut heights = [[0usize; CHUNK_SIZE]; CHUNK_SIZE];
    for lz in 0..CHUNK_SIZE {
        for lx in 0..CHUNK_SIZE {
            let wx = (chunk_x * CHUNK_SIZE as i32 + lx as i32) as f64;
            let wz = (chunk_z * CHUNK_SIZE as i32 + lz as i32) as f64;
            heights[lz][lx] = surface_height(noise, wx, wz);
        }
    }
    heights
}

pub fn fill_chunk_terrain(chunk: &mut Chunk, heights: &HeightMap) {
    for lz in 0..CHUNK_SIZE {
        for lx in 0..CHUNK_SIZE {
            let surface = heights[lz][lx];
            for y in 0..CHUNK_HEIGHT {
                chunk.set(lx, y, lz, classify_block(surface, y));
            }
        }
    }
}

fn surface_height(noise: &Perlin, wx: f64, wz: f64) -> usize {
    let scale1 = 0.03;
    let scale2 = 0.07;
    let scale3 = 0.15;

    let n = noise.get([wx * scale1, wz * scale1]) * 0.60
        + noise.get([wx * scale2, wz * scale2]) * 0.25
        + noise.get([wx * scale3, wz * scale3]) * 0.15;

    let base = (CHUNK_HEIGHT / 2) as f64;
    let range = (CHUNK_HEIGHT as f64 - 16.0) / 2.0;
    (base + n * range).clamp(4.0, (CHUNK_HEIGHT - 4) as f64) as usize
}

fn classify_block(surface: usize, y: usize) -> BlockType {
    if y == 0 {
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
    }
}
