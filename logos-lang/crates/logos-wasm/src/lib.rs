//! Logos WASM - WebAssembly bindings for the language service

mod api;

use wasm_bindgen::prelude::*;

pub use api::*;

#[wasm_bindgen(start)]
pub fn init() {
    // Set up panic hook for better error messages in console
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}
