#!/usr/bin/env node
/**
 * Common utilities for PRMX functional tests
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';

// Configuration
export const WS_ENDPOINT = 'ws://127.0.0.1:9944';
export const USDT_ASSET_ID = 1;
export const MARKET_ID = 0;
export const MANILA_ACCUWEATHER_KEY = '3423441';

export function formatUsdt(balance) {
    return `${(Number(balance) / 1e6).toFixed(2)} USDT`;
}

export async function connectToNode() {
    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({ provider: wsProvider });
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
    };
}

export async function getDaoAccount() {
    const { encodeAddress } = await import('@polkadot/util-crypto');
    const daoAccountHex = '0x' + '00'.repeat(32);
    return encodeAddress(daoAccountHex, 42);
}

export async function getChainTime(api) {
    const chainTimestamp = await api.query.timestamp.now();
    return chainTimestamp.toNumber() / 1000;
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

export async function setupOracle(api, alice, marketId = MARKET_ID) {
    // Bind location if needed
    const locationConfig = await api.query.prmxOracle.marketLocationConfig(marketId);
    if (!locationConfig.isSome) {
        const bindTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.setMarketLocationKey(marketId, MANILA_ACCUWEATHER_KEY)
        );
        await sendTx(bindTx, alice, api);
    }

    // Add oracle provider
    try {
        const addProviderTx = api.tx.sudo.sudo(
            api.tx.prmxOracle.addOracleProvider(alice.address)
        );
        await sendTx(addProviderTx, alice, api);
    } catch (e) {
        // Provider may already exist, ignore
    }
}

export async function submitRainfall(api, alice, marketId, timestamp, rainfall) {
    const rainTx = api.tx.prmxOracle.submitRainfall(marketId, timestamp, rainfall);
    await sendTx(rainTx, alice, api);
}

export async function requestQuote(api, user, marketId, coverageStart, coverageEnd, lat, lon, shares) {
    const quoteTx = api.tx.prmxQuote.requestPolicyQuote(
        marketId, coverageStart, coverageEnd, lat, lon, shares
    );
    
    let quoteId;
    await new Promise((resolve) => {
        quoteTx.signAndSend(user, ({ status, events }) => {
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
    return quoteId;
}

export async function submitQuote(api, oracle, quoteId, probabilityPpm = 50_000) {
    const submitQuoteTx = api.tx.prmxQuote.submitQuote(quoteId, probabilityPpm);
    await sendTx(submitQuoteTx, oracle);
    
    const quoteResult = await api.query.prmxQuote.quoteResults(quoteId);
    return quoteResult.isSome ? BigInt(quoteResult.unwrap().totalPremium.toString()) : 0n;
}

export async function createPolicy(api, user, quoteId) {
    const applyTx = api.tx.prmxPolicy.applyCoverageWithQuote(quoteId);
    
    let policyId;
    await new Promise((resolve) => {
        applyTx.signAndSend(user, ({ status, events }) => {
            if (status.isInBlock) {
                for (const { event } of events) {
                    if (event.section === 'prmxPolicy' && event.method === 'PolicyCreated') {
                        policyId = event.data[0].toNumber();
                    }
                }
                resolve();
            }
        });
    });
    return policyId;
}

export async function settlePolicy(api, settler, policyId, eventOccurred) {
    const settleTx = api.tx.prmxPolicy.settlePolicy(policyId, eventOccurred);
    
    const events = [];
    await new Promise((resolve) => {
        settleTx.signAndSend(settler, ({ status, events: txEvents }) => {
            if (status.isInBlock) {
                for (const { event } of txEvents) {
                    events.push({
                        section: event.section,
                        method: event.method,
                        data: event.data.toString(),
                    });
                }
                resolve();
            }
        });
    });
    return events;
}

export async function sendTx(tx, signer, api = null) {
    return new Promise((resolve, reject) => {
        tx.signAndSend(signer, ({ status, dispatchError, events }) => {
            if (status.isInBlock) {
                if (dispatchError) {
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
                } else {
                    resolve(events);
                }
            }
        });
    });
}

export async function waitForBlocks(api, numBlocks) {
    const startBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    let currentBlock = startBlock;
    
    while (currentBlock < startBlock + numBlocks) {
        await new Promise(r => setTimeout(r, 6000));
        currentBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    }
}

export async function waitUntilTime(api, targetTime) {
    let currentTime = await getChainTime(api);
    while (currentTime < targetTime) {
        await new Promise(r => setTimeout(r, 6000));
        currentTime = await getChainTime(api);
    }
}

export function printHeader(title) {
    console.log('\n' + '='.repeat(70));
    console.log(title);
    console.log('='.repeat(70));
}

export function printSection(title) {
    console.log('\n' + '─'.repeat(70));
    console.log(title);
    console.log('─'.repeat(70));
}
