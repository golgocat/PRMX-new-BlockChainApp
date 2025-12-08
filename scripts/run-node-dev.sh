#!/bin/bash
# PRMX Node Development Runner
# This script starts the node with the AccuWeather API key configured

# AccuWeather API Key for Oracle (testing only - DO NOT commit real keys to git)
export ACCUWEATHER_API_KEY="zpka_db8e78f41a5a431483111521abb69a4b_188626e6"

# Print configuration
echo "Starting PRMX Node with AccuWeather Oracle configured..."
echo "API Key: ${ACCUWEATHER_API_KEY:0:10}..."

# Run the node
cd "$(dirname "$0")/.."
./target/release/prmx-node --dev --tmp "$@"

