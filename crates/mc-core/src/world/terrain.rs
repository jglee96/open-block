use noise::{NoiseFn, Perlin};

use crate::block::BlockType;
use crate::chunk::{Chunk, CHUNK_HEIGHT, CHUNK_SIZE, FLUID_LEVEL_MAX};

pub type ColumnSampleMap = [[ColumnSurfaceSample; CHUNK_SIZE]; CHUNK_SIZE];
pub const WATER_LEVEL: usize = 18;
pub const SPAWN_X: i32 = 8;
pub const SPAWN_Z: i32 = 8;

const SPAWN_INNER_RADIUS: f64 = 20.0;
const SPAWN_OUTER_RADIUS: f64 = 42.0;
const POND_X: f64 = 14.0;
const POND_Z: f64 = 14.0;
const POND_RADIUS: f64 = 5.5;

#[derive(Clone, Copy, Debug, Default)]
pub struct MacroRegionSample {
    pub plains_weight: f64,
    pub hills_weight: f64,
    pub mountains_weight: f64,
    pub valley_weight: f64,
    pub water_distance: f64,
    pub ruggedness: f64,
    pub erosion: f64,
    pub continentalness: f64,
    pub spawn_weight: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ColumnSurfaceSample {
    pub target_surface_height: usize,
    pub surface_height: usize,
    pub surface_block: BlockType,
    pub steepness: f64,
    pub allow_foliage: bool,
    pub macro_region: MacroRegionSample,
}

impl Default for ColumnSurfaceSample {
    fn default() -> Self {
        Self {
            target_surface_height: WATER_LEVEL + 1,
            surface_height: WATER_LEVEL + 1,
            surface_block: BlockType::Grass,
            steepness: 0.0,
            allow_foliage: true,
            macro_region: MacroRegionSample::default(),
        }
    }
}

pub struct TerrainDensitySampler {
    continental_noise: Perlin,
    region_noise: Perlin,
    ridge_noise: Perlin,
    detail_noise: Perlin,
    detail_noise_b: Perlin,
    valley_noise: Perlin,
    erosion_noise: Perlin,
    cliff_noise: Perlin,
    cave_noise: Perlin,
    cave_detail_noise: Perlin,
    warp_x_noise: Perlin,
    warp_z_noise: Perlin,
}

impl TerrainDensitySampler {
    pub fn new(seed: u32) -> Self {
        Self {
            continental_noise: Perlin::new(seed.wrapping_add(11)),
            region_noise: Perlin::new(seed.wrapping_add(23)),
            ridge_noise: Perlin::new(seed.wrapping_add(37)),
            detail_noise: Perlin::new(seed.wrapping_add(53)),
            detail_noise_b: Perlin::new(seed.wrapping_add(71)),
            valley_noise: Perlin::new(seed.wrapping_add(89)),
            erosion_noise: Perlin::new(seed.wrapping_add(101)),
            cliff_noise: Perlin::new(seed.wrapping_add(131)),
            cave_noise: Perlin::new(seed.wrapping_add(149)),
            cave_detail_noise: Perlin::new(seed.wrapping_add(167)),
            warp_x_noise: Perlin::new(seed.wrapping_add(191)),
            warp_z_noise: Perlin::new(seed.wrapping_add(223)),
        }
    }

    pub fn sample_chunk_columns(&self, chunk_x: i32, chunk_z: i32) -> ColumnSampleMap {
        let mut columns = [[ColumnSurfaceSample::default(); CHUNK_SIZE]; CHUNK_SIZE];

        for lz in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let wx = chunk_x * CHUNK_SIZE as i32 + lx as i32;
                let wz = chunk_z * CHUNK_SIZE as i32 + lz as i32;
                columns[lz][lx] = self.sample_column_surface(wx, wz);
            }
        }

