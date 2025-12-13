//! PRMX Node CLI
//!
//! Command line interface for the PRMX node.

use sc_cli::RunCmd;
use std::path::PathBuf;

/// PRMX CLI structure
#[derive(Debug, clap::Parser)]
pub struct Cli {
    /// Possible subcommand with parameters.
    #[command(subcommand)]
    pub subcommand: Option<Subcommand>,

    #[clap(flatten)]
    pub run: RunCmd,
}

/// Possible subcommands of the main binary.
#[derive(Debug, clap::Subcommand)]
pub enum Subcommand {
    /// Key management CLI utilities
    #[command(subcommand)]
    Key(sc_cli::KeySubcommand),

    /// Build a chain specification.
    BuildSpec(sc_cli::BuildSpecCmd),

    /// Validate blocks.
    CheckBlock(sc_cli::CheckBlockCmd),

    /// Export blocks.
    ExportBlocks(sc_cli::ExportBlocksCmd),

    /// Export the state of a given block into a chain spec.
    ExportState(sc_cli::ExportStateCmd),

    /// Import blocks.
    ImportBlocks(sc_cli::ImportBlocksCmd),

    /// Remove the whole chain.
    PurgeChain(sc_cli::PurgeChainCmd),

    /// Revert the chain to a previous state.
    Revert(sc_cli::RevertCmd),

    /// Db meta columns information.
    ChainInfo(sc_cli::ChainInfoCmd),

    /// Inject an API key into offchain local storage.
    /// This allows offchain workers to access confidential API keys securely.
    InjectApiKey(InjectApiKeyCmd),
}

/// Command to inject API keys into offchain local storage
#[derive(Debug, Clone, clap::Parser)]
pub struct InjectApiKeyCmd {
    /// The storage key name (e.g., "prmx-oracle::accuweather-api-key")
    #[arg(long)]
    pub key: String,

    /// The API key value to store
    #[arg(long)]
    pub value: String,

    /// Specify the database directory path
    #[arg(long, value_name = "PATH")]
    pub base_path: Option<PathBuf>,

    /// Specify the chain specification
    #[arg(long, value_name = "CHAIN_SPEC")]
    pub chain: Option<String>,
}
