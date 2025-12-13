#!/bin/bash
# PRMX Node Development Runner
# This script starts the node with automatic API key injection.
#
# The API key is loaded from the .env file in the project root.
# Create your .env file based on .env.example and add your AccuWeather API key.

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment variables from .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${GREEN}📁 Loading environment from .env${NC}"
    source "$PROJECT_ROOT/.env"
else
    echo -e "${YELLOW}⚠️  No .env file found!${NC}"
    echo -e "${YELLOW}   Please create one based on .env.example:${NC}"
    echo -e "${YELLOW}   cp .env.example .env${NC}"
    echo -e "${YELLOW}   Then add your ACCUWEATHER_API_KEY${NC}"
    echo ""
fi

# Print configuration
echo -e ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}              PRMX Node Development Mode${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
if [ -n "$ACCUWEATHER_API_KEY" ]; then
    echo -e "${GREEN}✅ AccuWeather API Key: ${ACCUWEATHER_API_KEY:0:10}...${ACCUWEATHER_API_KEY: -4}${NC}"
else
    echo -e "${YELLOW}⚠️  AccuWeather API Key: Not configured${NC}"
fi
echo -e ""

# Use the start-node.sh script which handles injection
exec "$SCRIPT_DIR/start-node.sh" --dev --tmp "$@"
