#!/usr/bin/env node
/**
 * Shared Test Utilities for PRMX Test Suite
 * 
 * Provides common utilities for all test scripts with H128 hash-based ID support.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// =============================================================================
// Configuration
// =============================================================================

export const WS_ENDPOINT = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9944';
export const USDT_ASSET_ID = 1;
export const USDT_DECIMALS = 6;
export const MARKET_ID = 0; // Manila market
export const MANILA_LAT = 14_599_500;
export const MANILA_LON = 120_984_200;
export const MANILA_ACCUWEATHER_KEY = '3423441';
export const V3_LOCATION_ID = 0;
export const DEFAULT_STRIKE_MM = 500; // 50mm in tenths
export const DEFAULT_PROBABILITY_PPM = 50_000; // 5%
export const V3_PAYOUT_PER_SHARE = 100_000_000n; // $100 per share

// Base timestamp for oracle time calculation
const BASE_TIMESTAMP_SECS = 1733616000; // Dec 8, 2025 00:00 UTC

// =============================================================================
// Test Result Tracking
// =============================================================================

export class TestResults {
    constructor(suiteName) {
        this.suiteName = suiteName;
        this.passed = 0;
        this.failed = 0;
        this.tests = [];
        this.startTime = Date.now();
    }

    log(name, passed, details = '') {
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`   ${status}: ${name}${details ? ' - ' + details : ''}`);
        this.tests.push({ name, passed, details });
        if (passed) this.passed++;
        else this.failed++;
    }

    summary() {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        console.log('\n' + '═'.repeat(70));
        console.log(`📊 ${this.suiteName} - Test Summary`);
        console.log('═'.repeat(70));
        console.log(`   Total: ${this.passed + this.failed} | Passed: ${this.passed} | Failed: ${this.failed}`);
        console.log(`   Duration: ${elapsed}s`);
        
        if (this.failed > 0) {
            console.log('\n   Failed tests:');
            for (const test of this.tests.filter(t => !t.passed)) {
                console.log(`      ❌ ${test.name}: ${test.details}`);
            }
        }
        console.log('═'.repeat(70) + '\n');
        
        return { 
            suiteName: this.suiteName,
            passed: this.passed, 
            failed: this.failed, 
            tests: this.tests,
            duration: elapsed
        };
    }
}

// =============================================================================
// Connection & Setup
// =============================================================================

export async function connectToNode(wsUrl = WS_ENDPOINT) {
    console.log(`📡 Connecting to ${wsUrl}...`);
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({ provider: wsProvider });
    const chain = await api.rpc.system.chain();
    const header = await api.rpc.chain.getHeader();
    console.log(`   ✅ Connected to ${chain} at block #${header.number.toNumber()}\n`);
    return api;
}

export function getKeyring() {
    const keyring = new Keyring({ type: 'sr25519' });
    return {
        alice: keyring.addFromUri('//Alice'),
        bob: keyring.addFromUri('//Bob'),
        charlie: keyring.addFromUri('//Charlie'),
        dave: keyring.addFromUri('//Dave'),
        eve: keyring.addFromUri('//Eve'),
        ferdie: keyring.addFromUri('//Ferdie'),
        dao: keyring.addFromUri('//DAO'),       // Dedicated DAO account
        oracle: keyring.addFromUri('//Oracle'), // Dedicated Oracle account
    };
}

export async function getDaoAccount() {
    const { encodeAddress } = await import('@polkadot/util-crypto');
    // Dedicated DAO account (//DAO) - defined in runtime/src/lib.rs
    // Address: 5EyKeA48QNY6LbD2QeN2JUuArTiyBTDN2BBYoLLCwz9rXdZS
    const daoAccountHex = '0x8099b04502498ba2936833a5715a95dbcd367628a4dd4792222b7bcb4aa79959';
    return encodeAddress(daoAccountHex, 42);
}

export async function getOracleAccount() {
    const { encodeAddress } = await import('@polkadot/util-crypto');
    // Dedicated Oracle account (//Oracle) - used by offchain-oracle-service
    // Address: 5ERNkbfECLx6hDuTwjVPrXgaGe7hE114d6rFz1d2LxcVFnbB
    const oracleAccountHex = '0x683c4ef19d8fec497566bf7c24c5d6e3625edecde19d80c39281e4686961fa74';
    return encodeAddress(oracleAccountHex, 42);
}

export function printAccounts(accounts) {
    console.log('👤 Test Accounts:');
    for (const [name, account] of Object.entries(accounts)) {
        console.log(`   ${name.charAt(0).toUpperCase() + name.slice(1)}: ${account.address.substring(0, 20)}...`);
    }
    console.log('');
}

// =============================================================================
// H128 ID Extraction
// =============================================================================

/**
 * Extract H128 ID from event data.
 * H128 IDs are represented as hex strings (0x...).
 */
