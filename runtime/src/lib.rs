//! # PRMX Runtime
//!
//! The PRMX Runtime is a Substrate-based runtime for parametric rainfall insurance.
//! It integrates all PRMX pallets with standard Substrate pallets.
//!
//! This is a standalone dev chain configuration. XCM/Hydration logic is preserved
//! in pallet-prmx-xcm-capital for future parachain deployment.

#![cfg_attr(not(feature = "std"), no_std)]
// `construct_runtime!` does a lot of recursion and requires us to increase the limit.
#![recursion_limit = "256"]

// Make the WASM binary available.
#[cfg(feature = "std")]
include!(concat!(env!("OUT_DIR"), "/wasm_binary.rs"));

extern crate alloc;

use alloc::vec::Vec;
use codec::Encode;

use sp_api::impl_runtime_apis;
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_consensus_grandpa::AuthorityId as GrandpaId;
use sp_core::{crypto::KeyTypeId, OpaqueMetadata};
use sp_runtime::{
    generic, impl_opaque_keys,
    traits::{AccountIdLookup, BlakeTwo256, Block as BlockT, IdentifyAccount, SaturatedConversion, Verify},
    transaction_validity::{TransactionSource, TransactionValidity},
    ApplyExtrinsicResult, MultiSignature,
};
use sp_version::RuntimeVersion;

use frame_support::{
    construct_runtime,
    derive_impl,
    genesis_builder_helper::{build_state, get_preset},
    parameter_types,
    traits::{ConstU128, ConstU32, ConstU64, ConstU8},
    weights::{constants::WEIGHT_REF_TIME_PER_SECOND, Weight},
};
use frame_system::EnsureRoot;

// Re-export pallets for easy access
pub use frame_system::Call as SystemCall;
pub use pallet_balances::Call as BalancesCall;
pub use pallet_timestamp::Call as TimestampCall;

// =============================================================================
//                              Type Definitions
// =============================================================================

/// An index to a block.
pub type BlockNumber = u32;

/// Alias to 512-bit hash when used in the context of a transaction signature on the chain.
pub type Signature = MultiSignature;

/// Some way of identifying an account on the chain.
pub type AccountId = <<Signature as Verify>::Signer as IdentifyAccount>::AccountId;

/// Balance of an account.
pub type Balance = u128;

/// Index of a transaction in the chain.
pub type Nonce = u32;

/// A hash of some data used by the chain.
pub type Hash = sp_core::H256;

/// Asset ID type
pub type AssetId = u32;

/// USDT Asset ID (constant)
pub const USDT_ASSET_ID: AssetId = 1;

/// Opaque types block types.
pub mod opaque {
    use super::*;

    pub use sp_runtime::OpaqueExtrinsic as UncheckedExtrinsic;

    pub type Header = generic::Header<BlockNumber, BlakeTwo256>;
    pub type Block = generic::Block<Header, UncheckedExtrinsic>;
    pub type BlockId = generic::BlockId<Block>;

    impl_opaque_keys! {
        pub struct SessionKeys {
            pub aura: Aura,
            pub grandpa: Grandpa,
        }
    }
}

/// Runtime version.
#[sp_version::runtime_version]
pub const VERSION: RuntimeVersion = RuntimeVersion {
    spec_name: alloc::borrow::Cow::Borrowed("prmx"),
    impl_name: alloc::borrow::Cow::Borrowed("prmx-node"),
    authoring_version: 1,
    spec_version: 100,
    impl_version: 1,
    apis: RUNTIME_API_VERSIONS,
    transaction_version: 1,
    system_version: 1,
};

/// The version information used to identify this runtime when compiled natively.
#[cfg(feature = "std")]
pub fn native_version() -> sp_version::NativeVersion {
    sp_version::NativeVersion {
        runtime_version: VERSION,
        can_author_with: Default::default(),
    }
}

// =============================================================================
//                              Parameters
// =============================================================================

