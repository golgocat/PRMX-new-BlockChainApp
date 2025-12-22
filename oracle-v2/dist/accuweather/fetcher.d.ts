/**
 * AccuWeather precipitation data fetcher
 *
 * Uses Current Conditions endpoint (available on Starter tier)
 * to fetch real-time precipitation data and build hourly buckets.
 */
/**
 * Precipitation record from AccuWeather
 */
export interface PrecipitationRecord {
    dateTime: string;
    precipitationMm: number;
    rawData: object;
}
/**
 * Current conditions response with precipitation summary
 */
export interface CurrentConditionsData {
    pastHourMm: number;
    past3HoursMm: number;
    past6HoursMm: number;
    past12HoursMm: number;
    past24HoursMm: number;
    observationDateTime: string;
    epochTime: number;
}
/**
 * Fetch current precipitation data from AccuWeather
 * Uses the Current Conditions endpoint (available on Starter tier)
 *
 * @param locationKey - AccuWeather location key
 * @param startTime - Start of window (unix timestamp) - used for logging
 * @param endTime - End of window (unix timestamp) - used for logging
 */
export declare function fetchPrecipitation(locationKey: string, startTime: number, endTime: number): Promise<PrecipitationRecord[]>;
/**
 * Fetch current conditions with full precipitation summary
 * Returns structured data about precipitation over different time windows
 */
export declare function fetchCurrentConditions(locationKey: string): Promise<CurrentConditionsData | null>;
/**
 * Resolve AccuWeather location key from coordinates
 * (Manila is cached, but this is here for future expansion)
 */
export declare function resolveLocationKey(lat: number, lon: number): Promise<string>;
