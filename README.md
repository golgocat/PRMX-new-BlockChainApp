# PRMX Chain

<p align="center">
  <img src="frontend/public/logo.svg" alt="PRMX Logo" width="200"/>
</p>

<p align="center">
  <strong>Parametric Rainfall Insurance on the Polkadot Blockchain</strong>
</p>

<p align="center">
  A Substrate-based blockchain providing automated, trustless rainfall insurance with AccuWeather oracle integration.
</p>

---

## Overview

PRMX is a decentralized parametric insurance platform that automatically settles rainfall-based insurance policies using real-world weather data. When rainfall exceeds a predefined threshold, policyholders receive instant payouts without claims processing.

### Key Features

- **Automated Settlement** - Oracle-driven payouts with no manual claims
- **Dual Oracle System** - V1 (on-chain) and V2 (off-chain) for different use cases
- **LP Token Trading** - Policy-specific liquidity provider tokens tradable on an orderbook
- **AccuWeather Integration** - Real-time rainfall data from a trusted weather provider
- **XCM Ready** - Prepared for cross-chain capital management via Polkadot

### V1 vs V2 Products

| Feature | V1 | V2 |
|---------|----|----|
| **Markets** | All markets | Manila only |
| **Coverage Duration** | 24 hours fixed | 2-7 days configurable |
| **Event Type** | 24h rolling rainfall | Cumulative over window |
| **Early Trigger** | No | Yes |
| **Oracle** | On-chain OCW | Off-chain Node.js service |
| **Settlement** | Automatic via `on_initialize` | Via `submit_v2_report` extrinsic |

---

## Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend (Next.js)"]
        UI[Web Application]
    end

    subgraph Blockchain["PRMX Blockchain (Substrate)"]
        subgraph Pallets["Custom Pallets"]
            Markets[prmx-markets]
            Policy[prmx-policy]
            Holdings[prmx-holdings]
            Orderbook[prmx-orderbook-lp]
            Oracle[prmx-oracle]
            Quote[prmx-quote]
            XcmCapital[prmx-xcm-capital]
        end
        
        subgraph OracleV1["V1 Oracle (On-chain)"]
            OCW[Offchain Worker]
        end
    end

    subgraph OracleV2["V2 Oracle Service (Node.js)"]
        Listener[Event Listener]
        Evaluator[Rainfall Evaluator]
        Reporter[Report Submitter]
        MongoDB[(MongoDB Atlas)]
    end

    subgraph External["External Services"]
        AccuWeather[AccuWeather API]
        RPricing[R Pricing API]
    end

    UI <--> Blockchain
    OCW --> AccuWeather
    Quote --> RPricing
    OracleV2 --> AccuWeather
    OracleV2 <--> Blockchain
    Listener --> MongoDB
    Evaluator --> MongoDB
```

---

## Quick Start

### Prerequisites

- **Rust** (stable toolchain + wasm32 target)
- **Node.js** 18+
- **MongoDB** (Atlas account for V2 Oracle)
- **AccuWeather API Key** (Standard tier recommended)

### 1. Build the Node

```bash
# Install Rust if needed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Build the node
cargo build --release -p prmx-node
```

### 2. Start the Development Environment

The easiest way to start everything is using the restart script:

```bash
# Set required environment variables
export ACCUWEATHER_API_KEY="your-accuweather-api-key"
export RPRICING_API_KEY="your-r-pricing-api-key"

# Run the restart script (temporary mode)
./scripts/restart-dev-environment.sh --tmp
```

Or start components individually:

```bash
# Terminal 1: Start the blockchain
./target/release/prmx-node --dev --tmp

# Terminal 2: Start Oracle V2 (optional, for V2 policies)
cd oracle-v2 && npm install && npm start

