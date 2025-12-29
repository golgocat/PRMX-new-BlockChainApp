/**
 * Chain reporter for submitting V2 oracle reports
 */
/**
 * V2 report outcome
 */
export type V2Outcome = 'Triggered' | 'MaturedNoEvent';
/**
 * Submit a V2 report to the chain
 */
export declare function submitV2Report(policyId: string, // H128 as hex string
outcome: V2Outcome, observedAt: number, cumulativeMm: number, evidenceJson: object): Promise<string>;
/**
 * Check if a V2 report already exists on-chain
 */
export declare function checkV2ReportExists(policyId: string): Promise<boolean>;
