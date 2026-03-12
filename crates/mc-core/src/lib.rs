mod block;
mod chunk;
mod mesher;
mod utils;
mod world;

use wasm_bindgen::prelude::*;
use js_sys::{Float32Array, Int32Array};

pub use block::BlockType;
pub use chunk::{Chunk, CHUNK_SIZE, CHUNK_HEIGHT};
pub use mesher::Mesher;
pub use world::World;

/// Initialize panic hook for better error messages in browser console.
#[wasm_bindgen(start)]
pub fn init() {
    utils::set_panic_hook();
}

/// WASM-exported handle to a World instance.
#[wasm_bindgen]
pub struct WasmWorld {
    inner: World,
}

#[wasm_bindgen]
impl WasmWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> WasmWorld {
        WasmWorld {
            inner: World::new(seed),
        }
    }

    /// Generate a chunk (with neighbors for boundary culling) and return its mesh.
    /// Layout per vertex: [px, py, pz, nx, ny, nz, r, g, b] (9 floats, 36 bytes)
    /// Positions are in world space.
    pub fn build_chunk_mesh(&mut self, chunk_x: i32, chunk_z: i32) -> Float32Array {
        let data = self.inner.build_chunk_mesh_neighbors(chunk_x, chunk_z);
        Float32Array::from(data.as_slice())
    }

    pub fn build_water_mesh(&mut self, chunk_x: i32, chunk_z: i32) -> Float32Array {
        let data = self.inner.build_water_mesh_neighbors(chunk_x, chunk_z);
        Float32Array::from(data.as_slice())
    }

    /// Set a block at world coordinates. Affected chunk must be re-meshed by caller.
    pub fn set_block(&mut self, wx: i32, wy: i32, wz: i32, block_type: u8) {
        let block = BlockType::from_u8(block_type);
        self.inner.set_block_at(wx, wy, wz, block);
    }

    /// Return raw block data for a chunk (16×64×16 = 16 384 bytes) for physics.
    /// Returns None if the chunk has not been generated yet.
    pub fn get_chunk_blocks(&self, cx: i32, cz: i32) -> Option<js_sys::Uint8Array> {
        self.inner
            .get_chunk(cx, cz)
            .map(|c| js_sys::Uint8Array::from(c.blocks_raw()))
    }

    pub fn get_chunk_fluids(&self, cx: i32, cz: i32) -> Option<js_sys::Uint8Array> {
        self.inner
            .get_chunk(cx, cz)
            .map(|c| js_sys::Uint8Array::from(c.fluids_raw()))
    }

    pub fn step_fluids(&mut self, max_updates: u32) -> Int32Array {
        let data = self.inner.step_fluids(max_updates as usize);
        Int32Array::from(data.as_slice())
    }

    pub fn surface_height_at(&self, wx: i32, wz: i32) -> u32 {
        self.inner.surface_height_at(wx, wz) as u32
    }

    pub fn chunk_size() -> u32 {
        CHUNK_SIZE as u32
    }

    pub fn chunk_height() -> u32 {
        CHUNK_HEIGHT as u32
    }
}
