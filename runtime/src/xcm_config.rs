//! XCM Configuration for PRMX Parachain
//!
//! This module defines the XCM configuration for cross-chain communication
//! with Asset Hub and Hydration for the Pool 102 DeFi integration.

use crate::{
    AccountId, AllPalletsWithSystem, Balances, MessageQueue, ParachainSystem,
    PolkadotXcm, Runtime, RuntimeCall, RuntimeEvent, RuntimeOrigin,
};
use frame_support::{
    parameter_types,
    traits::{ConstU32, Contains, Everything, Nothing},
    weights::Weight,
};
use frame_system::EnsureRoot;
use pallet_xcm::XcmPassthrough;
use polkadot_parachain_primitives::primitives::Sibling;
use sp_runtime::traits::AccountIdConversion;
use xcm::latest::prelude::*;
use xcm_builder::{
    AccountId32Aliases, AllowKnownQueryResponses, AllowSubscriptionsFrom,
    AllowTopLevelPaidExecutionFrom, AllowUnpaidExecutionFrom, 
    FixedWeightBounds, FrameTransactionalProcessor, FungibleAdapter, 
    IsConcrete, ParentIsPreset, RelayChainAsNative, 
    SiblingParachainAsNative, SiblingParachainConvertsVia, 
    SignedAccountId32AsNative, SovereignSignedViaLocation, 
    TakeWeightCredit, WithComputedOrigin,
};
use xcm_executor::XcmExecutor;

// =============================================================================
//                       Chain Configuration Constants
// =============================================================================

/// PRMX parachain ID (for testing, will be registered properly on mainnet)
pub const PRMX_PARA_ID: u32 = 2000;

/// Asset Hub parachain ID
pub const ASSET_HUB_PARA_ID: u32 = 1000;

/// Hydration parachain ID
pub const HYDRATION_PARA_ID: u32 = 2034;

// =============================================================================
//                       Location Types
// =============================================================================

parameter_types! {
    /// The location of this parachain relative to the relay chain
    pub const RelayLocation: Location = Location::parent();
    
    /// Our location in the universal consensus
    pub UniversalLocation: InteriorLocation = [
        GlobalConsensus(NetworkId::Polkadot),
        Parachain(PRMX_PARA_ID),
    ].into();
    
    /// Location of Asset Hub (for USDT reserve)
    pub AssetHubLocation: Location = Location::new(1, [Parachain(ASSET_HUB_PARA_ID)]);
    
    /// Location of Hydration (for Pool 102)
    pub HydrationLocation: Location = Location::new(1, [Parachain(HYDRATION_PARA_ID)]);
    
    /// USDT location on Asset Hub (reserve)
    pub UsdtAssetHubLocation: Location = Location::new(
        1,
        [
            Parachain(ASSET_HUB_PARA_ID),
            PalletInstance(50), // Assets pallet
            GeneralIndex(1984), // USDT asset ID
        ]
    );
    
    /// Maximum weight for XCM execution
    pub const MaxInstructions: u32 = 100;
    pub const MaxAssetsIntoHolding: u32 = 64;
    
    /// Weight for one XCM instruction
    pub UnitWeightCost: Weight = Weight::from_parts(1_000_000_000, 64 * 1024);
}

// =============================================================================
//                       Type Definitions
// =============================================================================

/// Type for converting locations to account IDs
pub type LocationToAccountId = (
    // Parent chain (relay) can control a local account
    ParentIsPreset<AccountId>,
    // Sibling parachains use their para ID to derive accounts
    SiblingParachainConvertsVia<Sibling, AccountId>,
    // Local 32-byte accounts
    AccountId32Aliases<RelayNetwork, AccountId>,
);

/// Convert from XCM origin to local origin
pub type XcmOriginToCallOrigin = (
    // Sovereign account of the relay chain
    SovereignSignedViaLocation<LocationToAccountId, RuntimeOrigin>,
    // Relay chain root origin converts to local root
    RelayChainAsNative<RelayChainOrigin, RuntimeOrigin>,
    // Sibling parachains use their native origin
    SiblingParachainAsNative<cumulus_pallet_xcm::Origin, RuntimeOrigin>,
    // Signed 32-byte accounts
    SignedAccountId32AsNative<RelayNetwork, RuntimeOrigin>,
    // XCM origins mapped through pallet-xcm
    XcmPassthrough<RuntimeOrigin>,
);

/// Network ID for account derivation
parameter_types! {
    pub const RelayNetwork: Option<NetworkId> = Some(NetworkId::Polkadot);
}

