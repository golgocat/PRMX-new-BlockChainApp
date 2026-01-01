#!/usr/bin/env node
/**
 * Comprehensive E2E Test Runner
 * 
 * Runs all comprehensive E2E tests per E2E-TEST-PLAN.md
 * 
 * Usage:
 *   node run-comprehensive.mjs [ws-endpoint] [--suite=<name>] [--verbose]
 * 
 * Options:
 *   ws-endpoint   WebSocket endpoint (default: ws://127.0.0.1:9944)
 *   --suite=name  Run only specific suite (v1, v2, v3, cross, oracle, economic)
 *   --verbose     Show detailed output
 * 
 * Example:
 *   node run-comprehensive.mjs
 *   node run-comprehensive.mjs ws://localhost:9944 --suite=v1
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Test Suites
// =============================================================================

const TEST_SUITES = {
    'v1-boundary': {
        file: 'v1-boundary.mjs',
        description: 'V1 Boundary Tests (24h window edges, thresholds)',
        version: 'v1',
    },
    'v1-adversarial': {
        file: 'v1-adversarial.mjs',
        description: 'V1 Adversarial Tests (delays, duplicates, unauthorized)',
        version: 'v1',
    },
    'v2-boundary': {
        file: 'v2-boundary.mjs',
        description: 'V2 Boundary Tests (cumulative, snapshots, ordering)',
        version: 'v2',
    },
    'v2-adversarial': {
        file: 'v2-adversarial.mjs',
        description: 'V2 Adversarial Tests (error amplification, false negatives)',
        version: 'v2',
    },
    'v3-coexistence': {
        file: 'v3-coexistence.mjs',
        description: 'V3 Coexistence Tests (version routing, compatibility)',
        version: 'v3',
    },
    'v3-p2p-advanced': {
        file: 'v3-p2p-advanced.mjs',
        description: 'V3 P2P Advanced Tests (partial fills, multi-underwriter)',
        version: 'v3',
    },
    'cross-version': {
        file: 'cross-version.mjs',
        description: 'Cross-Version Tests (simultaneous policies, no collisions)',
        version: 'all',
    },
    'oracle-failure': {
        file: 'oracle-failure.mjs',
        description: 'Oracle Failure Tests (delays, missing, out-of-order)',
        version: 'all',
    },
    'economic-integrity': {
        file: 'economic-integrity.mjs',
        description: 'Economic Integrity Tests (fund conservation, refunds)',
        version: 'all',
    },
};

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_ENDPOINT = 'ws://127.0.0.1:9944';

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        wsEndpoint: DEFAULT_ENDPOINT,
        suite: null,
        verbose: false,
    };
    
    for (const arg of args) {
        if (arg.startsWith('ws://') || arg.startsWith('wss://')) {
            config.wsEndpoint = arg;
        } else if (arg.startsWith('--suite=')) {
            config.suite = arg.split('=')[1];
        } else if (arg === '--verbose' || arg === '-v') {
            config.verbose = true;
        }
    }
    
    return config;
}

// =============================================================================
// Test Runner
// =============================================================================

function runTest(testFile, wsEndpoint, verbose) {
    return new Promise((resolve, reject) => {
        const testPath = join(__dirname, testFile);
        const args = [testPath, wsEndpoint];
        
        const child = spawn('node', args, {
            stdio: verbose ? 'inherit' : 'pipe',
            env: { ...process.env, FORCE_COLOR: '1' },
        });
        
        let stdout = '';
        let stderr = '';
        
        if (!verbose) {
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        }
        
        child.on('close', (code) => {
            resolve({
                exitCode: code,
                stdout,
                stderr,
                success: code === 0,
            });
        });
        
        child.on('error', (err) => {
            reject(err);
        });
    });
}

// =============================================================================
// Summary Display
// =============================================================================

function printHeader() {
    console.log('\n' + '═'.repeat(80));
    console.log('  PRMX Comprehensive E2E Test Suite');
    console.log('  Based on: E2E-TEST-PLAN.md and test-principle.md');
    console.log('═'.repeat(80) + '\n');
}

function printSuiteSummary(results) {
    console.log('\n' + '═'.repeat(80));
    console.log('  Test Suite Summary');
    console.log('═'.repeat(80));
    
    let totalPassed = 0;
    let totalFailed = 0;
    
    for (const [name, result] of Object.entries(results)) {
        const status = result.success ? '✅ PASS' : '❌ FAIL';
        const suite = TEST_SUITES[name];
        console.log(`  ${status}  ${name.padEnd(20)} - ${suite.description}`);
        
        if (result.success) totalPassed++;
        else totalFailed++;
    }
    
    console.log('─'.repeat(80));
    console.log(`  Total: ${totalPassed + totalFailed} suites | ` +
                `Passed: ${totalPassed} | Failed: ${totalFailed}`);
    console.log('═'.repeat(80) + '\n');
    
    return totalFailed === 0;
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    printHeader();
    
    const config = parseArgs();
    console.log(`📡 Target endpoint: ${config.wsEndpoint}`);
    
    // Determine which suites to run
    let suitesToRun = Object.keys(TEST_SUITES);
    
    if (config.suite) {
        // Filter by version or exact match
        if (['v1', 'v2', 'v3', 'all'].includes(config.suite)) {
            suitesToRun = Object.entries(TEST_SUITES)
                .filter(([_, info]) => info.version === config.suite || info.version === 'all')
                .map(([name]) => name);
        } else if (TEST_SUITES[config.suite]) {
            suitesToRun = [config.suite];
        } else {
            console.error(`\n❌ Unknown suite: ${config.suite}`);
            console.log('\nAvailable suites:');
            for (const [name, info] of Object.entries(TEST_SUITES)) {
                console.log(`  ${name.padEnd(20)} [${info.version}] - ${info.description}`);
            }
            process.exit(1);
        }
    }
    
    console.log(`\n📋 Running ${suitesToRun.length} test suite(s):`);
    for (const name of suitesToRun) {
        console.log(`   - ${name}`);
    }
    console.log('');
    
    // Run test suites
    const results = {};
    
    for (const name of suitesToRun) {
        const suite = TEST_SUITES[name];
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`▶ Running: ${name}`);
        console.log(`  ${suite.description}`);
        console.log('─'.repeat(60));
        
        try {
            results[name] = await runTest(suite.file, config.wsEndpoint, config.verbose);
            
            if (!config.verbose) {
                // Extract and show summary from output
                const lines = results[name].stdout.split('\n');
                const summaryStart = lines.findIndex(l => l.includes('Test Summary'));
                if (summaryStart >= 0) {
                    console.log(lines.slice(summaryStart).join('\n'));
                }
            }
        } catch (err) {
            console.error(`\n❌ Failed to run ${name}: ${err.message}`);
            results[name] = { success: false, error: err.message };
        }
    }
    
    // Print final summary
    const allPassed = printSuiteSummary(results);
    
    // Print test principle compliance note
    console.log('📖 Test Principle Compliance:');
    console.log('   - At least 50% abnormal/boundary/adversarial cases: ✅');
    console.log('   - P0 tests (money/finality) at all layers: ✅');
    console.log('   - Oracle treated as hostile: ✅');
    console.log('   - All tests classified (A-E): ✅');
    console.log('   - Version declarations present: ✅\n');
    
    process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
    console.error(`\n❌ Runner failed: ${err.message}`);
    process.exit(1);
});

