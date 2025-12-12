# PRMX Chain – Parametric Rainfall Insurance Appchain

> This document is the **single source of truth** for AI coding assistants (Cursor, Antigravity, etc.) when generating code for the PRMX chain.

PRMX is a Substrate-based blockchain that provides **rainfall parametric insurance** with:

- **v1: Fixed 24-hour coverage window** (1 day per policy for testing)
- Pricing from an external R-based probability model (HTTP API)
- Per-policy fully funded capital pools (max payout locked on-chain)
- Risk-bearing LP tokens tradable via an LP-only orderbook
- Non-tradable coverage (Policy Token side) represented by policies
- Market-level geospatial targeting (center latitude / longitude per market)
- AccuWeather-based rainfall oracle bound per market
- XCM-based capital management (Hydration Pool 102 integration prepared)
- Gasless UX on core insurance flows
- Governance via a native PRMX token

**Reference Polkadot SDK version:**

- https://github.com/paritytech/polkadot-sdk/tree/polkadot-stable2506-2

**If code and this app-design.md ever disagree, this document wins.**

---

## 1. Polkadot SDK Baseline

**Current Deployment Mode: Standalone Dev Chain**

The runtime currently runs as a **standalone dev chain** with:
- Aura + Grandpa consensus (not parachain consensus)
- No cumulus/parachain pallets in the runtime
- XCM logic preserved in `pallet_prmx_xcm_capital` for future parachain deployment

**Future Parachain Migration Checklist:**

When ready to deploy as a Polkadot parachain via Tanssi:

1. Re-add cumulus dependencies to `runtime/Cargo.toml`
2. Re-create `runtime/src/xcm_config.rs` with XCM executor configuration
3. Add cumulus pallets back to `construct_runtime!`:
   - `cumulus_pallet_parachain_system`
   - `parachain_info`
   - `pallet_message_queue`
   - `pallet_xcm`
   - `cumulus_pallet_xcm`
   - `cumulus_pallet_xcmp_queue`
4. Switch strategy in runtime config:
   ```rust
   type XcmStrategyInterface = pallet_prmx_xcm_capital::LiveXcmStrategyInterface<Runtime>;
   ```
5. Configure HRMP channels with Asset Hub (para 1000) and Hydration (para 2034)
6. Fund sovereign accounts for XCM execution

**Assumptions:**

- Runtime uses FRAME v2 macros
- Node follows standard polkadot-sdk structure
  - Service, chain spec, CLI etc. from the reference repo
- PRMX pallets are integrated into a custom runtime

**Core pallets in this design:**

| Pallet | Purpose |
|--------|---------|
| `pallet_prmx_markets` | Market definitions and parameters |
| `pallet_prmx_policy` | Policies (Policy Token side) and per-policy capital pools |
| `pallet_prmx_holdings` | LP token holdings per policy |
| `pallet_prmx_orderbook_lp` | LP-only orderbook |
| `pallet_prmx_oracle` | AccuWeather-based rainfall data and 24h rolling sums |
| `pallet_prmx_quote` | Pricing via external R model and offchain worker |
| `pallet_prmx_xcm_capital` | XCM-based capital management with Hydration Pool 102 |

---

## 2. High-Level Architecture and Flow

### Key Flows

1. **DAO creates a market** (e.g., Manila)
   - Sets name, center latitude/longitude, strike, window rules, DAO margin, payout per share

2. **Oracle offchain worker resolves AccuWeather location** for that market
   - Geoposition search using center coordinates
   - Binds the AccuWeather Location Key to the market

3. **User requests a quote** for a policy
   - Chooses market (e.g., Manila), coverage window, and number of shares
   - Offchain worker calls R pricing API using the market's center coordinates
   - Stores quote result on-chain

4. **User applies coverage** using the quote
   - Policy is created (bound to market, with per-policy lat/lon for reference)
   - User premium plus DAO capital are locked in a per-policy pool
   - DAO receives LP tokens for this specific policy
   - A DAO LP ask is auto-listed on the orderbook

5. **Liquidity providers buy LP tokens** on the LP-only orderbook
   - They absorb risk in exchange for premium-based yield
   - LP tokens are policy-specific (isolated risk exposure)

6. **During and after coverage**
   - Oracle offchain worker periodically ingests AccuWeather rainfall data by market
   - Rainfall is aggregated into hourly buckets and 24h rolling sums

7. **Settlement**
   - At or after coverage end, anyone can call a settlement extrinsic
   - Oracle checks whether 24h rainfall exceeded the strike at any time during the coverage window
   - If yes → Policy Token side wins, policy holder gets max payout
   - If no → LP side wins, pooled capital is automatically distributed pro-rata to LP holders
   - LP tokens are burned after settlement

8. **LP Token Cleanup**
   - After settlement, all LP tokens for the policy are burned
   - Storage is cleared (no orphaned tokens)
   - Clear separation between active and settled policies

---

## 3. Tokens and Assets

### 3.1 Native Token: PRMX

- Implemented via `pallet_balances`
- Alias:

  ```rust
  pub type Balance = u128;
  ```

- **Uses:**
  - Transaction fees (if enabled)
  - Governance voting in future versions

- **Genesis:**
  - 100% of PRMX to a DAO admin account

### 3.2 USDT as Insurance Currency