        for lz in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let wx = chunk_x * CHUNK_SIZE as i32 + lx as i32;
                let wz = chunk_z * CHUNK_SIZE as i32 + lz as i32;
                columns[lz][lx].steepness = self.target_surface_steepness(wx, wz);
                columns[lz][lx].surface_block = self.classify_surface_block(columns[lz][lx]);
                columns[lz][lx].allow_foliage = self.allow_foliage(columns[lz][lx]);
            }
        }

        columns
    }

    pub fn fill_chunk_from_density(
        &self,
        chunk: &mut Chunk,
        columns: &mut ColumnSampleMap,
        chunk_x: i32,
        chunk_z: i32,
    ) {
        for lz in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let wx = chunk_x * CHUNK_SIZE as i32 + lx as i32;
                let wz = chunk_z * CHUNK_SIZE as i32 + lz as i32;
                chunk.set(lx, 0, lz, BlockType::Bedrock);
                let column = columns[lz][lx];
                for y in 1..CHUNK_HEIGHT {
                    let block = if self.density_at(wx, y as i32, wz, &column) >= 0.0 {
                        BlockType::Stone
                    } else {
                        BlockType::Air
                    };
                    chunk.set(lx, y, lz, block);
                }

                let top_solid = self.top_solid_in_chunk(chunk, lx, lz).unwrap_or(1).max(1);
                columns[lz][lx].surface_height = top_solid;
            }
        }

        for lz in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let wx = chunk_x * CHUNK_SIZE as i32 + lx as i32;
                let wz = chunk_z * CHUNK_SIZE as i32 + lz as i32;
                columns[lz][lx].steepness =
                    self.actual_surface_steepness(columns, chunk_x, chunk_z, lx, lz, wx, wz);
                columns[lz][lx].surface_block = self.classify_surface_block(columns[lz][lx]);
                columns[lz][lx].allow_foliage = self.allow_foliage(columns[lz][lx]);
            }
        }

        for lz in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let top_solid = columns[lz][lx].surface_height;
                self.paint_surface_column(chunk, columns[lz][lx], lx, lz, top_solid);

                if top_solid < WATER_LEVEL {
                    for y in (top_solid + 1)..=WATER_LEVEL {
                        if chunk.get(lx, y, lz) == BlockType::Air {
                            chunk.set(lx, y, lz, BlockType::Water);
                            chunk.set_fluid(lx, y, lz, FLUID_LEVEL_MAX);
                        }
                    }
                }
            }
        }
    }

    pub fn surface_height_at(&self, wx: i32, wz: i32) -> usize {
        let column = self.sample_column_surface(wx, wz);
        self.find_surface_height(wx, wz, &column)
    }

    pub fn sample_macro_region(&self, wx: i32, wz: i32) -> MacroRegionSample {
        self.sample_macro_region_f64(wx as f64, wz as f64)
    }

    fn sample_column_surface(&self, wx: i32, wz: i32) -> ColumnSurfaceSample {
        let macro_region = self.sample_macro_region_f64(wx as f64, wz as f64);
        let target_surface_height = self.target_surface_height(wx as f64, wz as f64, macro_region);
        let mut sample = ColumnSurfaceSample {
            target_surface_height,
            surface_height: target_surface_height,
            surface_block: BlockType::Grass,
            steepness: self.target_surface_steepness(wx, wz),
            allow_foliage: true,
            macro_region,
        };
        sample.surface_block = self.classify_surface_block(sample);
        sample.allow_foliage = self.allow_foliage(sample);
        sample
    }

    fn sample_macro_region_f64(&self, wx: f64, wz: f64) -> MacroRegionSample {
        let dx = wx - SPAWN_X as f64;
        let dz = wz - SPAWN_Z as f64;
        let dist = (dx * dx + dz * dz).sqrt();
        let spawn_weight = radial_weight(dist, SPAWN_INNER_RADIUS, SPAWN_OUTER_RADIUS);

        let continentalness = remap_unit(self.continental_noise.get([wx * 0.004, wz * 0.004]));
        let region = remap_unit(
            self.region_noise
                .get([wx * 0.008 + 50.0, wz * 0.008 - 75.0]),
        );
        let ruggedness = remap_unit(
            self.ridge_noise
                .get([wx * 0.012 - 140.0, wz * 0.012 + 93.0]),
        );
        let erosion = remap_unit(
            self.erosion_noise
                .get([wx * 0.015 + 400.0, wz * 0.015 - 220.0]),
        );
        let valley_raw = self
            .valley_noise
            .get([wx * 0.006 - 320.0, wz * 0.006 + 140.0])
            .abs();

        let mut valley_weight = ((0.34 - valley_raw) / 0.34).clamp(0.0, 1.0).powf(1.8);
        let mut mountains_weight = smoothstep(0.62, 0.84, region)
            * smoothstep(0.52, 0.88, ruggedness)
            * (0.55 + continentalness * 0.45);
        let mut hills_weight =
            smoothstep(0.35, 0.7, region) * (0.5 + (1.0 - erosion) * 0.35 + ruggedness * 0.15);

        valley_weight = lerp(
            valley_weight,
            0.35 + (1.0 - continentalness) * 0.2,
            spawn_weight * 0.8,
        );
        mountains_weight *= (1.0 - spawn_weight).powf(1.8) * (1.0 - valley_weight * 0.75);
        hills_weight *= (1.0 - spawn_weight * 0.65) * (1.0 - mountains_weight * 0.6);

        let plains_weight =
            (1.0 - valley_weight * 0.8 - hills_weight * 0.65 - mountains_weight * 0.95).max(0.12);

        let total = plains_weight + hills_weight + mountains_weight + valley_weight;
        MacroRegionSample {
            plains_weight: plains_weight / total,
            hills_weight: hills_weight / total,
            mountains_weight: mountains_weight / total,
            valley_weight: valley_weight / total,
            water_distance: (valley_raw * 26.0).clamp(0.0, 32.0),
            ruggedness,
            erosion,
            continentalness,
            spawn_weight,
        }
    }

    fn target_surface_height(&self, wx: f64, wz: f64, macro_region: MacroRegionSample) -> usize {
        let baseline = 21.0 + (macro_region.continentalness - 0.5) * 6.0;
        let rolling_low = self.detail_noise.get([wx * 0.022, wz * 0.022]) * 1.8;
        let rolling_mid = self
            .detail_noise_b
            .get([wx * 0.047 + 90.0, wz * 0.047 - 90.0])
            * 1.2;
        let rolling = rolling_low + rolling_mid;

        let plains_shape = signed_pow(rolling, 2.15) * 1.8;
        let hills_shape =
            rolling * 4.2 + self.region_noise.get([wx * 0.03 + 180.0, wz * 0.03 - 55.0]) * 2.2;
        let ridge = 1.0 - self.ridge_noise.get([wx * 0.018, wz * 0.018]).abs();
        let mountain_shape = signed_pow(rolling, 0.85) * 6.5 + ridge.powf(2.1) * 12.5 - 4.0;
        let valley_floor =
            -(5.0 + (1.0 - macro_region.erosion) * 3.0 + macro_region.ruggedness * 2.0)
                * macro_region.valley_weight;

        let mut height = baseline
            + macro_region.plains_weight * plains_shape
            + macro_region.hills_weight * hills_shape
            + macro_region.mountains_weight * mountain_shape
            + valley_floor;

        height = lerp(
            height,
            WATER_LEVEL as f64 - 0.8 + rolling_low * 0.8,
            macro_region.valley_weight * 0.65,
        );
        height = lerp(
            height,
            20.5 + rolling_low * 0.7,
            macro_region.spawn_weight * 0.9,
        );

        let pond_dx = wx - POND_X;
        let pond_dz = wz - POND_Z;
        let pond_dist = (pond_dx * pond_dx + pond_dz * pond_dz).sqrt();
        let pond_weight = radial_weight(pond_dist, 0.0, POND_RADIUS);
        height = lerp(height, WATER_LEVEL as f64 - 1.0, pond_weight);

        height.clamp(6.0, (CHUNK_HEIGHT - 4) as f64) as usize
    }

    fn target_surface_steepness(&self, wx: i32, wz: i32) -> f64 {
        let center = self.sample_macro_region(wx, wz);
        let east = self.sample_macro_region(wx + 1, wz);
        let west = self.sample_macro_region(wx - 1, wz);
        let south = self.sample_macro_region(wx, wz + 1);
        let north = self.sample_macro_region(wx, wz - 1);

        let center_height = self.target_surface_height(wx as f64, wz as f64, center) as f64;
        let dx = (self.target_surface_height((wx + 1) as f64, wz as f64, east) as f64
            - self.target_surface_height((wx - 1) as f64, wz as f64, west) as f64)
            .abs();
        let dz = (self.target_surface_height(wx as f64, (wz + 1) as f64, south) as f64
            - self.target_surface_height(wx as f64, (wz - 1) as f64, north) as f64)
            .abs();

        ((dx.max(dz) + (center_height - WATER_LEVEL as f64).max(0.0) * 0.02) / 8.5).clamp(0.0, 1.0)
    }

    fn density_at(&self, wx: i32, y: i32, wz: i32, column: &ColumnSurfaceSample) -> f64 {
        let surface = column.target_surface_height as f64;
        let yf = y as f64;
        let base_density = surface - yf;

        let warp_strength = 2.5 * column.macro_region.mountains_weight;
        let warped_x =
            wx as f64 + self.warp_x_noise.get([wx as f64 * 0.02, wz as f64 * 0.02]) * warp_strength;
        let warped_z = wz as f64
            + self
                .warp_z_noise
                .get([wx as f64 * 0.02 + 20.0, wz as f64 * 0.02 - 20.0])
                * warp_strength;

        let cliff_band = (1.0 - ((yf - (surface + 1.5)) / 8.5).abs()).clamp(0.0, 1.0);
        let ridge = 1.0
            - self
                .cliff_noise
                .get([warped_x * 0.05, yf * 0.11, warped_z * 0.05])
                .abs();
        let cliff_density = (ridge.powf(2.5) * 14.0 - 4.5)
            * cliff_band
            * (column.macro_region.mountains_weight * (0.5 + column.macro_region.ruggedness * 0.8)
                + column.macro_region.hills_weight * 0.15)
            * (1.0 - column.macro_region.spawn_weight);

        let mut cave_mask = ((surface - yf - 4.0) / 14.0).clamp(0.0, 1.0)
            * (column.macro_region.mountains_weight
                + column.macro_region.hills_weight * 0.35
                + column.macro_region.valley_weight * 0.1)
            * (1.0 - column.macro_region.spawn_weight);
        if y < WATER_LEVEL as i32 {
            cave_mask *= 0.3;
        }

        let cave_value = self
            .cave_noise
            .get([wx as f64 * 0.06, yf * 0.09, wz as f64 * 0.06])
            + self.cave_detail_noise.get([
                wx as f64 * 0.12 + 40.0,
                yf * 0.16 - 20.0,
                wz as f64 * 0.12 + 70.0,
            ]) * 0.4;
        let cave_void = ((0.17 - cave_value.abs()) / 0.17).clamp(0.0, 1.0).powf(1.4);
        let cave_density = cave_void
            * (8.0 * column.macro_region.mountains_weight
                + 3.0 * column.macro_region.hills_weight
                + 0.75 * column.macro_region.valley_weight)
            * cave_mask;

        base_density + cliff_density - cave_density
    }

    fn find_surface_height(&self, wx: i32, wz: i32, column: &ColumnSurfaceSample) -> usize {
        for y in (1..CHUNK_HEIGHT).rev() {
            if self.density_at(wx, y as i32, wz, column) >= 0.0 {
                return y;
            }
        }
        1
    }

    fn actual_surface_steepness(
        &self,
        columns: &ColumnSampleMap,
        chunk_x: i32,
        chunk_z: i32,
        lx: usize,
        lz: usize,
        wx: i32,
        wz: i32,
    ) -> f64 {
        let left = if lx > 0 {
            columns[lz][lx - 1].surface_height
        } else {
            self.surface_height_at(wx - 1, wz)
        };
        let right = if lx + 1 < CHUNK_SIZE {
            columns[lz][lx + 1].surface_height
        } else {
            self.surface_height_at(chunk_x * CHUNK_SIZE as i32 + lx as i32 + 1, wz)
        };
        let down = if lz > 0 {
            columns[lz - 1][lx].surface_height
        } else {
            self.surface_height_at(wx, wz - 1)
        };
        let up = if lz + 1 < CHUNK_SIZE {
            columns[lz + 1][lx].surface_height
        } else {
            self.surface_height_at(wx, chunk_z * CHUNK_SIZE as i32 + lz as i32 + 1)
        };

        let dx = (right as i32 - left as i32).abs() as f64;
        let dz = (up as i32 - down as i32).abs() as f64;
        (dx.max(dz) / 9.0).clamp(0.0, 1.0)
    }

    fn classify_surface_block(&self, column: ColumnSurfaceSample) -> BlockType {
        if column.surface_height <= WATER_LEVEL + 1
            || (column.macro_region.water_distance < 3.0
                && column.surface_height <= WATER_LEVEL + 4)
            || (column.macro_region.valley_weight > 0.55
                && column.surface_height <= WATER_LEVEL + 3)
        {
            BlockType::Sand
        } else if column.surface_height >= 46
            && column.macro_region.mountains_weight > 0.6
            && column.steepness < 0.7
        {
            BlockType::Snow
        } else if (column.steepness > 0.62 && column.macro_region.mountains_weight > 0.28)
            || (column.steepness > 0.75 && column.macro_region.ruggedness > 0.55)
        {
            BlockType::Stone
        } else {
            BlockType::Grass
        }
    }

    fn allow_foliage(&self, column: ColumnSurfaceSample) -> bool {
        column.surface_block == BlockType::Grass
            && column.steepness < 0.42
            && column.surface_height > WATER_LEVEL + 1
            && column.macro_region.water_distance > 2.0
            && column.macro_region.mountains_weight < 0.55
            && column.macro_region.valley_weight < 0.78
    }

    fn paint_surface_column(
        &self,
        chunk: &mut Chunk,
        column: ColumnSurfaceSample,
        lx: usize,
        lz: usize,
        top_solid: usize,
    ) {
        chunk.set(lx, top_solid, lz, column.surface_block);
        for depth in 1..=4 {
            let y = top_solid.saturating_sub(depth);
            if y == 0 {
                break;
            }
            if chunk.get(lx, y, lz) == BlockType::Air {
                break;
            }

            let filler = match column.surface_block {
                BlockType::Grass => BlockType::Dirt,
                BlockType::Sand => BlockType::Sand,
                BlockType::Snow | BlockType::Stone => BlockType::Stone,
                _ => BlockType::Stone,
            };
            chunk.set(lx, y, lz, filler);
        }
    }

    fn top_solid_in_chunk(&self, chunk: &Chunk, lx: usize, lz: usize) -> Option<usize> {
        (1..CHUNK_HEIGHT)
            .rev()
            .find(|&y| chunk.get(lx, y, lz).is_solid())
    }
}

