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
use prmx_primitives::{EventSpecV3, PolicyId};
use pallet_prmx_holdings::HoldingsApi;
use pallet_prmx_xcm_capital::CapitalApi;

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
    /// This is the dedicated DAO account (dev account: //DAO)
    /// Address: 5EyKeA48QNY6LbD2QeN2JUuArTiyBTDN2BBYoLLCwz9rXdZS
    pub DaoAccountId: AccountId = AccountId::new([
        0x80, 0x99, 0xb0, 0x45, 0x02, 0x49, 0x8b, 0xa2,
        0x93, 0x68, 0x33, 0xa5, 0x71, 0x5a, 0x95, 0xdb,
        0xcd, 0x36, 0x76, 0x28, 0xa4, 0xdd, 0x47, 0x92,
        0x22, 0x2b, 0x7b, 0xcb, 0x4a, 0xa7, 0x99, 0x59
    ]);
    /// DAO capital account (same as DaoAccountId for simplicity)
    pub DaoCapitalAccountId: AccountId = AccountId::new([
        0x80, 0x99, 0xb0, 0x45, 0x02, 0x49, 0x8b, 0xa2,
        0x93, 0x68, 0x33, 0xa5, 0x71, 0x5a, 0x95, 0xdb,
        0xcd, 0x36, 0x76, 0x28, 0xa4, 0xdd, 0x47, 0x92,
        0x22, 0x2b, 0x7b, 0xcb, 0x4a, 0xa7, 0x99, 0x59
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
    /// V2 oracle origin - only root/sudo can settle V2 policies
    type V2OracleOrigin = EnsureRoot<AccountId>;
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
    /// Holdings API for LP token ownership checks
    type HoldingsApi = PrmxHoldings;
}

// =============================================================================
//                          PRMX V3 Pallets (P2P Climate Risk Market)
// =============================================================================

parameter_types! {
    /// Maximum length of AccuWeather location key for V3
    pub const MaxLocationKeyLengthV3: u32 = 64;
    /// Maximum LP holders per V3 policy
    pub const MaxLpHoldersPerPolicyV3: u32 = 200;
}

/// Implement CreateBare for any call type to enable unsigned transactions
impl<LocalCall> frame_system::offchain::CreateBare<LocalCall> for Runtime
where
    RuntimeCall: From<LocalCall>,
{
    fn create_bare(call: RuntimeCall) -> UncheckedExtrinsic {
        UncheckedExtrinsic::new_bare(call)
    }
}

/// V3 Request Expiry API Adapter
pub struct RequestExpiryApiV3Adapter;

impl pallet_oracle_v3::RequestExpiryApiV3 for RequestExpiryApiV3Adapter {
    fn get_expired_requests(current_time: u64) -> Vec<prmx_primitives::PolicyId> {
        pallet_market_v3::Pallet::<Runtime>::get_expired_requests_internal(current_time)
    }
    
    fn is_request_expired(request_id: prmx_primitives::PolicyId, current_time: u64) -> bool {
        pallet_market_v3::Pallet::<Runtime>::is_request_expired_internal(request_id, current_time)
    }
    
    fn expire_request(request_id: prmx_primitives::PolicyId) -> frame_support::dispatch::DispatchResult {
        pallet_market_v3::Pallet::<Runtime>::do_expire_request(request_id)
    }
}

/// V3 Oracle Pallet Configuration
impl pallet_oracle_v3::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    /// Governance origin for adding/removing locations and oracle members
    type GovernanceOrigin = EnsureRoot<AccountId>;
    /// Oracle origin for submitting snapshots and reports
    type OracleOrigin = EnsureRoot<AccountId>;
    /// Settlement handler in policy pallet
    type PolicySettlement = PrmxPolicyV3;
    /// Request expiry API for detecting expired requests
    type RequestExpiryApi = RequestExpiryApiV3Adapter;
    type MaxLocationKeyLength = MaxLocationKeyLengthV3;
    type WeightInfo = ();
}

/// V3 Holdings API implementation using existing holdings pallet
pub struct HoldingsApiV3Adapter;

impl pallet_policy_v3::HoldingsApiV3<AccountId> for HoldingsApiV3Adapter {
    type Balance = Balance;

    fn mint_lp_tokens(
        policy_id: prmx_primitives::PolicyId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_holdings::Pallet::<Runtime>::mint_lp_tokens(policy_id, to, amount)
    }

    fn register_lp_holder(
        policy_id: prmx_primitives::PolicyId,
        holder: &AccountId,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_holdings::Pallet::<Runtime>::register_lp_holder(policy_id, holder)
    }

    fn total_lp_supply(policy_id: prmx_primitives::PolicyId) -> u128 {
        pallet_prmx_holdings::Pallet::<Runtime>::total_lp_shares(policy_id)
    }

    fn lp_balance(policy_id: prmx_primitives::PolicyId, account: &AccountId) -> u128 {
        pallet_prmx_holdings::Pallet::<Runtime>::lp_balance(policy_id, account)
    }

    fn distribute_to_lp_holders(
        policy_id: prmx_primitives::PolicyId,
        from_account: &AccountId,
        amount: Balance,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_holdings::Pallet::<Runtime>::distribute_to_lp_holders(policy_id, from_account, amount)
    }

    fn cleanup_policy_lp_tokens(
        policy_id: prmx_primitives::PolicyId,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_holdings::Pallet::<Runtime>::cleanup_policy_lp_tokens(policy_id)
    }
}

/// V3 Capital API implementation using existing XCM capital pallet
pub struct CapitalApiV3Adapter;

impl pallet_policy_v3::CapitalApiV3<AccountId> for CapitalApiV3Adapter {
    type Balance = Balance;