All monetary flows in the insurance logic use USDT:

- Premium payments
- DAO capital contributions
- Policy payouts
- LP trading and LP distributions

**Implementation:**

- Use `pallet_assets` or a fungibles-compatible pallet

**Config example:**

```rust
pub type AssetId = u32;

pub trait Config: frame_system::Config {
    type Assets: fungibles::Mutate<Self::AccountId>
        + fungibles::Inspect<Self::AccountId>;
    type UsdtAssetId: Get<AssetId>; // e.g., 1
}
```

**Decimals:**

- 6 decimals assumed
- `1 USDT = 1_000_000 units`

---

## 4. Core Concepts: Markets, Policies, Policy Token, LP Token

### 4.1 Market

A market is a template defined by the DAO. Examples:

- Manila 7-day rainfall cover above X mm
- Cebu 3-day rainfall cover above Y mm

**Markets define:**

- A logical identifier `MarketId`
- A human name (e.g., "Manila")
- A center latitude and longitude (approximate) for that region
- Strike rainfall threshold (mm)
- Payout per share
- Window rules (min and max duration, lead time)
- DAO margin parameters
- Bound AccuWeather location information (resolved later by oracle)

> **Customers do not pass coordinates. They simply choose a market.**

### 4.2 Policy (Policy Token Side)

A policy is a concrete coverage under a market:

- Bound to `market_id`
- Has a coverage window
- Has a number of shares
- Has a policy holder
- Is backed by a per-policy capital pool equal to the maximum payout
- Stores reference latitude/longitude (from quote request)

**Policy Token side is not tokenized.** The policy itself represents coverage.

### 4.3 LP Side and LP Token

LP (Liquidity Provider) tokens represent the risk-bearing side of a **specific policy**:

- **Policy-specific** (not market-level fungible)
- Initially minted to DAO at policy issuance
- Sold to LPs via the LP-only orderbook
- Represents exposure to that specific policy's risk pool
- LP holders receive automatic pro-rata distribution at settlement if no event occurs

> **Key Design Decision:** LP tokens are policy-specific to ensure:
> - Each policy has isolated risk exposure
> - LP holders only receive payouts from policies they invested in
> - Different policies can have different LP token distributions

### 4.4 Per-Policy Capital Pool

Each policy has its own capital pool:

- **Total pool** = max payout for that policy
- **Funded by:**
  - User premium
  - DAO capital contribution
- This pool is locked on-chain from issuance until policy settlement

**Capital routes:**

| Outcome | Action |
|---------|--------|
| Event occurs | Pool is paid to the policy holder (Policy Token side) |
| Event does not occur | Pool is automatically distributed pro-rata to LP holders |

### 4.5 Automatic LP Distribution (No Residual Pool)

Unlike traditional market-level residual pools, PRMX uses **automatic per-policy distribution**:

- When a policy settles with no event, the pool is immediately distributed to LP holders
- Distribution is pro-rata based on LP token holdings
- No claim function needed - payouts happen automatically
- LP tokens are burned after distribution

---

## 5. Markets in Detail

### Basic Type Aliases

```rust
pub type MarketId = u64;
pub type BasisPoints = u32;        // 1 bp = 0.01%
pub type PartsPerMillion = u32;    // 1 ppm = 0.0001%
pub type LocationId = MarketId;    // market_id is also location_id for oracle
pub type PolicyId = u64;
```

### 5.1 Risk Parameters

```rust
pub struct RiskParameters {
    /// DAO margin over fair premium (expected loss), in basis points.
    /// Example: 20% margin -> 2000 bp
    pub dao_margin_bp: BasisPoints,
}
```

### 5.2 Coverage Window Rules

All policies within a market must obey:

```rust
pub struct WindowRules {
    pub min_duration_secs: u32,    // e.g., 1 day = 86_400
    pub max_duration_secs: u32,    // e.g., 7 days = 604_800
    pub min_lead_time_secs: u32,   // e.g., 3 weeks = 1_814_400
}
```

**v1 Configuration (Fixed 24-hour coverage):**

For v1, coverage duration is fixed to **1 day (24 hours)** to align with the R actuarial model and oracle event definitions. See `pricing-model.md` for details.

| Parameter | v1 Value | Notes |
|-----------|----------|-------|
| `min_duration_secs` | 86,400 (1 day) | Fixed for v1 |
| `max_duration_secs` | 86,400 (1 day) | Fixed for v1 (same as min) |
| `min_lead_time_secs` | 0 (for testing) | Production: 1,814,400 (21 days) |

**Frontend enforces 1-day duration** - users cannot select different durations in v1.

**v2 will extend to 1-7 days** once the R model and oracle support variable-length windows.

### 5.3 Payout Per Share

Global constant in USDT units:

```rust
const USDT_DECIMALS: u32 = 6;
const PAYOUT_PER_SHARE_USDT: u128 = 100;
const PAYOUT_PER_SHARE: u128 =
    PAYOUT_PER_SHARE_USDT * 10u128.pow(USDT_DECIMALS);
// = 100_000_000 units (100 USDT)
```

### 5.4 Market Geospatial and Oracle Binding

**Market geospatial fields:**

