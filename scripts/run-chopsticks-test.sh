#!/bin/bash
# =============================================================================
# PRMX XCM Chopsticks Test Runner
# =============================================================================
#
# This script runs the multi-chain XCM test environment using Chopsticks
# to fork Polkadot, Asset Hub, and Hydration mainnet state.
#
# Usage:
#   ./scripts/run-chopsticks-test.sh [test-name]
#
# Examples:
#   ./scripts/run-chopsticks-test.sh           # Run all tests
#   ./scripts/run-chopsticks-test.sh deposit   # Run deposit test only
#   ./scripts/run-chopsticks-test.sh withdraw  # Run withdraw test only
#   ./scripts/run-chopsticks-test.sh full      # Run full lifecycle test
#
# Prerequisites:
#   - Node.js >= 18
#   - Chopsticks: npm install -g @acala-network/chopsticks
#   - @polkadot/api: npm install in scripts/chopsticks-tests
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CHOPSTICKS_DIR="$PROJECT_DIR/chopsticks"
TEST_DIR="$SCRIPT_DIR/chopsticks-tests"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}       PRMX XCM Chopsticks Test Runner${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

# =============================================================================
# Prerequisites Check
# =============================================================================

check_prerequisites() {
    echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js not found. Please install Node.js >= 18${NC}"
        exit 1
    fi
    echo -e "   ✅ Node.js $(node --version)"
    
    # Check Chopsticks (use local version from node_modules)
    if [ ! -f "$TEST_DIR/node_modules/.bin/chopsticks" ]; then
        echo -e "${YELLOW}   Installing Chopsticks locally...${NC}"
        cd "$TEST_DIR"
        npm install @acala-network/chopsticks --save-dev
        cd "$PROJECT_DIR"
    fi
    echo -e "   ✅ Chopsticks installed (local)"
    
    # Set PATH to include local node_modules
    export PATH="$TEST_DIR/node_modules/.bin:$PATH"
    
    # Check test directory dependencies
    if [ ! -d "$TEST_DIR/node_modules" ]; then
        echo -e "${YELLOW}   Installing test dependencies...${NC}"
        cd "$TEST_DIR"
        npm install @polkadot/api @polkadot/keyring @polkadot/util
        cd "$PROJECT_DIR"
    fi
    echo -e "   ✅ Test dependencies installed"
    
    # Create db directory for Chopsticks
    mkdir -p "$CHOPSTICKS_DIR/db"
    echo -e "   ✅ Chopsticks db directory ready"
    
    echo ""
}

# =============================================================================
# Start Chopsticks
# =============================================================================

start_chopsticks() {
    echo -e "${YELLOW}🚀 Starting Chopsticks multi-chain environment...${NC}"
    echo -e "   This will fork:"
    echo -e "   - Polkadot Relay Chain (port 9000)"
    echo -e "   - Asset Hub (port 8001)"
    echo -e "   - Hydration (port 8000)"
    echo ""
    
    # Start Chopsticks in background
    cd "$CHOPSTICKS_DIR"
    
    # For multi-chain XCM testing
    chopsticks xcm --config xcm-test.yml &
    CHOPSTICKS_PID=$!
    
    cd "$PROJECT_DIR"
    
    echo -e "${YELLOW}   Waiting for chains to initialize (30s)...${NC}"
    sleep 30
    
    # Check if Chopsticks is still running
    if ! kill -0 $CHOPSTICKS_PID 2>/dev/null; then
        echo -e "${RED}❌ Chopsticks failed to start${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}   ✅ Chopsticks running (PID: $CHOPSTICKS_PID)${NC}"
    echo ""
}

# =============================================================================
# Run Tests
# =============================================================================

run_test() {
    local test_name=$1
    local test_file=""
    
    case $test_name in
        "hrmp"|"setup")
            test_file="setup-hrmp-channels.mjs"
            ;;
        "deposit")
            test_file="test-xcm-deposit.mjs"
            ;;
        "withdraw")
            test_file="test-xcm-withdraw.mjs"
            ;;
        "full"|"lifecycle")
            test_file="test-full-xcm-cycle.mjs"
            ;;
        *)
            echo -e "${RED}Unknown test: $test_name${NC}"
            echo "Available tests: hrmp, deposit, withdraw, full"
            return 1
            ;;
    esac
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}   Running: $test_file${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    node "$TEST_DIR/$test_file"
    
    echo ""
}

run_all_tests() {
    echo -e "${YELLOW}🧪 Running all XCM tests...${NC}"
    echo ""
    
    run_test "hrmp"
    run_test "deposit"
    run_test "withdraw"
    run_test "full"
}

# =============================================================================
# Cleanup
# =============================================================================

cleanup() {
    echo ""
    echo -e "${YELLOW}🧹 Cleaning up...${NC}"
    
    if [ ! -z "$CHOPSTICKS_PID" ]; then
        echo -e "   Stopping Chopsticks (PID: $CHOPSTICKS_PID)..."
        kill $CHOPSTICKS_PID 2>/dev/null || true
    fi
    
    echo -e "${GREEN}   ✅ Cleanup complete${NC}"
}

trap cleanup EXIT

# =============================================================================
# Main
# =============================================================================

main() {
    check_prerequisites
    
    # Parse arguments
    TEST_NAME="${1:-all}"
    
    if [ "$TEST_NAME" == "no-start" ]; then
        # Run tests without starting Chopsticks (assume it's already running)
        TEST_NAME="${2:-all}"
        echo -e "${YELLOW}ℹ️  Skipping Chopsticks start (assuming already running)${NC}"
        echo ""
    else
        start_chopsticks
    fi
    
    # Run tests
    if [ "$TEST_NAME" == "all" ]; then
        run_all_tests
    else
        run_test "$TEST_NAME"
    fi
    
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}   🎉 XCM Tests Complete!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
}

main "$@"
