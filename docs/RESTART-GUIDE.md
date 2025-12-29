# PRMX Infrastructure Restart Guide

This guide explains the restart process for the PRMX development environment, including what happens at each stage and how API keys are securely managed.

> **⚠️ IMPORTANT: Before Starting**
> 
> - **Temporary Mode (`--tmp`)**: You **MUST** set the `ACCUWEATHER_API_KEY` environment variable, otherwise the V1 Oracle will not fetch rainfall data
> - **Persistent Mode (`--persistent`)**: API keys are injected via secure CLI (no environment variable needed)
> - See [Environment Variables Reference](#environment-variables-reference) for details

## Table of Contents

1. [Quick Start](#quick-start)
2. [Restart Modes](#restart-modes)
3. [What Happens When You Restart](#what-happens-when-you-restart)
4. [API Key Security](#api-key-security)
5. [Services Overview](#services-overview)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

> **⚠️ IMPORTANT: API Keys Required**
> 
> - **`ACCUWEATHER_API_KEY`**: Required for V1 Oracle rainfall data (without it, all markets show 0.0mm)
> - **`V3_INGEST_HMAC_SECRET`**: Required for V3 Oracle monitoring (without it, V3 policies won't be monitored)
> - See [Environment Variables Reference](#environment-variables-reference) for all options

```bash
# Temporary mode with V1 + V3 oracles (recommended)
ACCUWEATHER_API_KEY="your_accuweather_key" \
V3_INGEST_HMAC_SECRET="your_32_char_secret" \
./scripts/restart-dev-environment.sh

# Or set them in your shell session first
export ACCUWEATHER_API_KEY="your_accuweather_key"
export V3_INGEST_HMAC_SECRET="your_32_char_secret"
./scripts/restart-dev-environment.sh

# Persistent mode (data survives restarts)
./scripts/restart-dev-environment.sh --persistent

# Full example with all keys
ACCUWEATHER_API_KEY="your_key" \
V3_INGEST_HMAC_SECRET="your_secret" \
R_PRICING_API_KEY="your_key" \
./scripts/restart-dev-environment.sh
```

---

## Restart Modes

### Temporary Mode (`--tmp`) - Default

```bash
# ⚠️ RECOMMENDED: Set both ACCUWEATHER_API_KEY and V3_INGEST_HMAC_SECRET
ACCUWEATHER_API_KEY="your_accuweather_key" \
V3_INGEST_HMAC_SECRET="your_32_char_secret" \
./scripts/restart-dev-environment.sh --tmp
```

**⚠️ API Key Requirements:**

| Secret | Oracle | Effect if Missing |
|--------|--------|-------------------|
| `ACCUWEATHER_API_KEY` | V1 & V3 | All markets show 0.0mm rainfall, V3 policies not monitored |
| `V3_INGEST_HMAC_SECRET` | V3 only | V3 policies not monitored (V1 still works) |

**How secrets are injected:**
- **V1**: API key read at genesis → stored in `PendingApiKey` (on-chain 100 blocks) → copied to offchain storage
- **V3**: Secrets injected via RPC after node starts → stored directly in offchain storage (never on-chain)

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

0. ⚠️ SET ENVIRONMENT VARIABLE (REQUIRED)
         │
         ├──▶ export ACCUWEATHER_API_KEY="your_key"
         │    (Without this, OCW cannot fetch rainfall data!)
         │
         ▼
1. Stop all processes
         │
         ▼
2. Start node with --tmp flag
         │
         ├──▶ Creates random temp directory: /tmp/substrateXXXXX
         │
         ├──▶ Genesis block created with:
         │      • 6 markets (Manila, Amsterdam, Tokyo, Singapore, Jakarta, Dubai)
         │      • ACCUWEATHER_API_KEY env var → PendingApiKey storage (on-chain)
         │      • ⚠️ If env var not set: PendingApiKey is empty, OCW fails
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
ACCUWEATHER_API_KEY="your_key" \
V3_INGEST_HMAC_SECRET="your_secret" \
./scripts/restart-dev-environment.sh --persistent
```

**Characteristics:**
- Blockchain data persists across restarts
- All policies, trades, and LP positions are preserved
- V1 API keys injected via secure CLI on first run (never on-chain)
- V3 secrets injected via RPC after node starts (stored in offchain storage)
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
  • offchain-oracle-service (oracle service)
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

### 2. Oracle Service (`offchain-oracle-service`)

- **Port:** 3001 (HTTP API)
- **Log:** `/tmp/oracle-service.log`
- **Responsibilities:**
  - Monitor V2 policies for coverage periods
  - Fetch AccuWeather data for V2 evaluations
  - Calculate cumulative/max rainfall
  - Submit V2 reports on-chain
  - **V3 Ingest API**: Receive observations from on-chain OCW

### V3 Oracle (On-chain OCW)

- **Runs inside:** Blockchain node (offchain worker)
- **Log:** `/tmp/prmx-node.log` (look for `prmx-oracle-v3` entries)
- **Secrets Required:**
  - `ACCUWEATHER_API_KEY` - For fetching weather data
  - `V3_INGEST_HMAC_SECRET` - For authenticating with Ingest API
- **Responsibilities:**
  - Poll active V3 policies every ~60 seconds
  - Fetch AccuWeather data for each policy's location
  - Submit snapshots and final reports on-chain
  - Send observations to Ingest API for off-chain storage

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

**Symptom:** All markets show 0.0mm rainfall, OCW logs show "AccuWeather API key not configured"

**Cause:** `ACCUWEATHER_API_KEY` environment variable not set when starting in temporary mode

**Solution:**
```bash
# 1. Stop the node
pkill -f prmx-node

# 2. Restart WITH the API key set
ACCUWEATHER_API_KEY="your_accuweather_key" ./scripts/restart-dev-environment.sh

# 3. Verify API key is detected (should see "api_key_pending: true")
grep "api_key_pending" /tmp/prmx-node.log

# 4. Check for rainfall data (should see rolling sums > 0.0mm)
grep "rolling sum" /tmp/prmx-node.log
```

**Verification:**
```bash
# Check OCW logs for API key detection
grep "AccuWeather API key" /tmp/prmx-node.log

# Verify PendingApiKey was set
# (Should see "api_key_pending: true" during blocks 1-9)
grep "api_key_pending" /tmp/prmx-node.log

# Check if rainfall is being fetched
grep "Fetched.*hourly rainfall records" /tmp/prmx-node.log
```

#### V3 policies not being monitored

**Symptom:** V3 policies show "N/A" for Observed time, no snapshots being submitted

**Cause:** V3 oracle secrets not configured

**Solution:**
```bash
# 1. Check if secrets are configured
node scripts/set-v3-oracle-secrets.mjs --dry-run

# 2. If not configured, restart with V3 secrets
ACCUWEATHER_API_KEY="your_key" \
V3_INGEST_HMAC_SECRET="your_32_char_secret" \
./scripts/restart-dev-environment.sh

# 3. Or inject secrets into running node
node scripts/set-v3-oracle-secrets.mjs \
    --accuweather-key "your_key" \
    --hmac-secret "your_32_char_secret"
```

**Verification:**
```bash
# Check V3 OCW logs
grep "prmx-oracle-v3" /tmp/prmx-node.log

# Monitor V3 policies
node scripts/monitor-v3-policies.mjs --check-secrets
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
| Oracle Service | `/tmp/oracle-service.log` | `tail -f /tmp/oracle-service.log` |
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

> **⚠️ CRITICAL: Both `ACCUWEATHER_API_KEY` and `V3_INGEST_HMAC_SECRET` are recommended for full functionality**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ACCUWEATHER_API_KEY` | **YES** | None | AccuWeather API key for V1 & V3 Oracles. **Must be set** for weather data fetching. |
| `V3_INGEST_HMAC_SECRET` | **YES** (V3) | None | HMAC secret for V3 Ingest API authentication. Required for V3 policy monitoring. Should be at least 32 characters. |
| `V3_INGEST_API_URL` | Optional | `http://localhost:3001` | V3 Ingest API URL (where off-chain oracle service runs) |
| `R_PRICING_API_KEY` | Optional | `test_api_key` | R Pricing API key for quote pricing |
| `NODE_PATH` | Optional | `/tmp/node-v18.20.8-darwin-arm64/bin` | Path to Node.js binaries |
| `PRMX_DATA_DIR` | Optional | `/tmp/prmx-data` | Data directory for persistent mode |

### Setting Environment Variables

**Option 1: Inline (recommended for one-time use)**
```bash
ACCUWEATHER_API_KEY="your_key" ./scripts/restart-dev-environment.sh
```

**Option 2: Export in shell session**
```bash
export ACCUWEATHER_API_KEY="your_key"
export R_PRICING_API_KEY="your_key"
./scripts/restart-dev-environment.sh
```

**Option 3: Add to shell profile (persistent)**
```bash
# Add to ~/.bashrc or ~/.zshrc
export ACCUWEATHER_API_KEY="your_key"
export R_PRICING_API_KEY="your_key"
```

---

## Related Documentation

- [Oracle Design](./oracle-design.md) - Detailed oracle architecture
- [V1 vs V2 Oracle](./v1-v2-comparison.md) - Oracle version comparison
- [API Reference](./api-reference.md) - Chain RPC methods

---

*Last updated: December 2025*