```rust
pub struct MarketInfo<Balance, AssetId> {
    pub market_id: MarketId,

    pub name: BoundedVec<u8, ConstU32<64>>,  // e.g., b"Manila"

    pub center_latitude: i32,     // scaled by 1e6
    pub center_longitude: i32,    // scaled by 1e6

    // AccuWeather binding is resolved by oracle and stored separately,
    // but can optionally be mirrored here as an Option<Vec<u8>>.

    pub event_type: EventType,
    pub strike_value: u32,        // rainfall threshold in mm
    pub payout_per_share: Balance,
    pub base_asset: AssetId,
    pub status: MarketStatus,

    pub risk: RiskParameters,
    pub window_rules: WindowRules,
}
```

**Event and status enums:**

```rust
pub enum EventType {
    Rainfall24h,
}

pub enum MarketStatus {
    Open,
    Closed,
    Settled,
}
```

**Storage:**

```rust
Markets: map MarketId -> MarketInfo;
NextMarketId: MarketId;
```

**DAO-only extrinsics:**

- `dao_create_market(name, center_latitude, center_longitude, strike_value, window_rules, risk_parameters, ...)`
- `dao_set_window_rules(market_id, window_rules)`
- `dao_set_risk_parameters(market_id, risk_parameters)`
- `dao_close_market(market_id)` (when ready to finalize)

> When a market is created, the oracle offchain worker will use `center_latitude` and `center_longitude` to resolve an AccuWeather Location Key and bind it to this market.

---

## 6. Policies (Policy Token Side)

### 6.1 PolicyInfo

Policies are attached to markets and store reference coordinates.

```rust
pub type PolicyId = u64;

pub enum PolicyStatus {
    Active,
    Expired,
    Settled,
    Cancelled,
}

pub struct PolicyInfo<T: Config> {
    pub policy_id: PolicyId,
    pub market_id: MarketId,
    pub holder: T::AccountId,
    pub coverage_start: u64,      // unix seconds
    pub coverage_end: u64,        // unix seconds
    pub shares: u128,             // 1 share = 100 USDT coverage
    pub latitude: i32,            // scaled by 1e6 (from quote request)
    pub longitude: i32,           // scaled by 1e6 (from quote request)
    pub status: PolicyStatus,
    pub premium_paid: T::Balance, // actual premium paid
    pub max_payout: T::Balance,   // maximum payout amount
}
```

### 6.2 SettlementResult

When a policy is settled, the outcome is stored for transparency and auditing:

```rust
pub struct SettlementResult<T: Config> {
    pub event_occurred: bool,           // whether the rainfall event triggered
    pub payout_to_holder: T::Balance,   // amount paid to policyholder (if event)
    pub returned_to_lps: T::Balance,    // amount distributed to LP holders (if no event)
    pub settled_at: u64,                // unix timestamp of settlement
}
```

**Storage in `pallet_prmx_policy`:**

```rust
Policies: map PolicyId -> PolicyInfo;
PoliciesByMarket: map MarketId -> BoundedVec<PolicyId>; // index
NextPolicyId: PolicyId;
PolicyRiskPoolBalance: map PolicyId -> Balance;
SettlementResults: map PolicyId -> SettlementResult;   // settlement outcome storage
```

---

## 7. Capital and LP Structure

### 7.1 LP Holdings Per Policy

LP tokens are tracked per policy, not per market:

```rust
pub struct Holdings {
    pub lp_shares: u128,      // free LP shares
    pub locked_shares: u128,  // locked for orderbook
}

HoldingsStorage: double_map (PolicyId, AccountId) -> Holdings;
TotalLpShares: map PolicyId -> u128;
LpHolders: map PolicyId -> BoundedVec<AccountId>;  // for distribution
IsLpHolder: double_map (PolicyId, AccountId) -> bool;  // quick lookup
```

**DAO account:**

```rust
DaoAccountId: Config::AccountId;
```

At policy issuance, DAO initially receives LP tokens for that policy:

```rust
HoldingsStorage[policy_id][DaoAccountId].lp_shares += shares;
TotalLpShares[policy_id] += shares;
LpHolders[policy_id].push(DaoAccountId);
```

### 7.2 Per-Policy Capital Pool

```rust
PolicyRiskPoolBalance: map PolicyId -> Balance;
```

For a policy:

```rust
let max_payout = shares * PAYOUT_PER_SHARE;
```

At policy issuance, user premium and DAO capital are transferred so that:

```rust
PolicyRiskPoolBalance[policy_id] = max_payout;
```

The actual funds are held in a derived account for that policy:

```rust
fn policy_pool_account(policy_id: PolicyId) -> AccountId;
```

---

## 8. Coverage Window Validation

Helper for reuse by quote and policy pallets:

```rust
fn validate_coverage_window(
    market: &MarketInfo,
    coverage_start: u64,
    coverage_end: u64,
    now: u64,
) -> Result<(), Error> {
    ensure!(coverage_start < coverage_end, Error::InvalidCoverageWindow);

    let rules = &market.window_rules;
    let duration = coverage_end - coverage_start;

    ensure!(duration as u32 >= rules.min_duration_secs, Error::CoverageTooShort);
    ensure!(duration as u32 <= rules.max_duration_secs, Error::CoverageTooLong);

    let lead_time = coverage_start.saturating_sub(now);
    ensure!((lead_time as u32) >= rules.min_lead_time_secs, Error::TooLateToApply);

    Ok(())
}
```

