//! PRMX Node Command Implementation
//!
//! Implements the CLI commands for the node.

use crate::{
    chain_spec,
    cli::{Cli, Subcommand, InjectApiKeyCmd},
    service,
};
use prmx_runtime::Block;
use sc_cli::SubstrateCli;
use sc_service::PartialComponents;
use clap::Parser;

impl SubstrateCli for Cli {
    fn impl_name() -> String {
        "PRMX Node".into()
    }

    fn impl_version() -> String {
        env!("SUBSTRATE_CLI_IMPL_VERSION").into()
    }

    fn description() -> String {
        env!("CARGO_PKG_DESCRIPTION").into()
    }

    fn author() -> String {
        env!("CARGO_PKG_AUTHORS").into()
    }

    fn support_url() -> String {
        "https://github.com/prmx/prmx-chain/issues".into()
    }

    fn copyright_start_year() -> i32 {
        2024
    }

    fn load_spec(&self, id: &str) -> Result<Box<dyn sc_service::ChainSpec>, String> {
        Ok(match id {
            "dev" => Box::new(chain_spec::development_config()?),
            "" | "local" => Box::new(chain_spec::local_testnet_config()?),
            path => Box::new(chain_spec::ChainSpec::from_json_file(
                std::path::PathBuf::from(path),
            )?),
        })
    }
}

/// Parse and run command line arguments.
pub fn run() -> sc_cli::Result<()> {
    let cli = Cli::parse();

    match &cli.subcommand {
        Some(Subcommand::Key(cmd)) => cmd.run(&cli),

        Some(Subcommand::BuildSpec(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.sync_run(|config| cmd.run(config.chain_spec, config.network))
        }

        Some(Subcommand::CheckBlock(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, import_queue, .. } =
                    service::new_partial(&config)?;
                Ok((cmd.run(client, import_queue), task_manager))
            })
        }

        Some(Subcommand::ExportBlocks(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, .. } = service::new_partial(&config)?;
                Ok((cmd.run(client, config.database), task_manager))
            })
        }

        Some(Subcommand::ExportState(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, .. } = service::new_partial(&config)?;
                Ok((cmd.run(client, config.chain_spec), task_manager))
            })
        }

        Some(Subcommand::ImportBlocks(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, import_queue, .. } =
                    service::new_partial(&config)?;
                Ok((cmd.run(client, import_queue), task_manager))
            })
        }

        Some(Subcommand::PurgeChain(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.sync_run(|config| cmd.run(config.database))
        }

        Some(Subcommand::Revert(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, backend, .. } =
                    service::new_partial(&config)?;
                let aux_revert = Box::new(|client, _, blocks| {
                    sc_consensus_grandpa::revert(client, blocks)?;
                    Ok(())
                });
                Ok((cmd.run(client, backend, Some(aux_revert)), task_manager))
            })
        }

        Some(Subcommand::ChainInfo(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.sync_run(|config| cmd.run::<Block>(&config))
        }

        Some(Subcommand::InjectApiKey(cmd)) => {
            inject_api_key(cmd)
        }

        None => {
            let runner = cli.create_runner(&cli.run)?;
            runner.run_node_until_exit(|config| async move {
                service::new_full(config).map_err(sc_cli::Error::Service)
            })
        }
    }
}

/// Inject an API key into offchain local storage.
/// This allows offchain workers to access the key securely.
fn inject_api_key(cmd: &InjectApiKeyCmd) -> sc_cli::Result<()> {
    // Determine the base path
    let base_path = cmd.base_path.clone().unwrap_or_else(|| {
        sc_service::BasePath::from_project("", "", "prmx").path().to_path_buf()
    });
    
    // Determine chain ID
    let chain_id = cmd.chain.clone().unwrap_or_else(|| "prmx_dev".to_string());
    
    // Construct the offchain database path
    let offchain_db_path = base_path.join("chains").join(&chain_id).join("offchain");
    
    println!(
        "💉 Injecting API key '{}' into offchain storage at {:?}",
        cmd.key,
        offchain_db_path
    );
    
    // Create directory if it doesn't exist
    std::fs::create_dir_all(&offchain_db_path).map_err(|e| {
        sc_cli::Error::Application(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Failed to create offchain db directory: {}", e),
        )))
    })?;
    
    // Open the offchain storage using kvdb-rocksdb
    let db = kvdb_rocksdb::Database::open(
        &kvdb_rocksdb::DatabaseConfig::with_columns(1),
        &offchain_db_path,
    ).map_err(|e| {
        sc_cli::Error::Application(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Failed to open offchain database: {}", e),
        )))
    })?;
    
    // Write directly to the database
    // Column 0 is used for PERSISTENT storage, key format is just the key bytes
    let mut transaction = db.transaction();
    transaction.put(0, cmd.key.as_bytes(), cmd.value.as_bytes());
    db.write(transaction).map_err(|e| {
        sc_cli::Error::Application(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Failed to write to offchain database: {}", e),
        )))
    })?;
    
    // Verify it was stored
    if let Ok(Some(stored)) = db.get(0, cmd.key.as_bytes()) {
        println!("✅ API key '{}' successfully injected ({} bytes)", cmd.key, stored.len());
    } else {
        eprintln!("❌ Failed to verify API key injection");
        return Err(sc_cli::Error::Application(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "Failed to verify API key injection",
        ))));
    }
    
    Ok(())
}
