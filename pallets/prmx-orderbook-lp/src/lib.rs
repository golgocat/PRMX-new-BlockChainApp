//! # PRMX LP Orderbook Pallet
//!
//! This pallet implements an LP Token-only orderbook for trading LP shares.
//!
//! ## Overview
//!
//! - Sellers (including DAO) can place ask orders to sell LP tokens.
//! - Buyers can purchase LP tokens by matching against asks.
//! - Orders are sorted by price (lowest first for asks).
//! - LP Tokens are **policy-specific** - each policy has its own LP token pool.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

use alloc::vec::Vec;
use frame_support::traits::fungibles;
use pallet_prmx_holdings::HoldingsApi;

/// Policy ID type (matches pallet_prmx_policy)
pub type PolicyId = u64;

/// Trait for LP Orderbook API (implemented by this pallet, used by policy pallet)
pub trait LpOrderbookApi<AccountId, Balance> {
    /// Place a DAO LP ask order for a specific policy's LP tokens
    fn place_dao_lp_ask(
        policy_id: PolicyId,
        seller: &AccountId,
        price_per_share: Balance,
        quantity: u128,
    ) -> Result<(), sp_runtime::DispatchError>;
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use frame_support::pallet_prelude::*;
    use frame_support::traits::fungibles::Mutate;
    use frame_support::traits::tokens::Preservation;
    use frame_system::pallet_prelude::*;
    use sp_runtime::traits::Zero;

    // =========================================================================
    //                                  Types
    // =========================================================================

    pub type OrderId = u64;

    /// LP Ask Order structure - now tracks policy_id instead of market_id
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct LpAskOrder<T: Config> {
        pub order_id: OrderId,
        pub policy_id: PolicyId,      // LP tokens are policy-specific
        pub seller: T::AccountId,
        pub price: T::Balance,        // price per LP Token share in USDT units
        pub quantity: u128,           // original quantity
        pub remaining: u128,          // remaining unfilled quantity
        pub created_at: u64,
    }

    // =========================================================================
    //                                  Config
    // =========================================================================

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Balance type
        type Balance: Parameter + Member + From<u128> + Into<u128> + Copy + Default + MaxEncodedLen + Zero + Ord;

        /// Asset ID type
        type AssetId: Parameter + Member + Copy + Default + MaxEncodedLen;

        /// Fungibles implementation for USDT transfers
        type Assets: fungibles::Mutate<Self::AccountId, AssetId = Self::AssetId, Balance = Self::Balance>
            + fungibles::Inspect<Self::AccountId>;

        /// USDT asset ID
        #[pallet::constant]
        type UsdtAssetId: Get<Self::AssetId>;

        /// Access to holdings pallet (now policy-based)
        type HoldingsApi: HoldingsApi<Self::AccountId, Balance = Self::Balance>;

        /// DAO account ID (for DAO asks)
        #[pallet::constant]
        type DaoAccountId: Get<Self::AccountId>;

        /// Maximum orders per price level
        #[pallet::constant]
        type MaxOrdersPerPriceLevel: Get<u32>;

        /// Maximum price levels per policy
        #[pallet::constant]
        type MaxPriceLevels: Get<u32>;