export function extractH128Id(eventData) {
    if (!eventData) return null;
    // Handle both direct hex and encoded formats
    if (typeof eventData.toHex === 'function') {
        return eventData.toHex();
    }
    if (typeof eventData.toString === 'function') {
        const str = eventData.toString();
        // If it's already a hex string, return as-is
        if (str.startsWith('0x')) {
            return str;
        }
        // Otherwise try to convert
        return eventData.toHex ? eventData.toHex() : str;
    }
    return null;
}

/**
 * Find an event by pallet and method, and extract H128 ID from specified data index.
 */
export function findEventAndExtractId(events, palletName, methodName, dataIndex = 0) {
    for (const { event } of events) {
        if (event.section === palletName && event.method === methodName) {
            return extractH128Id(event.data[dataIndex]);
        }
    }
    return null;
}

/**
 * Validate that a value is a valid H128 hex string.
 */
export function isValidH128(value) {
    if (typeof value !== 'string') return false;
    // H128 is 16 bytes = 32 hex chars + '0x' prefix = 34 chars
    return /^0x[0-9a-fA-F]{32}$/.test(value);
}

// =============================================================================
// Time Utilities
// =============================================================================

export async function getChainTime(api) {
    const chainTimestamp = await api.query.timestamp.now();
    return Math.floor(chainTimestamp.toNumber() / 1000);
}

export async function getOracleTime(api) {
    const header = await api.rpc.chain.getHeader();
    const blockNum = header.number.toNumber();
    return BASE_TIMESTAMP_SECS + (blockNum * 6);
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForBlocks(api, numBlocks) {
    const startBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    let currentBlock = startBlock;
    
    while (currentBlock < startBlock + numBlocks) {
        await sleep(1000);
        currentBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    }
    return currentBlock;
}

export async function waitUntilTime(api, targetTime) {
    let currentTime = await getChainTime(api);
    while (currentTime < targetTime) {
        await sleep(1000);
        currentTime = await getChainTime(api);
    }
    return currentTime;
}

// =============================================================================
// Balance Utilities
// =============================================================================

export function formatUsdt(balance) {
    const val = Number(balance) / (10 ** USDT_DECIMALS);
    return `${val >= 0 ? '' : '-'}$${Math.abs(val).toFixed(2)}`;
}

export function formatChange(before, after) {
    const change = after - before;
    const sign = change >= 0n ? '+' : '';
    return `${sign}${formatUsdt(change)}`;
}

export async function getUsdtBalance(api, address) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    return usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
}

export async function getLpBalance(api, policyId, address) {
    const holdings = await api.query.prmxHoldings.holdingsStorage(policyId, address);
    return {
        free: BigInt(holdings.lpShares.toString()),
        locked: BigInt(holdings.lockedShares.toString()),
        total: BigInt(holdings.lpShares.toString()) + BigInt(holdings.lockedShares.toString()),
    };
}

export async function getTotalLpShares(api, policyId) {
    const total = await api.query.prmxHoldings.totalLpShares(policyId);
    return BigInt(total.toString());
}

export async function getBalanceSnapshot(api, addresses, policyId = null) {
    const snapshot = {};
    for (const [name, address] of Object.entries(addresses)) {
        snapshot[name] = {
            usdt: await getUsdtBalance(api, address),
            lp: policyId ? await getLpBalance(api, policyId, address) : null,
        };
    }
    return snapshot;
}

// =============================================================================
// Transaction Utilities
// =============================================================================

const MAX_RETRIES = 15;  // Increased due to OCW conflicts with Alice
const RETRY_DELAY_MS = 3000;  // 3 seconds to wait for OCW to settle