/// We assume that ~10% of the block weight is consumed by `on_initialize` handlers.
#[allow(dead_code)]
const AVERAGE_ON_INITIALIZE_RATIO: sp_runtime::Perbill = sp_runtime::Perbill::from_percent(10);
/// We allow `Normal` extrinsics to fill up the block up to 75%, the rest can be used
/// by Operational extrinsics.
const NORMAL_DISPATCH_RATIO: sp_runtime::Perbill = sp_runtime::Perbill::from_percent(75);
/// We allow for 2 seconds of compute with a 6 second average block time.
const MAXIMUM_BLOCK_WEIGHT: Weight =
    Weight::from_parts(WEIGHT_REF_TIME_PER_SECOND.saturating_mul(2), u64::MAX);

parameter_types! {
    pub const BlockHashCount: BlockNumber = 2400;
    pub const Version: RuntimeVersion = VERSION;
    pub BlockWeights: frame_system::limits::BlockWeights =
        frame_system::limits::BlockWeights::with_sensible_defaults(
            MAXIMUM_BLOCK_WEIGHT,
            NORMAL_DISPATCH_RATIO,
        );
    pub BlockLength: frame_system::limits::BlockLength =
        frame_system::limits::BlockLength::max_with_normal_ratio(
            5 * 1024 * 1024,
            NORMAL_DISPATCH_RATIO,
        );
    pub const SS58Prefix: u8 = 42;
}

// =============================================================================
//                          Frame System Config
// =============================================================================

#[derive_impl(frame_system::config_preludes::SolochainDefaultConfig)]
impl frame_system::Config for Runtime {
    type BaseCallFilter = frame_support::traits::Everything;
    type BlockWeights = BlockWeights;
    type BlockLength = BlockLength;
    type DbWeight = ();
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    type Nonce = Nonce;
    type Hash = Hash;
    type Hashing = BlakeTwo256;
    type AccountId = AccountId;
    type Lookup = AccountIdLookup<AccountId, ()>;
    type Block = Block;
    type RuntimeEvent = RuntimeEvent;
    type BlockHashCount = BlockHashCount;
    type Version = Version;
    type PalletInfo = PalletInfo;
    type AccountData = pallet_balances::AccountData<Balance>;
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = SS58Prefix;
    type OnSetCode = ();
    type MaxConsumers = ConstU32<16>;
    type RuntimeTask = ();
    type SingleBlockMigrations = ();
    type MultiBlockMigrator = ();
    type PreInherents = ();
    type PostInherents = ();
    type PostTransactions = ();
}

// =============================================================================
//                          Consensus Pallets
// =============================================================================

parameter_types! {
    pub const MaxAuthorities: u32 = 100;
}

impl pallet_aura::Config for Runtime {
    type AuthorityId = AuraId;
    type DisabledValidators = ();
    type MaxAuthorities = MaxAuthorities;
    type AllowMultipleBlocksPerSlot = ConstBool<false>;
    type SlotDuration = pallet_aura::MinimumPeriodTimesTwo<Runtime>;
}

impl pallet_grandpa::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type WeightInfo = ();
    type MaxAuthorities = MaxAuthorities;
    type MaxNominators = ConstU32<0>;
    type MaxSetIdSessionEntries = ConstU64<0>;
    type KeyOwnerProof = sp_core::Void;
    type EquivocationReportSystem = ();
}

// =============================================================================
//                          Time Pallet
// =============================================================================

parameter_types! {
    pub const MinimumPeriod: u64 = 3000; // 3 seconds (half of block time)
}

impl pallet_timestamp::Config for Runtime {
    type Moment = u64;
    type OnTimestampSet = Aura;
    type MinimumPeriod = MinimumPeriod;
    type WeightInfo = ();
}

// =============================================================================
//                          Balances Pallet (PRMX Token)
// =============================================================================

parameter_types! {
    pub const ExistentialDeposit: Balance = 1;
    pub const MaxLocks: u32 = 50;
    pub const MaxReserves: u32 = 50;
}

