# PRMX Infrastructure Restart Guide

This guide explains the restart process for the PRMX development environment, including what happens at each stage and how API keys are securely managed.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Restart Modes](#restart-modes)
3. [What Happens When You Restart](#what-happens-when-you-restart)
4. [API Key Security](#api-key-security)
5. [Services Overview](#services-overview)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Temporary mode (fresh start each time)
./scripts/restart-dev-environment.sh

# Persistent mode (data survives restarts)
./scripts/restart-dev-environment.sh --persistent

# With custom API keys
ACCUWEATHER_API_KEY="your_key" R_PRICING_API_KEY="your_key" ./scripts/restart-dev-environment.sh
```

---

## Restart Modes

### Temporary Mode (`--tmp`) - Default

```bash
./scripts/restart-dev-environment.sh --tmp
```

**Characteristics:**
- Fresh blockchain genesis each restart
- All on-chain data is lost
- All policies, trades, and LP positions are reset
- 6 markets are recreated from genesis config
- API keys are read from environment variables at genesis

**Use For:**
- Development and testing
- Experimenting with new features
- Clean-slate debugging

**Data Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    TEMPORARY MODE FLOW                          │
└─────────────────────────────────────────────────────────────────┘

1. Stop all processes
         │
         ▼
2. Start node with --tmp flag
         │
         ├──▶ Creates random temp directory: /tmp/substrateXXXXX
         │
         ├──▶ Genesis block created with:
         │      • 6 markets (Manila, Amsterdam, Tokyo, Singapore, Jakarta, Dubai)
         │      • ACCUWEATHER_API_KEY → PendingApiKey storage (on-chain)
         │      • Block 0 starts
         │
         ▼
3. OCW reads PendingApiKey and copies to offchain local storage
         │
         ├──▶ At block 1-9: OCW runs every block (startup phase)
         │      • Copies API key to offchain local storage
         │      • Resolves market locations from AccuWeather
         │      • Starts fetching rainfall data
         │
         ▼
4. PendingApiKey cleared from on-chain storage (after 100 blocks)
         │
         ├──▶ API key now ONLY exists in offchain local storage
         │      • Not visible on chain
         │      • Private to this node instance
         │
         ▼
5. Start Oracle V2 and Frontend services
```

### Persistent Mode (`--persistent`)

```bash
./scripts/restart-dev-environment.sh --persistent
```

**Characteristics:**
- Blockchain data persists across restarts
- All policies, trades, and LP positions are preserved
- API keys are injected via secure CLI (never on-chain)
- Data stored in `$PRMX_DATA_DIR` (default: `/tmp/prmx-data`)

**Use For:**
- Long-running test environments
- Demo environments
- Staging before production

**Data Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    PERSISTENT MODE FLOW                         │
└─────────────────────────────────────────────────────────────────┘

1. Stop all processes
         │
         ▼
2. Check if chain data exists at PRMX_DATA_DIR
         │
         ├──▶ If NEW CHAIN:
         │      │
         │      ├── Inject API keys via CLI BEFORE starting node
         │      │     ./prmx-node inject-api-key --key "..." --value "..."
         │      │
         │      ├── Keys written directly to offchain RocksDB
         │      │     (NEVER touches blockchain!)
         │      │
         │      └── Start node with --base-path
         │
         ├──▶ If EXISTING CHAIN:
         │      │
         │      ├── Start node with existing data
         │      │
         │      ├── Inject/update API keys via CLI
         │      │
         │      └── OCW reads keys from offchain storage
         │
         ▼
3. Node resumes from last finalized block
         │
         ├──▶ All markets, policies, positions preserved
         │
         ├──▶ OCW continues fetching rainfall data
         │
         ▼
4. Start Oracle V2 and Frontend services
```

---

## What Happens When You Restart

### Stage 1: Process Cleanup

```
┌─────────────────────────────────────────────────────────────────┐
│                      PROCESS CLEANUP                            │
└─────────────────────────────────────────────────────────────────┘

Killed Processes:
  • prmx-node (blockchain)
  • oracle-v2 (V2 oracle service)
  • next-server (frontend)

Freed Ports:
  • 9944 (WebSocket RPC)
  • 3001 (Oracle V2 API)
  • 3000 (Frontend)
```

### Stage 2: Blockchain Node Startup

```
┌─────────────────────────────────────────────────────────────────┐
│                    NODE STARTUP                                 │
└─────────────────────────────────────────────────────────────────┘

Genesis Block (Block 0) contains:
  ┌──────────────────────────────────────────────────────────────┐
  │ ACCOUNTS (with balances):                                    │
  │   • Alice, Bob, Charlie, Dave, Eve, Ferdie                  │
  │   • DAO Treasury                                             │
  │                                                              │
  │ MARKETS (6 created):                                         │
  │   0: Manila     (lat: 14.5995, lon: 120.9842, UTC+8)        │
  │   1: Amsterdam  (lat: 52.3676, lon: 4.9041,   UTC+1)        │
  │   2: Tokyo      (lat: 35.6762, lon: 139.6503, UTC+9)        │
  │   3: Singapore  (lat: 1.3521,  lon: 103.8198, UTC+8)        │
  │   4: Jakarta    (lat: -6.2088, lon: 106.8456, UTC+7)        │
  │   5: Dubai      (lat: 25.2048, lon: 55.2708,  UTC+4)        │
  │                                                              │
  │ ORACLE CONFIG:                                               │
  │   • PendingApiKey: ACCUWEATHER_API_KEY (cleared after 100)  │
  │   • OracleProviders: [Alice]                                │
  │                                                              │
  │ ASSETS:                                                      │
  │   • USDT (Asset ID: 1)                                      │
  └──────────────────────────────────────────────────────────────┘
```

### Stage 3: Offchain Worker Startup Phase (Blocks 0-9)

```
┌─────────────────────────────────────────────────────────────────┐
│                OCW STARTUP PHASE                                │
└─────────────────────────────────────────────────────────────────┘

Block 1-9 (every block):
  
  1. Check for PendingApiKey on-chain
       │
       ▼
  2. Copy API key to offchain local storage
       │
       ├──▶ Storage key: "prmx-oracle::accuweather-api-key"
       │    Storage type: PERSISTENT (survives node restart)
       │
       ▼
  3. Resolve market locations from AccuWeather
       │
       ├──▶ Market 0 → Location 3423441 (Manila)
       ├──▶ Market 1 → Location 3509930 (Amsterdam)
       ├──▶ Market 2 → Location 2409983 (Tokyo)
       ├──▶ Market 3 → Location 300542  (Singapore)
       ├──▶ Market 4 → Location 1889577 (Jakarta)
       └──▶ Market 5 → Location 323053  (Dubai)
       │
       ▼
  4. Fetch 24h historical rainfall for each market
       │
       ├──▶ AccuWeather /historical/24 endpoint
       ├──▶ 24 hourly observations per market
       ├──▶ Store in HourlyBuckets on-chain
       │
       ▼
  5. Calculate rolling 24h sum for each market
       │
       └──▶ Store in RollingWindowState on-chain
```

### Stage 4: Normal Operation (Block 10+)

```
┌─────────────────────────────────────────────────────────────────┐
│                NORMAL OPERATION                                 │
└─────────────────────────────────────────────────────────────────┘

OCW Schedule:
  • Every 600 blocks (~1 hour): Fetch new rainfall data
  • Every 100 blocks (~10 min): Check for new markets
  • Every 10 blocks (~1 min):   Check for policy settlements

Block Production:
  • ~6 seconds per block
  • Aura consensus (for dev chain)

PendingApiKey Cleanup:
  • At block 100: PendingApiKey cleared from on-chain storage
  • API key now only exists in offchain local storage
```

---

## API Key Security

### Injection Methods Comparison

| Method | On-Chain Exposure | When to Use |
|--------|-------------------|-------------|
| ❌ `setAccuweatherApiKey` extrinsic | **YES** (forever in blocks) | Never in production |
| ⚠️ Genesis `PendingApiKey` | **YES** (100 blocks) | Development only |
| ✅ CLI `inject-api-key` | **NO** | Production |

### Secure CLI Injection (Recommended)

```bash
# Inject BEFORE starting node (or after for existing chains)
./target/release/prmx-node inject-api-key \
    --key "prmx-oracle::accuweather-api-key" \
    --value "YOUR_ACCUWEATHER_API_KEY" \
    --base-path /path/to/data \
    --chain dev
```

**How it works:**
```
┌─────────────────────────────────────────────────────────────────┐
│                 SECURE CLI INJECTION                            │
└─────────────────────────────────────────────────────────────────┘

Command Line
     │
     ▼
Write DIRECTLY to RocksDB (offchain storage)
     │
     ├──▶ Location: {base_path}/chains/{chain_id}/offchain/
     │
     ├──▶ Column 0 (PERSISTENT)
     │
     └──▶ Key: "prmx-oracle::accuweather-api-key"
          Value: <your_api_key>

     ✅ Never touches blockchain
     ✅ Not in any block or extrinsic
     ✅ Private to this node
     ✅ Survives node restarts
```

### Storage Locations

| Storage Type | Location | Visibility | Persistence |
|--------------|----------|------------|-------------|
| On-chain (extrinsic) | Blockchain | Public | Forever |
| PendingApiKey | Blockchain | Public | 100 blocks |
| Offchain local | `{base}/chains/{chain}/offchain/` | Private | Permanent |
| Environment var | Memory | Private | Session only |

---

## Services Overview

### 1. Blockchain Node (`prmx-node`)

- **Port:** 9944 (WebSocket RPC)
- **Log:** `/tmp/prmx-node.log`
- **Responsibilities:**
  - Block production (Aura consensus)
  - Transaction validation
  - Offchain Worker execution (V1 Oracle)
  - State management

### 2. Oracle V2 Service (`oracle-v2`)

- **Port:** 3001 (HTTP API)
- **Log:** `/tmp/oracle-v2.log`
- **Responsibilities:**
  - Monitor V2 policies for coverage periods
  - Fetch AccuWeather data for V2 evaluations
  - Calculate cumulative/max rainfall
  - Submit V2 reports on-chain

### 3. Frontend (`frontend`)

- **Port:** 3000 (HTTP)
- **Log:** `/tmp/frontend.log`
- **Responsibilities:**
  - User interface
  - Policy creation/management
  - LP trading interface
  - Oracle data display

---

## Troubleshooting

### Common Issues

#### Node won't start
```bash
# Check if port is in use
lsof -i:9944

# Kill existing process
pkill -f prmx-node

# Check logs
tail -f /tmp/prmx-node.log
```

#### API keys not working (0.0mm rainfall)
```bash
# Check OCW logs for API key detection
grep "AccuWeather API key" /tmp/prmx-node.log

# Verify PendingApiKey was set
# (Should see "api_key_pending: true" during blocks 1-9)
grep "api_key_pending" /tmp/prmx-node.log
```

#### Markets not fetching data
```bash
# Check if location keys are resolved
grep "location key" /tmp/prmx-node.log

# Check for HTTP errors
grep "Error" /tmp/prmx-node.log | grep -i accuweather
```

#### Frontend not loading
```bash
# Check if still compiling
tail -f /tmp/frontend.log

# Restart just frontend
pkill -f next-server
cd frontend && npm run dev
```

### Log Locations

| Service | Log File | Watch Command |
|---------|----------|---------------|
| Node | `/tmp/prmx-node.log` | `tail -f /tmp/prmx-node.log` |
| Oracle V2 | `/tmp/oracle-v2.log` | `tail -f /tmp/oracle-v2.log` |
| Frontend | `/tmp/frontend.log` | `tail -f /tmp/frontend.log` |

### Useful Grep Patterns

```bash
# OCW activity
grep "Offchain worker" /tmp/prmx-node.log

# Rainfall fetching
grep "rolling sum" /tmp/prmx-node.log

# Market resolution
grep "Resolved AccuWeather location" /tmp/prmx-node.log

# API key status
grep "api_key_pending\|AccuWeather API key" /tmp/prmx-node.log

# Errors
grep -i "error\|failed\|warning" /tmp/prmx-node.log
```

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ACCUWEATHER_API_KEY` | Standard tier key | AccuWeather API key for V1 Oracle |
| `R_PRICING_API_KEY` | `test_api_key` | R Pricing API key for quote pricing |
| `NODE_PATH` | `/tmp/node-v18.20.8-darwin-arm64/bin` | Path to Node.js binaries |
| `PRMX_DATA_DIR` | `/tmp/prmx-data` | Data directory for persistent mode |

---

## Related Documentation

- [Oracle Design](./oracle-design.md) - Detailed oracle architecture
- [V1 vs V2 Oracle](./v1-v2-comparison.md) - Oracle version comparison
- [API Reference](./api-reference.md) - Chain RPC methods

---

*Last updated: December 2025*