export async function signAndSend(tx, signer, api, retries = MAX_RETRIES) {
    const TX_TIMEOUT_MS = 30000; // 30 second timeout per attempt
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            // Get the current nonce explicitly
            const nonce = await api.rpc.system.accountNextIndex(signer.address);
            
            const txPromise = new Promise((resolve, reject) => {
                let unsub;
                const timeoutId = setTimeout(() => {
                    if (unsub) unsub();
                    reject(new Error('Transaction timeout - likely evicted from pool'));
                }, TX_TIMEOUT_MS);
                
                tx.signAndSend(signer, { nonce }, (result) => {
                    const { status, events, dispatchError } = result;
                    
                    if (dispatchError) {
                        clearTimeout(timeoutId);
                        let errorMessage = 'Transaction failed';
                        if (dispatchError.isModule && api) {
                            try {
                                const decoded = api.registry.findMetaError(dispatchError.asModule);
                                errorMessage = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
                            } catch (e) {
                                errorMessage = dispatchError.toString();
                            }
                        } else {
                            errorMessage = dispatchError.toString();
                        }
                        reject(new Error(errorMessage));
                        return;
                    }
                    if (status.isInBlock || status.isFinalized) {
                        clearTimeout(timeoutId);
                        resolve({ status, events });
                    }
                }).then(u => { unsub = u; }).catch(reject);
            });
            
            return await txPromise;
        } catch (error) {
            const isPriorityError = error.message && error.message.includes('Priority is too low');
            const isNonceError = error.message && (
                error.message.includes('nonce') || 
                error.message.includes('1014') ||
                error.message.includes('Transaction is outdated')
            );
            const isTimeout = error.message && error.message.includes('timeout');
            
            if ((isPriorityError || isNonceError || isTimeout) && attempt < retries - 1) {
                console.log(`   ⚠️ Transaction retry ${attempt + 1}/${retries} (${isTimeout ? 'timeout' : 'pool conflict'}, waiting...)`)
                await sleep(RETRY_DELAY_MS + (attempt * 1000)); // Increasing delay
                continue;
            }
            throw error;
        }
    }
}

export async function sendTx(tx, signer, api) {
    return signAndSend(tx, signer, api);
}

// =============================================================================
// USDT Setup
// =============================================================================

export async function setupUsdt(api, alice, accounts) {
    console.log('🪙 Setting up USDT asset...');

    const mintAmount = 10_000_000_000_000n; // 10M USDT
    const daoAddress = await getDaoAccount();
    const oracleAddress = await getOracleAccount();

    // Check if asset exists
    const asset = await api.query.assets.asset(USDT_ASSET_ID);
    if (asset.isNone) {
        console.log('   Creating USDT asset...');
        await signAndSend(
            api.tx.sudo.sudo(api.tx.assets.forceCreate(USDT_ASSET_ID, alice.address, true, 1)),
            alice,
            api
        );
        await sleep(2000); // Wait for block to finalize
    }

    // Collect all addresses that need minting
    const addressesToMint = [];
    
    for (const [name, account] of Object.entries(accounts)) {
        if (name === 'dao' || name === 'oracle' || name === 'alice') continue;
        const balance = await getUsdtBalance(api, account.address);
        if (balance < mintAmount / 2n) {
            addressesToMint.push({ name, address: account.address });
        }
    }

    // Add DAO
    const daoBalance = await getUsdtBalance(api, daoAddress);
    if (daoBalance < mintAmount / 2n) {
        addressesToMint.push({ name: 'DAO', address: daoAddress });
    }

    // Add Oracle
    const oracleBalance = await getUsdtBalance(api, oracleAddress);
    if (oracleBalance < mintAmount / 2n) {
        addressesToMint.push({ name: 'Oracle', address: oracleAddress });
    }

    // Mint using sudo with longer delays to avoid OCW conflicts
    // OCW uses Alice for rainfall tx, so we need to give it time
    if (addressesToMint.length > 0) {
        console.log(`   Minting to ${addressesToMint.length} recipients (with OCW-friendly delays)...`);
        
        for (const { name, address } of addressesToMint) {
            console.log(`   Minting USDT to ${name}...`);
            try {
                await signAndSend(
                    api.tx.assets.mint(USDT_ASSET_ID, address, mintAmount.toString()),
                    alice,
                    api
                );
            } catch (e) {
                console.log(`   ⚠️ Retry with sudo for ${name}...`);
                // Fallback to sudo if regular mint fails
                await signAndSend(
                    api.tx.sudo.sudo(api.tx.assets.mint(USDT_ASSET_ID, address, mintAmount.toString())),
                    alice,
                    api
                );
            }
            // Wait 3 seconds between mints to let OCW settle
            await sleep(3000);
        }
    }

    console.log('   ✅ USDT setup complete\n');
}