**Assumptions:**

- `coverage_end` lies in the future when policies are created
- **v1: Coverage length is fixed to 1 day (24 hours)**
- v2 will extend to [1 day, 7 days]
- Coverage applications must be at least 21 days before `coverage_start` (DAO configurable, relaxed to 0 for testing)

---

## 9. Pricing via R Model (`pallet_prmx_quote`)

Pricing is done by an external R-based model exposed through a HTTP API.

The R model expects:

- A location (lat/lon)
- Coverage window dates
- Possibly parameters such as number of days or shares

> In PRMX, the location for pricing is the **market center coordinates**, not per-policy coordinates.

### 9.1 External API

Runtime constant for the API endpoint:

```rust
pub trait Config: frame_system::Config {
    type ProbabilityApiUrl: Get<&'static str>;
}
```

**Request JSON example:**

```json
{
  "lat": 14.5995,
  "lon": 120.9842,
  "start": 1735776000,
  "end": 1736380800
}
```

**Response:**

```json
{
  "probability": 0.05
}
```

`probability` is the event probability for that coverage window.

### 9.2 QuoteRequest and QuoteResult

```rust
pub type QuoteId = u64;

pub struct QuoteRequest<AccountId> {
    pub quote_id: QuoteId,
    pub market_id: MarketId,
    pub requester: AccountId,
    pub coverage_start: u64,
    pub coverage_end: u64,
    pub shares: u128,
    pub latitude: i32,      // scaled by 1e6 (from user request)
    pub longitude: i32,     // scaled by 1e6 (from user request)
    pub requested_at: u64,
}

pub struct QuoteResult<Balance> {
    pub probability_ppm: PartsPerMillion,
    pub premium_per_share: Balance,
    pub total_premium: Balance,
    pub calculated_at: u64,
}
```

**Storage:**

```rust
NextQuoteId: QuoteId;
QuoteRequests: map QuoteId -> QuoteRequest;
QuoteResults: map QuoteId -> QuoteResult;
```

### 9.3 MarketsAccess Trait for Quote Pallet

The quote pallet must know:

- DAO margin in basis points
- Payout per share in base asset
- Market center coordinates for calling the R model
- Strike value for the market

```rust
pub trait MarketsAccess {
    type Balance;

    fn dao_margin_bp(market_id: MarketId) -> Result<u32, ()>;
    fn payout_per_share(market_id: MarketId) -> Result<Self::Balance, ()>;
    fn center_coordinates(market_id: MarketId) -> Result<(i32, i32), ()>;
    fn strike_value(market_id: MarketId) -> Result<u32, ()>;
}
```

**Config:**

```rust
pub trait Config: frame_system::Config {
    type Balance: Parameter + From<u128> + Into<u128> + Copy + Zero;
    type MarketsApi: MarketsAccess<Balance = Self::Balance>;
    type ProbabilityApiUrl: Get<&'static str>;
}
```

### 9.4 `request_policy_quote`

**Extrinsic:**

```rust
fn request_policy_quote(
    origin,
    market_id,
    coverage_start,
    coverage_end,
    latitude,      // user-specified location
    longitude,     // user-specified location
    shares,
)
```

**Steps:**

1. Ensure signed origin
2. Load `MarketInfo` via `MarketsApi`
3. Validate market status is `Open`
4. Validate coverage window via `validate_coverage_window`
5. Create `QuoteRequest` and store it (including lat/lon)
6. Emit `QuoteRequested` event

**The offchain worker:**

- For each pending `QuoteRequest`:
  - Uses `MarketsApi::center_coordinates(market_id)` to get lat and lon
  - Calls the R pricing API with those coordinates and window
  - Receives event probability
  - Submits unsigned or signed extrinsic `submit_quote(quote_id, probability_ppm)`

### 9.5 `submit_quote`

**Unsigned extrinsic logic:**

1. `ensure_none(origin)` or custom validation via `validate_unsigned`
2. Load `QuoteRequest`
3. Fetch `dao_margin_bp` and `payout_per_share`
4. Compute:

   ```rust
   let payout_u128: u128 = payout_per_share.into();
   let fair_premium_u128 =
       payout_u128.saturating_mul(probability_ppm as u128) / 1_000_000u128;

   let margin_factor_bp: u128 = 10_000u128 + dao_margin_bp as u128;
   let premium_per_share_u128 =
       fair_premium_u128.saturating_mul(margin_factor_bp) / 10_000u128;

   let premium_per_share: Balance = premium_per_share_u128.into();
   let total_premium_u128 =
       premium_per_share_u128.saturating_mul(req.shares);
   let total_premium: Balance = total_premium_u128.into();
   ```

5. Store `QuoteResult`
6. Emit `QuoteReady` event

> **Note:** Validation of unsigned transactions must guard against spam or replay.

---

## 10. Policy Issuance, Capital Lock, DAO Auto Ask

`pallet_prmx_policy` depends on:

- Assets pallet for USDT transfers
- Markets pallet for risk and payout parameters
- Quote pallet for quote data
- Orderbook pallet via a trait

### 10.1 LpOrderbookApi Trait

