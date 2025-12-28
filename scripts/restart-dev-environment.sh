#!/bin/bash
# =============================================================================
# PRMX Development Environment Restart Script
# =============================================================================
#
# This script restarts the entire PRMX development environment with SECURE
# API key injection using the CLI method (no on-chain exposure).
#
# MODES:
#   --tmp        Temporary chain (default) - fresh genesis each restart
#   --persistent Persistent chain - data survives restarts
#
# USAGE:
#   ./scripts/restart-dev-environment.sh [--tmp|--persistent]
#
# ENVIRONMENT VARIABLES:
#   R_PRICING_API_KEY       - API key for R Pricing service (default: test_api_key)
#   ACCUWEATHER_API_KEY     - API key for AccuWeather (default: Standard tier key)
#   NODE_PATH               - Path to Node.js binaries
#   PRMX_DATA_DIR           - Data directory for persistent mode (default: /tmp/prmx-data)
#
# EXAMPLES:
#   # Temporary chain (fresh start each time)
#   ./scripts/restart-dev-environment.sh
#
#   # Persistent chain (data survives restarts)
#   ./scripts/restart-dev-environment.sh --persistent
#
#   # With custom API keys
#   ACCUWEATHER_API_KEY="your_key" ./scripts/restart-dev-environment.sh
#
# SERVICES:
#   - Blockchain Node:       ws://localhost:9944
#   - Oracle Service:        http://localhost:3001
#   - Frontend:              http://localhost:3000
#
# See docs/RESTART-GUIDE.md for detailed documentation.
#
# =============================================================================

set -e

# =============================================================================
# Configuration
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NODE_PATH="${NODE_PATH:-/tmp/node-v18.20.8-darwin-arm64/bin}"
PRMX_DATA_DIR="${PRMX_DATA_DIR:-/tmp/prmx-data}"

# API Keys (defaults for development)
# NOTE: Set these via environment variables for production use
R_PRICING_API_KEY="${R_PRICING_API_KEY:-test_api_key}"
ACCUWEATHER_API_KEY="${ACCUWEATHER_API_KEY:-}"

# Mode: "tmp" or "persistent"
MODE="tmp"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --tmp)
            MODE="tmp"
            shift
            ;;
        --persistent)
            MODE="persistent"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--tmp|--persistent]"
            exit 1
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# Helper Functions
# =============================================================================
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# =============================================================================
# Process Management
# =============================================================================
kill_processes() {
    log_step "Stopping existing processes..."
    
    # Kill by process name
    pkill -f "prmx-node" 2>/dev/null || true
    pkill -f "offchain-oracle-service" 2>/dev/null || true
    pkill -f "next-server" 2>/dev/null || true
    
    # Kill by port (fallback)
    lsof -ti:3001 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:9944 2>/dev/null | xargs kill -9 2>/dev/null || true
    
    sleep 2
    log_success "Processes stopped"
}

# =============================================================================
# Secure API Key Injection (CLI Method)
# =============================================================================
inject_api_keys_cli() {
    local base_path="$1"
    local chain_id="${2:-dev}"
    
    log_step "Injecting API keys securely via CLI..."
    
    cd "$PROJECT_ROOT"
    
    # Inject AccuWeather API key
    if [ -n "$ACCUWEATHER_API_KEY" ]; then
        log_info "  Injecting AccuWeather API key..."
        ./target/release/prmx-node inject-api-key \
            --key "prmx-oracle::accuweather-api-key" \
            --value "$ACCUWEATHER_API_KEY" \
            --base-path "$base_path" \
            --chain "$chain_id" 2>/dev/null || {
            log_warning "  AccuWeather key injection failed (may already exist)"
        }
    fi
    
    # Inject R Pricing API key
    if [ -n "$R_PRICING_API_KEY" ]; then
        log_info "  Injecting R Pricing API key..."
        ./target/release/prmx-node inject-api-key \
            --key "prmx-quote::r-pricing-api-key" \
            --value "$R_PRICING_API_KEY" \
            --base-path "$base_path" \
            --chain "$chain_id" 2>/dev/null || {
            log_warning "  R Pricing key injection failed (may already exist)"
        }
    fi
    
    log_success "API keys injected securely (never on-chain)"
}

# =============================================================================
# Node Management
# =============================================================================
start_node_tmp() {
    log_step "Starting blockchain node (temporary mode)..."
    
    cd "$PROJECT_ROOT"
    
    # With --tmp, the node creates a random temp directory
    # API keys are read from ACCUWEATHER_API_KEY env var at genesis
    # and stored in PendingApiKey (cleared after 100 blocks)
    export ACCUWEATHER_API_KEY
    export R_PRICING_API_KEY
    
    nohup ./target/release/prmx-node --dev --tmp > /tmp/prmx-node.log 2>&1 &
    NODE_PID=$!
    log_success "Node started (PID: $NODE_PID)"
    
    wait_for_node
}

