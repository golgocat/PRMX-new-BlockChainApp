//! # PRMX Quote Pallet
//!
//! This pallet manages quote requests and pricing via an external R model API.
//! Users request quotes, offchain workers fetch probability data, and the
//! pallet calculates premiums based on the DAO margin.
//!
//! ## Overview
//!
//! - Users call `request_policy_quote` with coverage details.
//! - Offchain worker fetches probability from R model API.
//! - `submit_quote` stores the calculated premium.
//! - Users can then apply for coverage using the quote.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

use alloc::vec::Vec;

// =============================================================================
//                     Quote Authority Crypto Types
// =============================================================================

/// Key type for quote authority (used for signing offchain transactions)
pub const KEY_TYPE: sp_runtime::KeyTypeId = sp_runtime::KeyTypeId(*b"quot");

/// Crypto module for quote authority signatures
pub mod crypto {
    use super::KEY_TYPE;
    use sp_core::sr25519::Signature as Sr25519Signature;
    use sp_runtime::{
        app_crypto::{app_crypto, sr25519},
        traits::Verify,
        MultiSignature, MultiSigner,
    };

    app_crypto!(sr25519, KEY_TYPE);

    /// Quote authority ID (public key)
    pub struct QuoteAuthId;

    impl frame_system::offchain::AppCrypto<MultiSigner, MultiSignature> for QuoteAuthId {
        type RuntimeAppPublic = Public;
        type GenericPublic = sp_core::sr25519::Public;
        type GenericSignature = sp_core::sr25519::Signature;
    }

    impl frame_system::offchain::AppCrypto<<Sr25519Signature as Verify>::Signer, Sr25519Signature>
        for QuoteAuthId
    {
        type RuntimeAppPublic = Public;
        type GenericPublic = sp_core::sr25519::Public;
        type GenericSignature = sp_core::sr25519::Signature;
    }
}

// =============================================================================
//                          Constants
// =============================================================================

/// Offchain storage key for R pricing API key
pub const R_PRICING_API_KEY_STORAGE: &[u8] = b"prmx-quote::pricing-api-key";

/// Offchain storage key for R pricing API URL
pub const R_PRICING_API_URL_STORAGE: &[u8] = b"prmx-quote::pricing-api-url";

/// Default R pricing API URL (can be overridden via genesis or extrinsic)
pub const DEFAULT_R_PRICING_API_URL: &str = "http://34.51.195.144:19090/pricing";

/// Default number of simulations for R model
pub const DEFAULT_NUMBER_OF_SIMULATIONS: u32 = 100_000;

/// Default ROC (Return on Capital) for R model
pub const DEFAULT_ROC: f64 = 0.08;

/// Test R pricing API key for development (DO NOT USE IN PRODUCTION)
#[cfg(feature = "dev-mode")]
pub const TEST_R_PRICING_API_KEY: &[u8] = b"test_api_key";

/// Test R pricing API URL for development
#[cfg(feature = "dev-mode")]
pub const TEST_R_PRICING_API_URL: &[u8] = b"http://34.51.195.144:19090/pricing";

/// Fixed probability for markets without actuarial model support.
/// 1% probability = 10,000 ppm (parts per million).
/// This is a temporary benchmark for markets like Amsterdam and Tokyo
/// until proper actuarial models are developed.
pub const FIXED_PROBABILITY_PPM: u32 = 10_000;

/// Trait for accessing quote data from other pallets
pub trait QuoteAccess<AccountId, Balance> {
    /// Get quote request by ID
    fn get_quote_request(quote_id: u64) -> Option<QuoteRequestInfo<AccountId>>;
    
    /// Get quote result by ID
    fn get_quote_result(quote_id: u64) -> Option<QuoteResultInfo<Balance>>;
    
    /// Mark a quote as consumed (used for policy creation)
    fn consume_quote(quote_id: u64) -> Result<(), sp_runtime::DispatchError>;
    
    /// Check if a quote is valid and ready to use
    fn is_quote_ready(quote_id: u64) -> bool;
}

/// Quote request info (generic version for trait)
#[derive(codec::Encode, codec::Decode, Clone, PartialEq, Eq, Debug, scale_info::TypeInfo)]
pub struct QuoteRequestInfo<AccountId> {
    pub quote_id: u64,
    pub market_id: u64,
    pub requester: AccountId,
    pub coverage_start: u64,
    pub coverage_end: u64,
    pub latitude: i32,
    pub longitude: i32,
    pub shares: u128,
    pub requested_at: u64,
    /// Policy version (V1 or V2) - determines settlement path
    pub policy_version: prmx_primitives::PolicyVersion,
    /// Event type for this quote
    pub event_type: prmx_primitives::EventType,
    /// Whether early trigger is enabled (V2 only)
    pub early_trigger: bool,
    /// Duration in days (used for V2 validation)
    pub duration_days: u8,
    /// Custom strike threshold in mm * 10 (V2 only, e.g., 500 = 50mm)
    pub strike_mm: Option<u32>,
}

