/**
 * AccuWeather precipitation data fetcher
 *
 * Uses Current Conditions endpoint (available on Starter tier)
 * to fetch real-time precipitation data and build hourly buckets.
 */
import axios from 'axios';
import { config } from '../config.js';
/**
 * Fetch current precipitation data from AccuWeather
 * Uses the Current Conditions endpoint (available on Starter tier)
 *
 * @param locationKey - AccuWeather location key
 * @param startTime - Start of window (unix timestamp) - used for logging
 * @param endTime - End of window (unix timestamp) - used for logging
 */
export async function fetchPrecipitation(locationKey, startTime, endTime) {
    if (!config.accuweatherApiKey) {
        throw new Error('AccuWeather API key not configured');
    }
    const records = [];
    try {
        // Use Current Conditions endpoint (available on Starter tier)
        const url = `${config.accuweatherBaseUrl}/currentconditions/v1/${locationKey}`;
        console.log(`🌐 Calling AccuWeather Current Conditions API: ${url}`);
        console.log(`   Location: ${locationKey}`);
        const response = await axios.get(url, {
            params: {
                apikey: config.accuweatherApiKey,
                details: true,
            },
        });
        console.log(`   ✅ API response status: ${response.status}`);
        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            const current = response.data[0];
            const precipSummary = current.PrecipitationSummary;
            if (precipSummary) {
                const pastHourMm = precipSummary.PastHour?.Metric?.Value || 0;
                const past3HoursMm = precipSummary.Past3Hours?.Metric?.Value || 0;
                const past6HoursMm = precipSummary.Past6Hours?.Metric?.Value || 0;
                const past12HoursMm = precipSummary.Past12Hours?.Metric?.Value || 0;
                const past24HoursMm = precipSummary.Past24Hours?.Metric?.Value || 0;
                console.log(`   💧 Precipitation Summary:`);
                console.log(`      Past Hour:    ${pastHourMm} mm`);
                console.log(`      Past 3 Hours: ${past3HoursMm} mm`);
                console.log(`      Past 6 Hours: ${past6HoursMm} mm`);
                console.log(`      Past 12 Hours: ${past12HoursMm} mm`);
                console.log(`      Past 24 Hours: ${past24HoursMm} mm`);
                // Create a single record for the current hour with PastHour rainfall
                // This will be used to create/update the current hourly bucket
                // Include the full raw response for debugging/display
                records.push({
                    dateTime: current.LocalObservationDateTime,
                    precipitationMm: pastHourMm,
                    rawData: {
                        // Full current conditions response
                        LocalObservationDateTime: current.LocalObservationDateTime,
                        EpochTime: current.EpochTime,
                        WeatherText: current.WeatherText,
                        WeatherIcon: current.WeatherIcon,
                        HasPrecipitation: current.HasPrecipitation,
                        PrecipitationType: current.PrecipitationType,
                        Temperature: current.Temperature,
                        RelativeHumidity: current.RelativeHumidity,
                        Wind: current.Wind,
                        Visibility: current.Visibility,
                        CloudCover: current.CloudCover,
                        Pressure: current.Pressure,
                        PrecipitationSummary: current.PrecipitationSummary,
                        // Extracted values for easy reference
                        _extracted: {
                            pastHourMm,
                            past3HoursMm,
                            past6HoursMm,
                            past12HoursMm,
                            past24HoursMm,
                            fetchedAt: new Date().toISOString(),
                            locationKey,
                        }
                    }
                });
                console.log(`   📦 Created record for ${current.LocalObservationDateTime}: ${pastHourMm}mm (past hour)`);
            }
            else {
                console.log(`   ⚠️  No precipitation summary in response`);
            }
        }
        else {
            console.log(`   ⚠️  Unexpected response format:`, typeof response.data);
        }
        console.log(`📊 Fetched ${records.length} precipitation records for location ${locationKey}`);
        return records;
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            const errorDetail = error.response?.data?.detail || error.message;
            throw new Error(`AccuWeather API error: ${error.response?.status} - ${errorDetail}`);
        }
        throw error;
    }
}
/**
 * Fetch current conditions with full precipitation summary
 * Returns structured data about precipitation over different time windows
 */