impl pallet_balances::Config for Runtime {
    type MaxLocks = MaxLocks;
    type MaxReserves = MaxReserves;
    type ReserveIdentifier = [u8; 8];
    type Balance = Balance;
    type RuntimeEvent = RuntimeEvent;
    type DustRemoval = ();
    type ExistentialDeposit = ExistentialDeposit;
    type AccountStore = System;
    type WeightInfo = ();
    type FreezeIdentifier = ();
    type MaxFreezes = ConstU32<0>;
    type RuntimeHoldReason = ();
    type RuntimeFreezeReason = ();
    type DoneSlashHandler = ();
}

// =============================================================================
//                          Transaction Payment
// =============================================================================

impl pallet_transaction_payment::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OnChargeTransaction = pallet_transaction_payment::FungibleAdapter<Balances, ()>;
    type WeightToFee = frame_support::weights::IdentityFee<Balance>;
    type LengthToFee = frame_support::weights::IdentityFee<Balance>;
    type FeeMultiplierUpdate = ();
    type OperationalFeeMultiplier = ConstU8<5>;
    type WeightInfo = ();
}

// =============================================================================
//                          Sudo Pallet
// =============================================================================

impl pallet_sudo::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type RuntimeCall = RuntimeCall;
    type WeightInfo = ();
}

// =============================================================================
//                          Assets Pallet (USDT)
// =============================================================================

parameter_types! {
    pub const AssetDeposit: Balance = 100;
    pub const ApprovalDeposit: Balance = 1;
    pub const StringLimit: u32 = 50;
    pub const MetadataDepositBase: Balance = 10;
    pub const MetadataDepositPerByte: Balance = 1;
}

impl pallet_assets::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type AssetIdParameter = codec::Compact<AssetId>;
    type Currency = Balances;
    type CreateOrigin = frame_support::traits::AsEnsureOriginWithArg<frame_system::EnsureSigned<AccountId>>;
    type ForceOrigin = EnsureRoot<AccountId>;
    type AssetDeposit = AssetDeposit;
    type AssetAccountDeposit = ConstU128<1>;
    type MetadataDepositBase = MetadataDepositBase;
    type MetadataDepositPerByte = MetadataDepositPerByte;
    type ApprovalDeposit = ApprovalDeposit;
    type StringLimit = StringLimit;
    type Freezer = ();
    type Extra = ();
    type WeightInfo = ();
    type Holder = ();
    type CallbackHandle = ();
    type RemoveItemsLimit = ConstU32<1000>;
    #[cfg(feature = "runtime-benchmarks")]
    type BenchmarkHelper = ();
}

// =============================================================================
//                          PRMX Markets Pallet
// =============================================================================

impl pallet_prmx_markets::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type NewMarketNotifier = PrmxOracle;
    /// DAO operations require Root (Sudo) origin
    type DaoOrigin = EnsureRoot<AccountId>;
}

// =============================================================================
//                          PRMX Holdings Pallet
// =============================================================================

parameter_types! {
    /// Maximum LP holders per policy for automatic distribution
    /// LP tokens are now policy-specific, not market-specific
    pub const MaxLpHoldersPerPolicy: u32 = 100;
}

impl pallet_prmx_holdings::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type Assets = Assets;
    type UsdtAssetId = ConstU32<USDT_ASSET_ID>;
    type MaxLpHoldersPerPolicy = MaxLpHoldersPerPolicy;
}

// =============================================================================
//                          PRMX Quote Pallet
// =============================================================================

parameter_types! {
    /// Quote is valid for 1 hour (3600 seconds)
    pub const QuoteValiditySeconds: u64 = 3600;
    /// R pricing API URL
    pub const ProbabilityApiUrl: &'static str = "http://34.51.195.144:19090/pricing";
    /// Maximum pending quotes
    pub const MaxPendingQuotes: u32 = 100;
}

