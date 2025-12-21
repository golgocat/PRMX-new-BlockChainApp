/**
 * AccuWeather precipitation data fetcher
 */
import axios from 'axios';
import { config } from '../config.js';
/**
 * Fetch historical precipitation data from AccuWeather
 *
 * @param locationKey - AccuWeather location key
 * @param startTime - Start of window (unix timestamp)
 * @param endTime - End of window (unix timestamp)
 */
export async function fetchPrecipitation(locationKey, startTime, endTime) {
    if (!config.accuweatherApiKey) {
        throw new Error('AccuWeather API key not configured');
    }
    const records = [];
    try {
        // AccuWeather historical data API (24-hour history)
        const url = `${config.accuweatherBaseUrl}/currentconditions/v1/${locationKey}/historical/24`;
        const response = await axios.get(url, {
            params: {
                apikey: config.accuweatherApiKey,
                details: true,
            },
        });
        if (response.data && Array.isArray(response.data)) {
            for (const record of response.data) {
                const recordTime = new Date(record.LocalObservationDateTime).getTime() / 1000;
                // Only include records within our window
                if (recordTime >= startTime && recordTime <= endTime) {
                    const precipMm = record.PrecipitationSummary?.Precipitation?.Metric?.Value || 0;
                    records.push({
                        dateTime: record.LocalObservationDateTime,
                        precipitationMm: precipMm,
                    });
                }
            }
        }
        console.log(`📊 Fetched ${records.length} precipitation records for location ${locationKey}`);
        return records;
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            throw new Error(`AccuWeather API error: ${error.response?.status} - ${error.message}`);
        }
        throw error;
    }
}
/**
 * Resolve AccuWeather location key from coordinates
 * (Manila is cached, but this is here for future expansion)
 */
export async function resolveLocationKey(lat, lon) {
    if (!config.accuweatherApiKey) {
        throw new Error('AccuWeather API key not configured');
    }
    try {
        const url = `${config.accuweatherBaseUrl}/locations/v1/cities/geoposition/search`;
        const response = await axios.get(url, {
            params: {
                apikey: config.accuweatherApiKey,
                q: `${lat / 1_000_000},${lon / 1_000_000}`, // Convert from scaled format
            },
        });
        if (response.data?.Key) {
            return response.data.Key;
        }
        throw new Error('No location key found');
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            throw new Error(`AccuWeather API error: ${error.response?.status} - ${error.message}`);
        }
        throw error;
    }
}
