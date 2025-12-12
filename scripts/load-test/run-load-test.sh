#!/bin/bash
#
# PRMX Load Test Runner
# 
# This script runs the full load test with event logging.
# Usage: ./run-load-test.sh [quick|full]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  PRMX Load Test Runner${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if node is running
if ! curl -s http://127.0.0.1:9944 > /dev/null 2>&1; then
    echo -e "${RED}Error: Node not running on ws://127.0.0.1:9944${NC}"
    echo "Please start the node first with:"
    echo "  ./target/release/prmx-node --dev"
    exit 1
fi

echo -e "${GREEN}✓ Node is running${NC}"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Determine test type
TEST_TYPE="${1:-quick}"

case "$TEST_TYPE" in
    quick)
        POLICIES=10
        INTERVAL=10
        DURATION=30
        echo -e "${YELLOW}Running QUICK test (10 policies, ~5 minutes)${NC}"
        ;;
    full)
        POLICIES=120
        INTERVAL=30
        DURATION=60
        echo -e "${YELLOW}Running FULL test (120 policies, ~1 hour)${NC}"
        ;;
    *)
        echo -e "${RED}Unknown test type: $TEST_TYPE${NC}"
        echo "Usage: $0 [quick|full]"
        exit 1
        ;;
esac

echo ""
echo -e "${CYAN}Configuration:${NC}"
echo "  Policies:  $POLICIES"
echo "  Interval:  ${INTERVAL}s"
echo "  Duration:  ${DURATION}s"
echo ""

# Start event listener in background
echo -e "${YELLOW}Starting event listener...${NC}"
node event-listener.mjs &
LISTENER_PID=$!

# Give listener time to connect
sleep 2

# Trap to clean up on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Cleaning up...${NC}"
    kill $LISTENER_PID 2>/dev/null || true
    echo -e "${GREEN}Done${NC}"
}
trap cleanup EXIT

# Run the load test
echo -e "${YELLOW}Starting load test...${NC}"
echo ""

node load-test.mjs \
    --policies=$POLICIES \
    --interval=$INTERVAL \
    --duration=$DURATION \
    --trigger-interval=180 \
    --trigger-prob=50

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Test Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Results written to: test-results.log"
echo ""