impl pallet_prmx_quote::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type MarketsApi = PrmxMarkets;
    type QuoteValiditySeconds = QuoteValiditySeconds;
    type ProbabilityApiUrl = ProbabilityApiUrl;
    type MaxPendingQuotes = MaxPendingQuotes;
    /// Quote authority ID for signing offchain worker transactions
    type AuthorityId = pallet_prmx_quote::crypto::QuoteAuthId;
}

// =============================================================================
//                          PRMX Orderbook LP Pallet
// =============================================================================

parameter_types! {
    pub const MaxOrdersPerPriceLevel: u32 = 100;
    pub const MaxPriceLevels: u32 = 1000;
    pub const MaxOrdersPerUser: u32 = 50;
}

impl pallet_prmx_orderbook_lp::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type Assets = Assets;
    type UsdtAssetId = ConstU32<USDT_ASSET_ID>;
    type HoldingsApi = PrmxHoldings;
    type DaoAccountId = DaoAccountId;
    type MaxOrdersPerPriceLevel = MaxOrdersPerPriceLevel;
    type MaxPriceLevels = MaxPriceLevels;
    type MaxOrdersPerUser = MaxOrdersPerUser;
}

// =============================================================================
//                          PRMX Policy Pallet
// =============================================================================

parameter_types! {
    /// Single DAO account for all operations (receives LP tokens, provides capital, receives settlement)
    /// This is Alice's account ID (well-known dev account: //Alice)
    pub DaoAccountId: AccountId = AccountId::new([
        0xd4, 0x35, 0x93, 0xc7, 0x15, 0xfd, 0xd3, 0x1c,
        0x61, 0x14, 0x1a, 0xbd, 0x04, 0xa9, 0x9f, 0xd6,
        0x82, 0x2c, 0x85, 0x58, 0x85, 0x4c, 0xcd, 0xe3,
        0x9a, 0x56, 0x84, 0xe7, 0xa5, 0x6d, 0xa2, 0x7d
    ]);
    /// DAO capital account (same as DaoAccountId for simplicity)
    pub DaoCapitalAccountId: AccountId = AccountId::new([
        0xd4, 0x35, 0x93, 0xc7, 0x15, 0xfd, 0xd3, 0x1c,
        0x61, 0x14, 0x1a, 0xbd, 0x04, 0xa9, 0x9f, 0xd6,
        0x82, 0x2c, 0x85, 0x58, 0x85, 0x4c, 0xcd, 0xe3,
        0x9a, 0x56, 0x84, 0xe7, 0xa5, 0x6d, 0xa2, 0x7d
    ]);
    /// USDT asset ID
    pub const UsdtAssetId: AssetId = USDT_ASSET_ID;
    /// Max policies per market
    pub const MaxPoliciesPerMarket: u32 = 10000;
}

impl pallet_prmx_policy::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type Assets = Assets;
    type UsdtAssetId = ConstU32<USDT_ASSET_ID>;
    type QuoteApi = PrmxQuote;
    type HoldingsApi = PrmxHoldings;
    type LpOrderbook = PrmxOrderbookLp;
    type DaoAccountId = DaoAccountId;
    type DaoCapitalAccountId = DaoCapitalAccountId;
    type MaxPoliciesPerMarket = MaxPoliciesPerMarket;
    /// Capital management via XCM-based DeFi strategy (Hydration Pool 102)
    type CapitalApi = PrmxXcmCapital;
    /// Access to markets pallet for policy label generation
    type MarketsApi = PrmxMarkets;
}

// =============================================================================
//                          PRMX Oracle Pallet
// =============================================================================

parameter_types! {
    /// Maximum length of AccuWeather location key
    pub const MaxLocationKeyLength: u32 = 64;
}

/// Implements frame_system::offchain::SigningTypes for signed transaction submission
impl frame_system::offchain::SigningTypes for Runtime {
    type Public = <Signature as Verify>::Signer;
    type Signature = Signature;
}

/// Implements frame_system::offchain::CreateTransactionBase for submitting signed transactions
impl<LocalCall> frame_system::offchain::CreateTransactionBase<LocalCall> for Runtime
where
    RuntimeCall: From<LocalCall>,
{
    type Extrinsic = UncheckedExtrinsic;
    type RuntimeCall = RuntimeCall;
}

