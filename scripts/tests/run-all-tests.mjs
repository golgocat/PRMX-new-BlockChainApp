#!/usr/bin/env node
/**
 * Unified Test Runner for PRMX Test Suite
 * 
 * Orchestrates all test suites and produces a summary report:
 * - V1 Policy Lifecycle
 * - V2 Policy Lifecycle
 * - V3 Policy Lifecycle
 * - Cross-Version Coexistence
 * 
 * Usage: 
 *   node run-all-tests.mjs [ws-endpoint]
 *   node run-all-tests.mjs --suite v1,v3
 *   node run-all-tests.mjs --list
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_WS_ENDPOINT = 'ws://127.0.0.1:9944';

const TEST_SUITES = [
    {
        id: 'v1',
        name: 'V1 Policy Lifecycle',
        file: 'test-v1-lifecycle.mjs',
        description: 'Complete V1 policy flow with hash-based IDs',
    },
    {
        id: 'v2',
        name: 'V2 Policy Lifecycle',
        file: 'test-v2-lifecycle.mjs',
        description: 'Complete V2 policy flow with custom strike',
    },
    {
        id: 'v3',
        name: 'V3 P2P Policy Lifecycle',
        file: 'test-v3-lifecycle.mjs',
        description: 'Complete V3 P2P underwriting flow',
    },
    {
        id: 'cross',
        name: 'Cross-Version Coexistence',
        file: 'test-cross-version.mjs',
        description: 'Verify V1/V2/V3 policies coexist without ID collisions',
    },
    {
        id: 'lp',
        name: 'LP Orderbook Trading',
        file: 'test-lp-trading.mjs',
        description: 'LP token trading, ask orders, and order fills',
    },
    {
        id: 'oracle',
        name: 'Oracle Advanced',
        file: 'test-oracle-advanced.mjs',
        description: 'Threshold breach detection and auto-settlement',
    },
    {
        id: 'edge',
        name: 'Edge Cases',
        file: 'test-edge-cases.mjs',
        description: 'Expiration, partial scenarios, and error handling',
    },
    {
        id: 'multi',
        name: 'Multi-Party Scenarios',
        file: 'test-multi-party.mjs',
        description: 'Multiple policyholders, underwriters, and LP transfers',
    },
    {
        id: 'frontend',
        name: 'Frontend API Integration',
        file: 'test-frontend-api.mjs',
        description: 'H128 ID display, policy queries, and LP holdings via API',
    },
];

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        wsEndpoint: DEFAULT_WS_ENDPOINT,
        suites: TEST_SUITES.map(s => s.id),
        listOnly: false,
        verbose: false,
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--list' || arg === '-l') {
            config.listOnly = true;
        } else if (arg === '--suite' || arg === '-s') {
            if (i + 1 < args.length) {
                config.suites = args[++i].split(',').map(s => s.trim());
            }
        } else if (arg === '--verbose' || arg === '-v') {
            config.verbose = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (arg.startsWith('ws://') || arg.startsWith('wss://')) {
            config.wsEndpoint = arg;
        }
    }
    
    return config;
}

function printHelp() {
    console.log(`
PRMX Comprehensive Test Runner

Usage:
  node run-all-tests.mjs [options] [ws-endpoint]

Options:
  --list, -l          List available test suites
  --suite, -s <ids>   Run specific suites (comma-separated)
  --verbose, -v       Show detailed output
  --help, -h          Show this help

Examples:
  node run-all-tests.mjs                      # Run all suites
  node run-all-tests.mjs ws://localhost:9944  # Custom endpoint
  node run-all-tests.mjs --suite v1,v3        # Run V1 and V3 only
  node run-all-tests.mjs --list               # List suites

Test Suites:
${TEST_SUITES.map(s => `  ${s.id.padEnd(8)} - ${s.name}`).join('\n')}
`);
}

function listSuites() {
    console.log('\n📋 Available Test Suites:\n');
    for (const suite of TEST_SUITES) {
        console.log(`  ${suite.id.padEnd(8)} │ ${suite.name}`);
        console.log(`           │ ${suite.description}`);
        console.log(`           │ File: ${suite.file}`);
        console.log('');
    }
}

// =============================================================================
// Test Execution
// =============================================================================

function runTestSuite(suite, wsEndpoint) {
    return new Promise((resolve) => {
        const testPath = join(__dirname, suite.file);
        const startTime = Date.now();
        let output = '';
        
        console.log(`\n${'━'.repeat(70)}`);
        console.log(`🧪 Running: ${suite.name}`);
        console.log(`   File: ${suite.file}`);
        console.log(`${'━'.repeat(70)}\n`);
        
        const child = spawn('node', [testPath, wsEndpoint], {
            cwd: __dirname,
            stdio: ['inherit', 'pipe', 'pipe'],
        });
        
        child.stdout.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stdout.write(str);
        });
        
        child.stderr.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stderr.write(str);
        });
        
        child.on('close', (code) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            // Extract test counts from output
            const passMatch = output.match(/Passed:\s*(\d+)/);
            const failMatch = output.match(/Failed:\s*(\d+)/);
            
            const passed = passMatch ? parseInt(passMatch[1]) : (code === 0 ? 1 : 0);
            const failed = failMatch ? parseInt(failMatch[1]) : (code !== 0 ? 1 : 0);
            
            resolve({
                suite: suite.name,
                suiteId: suite.id,
                passed,
                failed,
                exitCode: code,
                duration,
                success: code === 0,
            });
        });
        
        child.on('error', (error) => {
            console.error(`   Error running ${suite.file}: ${error.message}`);
            resolve({
                suite: suite.name,
                suiteId: suite.id,
                passed: 0,
                failed: 1,
                exitCode: 1,
                duration: '0',
                success: false,
                error: error.message,
            });
        });
    });
}

// =============================================================================
// Summary Report
// =============================================================================

function printSummary(results, totalDuration) {
    console.log('\n');
    console.log('╔' + '═'.repeat(68) + '╗');
    console.log('║' + '  📊 COMPREHENSIVE TEST SUMMARY'.padEnd(68) + '║');
    console.log('╠' + '═'.repeat(68) + '╣');
    
    let totalPassed = 0;
    let totalFailed = 0;
    let suitesPass = 0;
    let suitesFail = 0;
    
    for (const result of results) {
        const status = result.success ? '✅' : '❌';
        const line = `  ${status} ${result.suite.padEnd(35)} ${result.passed}/${result.passed + result.failed} tests (${result.duration}s)`;
        console.log('║' + line.padEnd(68) + '║');
        
        totalPassed += result.passed;
        totalFailed += result.failed;
        if (result.success) suitesPass++;
        else suitesFail++;
    }
    
    console.log('╠' + '═'.repeat(68) + '╣');
    
    const totalTests = totalPassed + totalFailed;
    const summaryLine1 = `  Suites: ${suitesPass} passed, ${suitesFail} failed (${results.length} total)`;
    const summaryLine2 = `  Tests:  ${totalPassed} passed, ${totalFailed} failed (${totalTests} total)`;
    const summaryLine3 = `  Time:   ${totalDuration}s`;
    
    console.log('║' + summaryLine1.padEnd(68) + '║');
    console.log('║' + summaryLine2.padEnd(68) + '║');
    console.log('║' + summaryLine3.padEnd(68) + '║');
    
    console.log('╠' + '═'.repeat(68) + '╣');
    
    const overallStatus = totalFailed === 0 ? '  ✅ ALL TESTS PASSED' : `  ❌ ${totalFailed} TESTS FAILED`;
    console.log('║' + overallStatus.padEnd(68) + '║');
    
    console.log('╚' + '═'.repeat(68) + '╝');
    console.log('');
    
    // Print failures if any
    if (totalFailed > 0) {
        console.log('Failed suites:');
        for (const result of results.filter(r => !r.success)) {
            console.log(`  ❌ ${result.suite}`);
            if (result.error) {
                console.log(`     Error: ${result.error}`);
            }
        }
        console.log('');
    }
    
    return { totalPassed, totalFailed, suitesPass, suitesFail };
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    const config = parseArgs();
    
    console.log('');
    console.log('╔' + '═'.repeat(68) + '╗');
    console.log('║' + '  🧪 PRMX COMPREHENSIVE TEST SUITE'.padEnd(68) + '║');
    console.log('║' + `  Testing H128 Hash-Based ID Implementation`.padEnd(68) + '║');
    console.log('╚' + '═'.repeat(68) + '╝');
    
    if (config.listOnly) {
        listSuites();
        process.exit(0);
    }
    
    // Filter suites based on config
    const suitesToRun = TEST_SUITES.filter(s => config.suites.includes(s.id));
    
    if (suitesToRun.length === 0) {
        console.error('\n❌ No valid test suites selected.');
        console.log('   Available: ' + TEST_SUITES.map(s => s.id).join(', '));
        process.exit(1);
    }
    
    console.log(`\n📡 WebSocket Endpoint: ${config.wsEndpoint}`);
    console.log(`📋 Running ${suitesToRun.length} test suite(s): ${suitesToRun.map(s => s.id).join(', ')}`);
    
    const startTime = Date.now();
    const results = [];
    
    for (const suite of suitesToRun) {
        const result = await runTestSuite(suite, config.wsEndpoint);
        results.push(result);
    }
    
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = printSummary(results, totalDuration);
    
    // Exit with appropriate code
    process.exit(summary.totalFailed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(`\n❌ Test runner failed: ${error.message}`);
    process.exit(1);
});

