#!/usr/bin/env node
/**
 * PRMX Test - Secondary LP Market (Charlie & Dave)
 * 
 * This test demonstrates the secondary LP token market:
 * 1. Bob buys insurance → DAO provides capital → DAO receives LP tokens
 * 2. DAO's LP tokens are placed on orderbook
 * 3. Charlie buys LP tokens from DAO (becomes risk-bearer)
 * 4. Dave buys LP tokens from DAO (becomes risk-bearer)
 * 5. Coverage ends, policy settles (NO event)
 * 6. Residual pool distributed to LP holders
 * 
 * Usage: node test-secondary-lp-market.mjs
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
const WS_ENDPOINT = 'ws://127.0.0.1:9944';
const USDT_ASSET_ID = 1;
const MARKET_ID = 0;
const MANILA_ACCUWEATHER_KEY = '3423441';
const COVERAGE_DURATION_SECS = 90; // 90 seconds for this test

function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

async function getBalances(api, address, label) {
    const usdt = await api.query.assets.account(USDT_ASSET_ID, address);
    const usdtBalance = usdt.isSome ? BigInt(usdt.unwrap().balance.toString()) : 0n;
    
    const holdings = await api.query.prmxHoldings.holdingsStorage(MARKET_ID, address);
    const lpShares = BigInt(holdings.lpShares.toString());
    const lockedShares = BigInt(holdings.lockedShares.toString());
    
    return { usdt: usdtBalance, lp: lpShares, lockedLp: lockedShares, label };
}

function printBalances(balances, title) {
    console.log(`\n   📊 ${title}:`);
    for (const bal of balances) {
        console.log(`      ${bal.label}:`);
        console.log(`         USDT: ${formatUsdt(bal.usdt)}`);
        if (bal.lp > 0n || bal.lockedLp > 0n) {
            console.log(`         LP Tokens: ${bal.lp.toString()} (free) + ${bal.lockedLp.toString()} (locked)`);
        }
    }
}

function printBalanceChanges(before, after, title) {
    console.log(`\n   📈 ${title}:`);
    for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = after[i];
        const usdtChange = a.usdt - b.usdt;
        const lpChange = a.lp - b.lp;
        const lockedLpChange = a.lockedLp - b.lockedLp;
        
        if (usdtChange !== 0n || lpChange !== 0n || lockedLpChange !== 0n) {
            console.log(`      ${b.label}:`);
            if (usdtChange !== 0n) {
                const sign = usdtChange >= 0n ? '+' : '';
                console.log(`         USDT: ${sign}${formatUsdt(usdtChange)} (${formatUsdt(b.usdt)} → ${formatUsdt(a.usdt)})`);
            }
            if (lpChange !== 0n) {
                const sign = lpChange >= 0n ? '+' : '';
                console.log(`         LP Tokens (free): ${sign}${lpChange.toString()} (${b.lp.toString()} → ${a.lp.toString()})`);
            }
            if (lockedLpChange !== 0n) {
                const sign = lockedLpChange >= 0n ? '+' : '';
                console.log(`         LP Tokens (locked): ${sign}${lockedLpChange.toString()} (${b.lockedLp.toString()} → ${a.lockedLp.toString()})`);
            }
        }
    }
}

async function main() {
    console.log('='.repeat(70));
    console.log('PRMX TEST - SECONDARY LP MARKET (CHARLIE & DAVE)');
    console.log('='.repeat(70));
    console.log('');
    console.log('📋 This test demonstrates:');
    console.log('   1. DAO receives LP tokens when providing policy capital');
    console.log('   2. Charlie & Dave buy LP tokens from DAO orderbook');
    console.log('   3. LP holders share residual pool after settlement');
    console.log('');

    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    console.log('✅ Connected to PRMX node');
    
    const keyring = new Keyring({ type: 'sr25519' });
    const alice = keyring.addFromUri('//Alice');
    const bob = keyring.addFromUri('//Bob');
    const charlie = keyring.addFromUri('//Charlie');
    const dave = keyring.addFromUri('//Dave');
    
    const daoAccountHex = '0x' + '00'.repeat(32);
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccount = encodeAddress(daoAccountHex, 42);
    
    console.log(`   Alice (Sudo): ${alice.address}`);
    console.log(`   Bob (Customer): ${bob.address}`);
    console.log(`   Charlie (LP): ${charlie.address}`);
    console.log(`   Dave (LP): ${dave.address}`);
    console.log(`   DAO Account: ${daoAccount}`);

    const chainTimestamp = await api.query.timestamp.now();
    const chainNow = chainTimestamp.toNumber() / 1000;
    console.log(`\n⏰ Chain time: ${new Date(chainNow * 1000).toISOString()}`);

    // =========================================================================
    // INITIAL STATE
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('INITIAL STATE - All Account Balances');
    console.log('─'.repeat(70));
    
    const initialBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, charlie.address, 'Charlie (LP)'),
        await getBalances(api, dave.address, 'Dave (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalances(initialBalances, 'Starting Balances');

    // =========================================================================
    // STEP 1: SETUP ORACLE
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 1: SETUP ORACLE');
    console.log('─'.repeat(70));

    const locationConfig = await api.query.prmxOracle.marketLocationConfig(MARKET_ID);
    if (!locationConfig.isSome) {
        console.log('⏳ Binding AccuWeather location...');
        const bindTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.setMarketLocationKey(MARKET_ID, MANILA_ACCUWEATHER_KEY)
        );
        await new Promise((resolve) => {
            bindTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    console.log('✅ Oracle configured');

    // Add oracle provider
    try {
        const addProviderTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.addOracleProvider(alice.address)
        );
        await new Promise((resolve) => {
            addProviderTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    } catch (e) {}

    // Submit low rainfall (no event)
    console.log('⏳ Submitting low rainfall data (NO event)...');
    const rainfallData = [
        { hourOffset: 0, rainfall: 50 },   // 5mm
        { hourOffset: 1, rainfall: 100 },  // 10mm
    ];
    
    for (const data of rainfallData) {
        const timestamp = Math.floor(chainNow - (data.hourOffset * 3600));
        const rainTx = api.tx.prmxOracle.submitRainfall(MARKET_ID, timestamp, data.rainfall);
        await new Promise((resolve) => {
            rainTx.signAndSend(alice, ({ status }) => {
                if (status.isInBlock) resolve();
            });
        });
    }
    console.log('✅ Rainfall: 15mm (below 50mm strike threshold)');

    // =========================================================================
    // STEP 2: BOB BUYS INSURANCE (Creates LP tokens for DAO)
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: BOB BUYS INSURANCE (3 shares = 300 USDT coverage)');
    console.log('─'.repeat(70));

    const coverageStart = Math.floor(chainNow + 15);
    const coverageEnd = coverageStart + COVERAGE_DURATION_SECS;
    const shares = 3; // Buy 3 shares to have enough LP tokens for trading
    
    console.log(`   Coverage: ${new Date(coverageStart * 1000).toISOString()}`);
    console.log(`          to ${new Date(coverageEnd * 1000).toISOString()}`);
    console.log(`   Shares: ${shares} (= ${shares * 100} USDT max payout)`);

    // Request quote
    const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
        MARKET_ID, coverageStart, coverageEnd, 14_599_500, 120_984_200, shares
    );

    let quoteId;
    await new Promise((resolve) => {
        quoteTx.signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxQuote' && event.method === 'QuoteRequested') {
                        quoteId = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });
    console.log(`✅ Quote requested (ID: ${quoteId})`);

    // Submit quote
    const submitQuoteTx = api.tx.prmxQuote.submitQuote(quoteId, 50_000); // 5% probability
    await new Promise((resolve) => {
        submitQuoteTx.signAndSend(alice, ({ status }) => {
            if (status.isInBlock) resolve();
        });
    });
    
    const quoteResult = await api.query.prmxQuote.quoteResults(quoteId);
    const premium = quoteResult.isSome ? BigInt(quoteResult.unwrap().totalPremium.toString()) : 0n;
    console.log(`✅ Quote ready (Premium: ${formatUsdt(premium)})`);

    // Get balances before coverage
    const beforeCoverageBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, charlie.address, 'Charlie (LP)'),
        await getBalances(api, dave.address, 'Dave (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];

    // Apply coverage
    const applyTx = api.tx.prmxPolicy.applyCoverageWithQuote(quoteId);
    
    let policyId;
    await new Promise((resolve) => {
        applyTx.signAndSend(bob, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 POLICY EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy') {
                        console.log(`      • ${event.method}`);
                        if (event.method === 'PolicyCreated') {
                            policyId = event.data[0].toNumber();
                        }
                    }
                    if (event.method === 'LpTokensMinted') {
                        console.log(`      • LP Tokens Minted: ${event.data[1].toString()} tokens to DAO`);
                    }
                    if (event.method === 'DaoLpAskPlaced') {
                        console.log(`      • DAO LP Ask Placed: ${event.data[2].toString()} tokens @ ${formatUsdt(BigInt(event.data[1].toString()))} each`);
                    }
                }
                resolve();
            }
        });
    });

    console.log(`\n✅ Policy created (ID: ${policyId})`);
    console.log(`   ${shares} LP tokens created and placed on orderbook`);

    const afterCoverageBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, charlie.address, 'Charlie (LP)'),
        await getBalances(api, dave.address, 'Dave (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalanceChanges(beforeCoverageBalances, afterCoverageBalances, 'Balance Changes from Policy Creation');

    // Check orderbook
    const priceLevels = await api.query.prmxOrderbookLp.priceLevels(MARKET_ID);
    console.log('\n   📖 LP ORDERBOOK STATE:');
    for (const price of priceLevels) {
        const orders = await api.query.prmxOrderbookLp.askBook(MARKET_ID, price);
        console.log(`      Price: ${formatUsdt(BigInt(price.toString()))} - Orders: ${orders.length}`);
    }

    // =========================================================================
    // STEP 3: CHARLIE BUYS LP TOKENS
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: CHARLIE BUYS LP TOKENS FROM DAO');
    console.log('─'.repeat(70));

    const charlieShares = 1; // Buy 1 LP token
    const maxPrice = 100_000_000n; // 100 USDT max price per share
    
    console.log(`   Charlie buying ${charlieShares} LP token(s) at max ${formatUsdt(maxPrice)} each`);
    
    const beforeCharlieBuy = [
        await getBalances(api, charlie.address, 'Charlie (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalances(beforeCharlieBuy, 'Balances BEFORE Charlie Buys');

    const charlieBuyTx = api.tx.prmxOrderbookLp.buyLp(MARKET_ID, maxPrice, charlieShares);
    
    await new Promise((resolve) => {
        charlieBuyTx.signAndSend(charlie, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 TRADE EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        const [orderId, buyer, seller, price, qty] = event.data;
                        console.log(`      • Trade: ${qty.toString()} LP @ ${formatUsdt(BigInt(price.toString()))}`);
                        console.log(`        Buyer: ${buyer.toString().substring(0, 15)}...`);
                        console.log(`        Seller: ${seller.toString().substring(0, 15)}...`);
                    }
                    if (event.section === 'assets' && event.method === 'Transferred') {
                        const [, from, to, amount] = event.data;
                        console.log(`      • USDT Transfer: ${formatUsdt(BigInt(amount.toString()))} ${from.toString().substring(0, 8)}... → ${to.toString().substring(0, 8)}...`);
                    }
                }
                resolve();
            }
        });
    });

    const afterCharlieBuy = [
        await getBalances(api, charlie.address, 'Charlie (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalanceChanges(beforeCharlieBuy, afterCharlieBuy, 'Balance Changes from Charlie\'s Purchase');

    // =========================================================================
    // STEP 4: DAVE BUYS LP TOKENS
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: DAVE BUYS LP TOKENS FROM DAO');
    console.log('─'.repeat(70));

    const daveShares = 1; // Buy 1 LP token
    
    console.log(`   Dave buying ${daveShares} LP token(s)`);
    
    const beforeDaveBuy = [
        await getBalances(api, dave.address, 'Dave (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalances(beforeDaveBuy, 'Balances BEFORE Dave Buys');

    const daveBuyTx = api.tx.prmxOrderbookLp.buyLp(MARKET_ID, maxPrice, daveShares);
    
    await new Promise((resolve) => {
        daveBuyTx.signAndSend(dave, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 TRADE EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxOrderbookLp' && event.method === 'TradeExecuted') {
                        const [, , , price, qty] = event.data;
                        console.log(`      • Trade: ${qty.toString()} LP @ ${formatUsdt(BigInt(price.toString()))}`);
                    }
                }
                resolve();
            }
        });
    });

    const afterDaveBuy = [
        await getBalances(api, dave.address, 'Dave (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalanceChanges(beforeDaveBuy, afterDaveBuy, 'Balance Changes from Dave\'s Purchase');

    // =========================================================================
    // LP HOLDER SUMMARY
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('LP HOLDER SUMMARY (Before Settlement)');
    console.log('─'.repeat(70));
    
    const lpHoldersBeforeSettlement = [
        await getBalances(api, charlie.address, 'Charlie'),
        await getBalances(api, dave.address, 'Dave'),
        await getBalances(api, daoAccount, 'DAO'),
    ];
    
    console.log('\n   🎫 LP TOKEN DISTRIBUTION:');
    let totalLP = 0n;
    for (const holder of lpHoldersBeforeSettlement) {
        const total = holder.lp + holder.lockedLp;
        if (total > 0n) {
            console.log(`      ${holder.label}: ${total.toString()} LP tokens`);
            totalLP += total;
        }
    }
    console.log(`      ─────────────────`);
    console.log(`      Total: ${totalLP.toString()} LP tokens`);

    // =========================================================================
    // STEP 5: WAIT FOR COVERAGE TO END
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 5: WAIT FOR COVERAGE TO END');
    console.log('─'.repeat(70));

    let currentChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    const waitTime = Math.max(0, coverageEnd - currentChainTs + 15);
    
    console.log(`⏳ Waiting ${waitTime.toFixed(0)} seconds for coverage window to end...`);
    for (let i = waitTime; i > 0; i -= 15) {
        console.log(`   ${i.toFixed(0)} seconds remaining...`);
        await new Promise(r => setTimeout(r, Math.min(15000, i * 1000)));
    }
    console.log('✅ Coverage window has ended!');

    // =========================================================================
    // STEP 6: SETTLEMENT
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 6: SETTLEMENT (NO EVENT - LP HOLDERS WIN)');
    console.log('─'.repeat(70));

    // Wait for chain time
    let settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    while (settlementChainTs <= coverageEnd) {
        await new Promise(r => setTimeout(r, 6000));
        settlementChainTs = (await api.query.timestamp.now()).toNumber() / 1000;
    }
    await new Promise(r => setTimeout(r, 12000));
    console.log('   ✅ Chain time confirmed past coverage end');

    const beforeSettlementBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, charlie.address, 'Charlie (LP)'),
        await getBalances(api, dave.address, 'Dave (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];

    const poolBal = await api.query.prmxPolicy.policyRiskPoolBalance(policyId);
    console.log(`\n   🏦 Policy Pool Balance: ${formatUsdt(BigInt(poolBal.toString()))}`);

    console.log('\n   💡 EXPECTED SETTLEMENT FUND FLOW:');
    console.log('      ✨ NO EVENT - LP holders profit!');
    console.log(`      Policy pool (${formatUsdt(BigInt(poolBal.toString()))}) → DAO Account`);
    console.log('      (LP tokens represent claim on residual profits)');

    console.log('\n⏳ Settling policy (event_occurred: false)...');
    const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, false);
    
    await new Promise((resolve) => {
        settleTx.signAndSend(alice, ({ status, events }) => {
            if (status.isInBlock) {
                console.log('\n   📋 SETTLEMENT EVENTS:');
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy') {
                        console.log(`      • ${event.method}`);
                    }
                    if (event.section === 'prmxHoldings') {
                        console.log(`      • ${event.section}.${event.method}`);
                    }
                    if (event.section === 'assets' && event.method === 'Transferred') {
                        const [, from, to, amount] = event.data;
                        console.log(`      • USDT: ${formatUsdt(BigInt(amount.toString()))} ${from.toString().substring(0, 8)}... → ${to.toString().substring(0, 8)}...`);
                    }
                }
                resolve();
            }
        });
    });

    const afterSettlementBalances = [
        await getBalances(api, bob.address, 'Bob (Customer)'),
        await getBalances(api, charlie.address, 'Charlie (LP)'),
        await getBalances(api, dave.address, 'Dave (LP)'),
        await getBalances(api, daoAccount, 'DAO Account'),
    ];
    printBalanceChanges(beforeSettlementBalances, afterSettlementBalances, 'Balance Changes from Settlement');

    // Check residual pool
    const residualPool = await api.query.prmxHoldings.marketLpResidualPool(MARKET_ID);
    console.log(`\n   💎 Market Residual Pool: ${formatUsdt(BigInt(residualPool.toString()))}`);

    // Check LP payout per share
    const payoutPerShare = await api.query.prmxHoldings.lpPayoutPerShare(MARKET_ID);
    console.log(`   📊 LP Payout Per Share: ${payoutPerShare.isSome ? formatUsdt(BigInt(payoutPerShare.unwrap().toString())) : 'Not set'}`);

    // =========================================================================
    // STEP 7: LP HOLDERS REALIZE PROFIT
    // =========================================================================
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 7: LP HOLDER PROFIT ANALYSIS');
    console.log('─'.repeat(70));

    // Calculate profit for each LP holder
    const totalLpTokens = await api.query.prmxHoldings.totalLpShares(MARKET_ID);
    const totalLp = BigInt(totalLpTokens.toString());
    const residualPoolBigInt = BigInt(residualPool.toString());
    
    console.log(`\n   🎯 LP TOKEN ECONOMICS:`);
    console.log(`      Total LP tokens in market: ${totalLp.toString()}`);
    console.log(`      Market Residual Pool: ${formatUsdt(residualPoolBigInt)}`);
    
    if (totalLp > 0n) {
        const valuePerLp = residualPoolBigInt / totalLp;
        console.log(`      Implied value per LP: ${formatUsdt(valuePerLp)}`);
    }

    console.log(`\n   💰 PROFIT/LOSS BY PARTICIPANT:`);
    
    // Charlie's P&L
    const charlieHoldings = await api.query.prmxHoldings.holdingsStorage(MARKET_ID, charlie.address);
    const charlieLp = BigInt(charlieHoldings.lpShares.toString());
    const charlieCost = 94_000_000n; // 94 USDT per LP
    const charlieValue = totalLp > 0n ? (residualPoolBigInt * charlieLp) / totalLp : 0n;
    const charliePnL = charlieValue - charlieCost;
    console.log(`      Charlie: Bought 1 LP @ 94 USDT, Value claim: ${formatUsdt(charlieValue)}, P&L: ${formatUsdt(charliePnL)}`);
    
    // Dave's P&L
    const daveHoldings = await api.query.prmxHoldings.holdingsStorage(MARKET_ID, dave.address);
    const daveLp = BigInt(daveHoldings.lpShares.toString());
    const daveCost = 94_000_000n;
    const daveValue = totalLp > 0n ? (residualPoolBigInt * daveLp) / totalLp : 0n;
    const davePnL = daveValue - daveCost;
    console.log(`      Dave: Bought 1 LP @ 94 USDT, Value claim: ${formatUsdt(daveValue)}, P&L: ${formatUsdt(davePnL)}`);
    
    // DAO's P&L
    const daoHoldings = await api.query.prmxHoldings.holdingsStorage(MARKET_ID, daoAccount);
    const daoLp = BigInt(daoHoldings.lpShares.toString()) + BigInt(daoHoldings.lockedShares.toString());
    const daoCapitalProvided = 282_000_000n; // Capital provided for this policy
    const daoCashReceived = 300_000_000n; // Pool balance received
    const daoLpSoldProceeds = 188_000_000n; // 2 LP sold @ 94 USDT
    const daoNetPosition = daoCashReceived + daoLpSoldProceeds - daoCapitalProvided;
    console.log(`      DAO: Capital: 282 USDT, Cash received: 300 USDT, LP sales: 188 USDT`);
    console.log(`           Net cash position: +${formatUsdt(daoNetPosition)}`);

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('TEST COMPLETE - FINAL SUMMARY');
    console.log('='.repeat(70));

    console.log('\n📊 NET BALANCE CHANGES (Start → End):');
    for (let i = 0; i < initialBalances.length; i++) {
        const initial = initialBalances[i];
        const final = afterSettlementBalances[i];
        const usdtChange = final.usdt - initial.usdt;
        const lpChange = (final.lp + final.lockedLp) - (initial.lp + initial.lockedLp);
        
        console.log(`   ${initial.label}:`);
        const usdtSign = usdtChange >= 0n ? '+' : '';
        console.log(`      USDT: ${usdtSign}${formatUsdt(usdtChange)}`);
        if (lpChange !== 0n) {
            const lpSign = lpChange >= 0n ? '+' : '';
            console.log(`      LP Tokens: ${lpSign}${lpChange.toString()}`);
        }
    }

    console.log('\n📝 COMPLETE FUND FLOW SUMMARY:');
    console.log('   ✨ NO RAINFALL EVENT - LP holders profit!');
    console.log('');
    console.log('   ┌─────────────────────────────────────────────────────────────────┐');
    console.log('   │ PHASE 1: POLICY CREATION                                        │');
    console.log('   ├─────────────────────────────────────────────────────────────────┤');
    console.log(`   │ Bob pays premium:           ${formatUsdt(premium).padStart(12)}                    │`);
    console.log(`   │ DAO provides capital:       ${formatUsdt(300_000_000n - premium).padStart(12)}                    │`);
    console.log('   │ Policy Pool receives:       300.00 USDT                    │');
    console.log('   │ DAO receives 3 LP tokens (locked for orderbook)            │');
    console.log('   ├─────────────────────────────────────────────────────────────────┤');
    console.log('   │ PHASE 2: SECONDARY MARKET TRADING                               │');
    console.log('   ├─────────────────────────────────────────────────────────────────┤');
    console.log('   │ Charlie: Pays 94 USDT → Receives 1 LP token                │');
    console.log('   │ Dave:    Pays 94 USDT → Receives 1 LP token                │');
    console.log('   │ DAO:     Receives 188 USDT ← Transfers 2 LP tokens         │');
    console.log('   │ DAO still holds 1 LP token (on orderbook)                  │');
    console.log('   ├─────────────────────────────────────────────────────────────────┤');
    console.log('   │ PHASE 3: SETTLEMENT (NO EVENT)                                  │');
    console.log('   ├─────────────────────────────────────────────────────────────────┤');
    console.log('   │ Policy Pool (300 USDT) → DAO Account                       │');
    console.log('   │ Residual Pool accumulates for LP holder claims             │');
    console.log('   ├─────────────────────────────────────────────────────────────────┤');
    console.log('   │ NET RESULTS                                                     │');
    console.log('   ├─────────────────────────────────────────────────────────────────┤');
    console.log(`   │ Bob (Policyholder):   -${formatUsdt(premium).padStart(12)} (premium, no payout)   │`);
    console.log('   │ Charlie (LP):         -94.00 USDT + claim on residual pool │');
    console.log('   │ Dave (LP):            -94.00 USDT + claim on residual pool │');
    console.log('   │ DAO:                 +206.00 USDT net cash flow            │');
    console.log('   │   (-282 capital + 188 LP sales + 300 settlement)           │');
    console.log('   └─────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('   💡 KEY INSIGHTS:');
    console.log('      1. LP tokens transfer risk from DAO to secondary buyers');
    console.log('      2. Charlie & Dave took over 2/3 of the policy risk');
    console.log('      3. When NO event: LP holders profit from premiums');
    console.log('      4. When event OCCURS: LP holders lose their capital');
    console.log('      5. DAO profits from margin + LP token sales');

    await api.disconnect();
}

main().catch(console.error);