/// Implements frame_system::offchain::CreateSignedTransaction for creating signed transactions
impl<LocalCall> frame_system::offchain::CreateSignedTransaction<LocalCall> for Runtime
where
    RuntimeCall: From<LocalCall>,
{
    fn create_signed_transaction<C: frame_system::offchain::AppCrypto<Self::Public, Self::Signature>>(
        call: RuntimeCall,
        public: <Signature as Verify>::Signer,
        account: AccountId,
        nonce: Nonce,
    ) -> Option<UncheckedExtrinsic> {
        let tip = 0;
        // Take the biggest period possible.
        let period = BlockHashCount::get()
            .checked_next_power_of_two()
            .map(|c| c / 2)
            .unwrap_or(2) as u64;
        let current_block = System::block_number()
            .saturated_into::<u64>()
            // The `System::block_number` is initialized with `n+1`,
            // so the actual block number is `n`.
            .saturating_sub(1);
        let era = generic::Era::mortal(period, current_block);
        let extra: SignedExtra = (
            frame_system::CheckNonZeroSender::<Runtime>::new(),
            frame_system::CheckSpecVersion::<Runtime>::new(),
            frame_system::CheckTxVersion::<Runtime>::new(),
            frame_system::CheckGenesis::<Runtime>::new(),
            frame_system::CheckEra::<Runtime>::from(era),
            frame_system::CheckNonce::<Runtime>::from(nonce),
            frame_system::CheckWeight::<Runtime>::new(),
            pallet_transaction_payment::ChargeTransactionPayment::<Runtime>::from(tip),
        );
        let raw_payload = SignedPayload::new(call, extra)
            .map_err(|e| {
                log::warn!("Unable to create signed payload: {:?}", e);
            })
            .ok()?;
        let signature = raw_payload.using_encoded(|payload| C::sign(payload, public))?;
        let (call, extra, _) = raw_payload.deconstruct();
        Some(UncheckedExtrinsic::new_signed(call, sp_runtime::MultiAddress::Id(account), signature, extra))
    }
}

/// A type for signing payloads for offchain worker transactions
pub type SignedPayload = generic::SignedPayload<RuntimeCall, SignedExtra>;

impl pallet_prmx_oracle::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    /// Oracle providers can submit data (Root for now, can be expanded)
    type OracleOrigin = EnsureRoot<AccountId>;
    /// Governance can manage oracle config
    type GovernanceOrigin = EnsureRoot<AccountId>;
    /// Access to markets pallet for center coordinates
    type MarketsApi = PrmxMarkets;
    /// Access to policy pallet for automatic settlements
    type PolicySettlement = PrmxPolicy;
    type MaxLocationKeyLength = MaxLocationKeyLength;
    /// Oracle authority ID for signing offchain worker transactions
    type AuthorityId = pallet_prmx_oracle::crypto::OracleAuthId;
    type WeightInfo = ();
}

// =============================================================================
//                          PRMX XCM Capital Pallet
// =============================================================================

impl pallet_prmx_xcm_capital::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type Assets = Assets;
    type UsdtAssetId = ConstU32<USDT_ASSET_ID>;
    type DaoAccountId = DaoAccountId;
    /// Default allocation percentage: 100% (1_000_000 ppm)
    type DefaultAllocationPpm = ConstU32<1_000_000>;
    /// Mock XCM strategy interface for v1 (simulates XCM without real cross-chain calls)
    type XcmStrategyInterface = pallet_prmx_xcm_capital::MockXcmStrategyInterface<Runtime>;
    /// Policy pool account derivation from policy pallet
    type PolicyPoolAccount = PrmxPolicy;
}


// =============================================================================
//                          Helper Types
// =============================================================================

use frame_support::traits::ConstBool;

// =============================================================================
//                          Construct Runtime
// =============================================================================

