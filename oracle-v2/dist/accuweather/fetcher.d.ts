/**
 * AccuWeather precipitation data fetcher
 */
/**
 * Precipitation record from AccuWeather
 */
export interface PrecipitationRecord {
    dateTime: string;
    precipitationMm: number;
}
/**
 * Fetch historical precipitation data from AccuWeather
 *
 * @param locationKey - AccuWeather location key
 * @param startTime - Start of window (unix timestamp)
 * @param endTime - End of window (unix timestamp)
 */
export declare function fetchPrecipitation(locationKey: string, startTime: number, endTime: number): Promise<PrecipitationRecord[]>;
/**
 * Resolve AccuWeather location key from coordinates
 * (Manila is cached, but this is here for future expansion)
 */
export declare function resolveLocationKey(lat: number, lon: number): Promise<string>;