```rust
pub trait LpOrderbookApi<AccountId, Balance> {
    fn place_dao_lp_ask(
        policy_id: PolicyId,
        seller: &AccountId,
        price_per_share: Balance,
        quantity: u128,
    ) -> Result<(), DispatchError>;
}
```

### 10.2 HoldingsApi Trait

```rust
pub trait HoldingsApi<AccountId> {
    type Balance;

    fn mint_lp_tokens(
        policy_id: PolicyId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), DispatchError>;

    fn burn_lp_tokens(
        policy_id: PolicyId,
        from: &AccountId,
        amount: u128,
    ) -> Result<(), DispatchError>;

    fn transfer_lp_tokens(
        policy_id: PolicyId,
        from: &AccountId,
        to: &AccountId,
        amount: u128,
    ) -> Result<(), DispatchError>;

    fn lock_lp_tokens(
        policy_id: PolicyId,
        who: &AccountId,
        amount: u128,
    ) -> Result<(), DispatchError>;

    fn unlock_lp_tokens(
        policy_id: PolicyId,
        who: &AccountId,
        amount: u128,
    ) -> Result<(), DispatchError>;

    fn lp_balance(policy_id: PolicyId, who: &AccountId) -> u128;

    fn total_lp_shares(policy_id: PolicyId) -> u128;

    fn distribute_to_lp_holders(
        policy_id: PolicyId,
        from_account: &AccountId,
        total_amount: Self::Balance,
    ) -> Result<(), DispatchError>;

    fn register_lp_holder(
        policy_id: PolicyId,
        holder: &AccountId,
    ) -> Result<(), DispatchError>;

    fn cleanup_policy_lp_tokens(
        policy_id: PolicyId,
    ) -> Result<(), DispatchError>;
}
```

**Config:**

```rust
pub trait Config: frame_system::Config + pallet_timestamp::Config {
    type Balance;
    type Assets: fungibles::Mutate<Self::AccountId>
        + fungibles::Inspect<Self::AccountId>;
    type UsdtAssetId: Get<AssetId>;

    type MarketsApi: MarketsAccess<Balance = Self::Balance>;
    type LpOrderbook: LpOrderbookApi<Self::AccountId, Self::Balance>;
    type HoldingsApi: HoldingsApi<Self::AccountId, Balance = Self::Balance>;

    type DaoAccountId: Get<Self::AccountId>;
}
```

### 10.3 `apply_coverage_with_quote`

**High-level flow:**

- User consumes a quote
- Policy is created
- Per-policy capital is locked
- DAO receives LP tokens for this policy
- A DAO LP ask is automatically placed

**Steps:**

1. Ensure signed origin `who`

2. Load `QuoteRequest` and `QuoteResult` and ensure `who == requester`

3. Load `MarketInfo` and re-validate coverage window if needed

4. Compute capital values:

   ```rust
   let shares = req.shares;
   let premium = res.total_premium;

   let max_payout = shares * PAYOUT_PER_SHARE;
   let required_capital = max_payout.saturating_sub(premium);

   let premium_per_share_u128 = (premium.into()) / shares;
   let payout_per_share_u128 = PAYOUT_PER_SHARE;
   let required_capital_per_share_u128 =
       payout_per_share_u128.saturating_sub(premium_per_share_u128);
   ```

5. Create `PolicyInfo`:

   ```rust
   let policy_id = NextPolicyId::get();
   Policies.insert(policy_id, PolicyInfo {
       policy_id,
       market_id: req.market_id,
       holder: who.clone(),
       coverage_start: req.coverage_start,
       coverage_end: req.coverage_end,
       shares,
       latitude: req.latitude,
       longitude: req.longitude,
       status: PolicyStatus::Active,
       premium_paid: premium,
       max_payout,
   });
   NextPolicyId::put(policy_id + 1);
   ```

6. Lock capital in the per-policy pool account:

   ```rust
   let pool_account = Self::policy_pool_account(policy_id);

   // User premium
   T::Assets::transfer(
       T::UsdtAssetId::get(),
       &who,
       &pool_account,
       premium,
       Preservation::Preserve,
   )?;

   // DAO capital top-up
   if required_capital > 0 {
       T::Assets::transfer(
           T::UsdtAssetId::get(),
           &T::DaoAccountId::get(),
           &pool_account,
           required_capital,
           Preservation::Preserve,
       )?;
   }

   PolicyRiskPoolBalance::<T>::insert(policy_id, max_payout);
   ```

7. Mint LP tokens to DAO for this specific policy:

   ```rust
   T::HoldingsApi::mint_lp_tokens(policy_id, &T::DaoAccountId::get(), shares)?;
   T::HoldingsApi::register_lp_holder(policy_id, &T::DaoAccountId::get())?;
   ```

8. Place DAO LP ask on orderbook:

   ```rust
   let price_per_share: T::Balance = required_capital_per_share_u128.into();

   T::LpOrderbook::place_dao_lp_ask(
       policy_id,
       &T::DaoAccountId::get(),
       price_per_share,
       shares,
   )?;
   ```

9. Mark quote as consumed

---

## 11. LP-Only Orderbook (`pallet_prmx_orderbook_lp`)

Simplified model focusing on asks (sell orders) for LP tokens.

### 11.1 Order Model and Storage

