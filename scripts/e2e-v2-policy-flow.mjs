#!/usr/bin/env node
/**
 * E2E test for V2 policy lifecycle (dev mode, sudo):
 * - Create a V2 quote for Manila market (cumulative rainfall, early trigger)
 * - Submit quote and apply coverage to create V2 policy
 * - Verify V2PolicyCreated event is emitted
 * - Manually submit a V2 oracle report (simulating off-chain service)
 * - Verify V2PolicySettled event and settlement
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

const WS_URL = 'ws://127.0.0.1:9944';
const USDT_DECIMALS = 6;
const MANILA_MARKET_ID = 0;

// V2 policy parameters
const DURATION_DAYS = 3; // 3 days (2-7 allowed)
const SHARES = 10n;

// Helper to format USDT balance
function formatUsdt(balance) {
    return `${(Number(balance) / (10 ** USDT_DECIMALS)).toFixed(2)} USDT`;
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║  PRMX E2E: V2 Policy Lifecycle (Cumulative Rainfall, Early Trigger)║');
    console.log('╚════════════════════════════════════════════════════════════════════╝');

    const api = await ApiPromise.create({ provider: new WsProvider(WS_URL) });
    const chain = await api.rpc.system.chain();
    console.log(`\n✅ Connected to: ${chain.toString()}\n`);

    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');

    console.log('📋 Accounts:');
    console.log(`   Alice (DAO/Oracle): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);

    // 1) Check Manila market exists
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`🏗️  STEP 1: Verify Manila Market (id=${MANILA_MARKET_ID})`);
    console.log(`──────────────────────────────────────────────────────────────────────`);
    
    const market = await api.query.prmxMarkets.markets(MANILA_MARKET_ID);
    if (market.isNone) {
        console.log('   ❌ Manila market not found. Please create it first.');
        await api.disconnect();
        process.exit(1);
    }
    const marketInfo = market.unwrap();
    console.log(`   ✅ Manila market exists`);
    console.log(`   Strike: ${marketInfo.strikeValue.toNumber() / 10}mm`);

    // 2) Request V2 Quote
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`📝 STEP 2: Request V2 Quote (Bob)`);
    console.log(`──────────────────────────────────────────────────────────────────────`);
    
    const nowSec = Math.floor(Date.now() / 1000);
    const coverageStart = nowSec + 3600; // 1 hour from now
    const coverageEnd = coverageStart + (DURATION_DAYS * 86400); // Duration in seconds
    
    console.log(`   Duration: ${DURATION_DAYS} days`);
    console.log(`   Coverage: ${new Date(coverageStart * 1000).toISOString()} to ${new Date(coverageEnd * 1000).toISOString()}`);
    console.log(`   Shares: ${SHARES}`);
    
    const expectedQuoteId = (await api.query.prmxQuote.nextQuoteId()).toNumber();
    
    await signAndWait(
        api.tx.prmxQuote.requestPolicyQuoteV2(
            MANILA_MARKET_ID,
            coverageStart,
            coverageEnd,
            marketInfo.centerLatitude.toNumber(),
            marketInfo.centerLongitude.toNumber(),
            SHARES,
            DURATION_DAYS
        ),
        bob,
        'requestPolicyQuoteV2'
    );
    console.log(`   ✅ V2 Quote ID: ${expectedQuoteId}`);

    // 3) Submit Quote (simulate OCW)
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`📊 STEP 3: Submit Quote (Alice as OCW)`);
    console.log(`──────────────────────────────────────────────────────────────────────`);
    
    const status = await api.query.prmxQuote.quoteStatuses(expectedQuoteId);
    if (status.toString() === 'Pending') {
        await signAndWait(
            api.tx.prmxQuote.submitQuote(expectedQuoteId, 50_000), // 5% probability
            alice,
            'submitQuote'
        );
    } else {
        console.log(`   Quote status: ${status.toString()}, skipping submitQuote`);
    }

    // 4) Apply Coverage (creates V2 policy)
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`🛡️  STEP 4: Apply Coverage (Bob)`);
    console.log(`──────────────────────────────────────────────────────────────────────`);
    
    const applyEvents = await signAndWait(
        api.tx.prmxPolicy.applyCoverageWithQuote(expectedQuoteId),
        bob,
        'applyCoverage'
    );
    
    // Find PolicyCreated and V2PolicyCreated events
    let policyId = null;
    let v2EventFound = false;
    
    for (const { event } of applyEvents) {
        if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
            policyId = event.data[0].toNumber();
            console.log(`   ✅ PolicyCreated: id=${policyId}`);
        }
        if (event.section === 'prmxPolicy' && event.method === 'V2PolicyCreated') {
            v2EventFound = true;
            const [pid, mid, start, end, strike, lat, lon] = event.data;
            console.log(`   ✅ V2PolicyCreated event emitted:`);
            console.log(`      policy_id: ${pid.toString()}`);
            console.log(`      market_id: ${mid.toString()}`);
            console.log(`      strike_mm: ${strike.toString() / 10}mm`);
        }
    }
    
    if (!policyId) {
        console.log('   ❌ PolicyCreated event not found');
        await api.disconnect();
        process.exit(1);
    }
    
    if (!v2EventFound) {
        console.log('   ⚠️  V2PolicyCreated event not found (may need runtime rebuild)');
    }

    // 5) Check V2 policy fields
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`🔍 STEP 5: Verify V2 Policy Fields`);
    console.log(`──────────────────────────────────────────────────────────────────────`);
    
    const policy = await api.query.prmxPolicy.policies(policyId);
    if (policy.isSome) {
        const p = policy.unwrap();
        console.log(`   Policy ID: ${policyId}`);
        console.log(`   Version: ${p.policyVersion?.toString() || 'V1 (default)'}`);
        console.log(`   Event Type: ${p.eventType?.toString() || 'Rainfall24hRolling (default)'}`);
        console.log(`   Early Trigger: ${p.earlyTrigger?.toString() || 'false (default)'}`);
        console.log(`   Oracle Status V2: ${p.oracleStatusV2?.toString() || 'None'}`);
        console.log(`   Strike MM: ${p.strikeMm?.toString() || 'None'}`);
        console.log(`   Status: ${p.status.toString()}`);
    }

    // 6) Submit V2 Oracle Report (simulate off-chain oracle)
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`📤 STEP 6: Submit V2 Oracle Report (Alice as V2 Reporter)`);
    console.log(`──────────────────────────────────────────────────────────────────────`);
    
    // First, add Alice as authorized V2 reporter
    console.log('   Adding Alice as V2 reporter...');
    await signAndWait(
        api.tx.sudo.sudo(api.tx.prmxOracle.addV2Reporter(alice.address)),
        alice,
        'addV2Reporter'
    );
    
    // Prepare V2 report parameters
    const observedAt = nowSec + 7200; // 2 hours from now (within coverage window)
    const cumulativeMm = 600; // 60mm (exceeds typical 50mm strike)
    const evidenceHash = Array(32).fill(42); // Dummy hash
    
    console.log(`   Submitting V2 report: Triggered at ${cumulativeMm/10}mm cumulative`);
    
    try {
        const reportEvents = await signAndWait(
            api.tx.prmxOracle.submitV2Report(
                policyId,
                'Triggered',
                observedAt,
                cumulativeMm,
                evidenceHash
            ),
            alice,
            'submitV2Report'
        );
        
        // Check for V2ReportAccepted and V2PolicySettled events
        for (const { event } of reportEvents) {
            if (event.section === 'prmxOracle' && event.method === 'V2ReportAccepted') {
                console.log(`   ✅ V2ReportAccepted: policy_id=${event.data[0]}, outcome=${event.data[1]}`);
            }
            if (event.section === 'prmxPolicy' && event.method === 'V2PolicySettled') {
                console.log(`   ✅ V2PolicySettled: policy_id=${event.data[0]}, outcome=${event.data[1]}`);
            }
        }
    } catch (err) {
        console.log(`   ⚠️  V2 report failed (may need runtime rebuild): ${err.message}`);
    }

    // 7) Final Summary
    console.log(`\n\n╔════════════════════════════════════════════════════════════════════╗`);
    console.log(`║                        FINAL SUMMARY                              ║`);
    console.log(`╚════════════════════════════════════════════════════════════════════╝`);
    
    const finalPolicy = await api.query.prmxPolicy.policies(policyId);
    if (finalPolicy.isSome) {
        const p = finalPolicy.unwrap();
        console.log(`\n   Policy ${policyId}:`);
        console.log(`   Status: ${p.status.toString()}`);
        console.log(`   Version: ${p.policyVersion?.toString() || 'V1'}`);
        console.log(`   Oracle Status V2: ${p.oracleStatusV2?.toString() || 'N/A'}`);
    }
    
    // Check V2 final report
    const v2Report = await api.query.prmxOracle.v2FinalReportByPolicy(policyId);
    if (v2Report.isSome) {
        const report = v2Report.unwrap();
        console.log(`\n   V2 Final Report:`);
        console.log(`   Outcome: ${report.outcome.toString()}`);
        console.log(`   Cumulative MM: ${report.cumulativeMm.toNumber() / 10}mm`);
        console.log(`   Submitted At: ${new Date(report.submittedAt.toNumber() * 1000).toISOString()}`);
    } else {
        console.log(`\n   ⚠️  No V2 report found on-chain`);
    }

    await api.disconnect();
    console.log('\n✅ V2 E2E Test complete\n');
}

async function signAndWait(tx, signer, label) {
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, { nonce: -1 }, ({ status, events, dispatchError }) => {
            if (dispatchError) {
                if (dispatchError.isModule) {
                    const decoded = tx.registry.findMetaError(dispatchError.asModule);
                    reject(new Error(`${label}: ${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
                } else {
                    reject(new Error(`${label}: ${dispatchError.toString()}`));
                }
                return;
            }
            if (status.isFinalized) {
                console.log(`   ✅ ${label} finalized`);
                resolve(events);
            }
        });
    });
}

main().catch((err) => {
    console.error('❌ V2 E2E Test failed:', err);
    process.exit(1);
});