construct_runtime!(
    pub enum Runtime {
        // Core
        System: frame_system,
        Timestamp: pallet_timestamp,
        
        // Consensus (Aura + Grandpa for standalone dev chain)
        Aura: pallet_aura,
        Grandpa: pallet_grandpa,
        
        // Monetary
        Balances: pallet_balances,
        TransactionPayment: pallet_transaction_payment,
        Assets: pallet_assets,
        
        // Governance
        Sudo: pallet_sudo,
        
        // PRMX Pallets
        PrmxMarkets: pallet_prmx_markets,
        PrmxHoldings: pallet_prmx_holdings,
        PrmxQuote: pallet_prmx_quote,
        PrmxPolicy: pallet_prmx_policy,
        PrmxOrderbookLp: pallet_prmx_orderbook_lp,
        PrmxOracle: pallet_prmx_oracle,
        PrmxXcmCapital: pallet_prmx_xcm_capital,
    }
);

// =============================================================================
//                          Block Type
// =============================================================================

/// The address format for describing accounts.
pub type Address = sp_runtime::MultiAddress<AccountId, ()>;
/// Block header type as expected by this runtime.
pub type Header = generic::Header<BlockNumber, BlakeTwo256>;
/// Block type as expected by this runtime.
pub type Block = generic::Block<Header, UncheckedExtrinsic>;
/// The SignedExtension to the basic transaction logic.
pub type SignedExtra = (
    frame_system::CheckNonZeroSender<Runtime>,
    frame_system::CheckSpecVersion<Runtime>,
    frame_system::CheckTxVersion<Runtime>,
    frame_system::CheckGenesis<Runtime>,
    frame_system::CheckEra<Runtime>,
    frame_system::CheckNonce<Runtime>,
    frame_system::CheckWeight<Runtime>,
    pallet_transaction_payment::ChargeTransactionPayment<Runtime>,
);
/// Unchecked extrinsic type as expected by this runtime.
pub type UncheckedExtrinsic =
    generic::UncheckedExtrinsic<Address, RuntimeCall, Signature, SignedExtra>;
/// Executive: handles dispatch to the various modules.
pub type Executive = frame_executive::Executive<
    Runtime,
    Block,
    frame_system::ChainContext<Runtime>,
    Runtime,
    AllPalletsWithSystem,
>;

// =============================================================================
//                          Runtime APIs
// =============================================================================

