/**
 * Chain event listener for V2PolicyCreated events
 */
import { ApiPromise } from '@polkadot/api';
/**
 * Connect to the PRMX chain and check for chain restart
 */
export declare function connectToChain(): Promise<ApiPromise>;
/**
 * Subscribe to V2 policy events (created, settled)
 */
export declare function subscribeToV2PolicyCreated(onPolicyCreated: (policy: {
    policy_id: number;
    market_id: number;
    coverage_start: number;
    coverage_end: number;
    strike_mm: number;
    lat: number;
    lon: number;
}) => Promise<void>): Promise<void>;
/**
 * Handle V2PolicyCreated event - create monitor document
 */
export declare function handleV2PolicyCreated(policy: {
    policy_id: number;
    market_id: number;
    coverage_start: number;
    coverage_end: number;
    strike_mm: number;
    lat: number;
    lon: number;
}): Promise<void>;
/**
 * Get API instance
 */
export declare function getApi(): ApiPromise;
/**
 * Disconnect from chain
 */
export declare function disconnectFromChain(): Promise<void>;