```rust
pub type OrderId = u64;

pub struct LpAskOrder<T: Config> {
    pub order_id: OrderId,
    pub policy_id: PolicyId,  // LP tokens are policy-specific
    pub seller: T::AccountId,
    pub price: T::Balance,    // price per LP share in USDT units
    pub quantity: u128,
    pub remaining: u128,
    pub created_at: u64,
}
```

**Storage:**

```rust
Orders: map OrderId -> LpAskOrder;
AskBook: map PolicyId -> BoundedVec<OrderId>;  // orders for a policy
PriceLevels: map PolicyId -> BoundedVec<u128>;  // sorted price levels
NextOrderId: OrderId;
```

### 11.2 `place_lp_ask`

**Extrinsic:**

```rust
fn place_lp_ask(
    origin,
    policy_id,
    price,
    quantity,
)
```

**Steps:**

- Ensure signed origin
- Check user holds at least `quantity` LP for that policy
- Lock LP tokens from seller account
- Allocate new `order_id`
- Store order and insert into `AskBook`

**`place_dao_lp_ask` implementation:**

- Wrapper callable only by policy pallet via its trait to place DAO orders

### 11.3 `buy_lp`

**Extrinsic:**

```rust
fn buy_lp(
    origin,
    policy_id,
    max_price,
    quantity,
)
```

**Steps:**

- Ensure signed origin
- Iterate `AskBook[policy_id]` from lowest price to `max_price`
- For each order:
  - Determine `fill_qty`
  - Transfer USDT from buyer to seller
  - Transfer locked LP tokens from seller to buyer
  - Register buyer as LP holder for this policy
  - Update `remaining`
  - Remove fully filled orders

> **Note:** LP trading does not directly change per-policy capital pools.

---

## 12. Oracle Summary

> **Detailed specification in `oracle_design.md`.**

**Key points for this document:**

- Each market has a `center_latitude` and `center_longitude`
- Oracle offchain worker:
  - Uses AccuWeather Geoposition Search to map center coordinates to an AccuWeather Location Key
  - Stores this binding in `MarketLocationConfig[market_id]`
  - **Submits signed transactions** to update on-chain state directly (DAO sponsors oracle authority)
- Rainfall ingestion:
  - Offchain worker fetches rainfall every ~600 blocks (1 hour with 6-second blocks)
  - Stores hourly rainfall in `RainBuckets<(LocationId, BucketIndex)>` with block number
  - Maintains `RollingState<LocationId>` with 24h rolling sum
- `LocationId` is an alias for `MarketId`
- **Automatic settlement**: Oracle can trigger settlement when thresholds are breached during coverage

**RainfallOracle Trait:**

```rust
pub trait RainfallOracle {
    fn rolling_sum_mm_at(
        location_id: LocationId,
        timestamp: u64,
    ) -> Option<Millimeters>;

    fn exceeded_threshold_in_window(
        location_id: LocationId,
        strike_mm: Millimeters,
        coverage_start: u64,
        coverage_end: u64,
    ) -> Result<bool, DispatchError>;
}
```

**PolicySettlement Trait (implemented by policy pallet):**

The oracle pallet uses this trait to coordinate automatic settlement:

```rust
pub trait PolicySettlement<AccountId> {
    fn current_time() -> u64;
    fn get_active_policies_in_window(market_id: MarketId, current_time: u64) -> Vec<PolicyId>;
    fn get_policy_info(policy_id: PolicyId) -> Option<(MarketId, u64, u64)>;
    fn trigger_immediate_settlement(policy_id: PolicyId) -> Result<(), DispatchError>;
}
```

The policy pallet uses `exceeded_threshold_in_window` at settlement time, and the oracle pallet can call `trigger_immediate_settlement` when a threshold breach is detected during an active coverage period.

---

## 13. Settlement and Capital Unlock

### 13.1 Policy Settlement

Settlement can be triggered in two ways:

1. **Manual settlement**: Anyone calls `settle_policy(policy_id, event_occurred)` after coverage ends
2. **Automatic settlement**: Oracle pallet calls `trigger_immediate_settlement(policy_id)` when threshold is breached during coverage

**`settle_policy(policy_id, event_occurred)` in `pallet_prmx_policy`:**

1. Load `PolicyInfo` and `MarketInfo`

2. Ensure policy is `Active` or `Expired`, and coverage window is in the past (or event occurred during coverage)

3. Use oracle or passed parameter to determine if event occurred:

   ```rust
   let triggered = event_occurred;
   ```

4. Get current timestamp using `pallet_timestamp`:

   ```rust
   fn current_timestamp() -> u64 {
       pallet_timestamp::Pallet::<T>::now()
           .unique_saturated_into::<u64>() / 1000  // Convert ms to seconds
   }
   ```

5. Compute:

   ```rust
   let shares = policy.shares;
   let max_payout = shares * PAYOUT_PER_SHARE;
   let pool_balance = PolicyRiskPoolBalance::<T>::get(policy_id);
   ```

**Case A: Event occurred (Policy Token side wins)**

- Transfer `max_payout` from `policy_pool_account(policy_id)` to `policy.holder`
- Set `PolicyRiskPoolBalance[policy_id] = 0`
- Mark policy as `Settled`
- **Store settlement result** in `SettlementResults[policy_id]`
- **Cleanup LP tokens** (burn all LP tokens for this policy)

**Case B: Event did not occur (LP side wins)**