/// Origin type for relay chain
pub struct RelayChainOrigin;
impl From<Location> for RelayChainOrigin {
    fn from(_: Location) -> Self {
        RelayChainOrigin
    }
}

/// Handle native currency (PRMX token) in XCM
pub type LocalAssetTransactor = FungibleAdapter<
    // Use pallet-balances for native currency
    Balances,
    // Match the native currency location
    IsConcrete<RelayLocation>,
    // Convert locations to accounts
    LocationToAccountId,
    // Local account type
    AccountId,
    // Teleport checking (disabled for now)
    (),
>;

// =============================================================================
//                       Barrier Configuration
// =============================================================================

/// XCM barriers - determine which XCM messages are allowed
pub type Barrier = (
    // Allow local execution for testing
    TakeWeightCredit,
    // Allow paid execution from anywhere for asset transfers
    WithComputedOrigin<
        AllowTopLevelPaidExecutionFrom<Everything>,
        UniversalLocation,
        ConstU32<8>,
    >,
    // Allow unpaid execution from parent (relay chain)
    AllowUnpaidExecutionFrom<ParentOnly>,
    // Allow query responses we're expecting
    AllowKnownQueryResponses<PolkadotXcm>,
    // Allow subscription responses
    AllowSubscriptionsFrom<Everything>,
);

/// Only parent (relay chain) can send unpaid XCM
pub struct ParentOnly;
impl Contains<Location> for ParentOnly {
    fn contains(location: &Location) -> bool {
        matches!(location.unpack(), (1, []))
    }
}

// =============================================================================
//                       Trader Configuration
// =============================================================================

/// Weight trader - handles fee payment for XCM execution
/// For testing, we use a simple fixed-weight approach
pub type Trader = ();

// =============================================================================
//                       XCM Executor Configuration
// =============================================================================

pub struct XcmConfig;
impl xcm_executor::Config for XcmConfig {
    type RuntimeCall = RuntimeCall;
    type XcmSender = XcmRouter;
    type AssetTransactor = LocalAssetTransactor;
    type OriginConverter = XcmOriginToCallOrigin;
    type IsReserve = (); // We don't accept reserve transfers in
    type IsTeleporter = (); // No teleporting
    type UniversalLocation = UniversalLocation;
    type Barrier = Barrier;
    type Weigher = FixedWeightBounds<UnitWeightCost, RuntimeCall, MaxInstructions>;
    type Trader = Trader;
    type ResponseHandler = PolkadotXcm;
    type AssetTrap = PolkadotXcm;
    type AssetLocker = ();
    type AssetExchanger = ();
    type AssetClaims = PolkadotXcm;
    type SubscriptionService = PolkadotXcm;
    type PalletInstancesInfo = AllPalletsWithSystem;
    type MaxAssetsIntoHolding = MaxAssetsIntoHolding;
    type FeeManager = ();
    type MessageExporter = ();
    type UniversalAliases = Nothing;
    type CallDispatcher = RuntimeCall;
    type SafeCallFilter = Everything;
    type Aliasers = Nothing;
    type TransactionalProcessor = FrameTransactionalProcessor;
    type HrmpNewChannelOpenRequestHandler = ();
    type HrmpChannelAcceptedHandler = ();
    type HrmpChannelClosingHandler = ();
    type XcmRecorder = PolkadotXcm;
}

// =============================================================================
//                       XCM Router Configuration
// =============================================================================

/// Routes XCM messages to their destinations
pub type XcmRouter = (
    // Send to XCMP queue for sibling parachains
    cumulus_pallet_xcmp_queue::Pallet<Runtime>,
);

// =============================================================================
//                       pallet_xcm Configuration
// =============================================================================

parameter_types! {
    pub const MaxLockers: u32 = 8;
    pub const MaxRemoteLockConsumers: u32 = 0;
}