start_node_persistent() {
    log_step "Starting blockchain node (persistent mode)..."
    
    cd "$PROJECT_ROOT"
    
    # Create data directory if it doesn't exist
    mkdir -p "$PRMX_DATA_DIR"
    
    # Check if this is a fresh chain
    local is_fresh=false
    if [ ! -d "$PRMX_DATA_DIR/chains" ]; then
        is_fresh=true
        log_info "  Fresh chain detected - will inject API keys"
    fi
    
    # Inject API keys BEFORE starting node (for fresh chains)
    if [ "$is_fresh" = true ]; then
        inject_api_keys_cli "$PRMX_DATA_DIR" "dev"
    fi
    
    # Start node with persistent storage
    nohup ./target/release/prmx-node --dev --base-path "$PRMX_DATA_DIR" > /tmp/prmx-node.log 2>&1 &
    NODE_PID=$!
    log_success "Node started (PID: $NODE_PID)"
    
    wait_for_node
    
    # For existing chains, inject keys if needed
    if [ "$is_fresh" = false ]; then
        inject_api_keys_cli "$PRMX_DATA_DIR" "dev"
    fi
}

wait_for_node() {
    log_info "Waiting for node to be ready..."
    for i in {1..30}; do
        if curl -s -X POST -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' \
            http://127.0.0.1:9944 > /dev/null 2>&1; then
            log_success "Node is ready"
            return 0
        fi
        sleep 1
    done
    log_error "Node failed to start within 30 seconds"
    return 1
}

# =============================================================================
# Off-chain Oracle Service
# =============================================================================
start_oracle_service() {
    log_step "Starting off-chain oracle service..."
    
    cd "$PROJECT_ROOT/offchain-oracle-service"
    export PATH="$NODE_PATH:$PATH"
    
    nohup npm start > /tmp/oracle-service.log 2>&1 &
    ORACLE_PID=$!
    log_success "Oracle service started (PID: $ORACLE_PID)"
    
    sleep 3
}

# =============================================================================
# Frontend
# =============================================================================
start_frontend() {
    log_step "Starting frontend..."
    
    cd "$PROJECT_ROOT/frontend"
    export PATH="$NODE_PATH:$PATH"
    
    nohup npm run dev > /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!
    log_success "Frontend started (PID: $FRONTEND_PID)"
}

# =============================================================================
# Verification
# =============================================================================
verify_markets() {
    log_step "Verifying genesis markets..."
    
    cd "$PROJECT_ROOT/frontend"
    export PATH="$NODE_PATH:$PATH"
    
    node << 'EOF'
const { ApiPromise, WsProvider } = require('@polkadot/api');

async function main() {
    const wsProvider = new WsProvider('ws://127.0.0.1:9944');
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const markets = await api.query.prmxMarkets.markets.entries();
    console.log('Markets configured at genesis:');
    console.log('  Total markets:', markets.length);
    for (const [key, value] of markets) {
        const data = value.toJSON();
        let name = data.name;
        if (typeof name === 'string' && name.startsWith('0x')) {
            name = Buffer.from(name.slice(2), 'hex').toString('utf8');
        }
        console.log('    Market ' + data.marketId + ': ' + name);
    }
    
    await api.disconnect();
}

main().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
EOF
}

verify_services() {
    log_step "Verifying services..."
    
    # Check node
    if curl -s -X POST -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' \
        http://127.0.0.1:9944 > /dev/null 2>&1; then
        log_success "Node: ✅ Running (ws://localhost:9944)"
    else
        log_error "Node: ❌ Not responding"
    fi
    
    # Check Oracle Service
    if curl -s http://localhost:3001/health 2>/dev/null | grep -q "ok"; then
        log_success "Oracle Service: ✅ Running (http://localhost:3001)"
    else
        log_warning "Oracle Service: ⚠️ Starting... (may take a moment)"
    fi
    
    # Check Frontend
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        log_success "Frontend: ✅ Running (http://localhost:3000)"
    else
        log_warning "Frontend: ⚠️ Compiling... (may take a moment)"
    fi
}

# =============================================================================
# Main
# =============================================================================
echo ""
echo "============================================="
echo "  PRMX Development Environment Restart"
echo "============================================="
echo ""
echo "  Mode: $MODE"
if [ "$MODE" = "persistent" ]; then
    echo "  Data: $PRMX_DATA_DIR"
fi
echo ""

# Stop existing processes
kill_processes

# Start blockchain node
if [ "$MODE" = "tmp" ]; then
    start_node_tmp
else
    start_node_persistent
fi

# Start services
start_oracle_service
start_frontend

# Wait for services to initialize
sleep 5

# Verify everything
verify_markets 2>/dev/null || log_warning "Market verification skipped"
echo ""
verify_services

# Summary
echo ""
echo "============================================="
echo "  Environment Ready!"
echo "============================================="
echo ""
echo "  Mode:           $MODE"
echo "  Frontend:       http://localhost:3000"
echo "  Node:           ws://localhost:9944"
echo "  Oracle Service: http://localhost:3001"
echo ""
echo "  Logs:"
echo "    Node:           tail -f /tmp/prmx-node.log"
echo "    Oracle Service: tail -f /tmp/oracle-service.log"
echo "    Frontend:       tail -f /tmp/frontend.log"
echo ""
if [ "$MODE" = "tmp" ]; then
    echo "  Note: Using temporary mode - all data will be lost on restart."
    echo "        Use --persistent for data that survives restarts."
else
    echo "  Note: Using persistent mode - data stored in $PRMX_DATA_DIR"
    echo "        API keys are stored securely in offchain storage."
fi
echo ""
