/**
 * Chain reporter for submitting V2 oracle reports
 */
import { Keyring } from '@polkadot/keyring';
import { getApi } from './listener.js';
import { config } from '../config.js';
import { getMonitors, getEvidence } from '../db/mongo.js';
import CryptoJS from 'crypto-js';
/**
 * Submit a V2 report to the chain
 */
export async function submitV2Report(policyId, outcome, observedAt, cumulativeMm, evidenceJson) {
    const api = getApi();
    const keyring = new Keyring({ type: 'sr25519' });
    const reporter = keyring.addFromUri(config.reporterMnemonic);
    // Compute evidence hash
    const evidenceString = JSON.stringify(evidenceJson);
    const evidenceHash = CryptoJS.SHA256(evidenceString).toString(CryptoJS.enc.Hex);
    const evidenceHashBytes = hexToBytes(evidenceHash);
    console.log(`📤 Submitting V2 report for policy ${policyId}: ${outcome}`);
    return new Promise((resolve, reject) => {
        api.tx.prmxOracle.submitV2Report(policyId, outcome, observedAt, cumulativeMm, evidenceHashBytes).signAndSend(reporter, { nonce: -1 }, async ({ status, dispatchError, txHash }) => {
            if (dispatchError) {
                if (dispatchError.isModule) {
                    const decoded = api.registry.findMetaError(dispatchError.asModule);
                    reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
                }
                else {
                    reject(new Error(dispatchError.toString()));
                }
                return;
            }
            if (status.isFinalized) {
                const txHashStr = txHash.toHex();
                console.log(`✅ V2 report finalized: ${txHashStr}`);
                // Store evidence in MongoDB
                try {
                    const evidence = {
                        _id: evidenceHash,
                        monitor_id: `0:${policyId}`, // Manila market
                        json_blob: evidenceJson,
                        created_at: new Date(),
                    };
                    await getEvidence().insertOne(evidence);
                    // Update monitor with tx hash and evidence hash
                    await getMonitors().updateOne({ policy_id: policyId }, {
                        $set: {
                            state: 'reported',
                            report_tx_hash: txHashStr,
                            evidence_hash: evidenceHash,
                            updated_at: new Date(),
                        }
                    });
                }
                catch (err) {
                    console.error('Error storing evidence:', err);
                }
                resolve(txHashStr);
            }
        });
    });
}
/**
 * Check if a V2 report already exists on-chain
 */
export async function checkV2ReportExists(policyId) {
    const api = getApi();
    const report = await api.query.prmxOracle.v2FinalReportByPolicy(policyId);
    // Check if report exists (Option type unwrapping)
    return !report.isEmpty;
}
/**
 * Convert hex string to bytes array
 */
function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
}
