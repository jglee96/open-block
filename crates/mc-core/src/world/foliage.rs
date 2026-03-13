use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_HEIGHT, CHUNK_SIZE};

use super::terrain::{ColumnSampleMap, ColumnSurfaceSample, SPAWN_X, SPAWN_Z, WATER_LEVEL};

pub fn place_trees(chunk: &mut Chunk, columns: &ColumnSampleMap, chunk_x: i32, chunk_z: i32) {
    let mut placed_tree = false;

    for lz in 2..(CHUNK_SIZE - 2) {
        for lx in 2..(CHUNK_SIZE - 2) {
            let wx = chunk_x * CHUNK_SIZE as i32 + lx as i32;
            let wz = chunk_z * CHUNK_SIZE as i32 + lz as i32;
            let column = columns[lz][lx];
            if should_place_tree(wx, wz, column) {
                placed_tree |= place_tree(chunk, columns, lx, lz, false);
            }
        }
    }

    if chunk_x == 0 && chunk_z == 0 {
        placed_tree |= place_tree(chunk, columns, 8, 3, true);
        placed_tree |= place_tree(chunk, columns, 12, 9, true);
        if !placed_tree {
            place_tree(chunk, columns, 11, 8, true);
        }
    }

    place_short_grass(chunk, columns, chunk_x, chunk_z);
}

fn should_place_tree(wx: i32, wz: i32, column: ColumnSurfaceSample) -> bool {
    if !column.allow_foliage
        || column.surface_height <= WATER_LEVEL + 1
        || column.steepness > 0.34
        || column.macro_region.valley_weight > 0.7
    {
        return false;
    }

    let mut hash = wx.wrapping_mul(374761393) ^ wz.wrapping_mul(668265263);
    hash = (hash ^ (hash >> 13)).wrapping_mul(1274126177);
    hash.rem_euclid(23) == 0
}

fn should_place_short_grass(wx: i32, wz: i32, column: ColumnSurfaceSample) -> bool {
    if !column.allow_foliage || column.surface_height <= WATER_LEVEL + 1 {
        return false;
    }

    let mut hash = wx.wrapping_mul(1103515245) ^ wz.wrapping_mul(12345);
    hash ^= hash >> 11;

    let near_spawn = (wx - SPAWN_X).pow(2) + (wz - SPAWN_Z).pow(2) <= 10_i32.pow(2);
    let dense_grass = column.steepness < 0.2 && column.macro_region.plains_weight > 0.35;
    if near_spawn {
        hash.rem_euclid(if dense_grass { 3 } else { 4 }) != 0
    } else {
        hash.rem_euclid(if dense_grass { 5 } else { 7 }) == 0
    }
}

fn place_tree(
    chunk: &mut Chunk,
    columns: &ColumnSampleMap,
    lx: usize,
    lz: usize,
    force_ground: bool,
) -> bool {
    let column = columns[lz][lx];
    let surface = column.surface_height;
    if surface + 6 >= CHUNK_HEIGHT {
        return false;
    }

    let top_block = chunk.get(lx, surface, lz);
    if top_block != BlockType::Grass {
        if !force_ground {
            return false;
        }
        chunk.set(lx, surface, lz, BlockType::Grass);
        for depth in 1..=3 {
            let y = surface.saturating_sub(depth);
            if y == 0 {
                break;
            }
            if chunk.get(lx, y, lz).is_solid() {
                chunk.set(lx, y, lz, BlockType::Dirt);
            }
        }
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
                if dx.abs() + dz.abs() > 3 {
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

fn place_short_grass(chunk: &mut Chunk, columns: &ColumnSampleMap, chunk_x: i32, chunk_z: i32) {
    for lz in 1..(CHUNK_SIZE - 1) {
        for lx in 1..(CHUNK_SIZE - 1) {
            let wx = chunk_x * CHUNK_SIZE as i32 + lx as i32;
            let wz = chunk_z * CHUNK_SIZE as i32 + lz as i32;
            let column = columns[lz][lx];
            if !should_place_short_grass(wx, wz, column) {
                continue;
            }
            let surface = column.surface_height;
            if surface + 1 >= CHUNK_HEIGHT {
                continue;
            }
            if chunk.get(lx, surface, lz) != BlockType::Grass {
                continue;
            }
            if chunk.get(lx, surface + 1, lz) != BlockType::Air {
                continue;
            }
            chunk.set(lx, surface + 1, lz, BlockType::ShortGrass);
        }
    }
}