/// Quote result info (generic version for trait)
#[derive(codec::Encode, codec::Decode, Clone, PartialEq, Eq, Debug, scale_info::TypeInfo)]
pub struct QuoteResultInfo<Balance> {
    pub probability_ppm: u32,
    pub premium_per_share: Balance,
    pub total_premium: Balance,
    pub calculated_at: u64,
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use frame_support::pallet_prelude::*;
    use frame_support::traits::Time;
    use frame_system::pallet_prelude::*;
    use pallet_prmx_markets::{MarketId, MarketsAccess, PartsPerMillion};
    use sp_runtime::offchain::{http, Duration};

    // =========================================================================
    //                                  Types
    // =========================================================================

    pub type QuoteId = u64;

    /// Quote request from a user
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct QuoteRequest<T: Config> {
        pub quote_id: QuoteId,
        pub market_id: MarketId,
        pub requester: T::AccountId,
        pub coverage_start: u64,
        pub coverage_end: u64,
        pub latitude: i32,      // scaled by 1e6
        pub longitude: i32,     // scaled by 1e6
        pub shares: u128,
        pub requested_at: u64,
        /// Policy version (V1 or V2) - determines which settlement path is used
        pub policy_version: prmx_primitives::PolicyVersion,
        /// Event type for the policy
        pub event_type: prmx_primitives::EventType,
        /// Whether early trigger is enabled (V2 default: true)
        pub early_trigger: bool,
        /// Duration in days (for V2 validation: 2-7 days)
        pub duration_days: u8,
        /// Custom strike threshold in mm * 10 (V2 only, e.g., 500 = 50mm)
        /// If None, uses market's default strike value
        pub strike_mm: Option<u32>,
    }

    /// Quote result from the offchain worker
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub struct QuoteResult<Balance> {
        pub probability_ppm: PartsPerMillion,
        pub premium_per_share: Balance,
        pub total_premium: Balance,
        pub calculated_at: u64,
    }

