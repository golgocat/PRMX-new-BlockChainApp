//! PRMX Node
//!
//! A Substrate-based node for the PRMX parametric rainfall insurance chain.

#![warn(missing_docs)]

mod chain_spec;
mod cli;
mod command;
mod rpc;
mod service;

fn main() -> sc_cli::Result<()> {
    command::run()
}