fn remap_unit(value: f64) -> f64 {
    value * 0.5 + 0.5
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t.clamp(0.0, 1.0)
}

fn smoothstep(edge0: f64, edge1: f64, value: f64) -> f64 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn signed_pow(value: f64, exp: f64) -> f64 {
    value.signum() * value.abs().powf(exp)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macro_regions_cover_world_and_plains_dominate() {
        let sampler = TerrainDensitySampler::new(42);
        let mut plains = 0usize;
        let mut hills = 0usize;
        let mut mountains = 0usize;
        let mut valleys = 0usize;

        for wz in (-160..=160).step_by(8) {
            for wx in (-160..=160).step_by(8) {
                let region = sampler.sample_macro_region(wx, wz);
                let weights = [
                    ("plains", region.plains_weight),
                    ("hills", region.hills_weight),
                    ("mountains", region.mountains_weight),
                    ("valleys", region.valley_weight),
                ];
                let winner = weights
                    .into_iter()
                    .max_by(|a, b| a.1.total_cmp(&b.1))
                    .map(|entry| entry.0)
                    .unwrap();
                match winner {
                    "plains" => plains += 1,
                    "hills" => hills += 1,
                    "mountains" => mountains += 1,
                    _ => valleys += 1,
                }
            }
        }

        assert!(plains > hills);
        assert!(plains > mountains);
        assert!(hills > 0);
        assert!(mountains > 0);
        assert!(valleys > 0);
    }

    #[test]
    fn spawn_override_stays_lowland_and_non_mountainous() {
        let sampler = TerrainDensitySampler::new(42);
        for wz in -12..=28 {
            for wx in -12..=28 {
                let dist_sq = (wx - SPAWN_X).pow(2) + (wz - SPAWN_Z).pow(2);
                if dist_sq > 18_i32.pow(2) {
                    continue;
                }
                let region = sampler.sample_macro_region(wx, wz);
                assert!(region.mountains_weight < 0.2);
                assert!(region.spawn_weight > 0.15);
            }
        }
    }

    #[test]
    fn mountain_regions_can_form_3d_features() {
        let sampler = TerrainDensitySampler::new(42);
        let mut found_overhang = false;
        let mut found_cave = false;

        for wz in (-128..=128).step_by(4) {
            for wx in (-128..=128).step_by(4) {
                let column = sampler.sample_column_surface(wx, wz);
                if column.macro_region.mountains_weight < 0.55 {
                    continue;
                }

                let actual = sampler.surface_height_at(wx, wz);
                if actual >= column.target_surface_height + 2 {
                    found_overhang = true;
                }

                for y in 8..actual.saturating_sub(3) {
                    let current = sampler.density_at(wx, y as i32, wz, &column);
                    let below = sampler.density_at(wx, y as i32 - 1, wz, &column);
                    let above = sampler.density_at(wx, y as i32 + 1, wz, &column);
                    if current < 0.0 && below >= 0.0 && above >= 0.0 {
                        found_cave = true;
                        break;
                    }
                }

                if found_overhang && found_cave {
                    break;
                }
            }
            if found_overhang && found_cave {
                break;
            }
        }

        assert!(found_overhang || found_cave);
    }
}
