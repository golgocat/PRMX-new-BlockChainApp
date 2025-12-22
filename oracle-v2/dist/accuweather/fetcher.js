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
        console.log(`🌐 Calling AccuWeather API: ${url}`);
        console.log(`   Time window: ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);
        const response = await axios.get(url, {
            params: {
                apikey: config.accuweatherApiKey,
                details: true,
            },
        });
        console.log(`   ✅ API response status: ${response.status}`);
        console.log(`   📦 Response data type: ${Array.isArray(response.data) ? 'array' : typeof response.data}`);
        console.log(`   📦 Response data length: ${Array.isArray(response.data) ? response.data.length : 'N/A'}`);
        if (response.data && Array.isArray(response.data)) {
            console.log(`   🔍 Processing ${response.data.length} records from API...`);
            for (const record of response.data) {
                const recordTime = new Date(record.LocalObservationDateTime).getTime() / 1000;
                const precipMm = record.PrecipitationSummary?.Precipitation?.Metric?.Value || 0;
                console.log(`   📅 Record: ${record.LocalObservationDateTime} (${new Date(recordTime * 1000).toISOString()}), precip: ${precipMm}mm`);
                console.log(`      Time check: ${recordTime} >= ${startTime} && ${recordTime} <= ${endTime} = ${recordTime >= startTime && recordTime <= endTime}`);
                // Only include records within our window
                if (recordTime >= startTime && recordTime <= endTime) {
                    records.push({
                        dateTime: record.LocalObservationDateTime,
                        precipitationMm: precipMm,
                    });
                    console.log(`      ✅ Included in results`);
                }
                else {
                    console.log(`      ⏭️  Skipped (outside time window)`);
                }
            }
        }
        else {
            console.log(`   ⚠️  Unexpected response format:`, typeof response.data);
        }
        console.log(`📊 Fetched ${records.length} precipitation records for location ${locationKey} (after filtering)`);
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