impl pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type SendXcmOrigin = xcm_builder::EnsureXcmOrigin<RuntimeOrigin, LocalOriginToLocation>;
    type XcmRouter = XcmRouter;
    type ExecuteXcmOrigin = xcm_builder::EnsureXcmOrigin<RuntimeOrigin, LocalOriginToLocation>;
    type XcmExecuteFilter = Everything;
    type XcmExecutor = XcmExecutor<XcmConfig>;
    type XcmTeleportFilter = Nothing;
    type XcmReserveTransferFilter = Everything;
    type Weigher = FixedWeightBounds<UnitWeightCost, RuntimeCall, MaxInstructions>;
    type UniversalLocation = UniversalLocation;
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    const VERSION_DISCOVERY_QUEUE_SIZE: u32 = 100;
    type AdvertisedXcmVersion = pallet_xcm::CurrentXcmVersion;
    type Currency = Balances;
    type CurrencyMatcher = ();
    type TrustedLockers = ();
    type SovereignAccountOf = LocationToAccountId;
    type MaxLockers = MaxLockers;
    type WeightInfo = pallet_xcm::TestWeightInfo;
    type AdminOrigin = EnsureRoot<AccountId>;
    type MaxRemoteLockConsumers = MaxRemoteLockConsumers;
    type RemoteLockConsumerIdentifier = ();
}

/// Convert a local origin to a location
pub type LocalOriginToLocation = SignedToAccountId32<RuntimeOrigin, AccountId, RelayNetwork>;

/// Signed origin to AccountId32 converter
pub struct SignedToAccountId32<RuntimeOrigin, AccountId, Network>(
    sp_std::marker::PhantomData<(RuntimeOrigin, AccountId, Network)>,
);

impl<
    RuntimeOrigin: frame_support::traits::OriginTrait + Clone,
    AccountId: Into<[u8; 32]>,
    Network: frame_support::traits::Get<Option<NetworkId>>,
> xcm_builder::ConvertOrigin<RuntimeOrigin> for SignedToAccountId32<RuntimeOrigin, AccountId, Network>
where
    RuntimeOrigin::PalletsOrigin: From<frame_system::RawOrigin<AccountId>>,
{
    fn convert_origin(
        origin: impl Into<Location>,
        kind: xcm::latest::OriginKind,
    ) -> Result<RuntimeOrigin, Location> {
        let origin = origin.into();
        match (kind, origin.unpack()) {
            (xcm::latest::OriginKind::Xcm, (0, [AccountId32 { id, network }])) => {
                let network = network.as_ref();
                if network == Network::get().as_ref() || network.is_none() {
                    Ok(RuntimeOrigin::signed(AccountId::from(*id).into()))
                } else {
                    Err(origin)
                }
            }
            _ => Err(origin),
        }
    }
}

// =============================================================================
//                       Cumulus XCM Pallet Configuration
// =============================================================================

impl cumulus_pallet_xcm::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type XcmExecutor = XcmExecutor<XcmConfig>;
}

// =============================================================================
//                       XCMP Queue Configuration
// =============================================================================

parameter_types! {
    pub const MaxInboundSuspended: u32 = 1000;
}

impl cumulus_pallet_xcmp_queue::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type ChannelInfo = ParachainSystem;
    type VersionWrapper = ();
    type ControllerOrigin = EnsureRoot<AccountId>;
    type ControllerOriginConverter = XcmOriginToCallOrigin;
    type WeightInfo = ();
    type PriceForSiblingDelivery = ();
    type XcmpQueue = frame_support::traits::TransformOrigin<
        MessageQueue,
        cumulus_primitives_core::AggregateMessageOrigin,
        cumulus_primitives_core::ParaId,
        ParaIdToSibling,
    >;
    type MaxInboundSuspended = MaxInboundSuspended;
    type MaxActiveOutboundChannels = ConstU32<128>;
    type MaxPageSize = ConstU32<{ 1 << 16 }>;
}

/// Convert ParaId to sibling location
pub struct ParaIdToSibling;
impl sp_runtime::traits::Convert<cumulus_primitives_core::ParaId, cumulus_primitives_core::AggregateMessageOrigin>
    for ParaIdToSibling
{
    fn convert(para_id: cumulus_primitives_core::ParaId) -> cumulus_primitives_core::AggregateMessageOrigin {
        cumulus_primitives_core::AggregateMessageOrigin::Sibling(para_id)
    }
}

// =============================================================================
//                       Helper Functions for XCM
// =============================================================================

/// Calculate sovereign account of a sibling parachain on Asset Hub
pub fn sibling_sovereign_account(para_id: u32) -> AccountId {
    Sibling::from(para_id).into_account_truncating()
}

/// Calculate PRMX sovereign account on Asset Hub
pub fn prmx_sovereign_on_asset_hub() -> AccountId {
    sibling_sovereign_account(PRMX_PARA_ID)
}

/// Calculate PRMX sovereign account on Hydration
pub fn prmx_sovereign_on_hydration() -> AccountId {
    sibling_sovereign_account(PRMX_PARA_ID)
}