    fn allocate_to_defi(
        policy_id: prmx_primitives::PolicyId,
        amount: Balance,
    ) -> Result<(), sp_runtime::DispatchError> {
        // V3 uses its own policy pool account derivation (pallet_policy_v3)
        // Use the new method that accepts the pool account directly
        let pool_account = pallet_policy_v3::Pallet::<Runtime>::policy_pool_account(policy_id);
        pallet_prmx_xcm_capital::Pallet::<Runtime>::do_allocate_to_defi_with_account(
            policy_id,
            amount,
            pool_account,
        )
    }

    fn auto_allocate_policy_capital(
        policy_id: prmx_primitives::PolicyId,
        pool_balance: Balance,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_xcm_capital::Pallet::<Runtime>::auto_allocate_policy_capital(policy_id, pool_balance)
    }

    fn ensure_local_liquidity(
        policy_id: prmx_primitives::PolicyId,
        required_local: Balance,
    ) -> Result<(), sp_runtime::DispatchError> {
        // V3 uses its own policy pool account derivation (pallet_policy_v3)
        let pool_account = pallet_policy_v3::Pallet::<Runtime>::policy_pool_account(policy_id);
        pallet_prmx_xcm_capital::Pallet::<Runtime>::do_ensure_local_liquidity_with_account(
            policy_id,
            required_local,
            pool_account,
        )
    }

    fn on_policy_settled(
        policy_id: prmx_primitives::PolicyId,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_xcm_capital::Pallet::<Runtime>::on_policy_settled(policy_id)
    }
}

/// V3 Policy Pallet Configuration
impl pallet_policy_v3::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type Assets = Assets;
    type UsdtAssetId = ConstU32<USDT_ASSET_ID>;
    type HoldingsApi = HoldingsApiV3Adapter;
    type CapitalApi = CapitalApiV3Adapter;
    type MaxLpHoldersPerPolicy = MaxLpHoldersPerPolicyV3;
    type WeightInfo = ();
}

/// V3 Location Registry Adapter
pub struct LocationRegistryV3Adapter;

impl pallet_market_v3::LocationRegistryApiV3 for LocationRegistryV3Adapter {
    fn is_location_active(location_id: pallet_market_v3::LocationId) -> bool {
        pallet_oracle_v3::Pallet::<Runtime>::is_location_active(location_id)
    }
}

/// V3 Policy API Adapter
pub struct PolicyApiV3Adapter;

impl pallet_market_v3::PolicyApiV3<AccountId, Balance> for PolicyApiV3Adapter {
    fn create_policy(
        policy_id: PolicyId,
        holder: AccountId,
        location_id: pallet_market_v3::LocationId,
        event_spec: EventSpecV3,
        initial_shares: u128,
        premium_per_share: Balance,
        coverage_start: u64,
        coverage_end: u64,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_policy_v3::Pallet::<Runtime>::create_policy(
            policy_id,
            holder,
            location_id,
            event_spec,
            initial_shares,
            premium_per_share,
            coverage_start,
            coverage_end,
        )
    }

    fn add_shares_to_policy(
        policy_id: PolicyId,
        underwriter: AccountId,
        shares: u128,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_policy_v3::Pallet::<Runtime>::add_shares_to_policy(policy_id, underwriter, shares)
    }

    fn allocate_to_defi(policy_id: PolicyId, amount: Balance) -> Result<(), sp_runtime::DispatchError> {
        pallet_policy_v3::Pallet::<Runtime>::allocate_to_defi(policy_id, amount)
    }

    fn trigger_defi_allocation(policy_id: PolicyId) -> Result<(), sp_runtime::DispatchError> {
        pallet_policy_v3::Pallet::<Runtime>::trigger_defi_allocation(policy_id)
    }

    fn policy_pool_account(policy_id: PolicyId) -> AccountId {
        pallet_policy_v3::Pallet::<Runtime>::policy_pool_account(policy_id)
    }
}

/// V3 Holdings API Adapter for Market Pallet
pub struct HoldingsApiV3MarketAdapter;

impl pallet_market_v3::HoldingsApiV3<AccountId> for HoldingsApiV3MarketAdapter {
    fn mint_lp_tokens(
        policy_id: PolicyId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_holdings::Pallet::<Runtime>::mint_lp_tokens(policy_id, to, amount)
    }

    fn register_lp_holder(
        policy_id: PolicyId,
        holder: &AccountId,
    ) -> Result<(), sp_runtime::DispatchError> {
        pallet_prmx_holdings::Pallet::<Runtime>::register_lp_holder(policy_id, holder)
    }
}

/// V3 Market Pallet Configuration
impl pallet_market_v3::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type Balance = Balance;
    type AssetId = AssetId;
    type Assets = Assets;
    type UsdtAssetId = ConstU32<USDT_ASSET_ID>;
    type LocationRegistry = LocationRegistryV3Adapter;
    type PolicyApi = PolicyApiV3Adapter;
    type HoldingsApi = HoldingsApiV3MarketAdapter;
    /// Only root/oracle can trigger request expiry
    type ExpiryOrigin = EnsureRoot<AccountId>;
    type WeightInfo = ();
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
        
        // PRMX Pallets (v1/v2)
        PrmxMarkets: pallet_prmx_markets,
        PrmxHoldings: pallet_prmx_holdings,
        PrmxQuote: pallet_prmx_quote,
        PrmxPolicy: pallet_prmx_policy,
        PrmxOrderbookLp: pallet_prmx_orderbook_lp,
        PrmxOracle: pallet_prmx_oracle,
        PrmxXcmCapital: pallet_prmx_xcm_capital,
        
        // PRMX Pallets (v3 - P2P Climate Risk Market)
        PrmxOracleV3: pallet_oracle_v3,
        PrmxPolicyV3: pallet_policy_v3,
        PrmxMarketV3: pallet_market_v3,
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