// =============================================================================
// V1/V2 Oracle Setup
// =============================================================================

export async function setupV1V2Oracle(api, alice, oracle = null, marketId = MARKET_ID) {
    console.log('🔮 Setting up V1/V2 oracle...');
    
    // Use oracle account if provided, otherwise fall back to alice
    const oracleAccount = oracle || alice;
    const oracleAddress = await getOracleAccount();

    // Bind location if needed
    const locationConfig = await api.query.prmxOracle.marketLocationConfig(marketId);
    if (!locationConfig.isSome) {
        console.log('   Binding market location...');
        await signAndSend(
            api.tx.sudo.sudo(api.tx.prmxOracle.setMarketLocationKey(marketId, MANILA_ACCUWEATHER_KEY)),
            alice,
            api
        );
    }

    // Add oracle provider (use the dedicated oracle account)
    try {
        const isProvider = await api.query.prmxOracle.oracleProviders(oracleAddress);
        if (!isProvider.isSome || !isProvider.unwrap()) {
            console.log(`   Adding oracle provider (${oracleAddress.substring(0, 12)}...)...`);
            await signAndSend(
                api.tx.sudo.sudo(api.tx.prmxOracle.addOracleProvider(oracleAddress)),
                alice,
                api
            );
        }
    } catch (e) {
        // Provider may already exist
    }

    console.log('   ✅ V1/V2 oracle setup complete\n');
}

// =============================================================================
// V3 Oracle Setup
// =============================================================================

export async function setupV3Oracle(api, alice, oracle = null, locationId = V3_LOCATION_ID) {
    console.log('🔮 Setting up V3 oracle...');
    
    // Get oracle address (dedicated oracle account)
    const oracleAddress = await getOracleAccount();

    // Add location if needed
    const existing = await api.query.prmxOracleV3.locationRegistry(locationId);
    if (!existing.isSome) {
        console.log('   Adding V3 location...');
        await signAndSend(
            api.tx.sudo.sudo(
                api.tx.prmxOracleV3.addLocation(
                    '264885',      // AccuWeather Manila key
                    14599512,      // latitude * 1e6
                    120984222,     // longitude * 1e6
                    'Manila'       // name
                )
            ),
            alice,
            api
        );
    }

    // Add oracle member (use dedicated oracle account)
    const isMember = await api.query.prmxOracleV3.oracleMembership(oracleAddress);
    if (!isMember.isTrue) {
        console.log(`   Adding oracle member (${oracleAddress.substring(0, 12)}...)...`);
        await signAndSend(
            api.tx.sudo.sudo(api.tx.prmxOracleV3.addOracleMember(oracleAddress)),
            alice,
            api
        );
    }

    console.log('   ✅ V3 oracle setup complete\n');
}

// =============================================================================
// Rainfall Submission
// =============================================================================

export async function submitRainfall(api, oracle, marketId, timestamp, rainfall) {
    await signAndSend(
        api.tx.prmxOracle.submitRainfall(marketId, timestamp, rainfall),
        oracle,
        api
    );
}

export async function submitRainfallBatch(api, oracle, marketId, dataPoints) {
    for (const { timestamp, rainfall } of dataPoints) {
        await submitRainfall(api, oracle, marketId, timestamp, rainfall);
    }
}

// =============================================================================
// Display Utilities
// =============================================================================

export function printHeader(title) {
    console.log('\n' + '═'.repeat(70));
    console.log(`  ${title}`);
    console.log('═'.repeat(70));
}

export function printSection(title) {
    console.log('\n' + '─'.repeat(60));
    console.log(`  ${title}`);
    console.log('─'.repeat(60));
}

export function printBalanceTable(snapshot, title = 'Balances') {
    console.log(`\n   📊 ${title}:`);
    for (const [name, data] of Object.entries(snapshot)) {
        console.log(`      ${name}: ${formatUsdt(data.usdt)}${data.lp ? ` | LP: ${data.lp.free} (free) + ${data.lp.locked} (locked)` : ''}`);
    }
}

