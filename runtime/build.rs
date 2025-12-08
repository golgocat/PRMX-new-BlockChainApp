// This file is part of PRMX Runtime.

fn main() {
    #[cfg(feature = "std")]
    {
        substrate_wasm_builder::WasmBuilder::build_using_defaults();
    }
}
