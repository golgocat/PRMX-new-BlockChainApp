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

use alloc::string::String;
use alloc::vec::Vec;

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
    pub trait Config: frame_system::Config + pallet_timestamp::Config {
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

            // Create quote request
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

        /// Submit a quote result (called by offchain worker as unsigned transaction).
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
    }

    // =========================================================================
    //                           Offchain Worker
    // =========================================================================

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        fn offchain_worker(_block_number: BlockNumberFor<T>) {
            // Process pending quotes (Logging Only)
            let pending = PendingQuotes::<T>::get();
            
            for quote_id in pending.iter() {
                if QuoteRequests::<T>::contains_key(quote_id) {
                    log::info!(
                        target: "prmx-quote",
                        "Pending quote {} ready for probability fetch (Simulate via submit_quote)",
                        quote_id
                    );
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

        /// Fetch probability from external API
        #[cfg(feature = "std")]
        fn fetch_probability(req: &QuoteRequest<T>) -> Result<PartsPerMillion, &'static str> {
            // Convert lat/lon to floats
            let lat = req.latitude as f64 / 1_000_000.0;
            let lon = req.longitude as f64 / 1_000_000.0;

            // Build request body
            let body = alloc::format!(
                r#"{{"lat":{},"lon":{},"start":{},"end":{}}}"#,
                lat, lon, req.coverage_start, req.coverage_end
            );

            let api_url = T::ProbabilityApiUrl::get();
            
            // For development, use mock API that returns 5%
            if api_url.contains("mock") || api_url.is_empty() {
                return Ok(50_000); // 5% = 50,000 ppm
            }

            // Make HTTP request
            let deadline = sp_io::offchain::timestamp().add(Duration::from_millis(5000));
            
            let request = http::Request::post(api_url, alloc::vec![body.as_bytes().to_vec()])
                .add_header("Content-Type", "application/json");

            let pending = request
                .deadline(deadline)
                .send()
                .map_err(|_| "Failed to send request")?;

            let response = pending
                .try_wait(deadline)
                .map_err(|_| "Request timeout")?
                .map_err(|_| "Request failed")?;

            if response.code != 200 {
                return Err("API returned error");
            }

            let body_bytes = response.body().collect::<Vec<u8>>();
            
            // Parse JSON response: { "probability": 0.05 }
            // Simple parsing without full JSON library in no_std
            let body_str = core::str::from_utf8(&body_bytes)
                .map_err(|_| "Invalid UTF-8")?;
            
            // Extract probability value (simplified parsing)
            if let Some(start) = body_str.find("probability") {
                if let Some(colon) = body_str[start..].find(':') {
                    let value_start = start + colon + 1;
                    let value_str = body_str[value_start..]
                        .trim()
                        .trim_start_matches(|c: char| c == '"' || c.is_whitespace())
                        .split(|c: char| c == ',' || c == '}' || c == '"')
                        .next()
                        .ok_or("Missing probability value")?;
                    
                    let probability: f64 = value_str
                        .trim()
                        .parse()
                        .map_err(|_| "Invalid probability format")?;
                    
                    // Convert to parts per million
                    let ppm = (probability * 1_000_000.0).round() as u32;
                    return Ok(ppm);
                }
            }

            Err("Failed to parse probability")
        }

        /// Fetch probability (no_std version - always returns mock)
        #[cfg(not(feature = "std"))]
        fn fetch_probability(_req: &QuoteRequest<T>) -> Result<PartsPerMillion, &'static str> {
            // In no_std environment, return mock probability (5%)
            Ok(50_000)
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
