/**
 * AccuWeather precipitation data fetcher
 * 
 * Uses Current Conditions endpoint (available on Starter tier)
 * to fetch real-time precipitation data and build hourly buckets.
 */

import axios from 'axios';
import { config } from '../config.js';

/**
 * Precipitation record from AccuWeather
 */
export interface PrecipitationRecord {
  dateTime: string;     // ISO datetime
  precipitationMm: number;
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
export async function fetchPrecipitation(
  locationKey: string,
  startTime: number,
  endTime: number
): Promise<PrecipitationRecord[]> {
  if (!config.accuweatherApiKey) {
    throw new Error('AccuWeather API key not configured');
  }
  
  const records: PrecipitationRecord[] = [];
  
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
        records.push({
          dateTime: current.LocalObservationDateTime,
          precipitationMm: pastHourMm,
        });
        
        console.log(`   📦 Created record for ${current.LocalObservationDateTime}: ${pastHourMm}mm (past hour)`);
      } else {
        console.log(`   ⚠️  No precipitation summary in response`);
      }
    } else {
      console.log(`   ⚠️  Unexpected response format:`, typeof response.data);
    }
    
    console.log(`📊 Fetched ${records.length} precipitation records for location ${locationKey}`);
    return records;
    
  } catch (error) {
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
export async function fetchCurrentConditions(locationKey: string): Promise<CurrentConditionsData | null> {
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
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorDetail = error.response?.data?.detail || error.message;
      throw new Error(`AccuWeather API error: ${error.response?.status} - ${errorDetail}`);
    }
    throw error;
  }
}

/**
 * Resolve AccuWeather location key from coordinates
 * (Manila is cached, but this is here for future expansion)
 */
export async function resolveLocationKey(lat: number, lon: number): Promise<string> {
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
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`AccuWeather API error: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