export async function fetchCurrentConditions(locationKey) {
    if (!config.accuweatherApiKey) {
        throw new Error('AccuWeather API key not configured');
    }
    try {
        const url = `${config.accuweatherBaseUrl}/currentconditions/v1/${locationKey}`;
        const response = await axios.get(url, {
            params: {
                apikey: config.accuweatherApiKey,
                details: true,
            },
        });
        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            const current = response.data[0];
            const precipSummary = current.PrecipitationSummary;
            return {
                pastHourMm: precipSummary?.PastHour?.Metric?.Value || 0,
                past3HoursMm: precipSummary?.Past3Hours?.Metric?.Value || 0,
                past6HoursMm: precipSummary?.Past6Hours?.Metric?.Value || 0,
                past12HoursMm: precipSummary?.Past12Hours?.Metric?.Value || 0,
                past24HoursMm: precipSummary?.Past24Hours?.Metric?.Value || 0,
                observationDateTime: current.LocalObservationDateTime,
                epochTime: current.EpochTime,
            };
        }
        return null;
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            const errorDetail = error.response?.data?.detail || error.message;
            throw new Error(`AccuWeather API error: ${error.response?.status} - ${errorDetail}`);
        }
        throw error;
    }
}
/**
 * Fetch historical precipitation data for the past 24 hours
 * Uses the Historical Current Conditions endpoint (available on Starter tier)
 *
 * This endpoint returns 24 hourly observations, each with its own PrecipitationSummary
 *
 * @param locationKey - AccuWeather location key
 * @returns Array of 24 precipitation records (one per hour)
 */
export async function fetchHistorical24Hours(locationKey) {
    if (!config.accuweatherApiKey) {
        throw new Error('AccuWeather API key not configured');
    }
    const records = [];
    try {
        // Use Historical Current Conditions endpoint (Starter tier)
        const url = `${config.accuweatherBaseUrl}/currentconditions/v1/${locationKey}/historical/24`;
        console.log(`🌐 Calling AccuWeather Historical 24h API: ${url}`);
        console.log(`   Location: ${locationKey}`);
        const response = await axios.get(url, {
            params: {
                apikey: config.accuweatherApiKey,
                details: true,
            },
        });
        console.log(`   ✅ API response status: ${response.status}`);
        if (response.data && Array.isArray(response.data)) {
            console.log(`   📊 Received ${response.data.length} hourly observations`);
            for (const observation of response.data) {
                const precipSummary = observation.PrecipitationSummary;
                const pastHourMm = precipSummary?.PastHour?.Metric?.Value || 0;
                records.push({
                    dateTime: observation.LocalObservationDateTime,
                    precipitationMm: pastHourMm,
                    rawData: {
                        LocalObservationDateTime: observation.LocalObservationDateTime,
                        EpochTime: observation.EpochTime,
                        WeatherText: observation.WeatherText,
                        WeatherIcon: observation.WeatherIcon,
                        HasPrecipitation: observation.HasPrecipitation,
                        PrecipitationType: observation.PrecipitationType,
                        Temperature: observation.Temperature,
                        RelativeHumidity: observation.RelativeHumidity,
                        Wind: observation.Wind,
                        Visibility: observation.Visibility,
                        CloudCover: observation.CloudCover,
                        Pressure: observation.Pressure,
                        PrecipitationSummary: observation.PrecipitationSummary,
                        _extracted: {
                            pastHourMm,
                            fetchedAt: new Date().toISOString(),
                            locationKey,
                            source: 'historical/24',
                        }
                    }
                });
            }
            // Log summary
            const totalPrecip = records.reduce((sum, r) => sum + r.precipitationMm, 0);
            console.log(`   💧 Total precipitation over 24h: ${totalPrecip.toFixed(1)} mm`);
            console.log(`   📦 Created ${records.length} hourly records`);
        }
        else {
            console.log(`   ⚠️  Unexpected response format:`, typeof response.data);
        }
        return records;
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            const errorDetail = error.response?.data?.detail || error.message;
            console.error(`   ❌ AccuWeather API error: ${error.response?.status} - ${errorDetail}`);
            throw new Error(`AccuWeather API error: ${error.response?.status} - ${errorDetail}`);
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