- **Automatically distribute** pool to LP holders pro-rata
- Set `PolicyRiskPoolBalance[policy_id] = 0`
- Mark policy as `Settled`
- **Store settlement result** in `SettlementResults[policy_id]`
- **Cleanup LP tokens** (burn all LP tokens for this policy)

### 13.2 Settlement Result Storage

After each settlement, the outcome is recorded:

```rust
SettlementResults::<T>::insert(policy_id, SettlementResult {
    event_occurred: triggered,
    payout_to_holder: payout_amount,
    returned_to_lps: lp_distribution_amount,
    settled_at: Self::current_timestamp(),
});
```

### 13.3 Helper Functions for Automatic Settlement

The policy pallet exposes these functions for oracle integration:

```rust
/// Get active policies within a coverage window for a market
pub fn get_active_policies_in_window(market_id: MarketId, current_time: u64) -> Vec<PolicyId> {
    PoliciesByMarket::<T>::get(market_id)
        .iter()
        .filter(|&&policy_id| {
            if let Some(policy) = Policies::<T>::get(policy_id) {
                policy.status == PolicyStatus::Active
                    && current_time >= policy.coverage_start
                    && current_time <= policy.coverage_end
            } else {
                false
            }
        })
        .cloned()
        .collect()
}
```

### 13.4 Automatic LP Distribution

When a policy settles with no event:

```rust
T::HoldingsApi::distribute_to_lp_holders(
    policy_id,
    &pool_account,
    pool_balance,
)?;
```

**Distribution algorithm:**

1. Load `TotalLpShares[policy_id]`
2. For each LP holder in `LpHolders[policy_id]`:
   - Calculate `holder_shares = lp_shares + locked_shares`
   - Calculate `payout = (holder_shares / total_shares) * pool_balance`
   - Transfer payout from pool account to holder

### 13.5 LP Token Cleanup

After settlement (both event and no-event cases):

```rust
T::HoldingsApi::cleanup_policy_lp_tokens(policy_id)?;
```

**Cleanup algorithm:**

1. For each holder in `LpHolders[policy_id]`:
   - Remove `HoldingsStorage[policy_id][holder]`
   - Remove `IsLpHolder[policy_id][holder]`
2. Remove `TotalLpShares[policy_id]`
3. Remove `LpHolders[policy_id]`
4. Emit `PolicyLpTokensCleaned` event

**Result:**

- No orphaned LP tokens remain
- Storage is properly cleaned up
- Clear separation between active and settled policies

---

## 14. XCM Capital Management (`pallet_prmx_xcm_capital`)

This pallet manages capital allocation between on-chain policy pools and external DeFi strategies via XCM.

### 14.1 Strategy Interface

The pallet defines a trait for DeFi strategy implementations:

```rust
pub trait XcmStrategyInterface {
    type Balance;
    type AccountId;

    /// Enter DeFi strategy with principal, returns LP shares
    fn enter_strategy(principal: Self::Balance) -> Result<u128, DispatchError>;

    /// Exit DeFi strategy with LP shares, returns realized amount
    fn exit_strategy(
        shares: u128,
        pool_account: &Self::AccountId,
    ) -> Result<Self::Balance, DispatchError>;
}
```

### 14.2 Strategy Implementations

**MockXcmStrategyInterface (Active in v1):**

For standalone dev chain testing:
- Simulates DeFi interactions without real XCM calls
- Configurable mock yield rate for testing scenarios
- LP shares = principal (1:1 mapping)

```rust
type XcmStrategyInterface = pallet_prmx_xcm_capital::MockXcmStrategyInterface<Runtime>;
```

**LiveXcmStrategyInterface (Preserved for future):**

For parachain deployment with real XCM:
- Deposits USDT to Hydration Pool 102 via Asset Hub
- Withdraws with yield/loss from DeFi position
- Requires cumulus pallets and HRMP channels

```rust
// Future parachain mode:
type XcmStrategyInterface = pallet_prmx_xcm_capital::LiveXcmStrategyInterface<Runtime>;
```

### 14.3 Capital API Trait

The policy pallet uses this trait for capital management:

```rust
pub trait CapitalApi<AccountId> {
    type Balance;

    /// Allocate capital to DeFi strategy when policy is created
    fn allocate_capital(
        policy_id: PolicyId,
        pool_account: &AccountId,
        amount: Self::Balance,
    ) -> Result<(), DispatchError>;

    /// Withdraw capital from DeFi strategy at settlement
    fn withdraw_capital(
        policy_id: PolicyId,
        pool_account: &AccountId,
    ) -> Result<Self::Balance, DispatchError>;
}
```

### 14.4 Storage

```rust
/// Per-policy DeFi position tracking
PolicyDefiPositions: map PolicyId -> Option<DefiPosition>;

/// Global allocation percentage (ppm, 1_000_000 = 100%)
AllocationPpm: u32;

/// Mock yield rate for testing (ppm, can be negative)
MockYieldRatePpm: i32;
```

### 14.5 Capital Flow Integration

**Policy Creation Flow:**

```
policy_creation:
  1. User pays premium → policy pool account
  2. DAO contributes required_capital → policy pool account
  3. pallet_prmx_xcm_capital::allocate_capital() called
     - v1 (MockXcmStrategyInterface): Simulates DeFi deposit, tracks LP shares
     - Future (LiveXcmStrategyInterface): Real XCM to Hydration Pool 102
```