        /// Maximum active orders per user per policy
        #[pallet::constant]
        type MaxOrdersPerUser: Get<u32>;
    }

    // =========================================================================
    //                                  Storage
    // =========================================================================

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    /// Next order ID
    #[pallet::storage]
    #[pallet::getter(fn next_order_id)]
    pub type NextOrderId<T> = StorageValue<_, OrderId, ValueQuery>;

    /// Orders by ID
    #[pallet::storage]
    #[pallet::getter(fn orders)]
    pub type Orders<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        OrderId,
        LpAskOrder<T>,
        OptionQuery,
    >;

    /// Ask book: PolicyId -> Price -> Vec<OrderId>
    /// Orders at each price level, sorted by time (FIFO)
    #[pallet::storage]
    #[pallet::getter(fn ask_book)]
    pub type AskBook<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        PolicyId,
        Blake2_128Concat,
        T::Balance,  // price
        BoundedVec<OrderId, T::MaxOrdersPerPriceLevel>,
        ValueQuery,
    >;

    /// Price levels for a policy (sorted ascending)
    #[pallet::storage]
    #[pallet::getter(fn price_levels)]
    pub type PriceLevels<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        PolicyId,
        BoundedVec<T::Balance, T::MaxPriceLevels>,
        ValueQuery,
    >;

    /// User's active orders per policy
    #[pallet::storage]
    #[pallet::getter(fn user_orders)]
    pub type UserOrders<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        T::AccountId,
        Blake2_128Concat,
        PolicyId,
        BoundedVec<OrderId, T::MaxOrdersPerUser>,
        ValueQuery,
    >;

    // =========================================================================
    //                                  Events
    // =========================================================================

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Ask order placed for policy LP tokens. [order_id, policy_id, seller, price, quantity]
        AskPlaced {
            order_id: OrderId,
            policy_id: PolicyId,
            seller: T::AccountId,
            price: T::Balance,
            quantity: u128,
        },
        /// Ask order cancelled. [order_id, remaining]
        AskCancelled {
            order_id: OrderId,
            remaining: u128,
        },
        /// Trade executed for policy LP tokens. [order_id, policy_id, buyer, seller, price, quantity]
        TradeExecuted {
            order_id: OrderId,
            policy_id: PolicyId,
            buyer: T::AccountId,
            seller: T::AccountId,
            price: T::Balance,
            quantity: u128,
        },
        /// Order fully filled. [order_id]
        OrderFilled {
            order_id: OrderId,
        },
    }

    // =========================================================================
    //                                  Errors
    // =========================================================================

    #[pallet::error]
    pub enum Error<T> {
        /// Order not found.
        OrderNotFound,
        /// Not the order owner.
        NotOrderOwner,
        /// Insufficient LP balance.
        InsufficientLpBalance,
        /// Insufficient USDT balance.
        InsufficientUsdtBalance,
        /// Invalid quantity.
        InvalidQuantity,
        /// Invalid price.
        InvalidPrice,
        /// No matching orders.
        NoMatchingOrders,
        /// Price too high.
        PriceTooHigh,
        /// Arithmetic overflow.
        ArithmeticOverflow,
        /// Transfer failed.
        TransferFailed,
        /// Too many orders at price level.
        TooManyOrdersAtPriceLevel,
    }

    // =========================================================================
    //                                Extrinsics
    // =========================================================================

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Place an ask order to sell LP tokens for a specific policy.
        /// 
        /// - `policy_id`: The policy whose LP tokens to sell.
        /// - `price`: Price per LP share in USDT units.
        /// - `quantity`: Number of LP shares to sell.
        #[pallet::call_index(0)]
        #[pallet::weight(50_000)]
        pub fn place_lp_ask(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            price: T::Balance,
            quantity: u128,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            Self::do_place_lp_ask(policy_id, &who, price, quantity)
        }

        /// Cancel an ask order.
        /// 
        /// - `order_id`: The order to cancel.
        #[pallet::call_index(1)]
        #[pallet::weight(30_000)]
        pub fn cancel_lp_ask(
            origin: OriginFor<T>,
            order_id: OrderId,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            // Load order
            let order = Orders::<T>::get(order_id)
                .ok_or(Error::<T>::OrderNotFound)?;

            // Verify ownership
            ensure!(order.seller == who, Error::<T>::NotOrderOwner);

            // Unlock LP tokens (policy-specific)
            T::HoldingsApi::unlock_lp_tokens(order.policy_id, &who, order.remaining)
                .map_err(|_| Error::<T>::TransferFailed)?;

            // Remove from ask book
            Self::remove_from_ask_book(order.policy_id, order.price, order_id)?;

            // Remove from user orders
            UserOrders::<T>::mutate(&who, order.policy_id, |orders| {
                orders.retain(|&id| id != order_id);
            });

            // Remove order
            Orders::<T>::remove(order_id);

            Self::deposit_event(Event::AskCancelled {
                order_id,
                remaining: order.remaining,
            });

            Ok(())
        }

        /// Buy LP tokens from the orderbook for a specific policy.
        /// 
        /// - `policy_id`: The policy whose LP tokens to buy.
        /// - `max_price`: Maximum price willing to pay per share.
        /// - `quantity`: Number of LP shares to buy.
        #[pallet::call_index(2)]
        #[pallet::weight(100_000)]
        pub fn buy_lp(
            origin: OriginFor<T>,
            policy_id: PolicyId,
            max_price: T::Balance,
            quantity: u128,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            ensure!(quantity > 0, Error::<T>::InvalidQuantity);

            // Get price levels for this policy
            let price_levels = PriceLevels::<T>::get(policy_id);
            
            let mut remaining_to_buy = quantity;
            let mut total_cost_u128: u128 = 0;

            // Iterate through price levels from lowest to highest
            for price in price_levels.iter() {
                if *price > max_price {
                    break; // Price too high
                }

                if remaining_to_buy == 0 {
                    break;
                }

                // Get orders at this price level
                let order_ids = AskBook::<T>::get(policy_id, price);

                for order_id in order_ids.iter() {
                    if remaining_to_buy == 0 {
                        break;
                    }

                    if let Some(mut order) = Orders::<T>::get(order_id) {
                        let fill_qty = core::cmp::min(remaining_to_buy, order.remaining);
                        
                        if fill_qty > 0 {
                            // Calculate cost
                            let price_u128: u128 = (*price).into();
                            let cost_u128 = price_u128
                                .checked_mul(fill_qty)
                                .ok_or(Error::<T>::ArithmeticOverflow)?;
                            let cost: T::Balance = cost_u128.into();

                            // Transfer USDT from buyer to seller
                            T::Assets::transfer(
                                T::UsdtAssetId::get(),
                                &who,
                                &order.seller,
                                cost,
                                Preservation::Preserve,
                            )?;

                            // Transfer locked LP tokens from seller to buyer (policy-specific)
                            T::HoldingsApi::transfer_locked_lp_tokens(
                                policy_id,
                                &order.seller,
                                &who,
                                fill_qty,
                            ).map_err(|_| Error::<T>::TransferFailed)?;

                            // Register buyer as LP holder for this policy
                            T::HoldingsApi::register_lp_holder(policy_id, &who)
                                .map_err(|_| Error::<T>::TransferFailed)?;

                            // Update order
                            order.remaining = order.remaining.saturating_sub(fill_qty);
                            remaining_to_buy = remaining_to_buy.saturating_sub(fill_qty);
                            total_cost_u128 = total_cost_u128.saturating_add(cost_u128);

                            Self::deposit_event(Event::TradeExecuted {
                                order_id: *order_id,
                                policy_id,
                                buyer: who.clone(),
                                seller: order.seller.clone(),
                                price: *price,
                                quantity: fill_qty,
                            });

                            if order.remaining == 0 {
                                // Order fully filled - remove it
                                Self::remove_from_ask_book(policy_id, *price, *order_id)?;
                                UserOrders::<T>::mutate(&order.seller, policy_id, |orders| {
                                    orders.retain(|&id| id != *order_id);
                                });
                                Orders::<T>::remove(order_id);

                                Self::deposit_event(Event::OrderFilled {
                                    order_id: *order_id,
                                });
                            } else {
                                // Update order with new remaining
                                Orders::<T>::insert(order_id, order);
                            }
                        }
                    }
                }
            }

            // Check if we filled anything
            let filled = quantity.saturating_sub(remaining_to_buy);
            ensure!(filled > 0, Error::<T>::NoMatchingOrders);

            Ok(())
        }
    }

    // =========================================================================
    //                           Helper Functions
    // =========================================================================

    impl<T: Config> Pallet<T> {
        /// Internal function to place an LP ask order for a policy
        pub fn do_place_lp_ask(
            policy_id: PolicyId,
            seller: &T::AccountId,
            price: T::Balance,
            quantity: u128,
        ) -> DispatchResult {
            ensure!(quantity > 0, Error::<T>::InvalidQuantity);
            ensure!(price > T::Balance::zero(), Error::<T>::InvalidPrice);

            // Check seller has enough LP tokens for this policy
            let available = T::HoldingsApi::lp_balance(policy_id, seller);
            ensure!(available >= quantity, Error::<T>::InsufficientLpBalance);

            // Lock LP tokens (policy-specific)
            T::HoldingsApi::lock_lp_tokens(policy_id, seller, quantity)
                .map_err(|_| Error::<T>::InsufficientLpBalance)?;

            // Create order
            let order_id = NextOrderId::<T>::get();
            let now = Self::current_timestamp();
            
            let order = LpAskOrder::<T> {
                order_id,
                policy_id,
                seller: seller.clone(),
                price,
                quantity,
                remaining: quantity,
                created_at: now,
            };

            // Store order
            Orders::<T>::insert(order_id, order);
            NextOrderId::<T>::put(order_id + 1);

            // Add to ask book (keyed by policy_id)
            Self::add_to_ask_book(policy_id, price, order_id)?;

            // Add to user orders
            UserOrders::<T>::try_mutate(seller, policy_id, |orders| -> DispatchResult {
                orders.try_push(order_id).map_err(|_| Error::<T>::TooManyOrdersAtPriceLevel)?;
                Ok(())
            })?;

            Self::deposit_event(Event::AskPlaced {
                order_id,
                policy_id,
                seller: seller.clone(),
                price,
                quantity,
            });

            Ok(())
        }

        /// Add order to ask book at price level
        fn add_to_ask_book(
            policy_id: PolicyId,
            price: T::Balance,
            order_id: OrderId,
        ) -> DispatchResult {
            // Add to price level
            AskBook::<T>::try_mutate(policy_id, price, |orders| {
                orders.try_push(order_id)
                    .map_err(|_| Error::<T>::TooManyOrdersAtPriceLevel)
            })?;

            // Update price levels (maintain sorted order)
            PriceLevels::<T>::try_mutate(policy_id, |levels| -> DispatchResult {
                if !levels.contains(&price) {
                    if levels.len() >= T::MaxPriceLevels::get() as usize {
                        return Err(Error::<T>::TooManyOrdersAtPriceLevel.into());
                    }
                    let pos = levels.iter().position(|&p| p > price).unwrap_or(levels.len());
                    levels.try_insert(pos, price).map_err(|_| Error::<T>::TooManyOrdersAtPriceLevel)?;
                }
                Ok(())
            })?;

            Ok(())
        }

        /// Remove order from ask book
        fn remove_from_ask_book(
            policy_id: PolicyId,
            price: T::Balance,
            order_id: OrderId,
        ) -> DispatchResult {
            // Remove from price level
            AskBook::<T>::mutate(policy_id, price, |orders| {
                orders.retain(|&id| id != order_id);
            });

            // If price level is empty, remove it
            let orders_at_price = AskBook::<T>::get(policy_id, price);
            if orders_at_price.is_empty() {
                AskBook::<T>::remove(policy_id, price);
                PriceLevels::<T>::mutate(policy_id, |levels| {
                    levels.retain(|&p| p != price);
                });
            }

            Ok(())
        }

        /// Get current timestamp
        fn current_timestamp() -> u64 {
            let block_number: u64 = frame_system::Pallet::<T>::block_number()
                .try_into()
                .unwrap_or(0);
            block_number * 6 // Assume 6 second blocks
        }

        /// Get best ask price for a policy
        pub fn best_ask_price(policy_id: PolicyId) -> Option<T::Balance> {
            let levels = PriceLevels::<T>::get(policy_id);
            levels.first().cloned()
        }

        /// Get all asks for a policy
        pub fn get_asks_for_policy(policy_id: PolicyId) -> Vec<(T::Balance, Vec<OrderId>)> {
            let levels = PriceLevels::<T>::get(policy_id);
            levels
                .iter()
                .map(|price| (*price, AskBook::<T>::get(policy_id, price).to_vec()))
                .collect()
        }
    }
}

// =============================================================================
//                      LpOrderbookApi Implementation
// =============================================================================

impl<T: Config> LpOrderbookApi<T::AccountId, <T as Config>::Balance> for Pallet<T> {
    fn place_dao_lp_ask(
        policy_id: PolicyId,
        seller: &T::AccountId,
        price_per_share: <T as Config>::Balance,
        quantity: u128,
    ) -> Result<(), sp_runtime::DispatchError> {
        Pallet::<T>::do_place_lp_ask(policy_id, seller, price_per_share, quantity)
    }
}
