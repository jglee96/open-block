use noise::{NoiseFn, Perlin};

use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_HEIGHT, CHUNK_SIZE, FLUID_LEVEL_MAX};

pub type HeightMap = [[usize; CHUNK_SIZE]; CHUNK_SIZE];
pub const WATER_LEVEL: usize = 18;
pub const SPAWN_X: i32 = 8;
pub const SPAWN_Z: i32 = 8;
const START_ZONE_INNER_RADIUS: f64 = 24.0;
const START_ZONE_OUTER_RADIUS: f64 = 48.0;
const START_ZONE_HEIGHT: f64 = 22.0;
const POND_X: f64 = 14.0;
const POND_Z: f64 = 14.0;
const POND_RADIUS: f64 = 5.5;

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

pub fn surface_height_at(noise: &Perlin, wx: i32, wz: i32) -> usize {
    surface_height(noise, wx as f64, wz as f64)
}

pub fn fill_chunk_terrain(chunk: &mut Chunk, heights: &HeightMap) {
    for lz in 0..CHUNK_SIZE {
        for lx in 0..CHUNK_SIZE {
            let surface = heights[lz][lx];
            for y in 0..CHUNK_HEIGHT {
                chunk.set(lx, y, lz, classify_block(surface, y));
            }
            if surface < WATER_LEVEL {
                for y in (surface + 1)..=WATER_LEVEL {
                    chunk.set(lx, y, lz, BlockType::Water);
                    chunk.set_fluid(lx, y, lz, FLUID_LEVEL_MAX);
                }
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
    let noisy_height = base + n * range;

    let dx = wx - SPAWN_X as f64;
    let dz = wz - SPAWN_Z as f64;
    let dist = (dx * dx + dz * dz).sqrt();
    let flatten_weight = radial_weight(dist, START_ZONE_INNER_RADIUS, START_ZONE_OUTER_RADIUS);
    let flat_noise = noise.get([wx * 0.08 + 100.0, wz * 0.08 - 100.0]) * 1.4;
    let flat_height = START_ZONE_HEIGHT + flat_noise;
    let mut blended_height = noisy_height * (1.0 - flatten_weight) + flat_height * flatten_weight;

    let pond_dx = wx - POND_X;
    let pond_dz = wz - POND_Z;
    let pond_dist = (pond_dx * pond_dx + pond_dz * pond_dz).sqrt();
    let pond_weight = radial_weight(pond_dist, 0.0, POND_RADIUS);
    blended_height = blended_height * (1.0 - pond_weight) + (WATER_LEVEL as f64 - 1.0) * pond_weight;

    blended_height.clamp(4.0, (CHUNK_HEIGHT - 4) as f64) as usize
}

fn radial_weight(distance: f64, inner: f64, outer: f64) -> f64 {
    if distance <= inner {
        return 1.0;
    }
    if distance >= outer {
        return 0.0;
    }
    let t = (distance - inner) / (outer - inner);
    1.0 - (t * t * (3.0 - 2.0 * t))
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
        } else if surface < WATER_LEVEL {
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