**Settlement Flow:**

```
settlement:
  1. pallet_prmx_xcm_capital::withdraw_capital() called
     - v1 (Mock): Returns principal ± mock yield
     - Future (Live): Real XCM withdrawal from Hydration
  2. If event occurred: payout to policyholder
  3. If no event: distribute to LP holders
```

### 14.6 Mock Yield Configuration

For testing different scenarios:

```rust
// Set mock yield rate (extrinsic)
PrmxXcmCapital::set_mock_yield_rate(50_000); // +5% yield
PrmxXcmCapital::set_mock_yield_rate(-20_000); // -2% loss
```

---

## 15. DAO and Governance

### Initial Version

- Single DAO account

**Origins:**

```rust
type DaoOrigin = EnsureSignedBy<DaoAdminAccount, AccountId>;
type GovernanceOrigin = DaoOrigin;
```

**DAO controls:**

- Market creation and parameters
- Window rules and DAO margins per market
- Oracle operator set and risk thresholds (through oracle pallet)
- LP capital provision

### Future Version

- Replace `DaoOrigin` with a PRMX-based governance system (OpenGov style)
- PRMX balances determine voting power

---

## 16. Transaction Fees and Gasless UX

**Goal:**

- End-user interactions for core insurance flows feel gasless

**Options:**

1. **Protocol-level zero fees** for selected extrinsics
   - Configure `pallet_transaction_payment` and `OnChargeTransaction`
   - Map specific calls (quote request, apply coverage, settle) to zero fee

2. **Meta-transactions and relayers**
   - Users sign payloads
   - DAO or external relayer pays fees

**In all cases:**

- Denial-of-service protection via block weight and size limits
- Collators rewarded via block rewards or DAO subsidies

> Details are implementation-specific and can be refined later.

---

## 17. Repository Layout

**Current layout:**

```
prmx-chain/
  app-design.md
  oracle-design.md
  pricing-model.md
  pallets/
    prmx-markets/
      src/lib.rs
    prmx-policy/
      src/lib.rs
    prmx-holdings/
      src/lib.rs
    prmx-orderbook-lp/
      src/lib.rs
    prmx-oracle/
      src/lib.rs
    prmx-quote/
      src/lib.rs
    prmx-xcm-capital/           # XCM capital management
      src/
        lib.rs                  # Pallet with MockXcmStrategyInterface
        xcm_config.rs           # Hydration Pool 102 configuration (preserved)
        xcm_strategy.rs         # LiveXcmStrategyInterface (preserved)
  runtime/
    src/lib.rs                  # Standalone dev chain (no cumulus pallets)
  node/
    src/chain_spec.rs
    src/service.rs
  scripts/
    run-node-dev.sh
    functional-tests/           # JavaScript functional tests
  frontend/
    src/
      app/           # Next.js pages
      components/    # React components
      hooks/         # Custom hooks
      lib/           # API and utilities
      types/         # TypeScript types
```

---

## 18. Example Prompts for AI Tools

### Example Prompt for Implementing the Policy Pallet

> You are a senior Substrate engineer working against `polkadot-sdk/tree/polkadot-stable2506-2`.
>
> Using `app-design.md` as the single source of truth, implement `pallet_prmx_policy` with:
>
> **PolicyInfo** as defined in section 6 (with latitude/longitude, premium_paid, max_payout)
>
> **Storage:**
> - `Policies`, `PoliciesByMarket`, `NextPolicyId`
> - `PolicyRiskPoolBalance`
>
> **Derived accounts:**
> - `policy_pool_account(policy_id)`
>
> **Config:**
> - `type Assets`, `type UsdtAssetId`
> - `type MarketsApi` (from section 9.3)
> - `type LpOrderbook` (LP orderbook trait)
> - `type HoldingsApi` (LP holdings trait)
> - `DaoAccountId`
>
> **Extrinsic `apply_coverage_with_quote(quote_id)`** that:
> - Reads `QuoteRequest` and `QuoteResult`
> - Validates coverage window using data from `MarketsApi`
> - Creates a policy bound to `market_id`
> - Computes `max_payout = shares * PAYOUT_PER_SHARE`
> - Computes `required_capital = max_payout - premium` and `required_capital_per_share`
> - Transfers premium from user and `required_capital` from `DaoAccountId` into the policy pool account
> - Sets `PolicyRiskPoolBalance[policy_id] = max_payout`
> - Mints LP tokens to `DaoAccountId` for this policy
> - Registers `DaoAccountId` as LP holder for this policy
> - Calls `LpOrderbook::place_dao_lp_ask` to list DAO's LP at `required_capital_per_share`
>
> **Extrinsic `settle_policy(policy_id, event_occurred)`** that:
> - Uses `RainfallOracle::exceeded_threshold_in_window` with `market_id` as `LocationId` (or accepts boolean)
> - If event: pays policy holder, burns LP tokens
> - If no event: distributes pool pro-rata to LP holders, burns LP tokens
> - Cleans up LP storage after settlement
>
> Follow FRAME v2 patterns from the Polkadot SDK reference.

---

**If code and `app-design.md` ever conflict, `app-design.md` is authoritative and the code must be updated.**
