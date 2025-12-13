//! PRMX Node
//!
//! A Substrate-based node for the PRMX parametric rainfall insurance chain.
//!
//! ## Configuration
//!
//! API keys are loaded from environment variables. Create a `.env` file
//! in the project root with your configuration:
//!
//! ```text
//! ACCUWEATHER_API_KEY=your_key_here
//! R_PRICING_API_KEY=your_key_here
//! ```
//!
//! See `.env.example` for a template.

#![warn(missing_docs)]

mod chain_spec;
mod cli;
mod command;
mod rpc;
mod service;

fn main() -> sc_cli::Result<()> {
    // Load environment variables from .env file (if it exists)
    // This allows API keys to be configured securely without hardcoding
    match dotenvy::dotenv() {
        Ok(path) => {
            eprintln!("📁 Loaded environment from: {}", path.display());
        }
        Err(_) => {
            // .env file not found is okay - keys can be set directly in environment
            eprintln!("ℹ️  No .env file found. Using system environment variables.");
        }
    }
    
    command::run()
}