# Terminal 3: Start the frontend
cd frontend && npm install && npm run dev
```

### 3. Access the Application

- **Frontend**: http://localhost:3000
- **Oracle V2 API**: http://localhost:3001
- **Blockchain RPC**: ws://localhost:9944

For detailed restart instructions, see [docs/RESTART-GUIDE.md](docs/RESTART-GUIDE.md).

---

## Project Structure

```
PRMX/
├── pallets/                    # Substrate custom pallets
│   ├── prmx-markets/           # Market definitions and parameters
│   ├── prmx-policy/            # Policy lifecycle management
│   ├── prmx-holdings/          # LP token holdings per policy
│   ├── prmx-orderbook-lp/      # LP-only orderbook
│   ├── prmx-oracle/            # V1 oracle + V2 report receiver
│   ├── prmx-quote/             # Pricing via R model
│   └── prmx-xcm-capital/       # XCM capital management
│
├── primitives/                 # Shared types (PolicyVersion, V2Outcome, etc.)
├── runtime/                    # Substrate runtime configuration
├── node/                       # Substrate node binary
│
├── oracle-v2/                  # V2 off-chain oracle service
│   ├── src/
│   │   ├── chain/              # Blockchain event listener & reporter
│   │   ├── db/                 # MongoDB integration
│   │   ├── accuweather/        # AccuWeather API client
│   │   ├── evaluator/          # Cumulative rainfall calculator
│   │   ├── scheduler/          # Polling loop
│   │   └── api/                # REST API server
│   └── package.json
│
├── frontend/                   # Next.js web application
│   ├── src/
│   │   ├── app/                # App Router pages
│   │   ├── components/         # React components
│   │   ├── hooks/              # Custom hooks
│   │   ├── lib/                # Utilities and API
│   │   └── stores/             # Zustand state
│   └── package.json
│
├── scripts/                    # Helper and test scripts
│   ├── functional-tests/       # Automated test suite
│   ├── load-test/              # Load testing tools
│   ├── chopsticks-tests/       # Chopsticks XCM tests
│   └── restart-dev-environment.sh
│
├── docs/                       # Documentation
│   ├── RESTART-GUIDE.md        # Dev environment restart guide
│   └── SETTLEMENT-FLOW.md      # V1/V2 settlement documentation
│
├── app-design.md               # Application design specification
├── oracle-design.md            # Oracle system specification
└── pricing-model.md            # R pricing model integration
```

---

## Components

### Substrate Blockchain

The PRMX blockchain is built on Substrate with custom pallets:

| Pallet | Description |
|--------|-------------|
| `prmx-markets` | Market definitions with geospatial coordinates, strike values, and window rules |
| `prmx-policy` | Policy creation, lifecycle, V1/V2 handling, and settlement |
| `prmx-holdings` | Per-policy LP token holdings (free and locked shares) |
| `prmx-orderbook-lp` | LP-only orderbook for trading policy-specific LP tokens |
| `prmx-oracle` | V1 24h rolling rainfall + V2 report receiver |
| `prmx-quote` | Quote requests with R pricing model integration |
| `prmx-xcm-capital` | XCM-based capital management (Hydration Pool 102 ready) |

For detailed specifications, see [app-design.md](app-design.md).

### Oracle V2 Service

The V2 Oracle is an off-chain Node.js service for cumulative rainfall monitoring:

- **Event Listener**: Subscribes to `V2PolicyCreated` events
- **Scheduler**: Polls AccuWeather every 30 minutes
- **Evaluator**: Calculates cumulative rainfall during coverage
- **Reporter**: Submits `submit_v2_report` when triggered or matured

For settlement flow details, see [docs/SETTLEMENT-FLOW.md](docs/SETTLEMENT-FLOW.md).

### Frontend

A modern Next.js application with:

- Dashboard with platform statistics
- Market explorer with rainfall data
- Policy management (V1/V2)
- LP token trading orderbook
- Oracle monitoring pages

For frontend details, see [frontend/README.md](frontend/README.md).

---

## Configuration

### Environment Variables

```bash
# Blockchain
NEXT_PUBLIC_RPC_URL=ws://localhost:9944

# Oracle V2
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/prmx-oracle-v2
WS_ENDPOINT=ws://127.0.0.1:9944
ACCUWEATHER_API_KEY=your-api-key
MANILA_LOCATION_KEY=264885
ORACLE_SEED=//Alice
ORACLE_V2_API_PORT=3001

# R Pricing
RPRICING_API_KEY=your-api-key
```

### API Key Injection

API keys are injected securely via CLI for persistent mode:

```bash
# Inject AccuWeather API key
./target/release/prmx-node inject-api-key \
  --base-path /path/to/data \
  --key-type accuweather \
  --key "your-api-key"

# Inject R Pricing API key
./target/release/prmx-node inject-api-key \
  --base-path /path/to/data \
  --key-type rpricing \
  --key "your-api-key"
```

For temporary mode, use environment variables. See [docs/RESTART-GUIDE.md](docs/RESTART-GUIDE.md).

---

## Testing

### Functional Tests

```bash
cd scripts/functional-tests

# Run individual tests
node test-auto-settlement-threshold-breach.mjs
node test-rolling-sum-calculation.mjs
node test-multiple-markets.mjs

# See README for full test list
```

### E2E Scripts

```bash
cd scripts

# V1 flow test
node e2e-singapore-flow.mjs

# V2 flow test
node e2e-v2-policy-flow.mjs

# Settlement tests
node test-v2-settlement.mjs
```

### Load Testing

```bash
cd scripts/load-test
./run-load-test.sh
```

### Chopsticks Tests (XCM)

```bash
cd scripts
./run-chopsticks-test.sh
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [app-design.md](app-design.md) | Complete application design specification |
| [oracle-design.md](oracle-design.md) | V1 and V2 oracle system specification |
| [pricing-model.md](pricing-model.md) | R actuarial model integration |
| [docs/RESTART-GUIDE.md](docs/RESTART-GUIDE.md) | Development environment restart guide |
| [docs/SETTLEMENT-FLOW.md](docs/SETTLEMENT-FLOW.md) | V1/V2 settlement flow documentation |
| [frontend/README.md](frontend/README.md) | Frontend application documentation |

---

## Tech Stack

### Blockchain

- **Substrate** - Polkadot SDK (polkadot-stable2506-2)
- **Rust** - Systems programming language
- **FRAME v2** - Pallet development framework

### Oracle V2

- **Node.js** - JavaScript runtime
- **TypeScript** - Type-safe JavaScript
- **MongoDB Atlas** - Cloud database
- **Express.js** - REST API framework

### Frontend

- **Next.js 14** - React framework (App Router)
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS
- **Zustand** - State management
- **Polkadot.js** - Blockchain integration

### External Services

- **AccuWeather** - Weather data provider
- **R Pricing API** - Actuarial probability model

---

## Default Markets

The following markets are created at genesis:

| Market | Location Key | Timezone | Coordinates |
|--------|--------------|----------|-------------|
| Manila | 264885 | UTC+8 | 14.5995, 120.9842 |
| Tokyo | 226396 | UTC+9 | 35.6762, 139.6503 |
| Hong Kong | 1123655 | UTC+8 | 22.3193, 114.1694 |
| Singapore | 300597 | UTC+8 | 1.3521, 103.8198 |
| Jakarta | 208971 | UTC+7 | -6.2088, 106.8456 |
| Dubai | 323091 | UTC+4 | 25.2048, 55.2708 |

---

## License

MIT

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Support

For questions or issues, please open a GitHub issue.

