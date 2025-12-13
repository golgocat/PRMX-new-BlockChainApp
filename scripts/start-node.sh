#!/bin/bash
# PRMX Node Startup Script
# This script starts the node and optionally injects API keys via extrinsic.
#
# Usage:
#   ./scripts/start-node.sh [--dev] [--tmp] [additional node args...]
#
# Prerequisites:
#   - .env file with ACCUWEATHER_API_KEY set
#   - Node built with: cargo build --release
#   - Node.js installed for API key injection script
#
# Example:
#   # Start in dev mode with temporary database
#   ./scripts/start-node.sh --dev --tmp
#
#   # Start in dev mode with persistent database
#   ./scripts/start-node.sh --dev

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NODE_BIN="$PROJECT_ROOT/target/release/prmx-node"

# Load environment variables
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${GREEN}📁 Loading environment from .env${NC}"
    source "$PROJECT_ROOT/.env"
else
    echo -e "${YELLOW}⚠️  No .env file found. API keys will not be injected.${NC}"
fi

# Check if node binary exists
if [ ! -f "$NODE_BIN" ]; then
    echo -e "${RED}❌ Node binary not found at $NODE_BIN${NC}"
    echo -e "${YELLOW}   Build with: cargo build --release${NC}"
    exit 1
fi

# Function to inject API key via extrinsic after node starts
inject_api_key() {
    local NODE_URL="ws://127.0.0.1:9944"
    
    if [ -z "$ACCUWEATHER_API_KEY" ]; then
        echo -e "${YELLOW}⚠️  ACCUWEATHER_API_KEY not set. Skipping API key injection.${NC}"
        return 0
    fi
    
    echo -e "${CYAN}💉 API key injection scheduled...${NC}"
    
    # Wait for node to be ready
    sleep 12
    
    # Run the injection script
    cd "$SCRIPT_DIR" && node set-oracle-api-key.mjs "$ACCUWEATHER_API_KEY" "$NODE_URL" 2>&1 || {
        echo -e "${YELLOW}⚠️  API key injection failed (node may not be ready yet)${NC}"
        echo -e "${YELLOW}   You can manually inject later with:${NC}"
        echo -e "${YELLOW}   node scripts/set-oracle-api-key.mjs${NC}"
    }
}

# Start API key injection in background
if [ -n "$ACCUWEATHER_API_KEY" ]; then
    inject_api_key &
    INJECT_PID=$!
    echo -e "${GREEN}💉 API key injection scheduled in background (PID: $INJECT_PID)${NC}"
fi

# Print startup info
echo -e ""
echo -e "${GREEN}🚀 Starting PRMX Node...${NC}"
echo -e "${CYAN}   Binary: $NODE_BIN${NC}"
echo -e "${CYAN}   Args: $@${NC}"
echo -e ""

# Start the node (exec replaces this process)
exec "$NODE_BIN" "$@"