impl_runtime_apis! {
    impl sp_api::Core<Block> for Runtime {
        fn version() -> RuntimeVersion {
            VERSION
        }

        fn execute_block(block: Block) {
            Executive::execute_block(block);
        }

        fn initialize_block(header: &<Block as BlockT>::Header) -> sp_runtime::ExtrinsicInclusionMode {
            Executive::initialize_block(header)
        }
    }

    impl sp_api::Metadata<Block> for Runtime {
        fn metadata() -> OpaqueMetadata {
            OpaqueMetadata::new(Runtime::metadata().into())
        }

        fn metadata_at_version(version: u32) -> Option<OpaqueMetadata> {
            Runtime::metadata_at_version(version)
        }

        fn metadata_versions() -> Vec<u32> {
            Runtime::metadata_versions()
        }
    }

    impl sp_block_builder::BlockBuilder<Block> for Runtime {
        fn apply_extrinsic(extrinsic: <Block as BlockT>::Extrinsic) -> ApplyExtrinsicResult {
            Executive::apply_extrinsic(extrinsic)
        }

        fn finalize_block() -> <Block as BlockT>::Header {
            Executive::finalize_block()
        }

        fn inherent_extrinsics(data: sp_inherents::InherentData) -> Vec<<Block as BlockT>::Extrinsic> {
            data.create_extrinsics()
        }

        fn check_inherents(
            block: Block,
            data: sp_inherents::InherentData,
        ) -> sp_inherents::CheckInherentsResult {
            data.check_extrinsics(&block)
        }
    }

    impl sp_transaction_pool::runtime_api::TaggedTransactionQueue<Block> for Runtime {
        fn validate_transaction(
            source: TransactionSource,
            tx: <Block as BlockT>::Extrinsic,
            block_hash: <Block as BlockT>::Hash,
        ) -> TransactionValidity {
            Executive::validate_transaction(source, tx, block_hash)
        }
    }

    impl sp_offchain::OffchainWorkerApi<Block> for Runtime {
        fn offchain_worker(header: &<Block as BlockT>::Header) {
            Executive::offchain_worker(header)
        }
    }

    impl sp_consensus_aura::AuraApi<Block, AuraId> for Runtime {
        fn slot_duration() -> sp_consensus_aura::SlotDuration {
            sp_consensus_aura::SlotDuration::from_millis(Aura::slot_duration())
        }

        fn authorities() -> Vec<AuraId> {
            pallet_aura::Authorities::<Runtime>::get().into_inner()
        }
    }

    impl sp_session::SessionKeys<Block> for Runtime {
        fn generate_session_keys(seed: Option<Vec<u8>>) -> Vec<u8> {
            opaque::SessionKeys::generate(seed)
        }

        fn decode_session_keys(
            encoded: Vec<u8>,
        ) -> Option<Vec<(Vec<u8>, KeyTypeId)>> {
            opaque::SessionKeys::decode_into_raw_public_keys(&encoded)
        }
    }

    impl sp_consensus_grandpa::GrandpaApi<Block> for Runtime {
        fn grandpa_authorities() -> sp_consensus_grandpa::AuthorityList {
            Grandpa::grandpa_authorities()
        }

        fn current_set_id() -> sp_consensus_grandpa::SetId {
            Grandpa::current_set_id()
        }

        fn submit_report_equivocation_unsigned_extrinsic(
            _equivocation_proof: sp_consensus_grandpa::EquivocationProof<
                <Block as BlockT>::Hash,
                sp_runtime::traits::NumberFor<Block>,
            >,
            _key_owner_proof: sp_consensus_grandpa::OpaqueKeyOwnershipProof,
        ) -> Option<()> {
            None
        }

        fn generate_key_ownership_proof(
            _set_id: sp_consensus_grandpa::SetId,
            _authority_id: GrandpaId,
        ) -> Option<sp_consensus_grandpa::OpaqueKeyOwnershipProof> {
            None
        }
    }

    impl frame_system_rpc_runtime_api::AccountNonceApi<Block, AccountId, Nonce> for Runtime {
        fn account_nonce(account: AccountId) -> Nonce {
            System::account_nonce(account)
        }
    }

    impl pallet_transaction_payment_rpc_runtime_api::TransactionPaymentApi<Block, Balance> for Runtime {
        fn query_info(
            uxt: <Block as BlockT>::Extrinsic,
            len: u32,
        ) -> pallet_transaction_payment_rpc_runtime_api::RuntimeDispatchInfo<Balance> {
            TransactionPayment::query_info(uxt, len)
        }

        fn query_fee_details(
            uxt: <Block as BlockT>::Extrinsic,
            len: u32,
        ) -> pallet_transaction_payment::FeeDetails<Balance> {
            TransactionPayment::query_fee_details(uxt, len)
        }

        fn query_weight_to_fee(weight: Weight) -> Balance {
            TransactionPayment::weight_to_fee(weight)
        }

        fn query_length_to_fee(length: u32) -> Balance {
            TransactionPayment::length_to_fee(length)
        }
    }

    impl sp_genesis_builder::GenesisBuilder<Block> for Runtime {
        fn build_state(config: Vec<u8>) -> sp_genesis_builder::Result {
            build_state::<RuntimeGenesisConfig>(config)
        }

        fn get_preset(id: &Option<sp_genesis_builder::PresetId>) -> Option<Vec<u8>> {
            get_preset::<RuntimeGenesisConfig>(id, |_| None)
        }

        fn preset_names() -> Vec<sp_genesis_builder::PresetId> {
            Default::default()
        }
    }
}