    /// Quote status
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen, Default)]
    pub enum QuoteStatus {
        #[default]
        Pending,
        Ready,
        Consumed,
        Expired,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: 
        frame_system::Config 
        + pallet_timestamp::Config 
        + frame_system::offchain::CreateSignedTransaction<Call<Self>>
    {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Balance type
        type Balance: Parameter + Member + From<u128> + Into<u128> + Copy + Default + MaxEncodedLen;

        /// Access to markets pallet
        type MarketsApi: MarketsAccess<Balance = Self::Balance>;

        /// Quote validity duration in seconds (how long a quote is valid after calculation)
        #[pallet::constant]
        type QuoteValiditySeconds: Get<u64>;

        /// URL for the probability API (for development, use mock)
        #[pallet::constant]
        type ProbabilityApiUrl: Get<&'static str>;

        /// Maximum pending quotes
        #[pallet::constant]
        type MaxPendingQuotes: Get<u32>;

        /// Quote authority ID for signing offchain worker transactions
        type AuthorityId: frame_system::offchain::AppCrypto<Self::Public, Self::Signature>;
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Next quote ID
    #[pallet::storage]
    #[pallet::getter(fn next_quote_id)]
    pub type NextQuoteId<T> = StorageValue<_, QuoteId, ValueQuery>;

    /// Quote requests by ID
    #[pallet::storage]
    #[pallet::getter(fn quote_requests)]
    pub type QuoteRequests<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        QuoteId,
        QuoteRequest<T>,
        OptionQuery,
    >;

    /// Quote results by ID
    #[pallet::storage]
    #[pallet::getter(fn quote_results)]
    pub type QuoteResults<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        QuoteId,
        QuoteResult<T::Balance>,
        OptionQuery,
    >;

    /// Quote status by ID
    #[pallet::storage]
    #[pallet::getter(fn quote_status)]
    pub type QuoteStatuses<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        QuoteId,
        QuoteStatus,
        ValueQuery,
    >;

    /// Pending quotes (waiting for offchain worker)
    #[pallet::storage]
    #[pallet::getter(fn pending_quotes)]
    pub type PendingQuotes<T: Config> = StorageValue<_, BoundedVec<QuoteId, T::MaxPendingQuotes>, ValueQuery>;

    /// Quote providers (accounts authorized to submit quote results)
    #[pallet::storage]
    #[pallet::getter(fn quote_providers)]
    pub type QuoteProviders<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        T::AccountId,
        bool,
        ValueQuery,
    >;

    // =========================================================================
    //                           Genesis Configuration
    // =========================================================================

    #[pallet::genesis_config]
    #[derive(frame_support::DefaultNoBound)]
    pub struct GenesisConfig<T: Config> {
        /// R pricing API key (stored in offchain index at genesis)
        pub pricing_api_key: Vec<u8>,
        /// R pricing API URL (stored in offchain index at genesis)
        pub pricing_api_url: Vec<u8>,
        /// Initial quote providers (accounts authorized to submit quote results)
        pub quote_providers: Vec<T::AccountId>,
    }

    #[pallet::genesis_build]
    impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
        fn build(&self) {
            // Store API key in offchain index
            if !self.pricing_api_key.is_empty() {
                sp_io::offchain_index::set(R_PRICING_API_KEY_STORAGE, &self.pricing_api_key);
                log::info!(
                    target: "prmx-quote",
                    "🔑 Genesis: R pricing API key configured (length: {} bytes)",
                    self.pricing_api_key.len()
                );
            }

            // Store API URL in offchain index
            if !self.pricing_api_url.is_empty() {
                sp_io::offchain_index::set(R_PRICING_API_URL_STORAGE, &self.pricing_api_url);
                log::info!(
                    target: "prmx-quote",
                    "🌐 Genesis: R pricing API URL configured"
                );
            }

            // Register initial quote providers
            for account in &self.quote_providers {
                QuoteProviders::<T>::insert(account, true);
                log::info!(
                    target: "prmx-quote",
                    "🔐 Genesis: Registered quote provider"
                );
            }
        }
    }

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Quote requested. [quote_id, market_id, requester]
        QuoteRequested {
            quote_id: QuoteId,
            market_id: MarketId,
            requester: T::AccountId,
        },
        /// Quote ready (calculated by offchain worker). [quote_id, premium]
        QuoteReady {
            quote_id: QuoteId,
            total_premium: T::Balance,
        },
        /// Quote consumed (used for policy). [quote_id]
        QuoteConsumed {
            quote_id: QuoteId,
        },
        /// Quote expired. [quote_id]
        QuoteExpired {
            quote_id: QuoteId,
        },
        /// Quote provider added
        QuoteProviderAdded {
            account: T::AccountId,
        },
        /// Quote provider removed
        QuoteProviderRemoved {
            account: T::AccountId,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Quote not found.
        QuoteNotFound,
        /// Quote already exists.
        QuoteAlreadyExists,
        /// Quote not ready.
        QuoteNotReady,
        /// Quote already consumed.
        QuoteAlreadyConsumed,
        /// Quote expired.
        QuoteExpired,
        /// Market not found.
        MarketNotFound,
        /// Market not open.
        MarketNotOpen,
        /// Invalid coverage window.
        InvalidCoverageWindow,
        /// Invalid shares (must be > 0).
        InvalidShares,
        /// Unauthorized.
        Unauthorized,
        /// Offchain worker error.
        OffchainWorkerError,
        /// API fetch error.
        ApiFetchError,
        /// Arithmetic overflow.
        ArithmeticOverflow,
        /// Not a quote provider.
        NotQuoteProvider,
        /// V2 quote not allowed for this market/duration.
        V2NotAllowed,
        /// Invalid strike threshold (must be 10-3000, i.e., 1mm-300mm).
        InvalidStrike,
    }

    // =========================================================================
    //                              Validate Unsigned
    // =========================================================================

    #[pallet::validate_unsigned]
    impl<T: Config> ValidateUnsigned for Pallet<T> {
        type Call = Call<T>;

        fn validate_unsigned(_source: TransactionSource, call: &Self::Call) -> TransactionValidity {
            match call {
                Call::submit_quote { quote_id, probability_ppm } => {
                    // Validate that the quote exists and is pending
                    if !QuoteRequests::<T>::contains_key(quote_id) {
                        return InvalidTransaction::Custom(1).into();
                    }

                    if QuoteStatuses::<T>::get(quote_id) != QuoteStatus::Pending {
                        return InvalidTransaction::Custom(2).into();
                    }

                    // Validate probability is reasonable (0-100%)
                    if *probability_ppm > 1_000_000 {
                        return InvalidTransaction::Custom(3).into();
                    }

                    ValidTransaction::with_tag_prefix("prmx-quote")
                        .priority(100)
                        .longevity(5)
                        .and_provides([&(quote_id, probability_ppm)])
                        .propagate(true)
                        .build()
                }
                _ => InvalidTransaction::Call.into(),
            }
        }
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Request a quote for policy coverage.
        /// 
        /// - `market_id`: The market to get coverage from.
        /// - `coverage_start`: Start of coverage window (unix timestamp).
        /// - `coverage_end`: End of coverage window (unix timestamp).
        /// - `latitude`: Latitude scaled by 1e6 (e.g., 12.345678° -> 12_345_678).
        /// - `longitude`: Longitude scaled by 1e6.
        /// - `shares`: Number of shares (1 share = 100 USDT coverage).
        #[pallet::call_index(0)]
        #[pallet::weight(10_000)]
        pub fn request_policy_quote(
            origin: OriginFor<T>,
            market_id: MarketId,
            coverage_start: u64,
            coverage_end: u64,
            latitude: i32,
            longitude: i32,
            shares: u128,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Validate shares
            ensure!(shares > 0, Error::<T>::InvalidShares);

            // Check market is open
            ensure!(
                T::MarketsApi::is_market_open(market_id),
                Error::<T>::MarketNotOpen
            );

            // Get current timestamp
            let now = Self::current_timestamp();

            // Validate coverage window
            T::MarketsApi::validate_coverage_window(
                market_id,
                coverage_start,
                coverage_end,
                now,
            ).map_err(|_| Error::<T>::InvalidCoverageWindow)?;

            // Create quote request (V1 defaults)
            let quote_id = NextQuoteId::<T>::get();
            let quote_request = QuoteRequest::<T> {
                quote_id,
                market_id,
                requester: who.clone(),
                coverage_start,
                coverage_end,
                latitude,
                longitude,
                shares,
                requested_at: now,
                // V1 defaults
                policy_version: prmx_primitives::PolicyVersion::V1,
                event_type: prmx_primitives::EventType::Rainfall24hRolling,
                early_trigger: false,
                duration_days: 0, // Not used for V1
                strike_mm: None,  // V1 uses market's default strike
            };

            // Store quote request
            QuoteRequests::<T>::insert(quote_id, quote_request);
            QuoteStatuses::<T>::insert(quote_id, QuoteStatus::Pending);
            NextQuoteId::<T>::put(quote_id + 1);

            // Add to pending quotes for offchain worker
            PendingQuotes::<T>::mutate(|pending| {
                let _ = pending.try_push(quote_id);
            });

            Self::deposit_event(Event::QuoteRequested {
                quote_id,
                market_id,
                requester: who,
            });

            Ok(())
        }

        /// Submit a quote result (called by offchain worker or authorized provider).
        /// 
        /// - `quote_id`: The quote ID.
        /// - `probability_ppm`: Probability in parts per million (e.g., 5% = 50,000 ppm).
        #[pallet::call_index(1)]
        #[pallet::weight(10_000)]
        pub fn submit_quote(
            origin: OriginFor<T>,
            quote_id: QuoteId,
            probability_ppm: PartsPerMillion,
        ) -> DispatchResult {
            // Allow manual submission for testing (simulate offchain worker)
            let _ = ensure_signed(origin)?;

            Self::do_submit_quote(quote_id, probability_ppm)
        }

        /// Submit a quote result from offchain worker (signed transaction).
        /// Only authorized quote providers can call this.
        #[pallet::call_index(2)]
        #[pallet::weight(10_000)]
        pub fn submit_quote_from_ocw(
            origin: OriginFor<T>,
            quote_id: QuoteId,
            probability_ppm: PartsPerMillion,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Verify signer is an authorized quote provider
            ensure!(
                QuoteProviders::<T>::get(&who),
                Error::<T>::NotQuoteProvider
            );

            log::info!(
                target: "prmx-quote",
                "🤖 OCW signed tx: submitting quote {} with probability {} ppm",
                quote_id,
                probability_ppm
            );

            Self::do_submit_quote(quote_id, probability_ppm)
        }

        /// Store R pricing API key in offchain storage.
        /// Only callable by Root/Sudo.
        #[pallet::call_index(3)]
        #[pallet::weight(10_000)]
        pub fn set_pricing_api_key(
            origin: OriginFor<T>,
            api_key: Vec<u8>,
        ) -> DispatchResult {
            ensure_root(origin)?;

            sp_io::offchain_index::set(R_PRICING_API_KEY_STORAGE, &api_key);

            log::info!(
                target: "prmx-quote",
                "🔑 R pricing API key stored (length: {} bytes)",
                api_key.len()
            );

            Ok(())
        }

        /// Store R pricing API URL in offchain storage.
        /// Only callable by Root/Sudo.
        #[pallet::call_index(4)]
        #[pallet::weight(10_000)]
        pub fn set_pricing_api_url(
            origin: OriginFor<T>,
            api_url: Vec<u8>,
        ) -> DispatchResult {
            ensure_root(origin)?;

            sp_io::offchain_index::set(R_PRICING_API_URL_STORAGE, &api_url);

            log::info!(
                target: "prmx-quote",
                "🌐 R pricing API URL stored"
            );

            Ok(())
        }

        /// Add a quote provider account.
        /// Only callable by Root/Sudo.
        #[pallet::call_index(5)]
        #[pallet::weight(10_000)]
        pub fn add_quote_provider(
            origin: OriginFor<T>,
            account: T::AccountId,
        ) -> DispatchResult {
            ensure_root(origin)?;

            QuoteProviders::<T>::insert(&account, true);

            Self::deposit_event(Event::QuoteProviderAdded { account });

            Ok(())
        }

        /// Remove a quote provider account.
        /// Only callable by Root/Sudo.
        #[pallet::call_index(6)]
        #[pallet::weight(10_000)]
        pub fn remove_quote_provider(
            origin: OriginFor<T>,
            account: T::AccountId,
        ) -> DispatchResult {
            ensure_root(origin)?;

            QuoteProviders::<T>::remove(&account);

            Self::deposit_event(Event::QuoteProviderRemoved { account });

            Ok(())
        }

        /// Request a V2 quote for policy coverage.
        /// 
        /// V2 policies use cumulative rainfall over the coverage window with early trigger.
        /// Currently only Manila market is supported with 2-7 day durations.
        ///
        /// - `market_id`: The market (must be Manila for V2).
        /// - `coverage_start`: Start of coverage window (unix timestamp).
        /// - `coverage_end`: End of coverage window (unix timestamp).
        /// - `latitude`: Latitude scaled by 1e6.
        /// - `longitude`: Longitude scaled by 1e6.
        /// - `shares`: Number of shares (1 share = 100 USDT coverage).
        /// - `duration_days`: Coverage duration in days (2-7 for V2).
        /// - `strike_mm`: Custom strike threshold in mm * 10 (e.g., 500 = 50mm). Range: 10-3000 (1mm-300mm).
        #[pallet::call_index(7)]
        #[pallet::weight(10_000)]
        pub fn request_policy_quote_v2(
            origin: OriginFor<T>,
            market_id: MarketId,
            coverage_start: u64,
            coverage_end: u64,
            latitude: i32,
            longitude: i32,
            shares: u128,
            duration_days: u8,
            strike_mm: u32,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Validate shares
            ensure!(shares > 0, Error::<T>::InvalidShares);

            // Validate strike range: 10-3000 (1mm-300mm when scaled by 10)
            ensure!(strike_mm >= 10 && strike_mm <= 3000, Error::<T>::InvalidStrike);

            // Check market is open
            ensure!(
                T::MarketsApi::is_market_open(market_id),
                Error::<T>::MarketNotOpen
            );

            // V2-specific validation: market must be Manila and duration 2-7 days
            T::MarketsApi::ensure_v2_allowed(market_id, duration_days)
                .map_err(|_| Error::<T>::V2NotAllowed)?;

            // Get current timestamp
            let now = Self::current_timestamp();

            // Validate coverage window
            T::MarketsApi::validate_coverage_window(
                market_id,
                coverage_start,
                coverage_end,
                now,
            ).map_err(|_| Error::<T>::InvalidCoverageWindow)?;

            // Create V2 quote request with custom strike
            let quote_id = NextQuoteId::<T>::get();
            let quote_request = QuoteRequest::<T> {
                quote_id,
                market_id,
                requester: who.clone(),
                coverage_start,
                coverage_end,
                latitude,
                longitude,
                shares,
                requested_at: now,
                // V2 specifics
                policy_version: prmx_primitives::PolicyVersion::V2,
                event_type: prmx_primitives::EventType::CumulativeRainfallWindow,
                early_trigger: true, // V2 default
                duration_days,
                strike_mm: Some(strike_mm), // Custom strike for V2
            };

            // Store quote request
            QuoteRequests::<T>::insert(quote_id, quote_request);
            QuoteStatuses::<T>::insert(quote_id, QuoteStatus::Pending);
            NextQuoteId::<T>::put(quote_id + 1);

            // Add to pending quotes for offchain worker
            PendingQuotes::<T>::mutate(|pending| {
                let _ = pending.try_push(quote_id);
            });

            Self::deposit_event(Event::QuoteRequested {
                quote_id,
                requester: who,
                market_id,
            });

            Ok(())
        }
    }

    // =========================================================================
    //                           Offchain Worker
    // =========================================================================

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        fn offchain_worker(block_number: BlockNumberFor<T>) {
            use sp_runtime::traits::UniqueSaturatedInto;
            let block_num: u32 = block_number.unique_saturated_into();

            // Process pending quotes
            let pending = PendingQuotes::<T>::get();
            
            if pending.is_empty() {
                return;
            }

            log::info!(
                target: "prmx-quote",
                "📊 Offchain worker at block {}: {} pending quotes",
                block_num,
                pending.len()
            );

            // Get API key from offchain storage
            let api_key = match Self::get_pricing_api_key() {
                Some(key) => key,
                None => {
                    log::warn!(
                        target: "prmx-quote",
                        "⚠️ R pricing API key not configured. Skipping quote processing."
                    );
                    return;
                }
            };

            // Get API URL from offchain storage or use default
            let api_url = Self::get_pricing_api_url()
                .unwrap_or_else(|| DEFAULT_R_PRICING_API_URL.as_bytes().to_vec());

            for quote_id in pending.iter() {
                if let Some(req) = QuoteRequests::<T>::get(quote_id) {
                    // Only process pending quotes
                    if QuoteStatuses::<T>::get(quote_id) != QuoteStatus::Pending {
                        continue;
                    }

                    log::info!(
                        target: "prmx-quote",
                        "🔄 Processing quote {} for market {}",
                        quote_id,
                        req.market_id
                    );

                    // Check if market has actuarial model support
                    let probability_result = if Self::has_actuarial_model(req.market_id) {
                        // Call R API for markets with model support (Manila = market_id 0)
                        Self::fetch_probability_from_r_api(&req, &api_key, &api_url)
                    } else {
                        // Use fixed 1% probability for markets without model
                        // 1% = 10,000 ppm (parts per million)
                        // This is a temporary benchmark for Amsterdam, Tokyo, etc.
                        log::info!(
                            target: "prmx-quote",
                            "📊 Using fixed 1% probability for market {} (no actuarial model)",
                            req.market_id
                        );
                        Ok(FIXED_PROBABILITY_PPM)
                    };

                    match probability_result {
                        Ok(probability_ppm) => {
                            log::info!(
                                target: "prmx-quote",
                                "✅ Got probability {} ppm for quote {}",
                                probability_ppm,
                                quote_id
                            );

                            // Submit signed transaction to update on-chain
                            if let Err(e) = Self::submit_quote_signed_tx(*quote_id, probability_ppm) {
                                log::warn!(
                                    target: "prmx-quote",
                                    "❌ Failed to submit quote {}: {}",
                                    quote_id,
                                    e
                                );
                            }
                        }
                        Err(e) => {
                            log::warn!(
                                target: "prmx-quote",
                                "❌ Failed to fetch probability for quote {}: {}",
                                quote_id,
                                e
                            );
                        }
                    }
                }
            }
        }
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Get current timestamp (simplified - in production use pallet-timestamp)
        fn current_timestamp() -> u64 {
            // Get timestamp from pallet_timestamp (returns milliseconds)
            let now_ms: u64 = pallet_timestamp::Pallet::<T>::now()
                .try_into()
                .unwrap_or(0);
            // Convert to seconds
            now_ms / 1000
        }

        /// Check if a market has actuarial model support.
        /// Currently only Manila (market_id = 0) has R model support.
        /// Other markets (Amsterdam = 1, Tokyo = 2) use fixed probability.
        fn has_actuarial_model(market_id: u64) -> bool {
            // Only Manila (market_id = 0) has R actuarial model
            market_id == 0
        }

        /// Internal function to submit quote result
        fn do_submit_quote(quote_id: QuoteId, probability_ppm: PartsPerMillion) -> DispatchResult {
            // Load quote request
            let req = QuoteRequests::<T>::get(quote_id)
                .ok_or(Error::<T>::QuoteNotFound)?;

            // Ensure quote is pending
            ensure!(
                QuoteStatuses::<T>::get(quote_id) == QuoteStatus::Pending,
                Error::<T>::QuoteAlreadyConsumed
            );

            // Get market data
            let dao_margin_bp = T::MarketsApi::dao_margin_bp(req.market_id)
                .map_err(|_| Error::<T>::MarketNotFound)?;
            let payout_per_share = T::MarketsApi::payout_per_share(req.market_id)
                .map_err(|_| Error::<T>::MarketNotFound)?;

            // Calculate premium
            let payout_u128: u128 = payout_per_share.into();
            
            // Fair premium = payout * probability
            let fair_premium_u128 = payout_u128
                .saturating_mul(probability_ppm as u128)
                / 1_000_000u128;

            // Apply DAO margin: premium = fair_premium * (1 + margin)
            // margin_factor = 10000 + dao_margin_bp (in basis points)
            let margin_factor_bp: u128 = 10_000u128 + dao_margin_bp as u128;
            let premium_per_share_u128 = fair_premium_u128
                .saturating_mul(margin_factor_bp)
                / 10_000u128;

            let premium_per_share: T::Balance = premium_per_share_u128.into();
            let total_premium_u128 = premium_per_share_u128.saturating_mul(req.shares);
            let total_premium: T::Balance = total_premium_u128.into();

            // Store quote result
            let now = Self::current_timestamp();
            let quote_result = QuoteResult {
                probability_ppm,
                premium_per_share,
                total_premium,
                calculated_at: now,
            };

            QuoteResults::<T>::insert(quote_id, quote_result);
            QuoteStatuses::<T>::insert(quote_id, QuoteStatus::Ready);

            // Remove from pending quotes
            PendingQuotes::<T>::mutate(|pending| {
                pending.retain(|&id| id != quote_id);
            });

            Self::deposit_event(Event::QuoteReady {
                quote_id,
                total_premium,
            });

            Ok(())
        }

        /// Get R pricing API key from offchain storage or test fallback
        fn get_pricing_api_key() -> Option<Vec<u8>> {
            // Try offchain local storage first
            let storage = sp_io::offchain::local_storage_get(
                sp_core::offchain::StorageKind::PERSISTENT,
                R_PRICING_API_KEY_STORAGE,
            );

            if let Some(key) = storage {
                if !key.is_empty() {
                    return Some(key);
                }
            }

            // Fallback: Use test API key in dev mode
            #[cfg(feature = "dev-mode")]
            {
                log::info!(
                    target: "prmx-quote",
                    "Using test R pricing API key (dev-mode)"
                );
                return Some(TEST_R_PRICING_API_KEY.to_vec());
            }

            #[cfg(not(feature = "dev-mode"))]
            None
        }

        /// Get R pricing API URL from offchain storage or test fallback
        fn get_pricing_api_url() -> Option<Vec<u8>> {
            // Try offchain local storage first
            let storage = sp_io::offchain::local_storage_get(
                sp_core::offchain::StorageKind::PERSISTENT,
                R_PRICING_API_URL_STORAGE,
            );

            if let Some(url) = storage {
                if !url.is_empty() {
                    return Some(url);
                }
            }

            // Fallback: Use test API URL in dev mode
            #[cfg(feature = "dev-mode")]
            {
                log::info!(
                    target: "prmx-quote",
                    "Using test R pricing API URL (dev-mode)"
                );
                return Some(TEST_R_PRICING_API_URL.to_vec());
            }

            #[cfg(not(feature = "dev-mode"))]
            None
        }

        /// Fetch probability from R pricing API
        /// 
        /// API parameters per pricing-model.md:
        /// - lat, lon: Geographic location
        /// - startdate: Coverage start as Unix timestamp
        /// - duration_in_hours: 24 (fixed for v1)
        /// - threshold: Strike value in mm
        /// - coverage: payout_per_share × shares
        /// - number_of_simulations: 100000
        /// - ROC: 0.08
        fn fetch_probability_from_r_api(
            req: &QuoteRequest<T>,
            api_key: &[u8],
            api_url: &[u8],
        ) -> Result<PartsPerMillion, &'static str> {
            // Get market data
            let payout_per_share = T::MarketsApi::payout_per_share(req.market_id)
                .map_err(|_| "Market not found")?;
            
            // Get strike value: use custom strike for V2, market default for V1
            let strike_mm = match req.strike_mm {
                Some(custom_strike) => custom_strike,
                None => T::MarketsApi::strike_value(req.market_id)
                    .map_err(|_| "Market not found")?,
            };

            // Convert lat/lon to floats (stored as scaled by 1e6)
            let lat = req.latitude as f64 / 1_000_000.0;
            let lon = req.longitude as f64 / 1_000_000.0;

            // Calculate coverage amount in whole units (API expects dollars, not micro-dollars)
            // Balance has 6 decimal places, so divide by 1_000_000
            let payout_u128: u128 = payout_per_share.into();
            let coverage_raw = payout_u128.saturating_mul(req.shares);
            let coverage = coverage_raw / 1_000_000; // Convert to whole dollars

            // Convert strike_mm (stored as mm * 10 for oracle) to actual mm
            // The R API expects threshold in mm
            let threshold_mm = strike_mm as f64 / 10.0;

            // Calculate duration in hours from coverage period
            let duration_in_hours = if req.coverage_end > req.coverage_start {
                (req.coverage_end - req.coverage_start) / 3600 // Convert seconds to hours
            } else {
                24 // Default to 24 hours if invalid range
            };

            // Build request URL with query parameters
            // The R API uses GET with query params, not POST with JSON body
            let api_url_str = core::str::from_utf8(api_url)
                .map_err(|_| "Invalid API URL encoding")?;
            let api_key_str = core::str::from_utf8(api_key)
                .map_err(|_| "Invalid API key encoding")?;

            // Build full URL with query parameters
            let full_url = alloc::format!(
                "{}?lat={}&lon={}&startdate={}&duration_in_hours={}&threshold={}&coverage={}&number_of_simulations={}&ROC={}",
                api_url_str,
                lat,
                lon,
                req.coverage_start,
                duration_in_hours,
                threshold_mm,
                coverage,
                DEFAULT_NUMBER_OF_SIMULATIONS,
                DEFAULT_ROC
            );

            log::info!(
                target: "prmx-quote",
                "📤 Calling R API: {}",
                full_url
            );

            // Make HTTP GET request
            let deadline = sp_io::offchain::timestamp().add(Duration::from_millis(30_000));

            let request = http::Request::get(&full_url)
                .add_header("X-API-Key", api_key_str);

            let pending = request
                .deadline(deadline)
                .send()
                .map_err(|_| "Failed to send HTTP request")?;

            let response = pending
                .try_wait(deadline)
                .map_err(|_| "HTTP request timeout")?
                .map_err(|_| "HTTP request failed")?;

            if response.code != 200 {
                log::warn!(
                    target: "prmx-quote",
                    "R API returned status code {}",
                    response.code
                );
                return Err("R API returned error");
            }

            let response_body = response.body().collect::<Vec<u8>>();
            
            log::info!(
                target: "prmx-quote",
                "📥 R API response: {}",
                core::str::from_utf8(&response_body).unwrap_or("invalid utf8")
            );
            
            // Parse response and calculate probability
            // Pass coverage (in whole dollars, same units as sent to API) for probability calculation
            Self::parse_r_api_response(&response_body, coverage)
        }

        /// Parse R API response and calculate probability
        /// 
        /// Expected response format:
        /// {
        ///   "avg_cost": 5.25,
        ///   "recommended_premium": 6.3,
        ///   "closest_point": {...},
        ///   "dist_closest_point_km": 12.5
        /// }
        /// 
        /// Probability calculation per pricing-model.md:
        /// p = avg_cost / coverage
        /// probability_ppm = p * 1_000_000
        fn parse_r_api_response(json: &[u8], coverage: u128) -> Result<PartsPerMillion, &'static str> {
            let json_str = core::str::from_utf8(json)
                .map_err(|_| "Invalid JSON encoding")?;

            log::debug!(
                target: "prmx-quote",
                "📥 R API response: {}",
                json_str
            );

            // Extract avg_cost value from JSON
            // Look for "avg_cost": followed by a number
            let avg_cost = Self::extract_json_number(json_str, "avg_cost")
                .ok_or("Could not find avg_cost in response")?;

            log::info!(
                target: "prmx-quote",
                "📊 avg_cost = {}, coverage = {}",
                avg_cost,
                coverage
            );

            if coverage == 0 {
                return Err("Coverage cannot be zero");
            }

            // Calculate probability: p = avg_cost / coverage
            // Then convert to parts per million
            // Note: avg_cost is in the same units as coverage (e.g., USDT with 6 decimals)
            let probability = avg_cost / (coverage as f64);
            // Manual rounding: add 0.5 and truncate (f64::round not available in no_std)
            let probability_ppm = (probability * 1_000_000.0 + 0.5) as u32;

            // Sanity check: probability should be between 0% and 100%
            if probability_ppm > 1_000_000u32 {
                log::warn!(
                    target: "prmx-quote",
                    "⚠️ Calculated probability {} ppm exceeds 100%, capping at 1,000,000",
                    probability_ppm
                );
                return Ok(1_000_000);
            }

            log::info!(
                target: "prmx-quote",
                "✅ Calculated probability: {}% ({} ppm)",
                probability * 100.0,
                probability_ppm
            );

            Ok(probability_ppm)
        }

        /// Extract a numeric value from JSON by key name
        fn extract_json_number(json: &str, key: &str) -> Option<f64> {
            // Try both regular JSON format ("key":) and escaped format (\"key\":)
            // The R API returns double-encoded JSON: ["{\"avg_cost\":0.902,...}"]
            
            // First try escaped format: \"key\":
            let escaped_pattern = alloc::format!("\\\"{}\\\"", key);
            if let Some(key_start) = json.find(&escaped_pattern) {
                let after_key = &json[key_start + escaped_pattern.len()..];
                if let Some(colon_pos) = after_key.find(':') {
                    let value_part = &after_key[colon_pos + 1..];
                    let value_trimmed = value_part.trim_start();
                    // For escaped JSON, values end at \, or \" or }
                    let end_pos = value_trimmed
                        .find(|c: char| c == ',' || c == '\\' || c == '}' || c == ']')
                        .unwrap_or(value_trimmed.len());
                    let value_str = value_trimmed[..end_pos].trim();
                    if let Ok(val) = value_str.parse::<f64>() {
                        return Some(val);
                    }
                }
            }
            
            // Fallback to regular format: "key":
            let pattern = alloc::format!("\"{}\"", key);
            let key_start = json.find(&pattern)?;
            
            // Find the colon after the key
            let after_key = &json[key_start + pattern.len()..];
            let colon_pos = after_key.find(':')?;
            
            // Get the value part (after the colon)
            let value_part = &after_key[colon_pos + 1..];
            
            // Skip whitespace
            let value_trimmed = value_part.trim_start();
            
            // Find the end of the number (comma, }, or whitespace)
            let end_pos = value_trimmed
                .find(|c: char| c == ',' || c == '}' || c == ']' || c == '\n')
                .unwrap_or(value_trimmed.len());
            
            let value_str = value_trimmed[..end_pos].trim();
            
            value_str.parse::<f64>().ok()
        }

        /// Submit a signed transaction to update on-chain quote result
        fn submit_quote_signed_tx(
            quote_id: QuoteId,
            probability_ppm: PartsPerMillion,
        ) -> Result<(), &'static str> {
            use frame_system::offchain::{SendSignedTransaction, Signer};

            // Get signer from keystore
            let signer = Signer::<T, T::AuthorityId>::all_accounts();

            if !signer.can_sign() {
                log::warn!(
                    target: "prmx-quote",
                    "⚠️ No quote authority keys found in keystore. Cannot submit signed tx."
                );
                return Err("No quote authority keys in keystore");
            }

            // Create the call
            let call = Call::<T>::submit_quote_from_ocw {
                quote_id,
                probability_ppm,
            };

            // Send signed transaction
            let results = signer.send_signed_transaction(|_account| call.clone());

            for (acc, result) in &results {
                match result {
                    Ok(()) => {
                        log::info!(
                            target: "prmx-quote",
                            "✅ Signed tx sent from account {:?} for quote {}",
                            acc.id,
                            quote_id
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!(
                            target: "prmx-quote",
                            "❌ Signed tx from account {:?} failed: {:?}",
                            acc.id,
                            e
                        );
                    }
                }
            }

            Err("All signed transactions failed")
        }

        /// Mark a quote as consumed
        pub fn do_consume_quote(quote_id: QuoteId) -> DispatchResult {
            ensure!(
                QuoteStatuses::<T>::get(quote_id) == QuoteStatus::Ready,
                Error::<T>::QuoteNotReady
            );

            QuoteStatuses::<T>::insert(quote_id, QuoteStatus::Consumed);

            Self::deposit_event(Event::QuoteConsumed { quote_id });

            Ok(())
        }

        /// Check if quote is ready and valid
        pub fn is_quote_ready_and_valid(quote_id: QuoteId) -> bool {
            if QuoteStatuses::<T>::get(quote_id) != QuoteStatus::Ready {
                return false;
            }

            if let Some(result) = QuoteResults::<T>::get(quote_id) {
                let now = Self::current_timestamp();
                let validity = T::QuoteValiditySeconds::get();
                return now <= result.calculated_at.saturating_add(validity);
            }

            false
        }
    }

    // =========================================================================
    //                         QuoteAccess Implementation
    // =========================================================================

    impl<T: Config> QuoteAccess<T::AccountId, T::Balance> for Pallet<T> {
        fn get_quote_request(quote_id: u64) -> Option<QuoteRequestInfo<T::AccountId>> {
            QuoteRequests::<T>::get(quote_id).map(|req| QuoteRequestInfo {
                quote_id: req.quote_id,
                market_id: req.market_id,
                requester: req.requester,
                coverage_start: req.coverage_start,
                coverage_end: req.coverage_end,
                latitude: req.latitude,
                longitude: req.longitude,
                shares: req.shares,
                requested_at: req.requested_at,
                policy_version: req.policy_version,
                event_type: req.event_type,
                early_trigger: req.early_trigger,
                duration_days: req.duration_days,
                strike_mm: req.strike_mm,
            })
        }

        fn get_quote_result(quote_id: u64) -> Option<QuoteResultInfo<T::Balance>> {
            QuoteResults::<T>::get(quote_id).map(|res| QuoteResultInfo {
                probability_ppm: res.probability_ppm,
                premium_per_share: res.premium_per_share,
                total_premium: res.total_premium,
                calculated_at: res.calculated_at,
            })
        }

        fn consume_quote(quote_id: u64) -> Result<(), sp_runtime::DispatchError> {
            Pallet::<T>::do_consume_quote(quote_id)
        }

        fn is_quote_ready(quote_id: u64) -> bool {
            Pallet::<T>::is_quote_ready_and_valid(quote_id)
        }
    }
}
