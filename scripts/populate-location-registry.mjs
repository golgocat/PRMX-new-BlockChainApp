#!/usr/bin/env node
/**
 * Populate V3 LocationRegistry with common locations
 * 
 * This script adds locations to the on-chain LocationRegistry via governance calls.
 * Each location requires an AccuWeather location key for weather data fetching.
 * 
 * Usage:
 *   node scripts/populate-location-registry.mjs [options]
 * 
 * Options:
 *   --ws-url <url>       WebSocket URL (default: ws://127.0.0.1:9944)
 *   --sudo               Use sudo to bypass governance (dev mode only)
 *   --dry-run            Show what would be added without submitting
 *   --locations <list>   Comma-separated location names to add (default: all)
 * 
 * Examples:
 *   # Add all locations via sudo (development)
 *   node scripts/populate-location-registry.mjs --sudo
 *   
 *   # Dry run to see locations
 *   node scripts/populate-location-registry.mjs --dry-run
 *   
 *   # Add specific locations only
 *   node scripts/populate-location-registry.mjs --sudo --locations "Manila,Tokyo"
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';

// ============================================================================
// Location Database
// ============================================================================
// AccuWeather location keys from: https://developer.accuweather.com/accuweather-locations-api/apis
// Coordinates are scaled by 1e6 (e.g., 14.599512 → 14599512)

const LOCATIONS = [
  // Philippines
  {
    name: 'Manila',
    accuweatherKey: '264885',
    latitude: 14599512,    // 14.599512
    longitude: 120984222,  // 120.984222
    country: 'Philippines',
    region: 'Southeast Asia',
  },
  {
    name: 'Cebu City',
    accuweatherKey: '262278',
    latitude: 10315699,
    longitude: 123885437,
    country: 'Philippines',
    region: 'Southeast Asia',
  },
  
  // Japan
  {
    name: 'Tokyo',
    accuweatherKey: '226396',
    latitude: 35689487,
    longitude: 139691711,
    country: 'Japan',
    region: 'East Asia',
  },
  {
    name: 'Osaka',
    accuweatherKey: '224436',
    latitude: 34693738,
    longitude: 135502165,
    country: 'Japan',
    region: 'East Asia',
  },
  
  // Singapore
  {
    name: 'Singapore',
    accuweatherKey: '300597',
    latitude: 1352083,
    longitude: 103819839,
    country: 'Singapore',
    region: 'Southeast Asia',
  },
  
  // Thailand
  {
    name: 'Bangkok',
    accuweatherKey: '318849',
    latitude: 13756331,
    longitude: 100501762,
    country: 'Thailand',
    region: 'Southeast Asia',
  },
  
  // Vietnam
  {
    name: 'Ho Chi Minh City',
    accuweatherKey: '353981',
    latitude: 10823099,
    longitude: 106629664,
    country: 'Vietnam',
    region: 'Southeast Asia',
  },
  {
    name: 'Hanoi',
    accuweatherKey: '353412',
    latitude: 21028511,
    longitude: 105804817,
    country: 'Vietnam',
    region: 'Southeast Asia',
  },
  
  // Indonesia
  {
    name: 'Jakarta',
    accuweatherKey: '208971',
    latitude: -6174465,
    longitude: 106845599,
    country: 'Indonesia',
    region: 'Southeast Asia',
  },
  
  // Malaysia
  {
    name: 'Kuala Lumpur',
    accuweatherKey: '233776',
    latitude: 3139003,
    longitude: 101686852,
    country: 'Malaysia',
    region: 'Southeast Asia',
  },
  
  // South Korea
  {
    name: 'Seoul',
    accuweatherKey: '226081',
    latitude: 37566535,
    longitude: 126977969,
    country: 'South Korea',
    region: 'East Asia',
  },
  
  // Taiwan
  {
    name: 'Taipei',
    accuweatherKey: '315078',
    latitude: 25032969,
    longitude: 121565418,
    country: 'Taiwan',
    region: 'East Asia',
  },
  
  // Hong Kong
  {
    name: 'Hong Kong',
    accuweatherKey: '1123655',
    latitude: 22396428,
    longitude: 114109497,
    country: 'Hong Kong',
    region: 'East Asia',
  },
  
  // India
  {
    name: 'Mumbai',
    accuweatherKey: '204842',
    latitude: 19075984,
    longitude: 72877656,
    country: 'India',
    region: 'South Asia',
  },
  {
    name: 'Chennai',
    accuweatherKey: '206671',
    latitude: 13082680,
    longitude: 80270721,
    country: 'India',
    region: 'South Asia',
  },
  
  // Australia
  {
    name: 'Sydney',
    accuweatherKey: '22889',
    latitude: -33868820,
    longitude: 151209296,
    country: 'Australia',
    region: 'Oceania',
  },
  {
    name: 'Brisbane',
    accuweatherKey: '24741',
    latitude: -27469771,
    longitude: 153025124,
    country: 'Australia',
    region: 'Oceania',
  },
  
  // USA (Hurricane/Typhoon prone)
  {
    name: 'Miami',
    accuweatherKey: '347936',
    latitude: 25761680,
    longitude: -80191790,
    country: 'USA',
    region: 'North America',
  },
  {
    name: 'Houston',
    accuweatherKey: '351197',
    latitude: 29760427,
    longitude: -95369804,
    country: 'USA',
    region: 'North America',
  },
  {
    name: 'New Orleans',
    accuweatherKey: '348585',
    latitude: 29951066,
    longitude: -90071532,
    country: 'USA',
    region: 'North America',
  },
];

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    wsUrl: 'ws://127.0.0.1:9944',
    useSudo: false,
    dryRun: false,
    locations: null, // null = all
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--ws-url':
        config.wsUrl = args[++i];
        break;
      case '--sudo':
        config.useSudo = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--locations':
        config.locations = args[++i].split(',').map(s => s.trim());
        break;
      case '--help':
      case '-h':
        console.log(`
V3 LocationRegistry Population Script

Usage:
  node scripts/populate-location-registry.mjs [options]

Options:
  --ws-url <url>       WebSocket URL (default: ws://127.0.0.1:9944)
  --sudo               Use sudo to bypass governance (dev mode only)
  --dry-run            Show what would be added without submitting
  --locations <list>   Comma-separated location names to add (default: all)

Examples:
  node scripts/populate-location-registry.mjs --sudo
  node scripts/populate-location-registry.mjs --dry-run
  node scripts/populate-location-registry.mjs --sudo --locations "Manila,Tokyo"

Available Locations:
${LOCATIONS.map(l => `  - ${l.name} (${l.country})`).join('\n')}
        `);
        process.exit(0);
    }
  }
  
  return config;
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  const config = parseArgs();
  
  console.log('═'.repeat(60));
  console.log('PRMX V3 LocationRegistry Population');
  console.log('═'.repeat(60));
  console.log(`Node URL: ${config.wsUrl}`);
  console.log(`Mode: ${config.dryRun ? 'DRY RUN' : config.useSudo ? 'SUDO' : 'GOVERNANCE'}`);
  console.log('');

  // Filter locations if specified
  let locationsToAdd = LOCATIONS;
  if (config.locations) {
    const requestedNames = config.locations.map(n => n.toLowerCase());
    locationsToAdd = LOCATIONS.filter(l => 
      requestedNames.includes(l.name.toLowerCase())
    );
    
    if (locationsToAdd.length === 0) {
      console.error('❌ No matching locations found');
      console.error('Available:', LOCATIONS.map(l => l.name).join(', '));
      process.exit(1);
    }
  }

  console.log(`📍 Locations to add (${locationsToAdd.length}):`);
  for (const loc of locationsToAdd) {
    console.log(`   - ${loc.name}, ${loc.country} (AccuWeather: ${loc.accuweatherKey})`);
  }
  console.log('');

  if (config.dryRun) {
    console.log('🔍 DRY RUN - No transactions will be submitted');
    console.log('');
    console.log('Location Details:');
    console.log('─'.repeat(60));
    for (const loc of locationsToAdd) {
      console.log(`Name: ${loc.name}`);
      console.log(`  AccuWeather Key: ${loc.accuweatherKey}`);
      console.log(`  Latitude: ${loc.latitude / 1e6}° (raw: ${loc.latitude})`);
      console.log(`  Longitude: ${loc.longitude / 1e6}° (raw: ${loc.longitude})`);
      console.log(`  Country: ${loc.country}`);
      console.log(`  Region: ${loc.region}`);
      console.log('');
    }
    process.exit(0);
  }

  // Connect to node
  console.log('🔌 Connecting to PRMX node...');
  const wsProvider = new WsProvider(config.wsUrl);
  const api = await ApiPromise.create({ provider: wsProvider });
  
  const chain = await api.rpc.system.chain();
  console.log(`✅ Connected to: ${chain.toString()}`);
  console.log('');

  // Get Alice account for sudo
  const keyring = new Keyring({ type: 'sr25519' });
  const alice = keyring.addFromUri('//Alice');
  console.log(`👤 Signer: ${alice.address}`);
  console.log('');

  // Check existing locations
  console.log('📊 Checking existing locations...');
  const nextLocationId = await api.query.prmxOracleV3.nextLocationId();
  console.log(`   Next Location ID: ${nextLocationId.toString()}`);
  
  // Query existing locations
  const existingLocations = await api.query.prmxOracleV3.locationRegistry.entries();
  const existingNames = new Set();
  for (const [key, value] of existingLocations) {
    if (value.isSome) {
      const loc = value.unwrap();
      const name = new TextDecoder().decode(new Uint8Array(loc.name));
      existingNames.add(name.toLowerCase());
      console.log(`   Existing: ID ${loc.locationId} - ${name}`);
    }
  }
  console.log('');

  // Filter out already existing locations
  const newLocations = locationsToAdd.filter(l => 
    !existingNames.has(l.name.toLowerCase())
  );

  if (newLocations.length === 0) {
    console.log('✅ All locations already exist in registry!');
    await api.disconnect();
    process.exit(0);
  }

  console.log(`📤 Adding ${newLocations.length} new locations...`);
  console.log('');

  // Submit transactions
  let successCount = 0;
  let failCount = 0;

  for (const loc of newLocations) {
    try {
      console.log(`   Adding: ${loc.name}...`);
      
      // Build the add_location call
      const addLocationCall = api.tx.prmxOracleV3.addLocation(
        loc.accuweatherKey,  // accuweather_key: Vec<u8>
        loc.latitude,         // latitude: i32
        loc.longitude,        // longitude: i32
        loc.name              // name: Vec<u8>
      );

      // Wrap in sudo if requested
      const tx = config.useSudo 
        ? api.tx.sudo.sudo(addLocationCall)
        : addLocationCall;

      // Submit and wait for finalization
      await new Promise((resolve, reject) => {
        tx.signAndSend(alice, { nonce: -1 }, ({ status, events, dispatchError }) => {
          if (dispatchError) {
            if (dispatchError.isModule) {
              const decoded = api.registry.findMetaError(dispatchError.asModule);
              reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`));
            } else {
              reject(new Error(dispatchError.toString()));
            }
          } else if (status.isInBlock) {
            console.log(`   ✅ ${loc.name} added (block: ${status.asInBlock.toHex().slice(0, 18)}...)`);
            successCount++;
            resolve();
          }
        });
      });

    } catch (error) {
      console.error(`   ❌ Failed to add ${loc.name}: ${error.message}`);
      failCount++;
    }
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log('Summary');
  console.log('═'.repeat(60));
  console.log(`✅ Successfully added: ${successCount}`);
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount}`);
  }
  console.log('');

  // Show final state
  const finalNextId = await api.query.prmxOracleV3.nextLocationId();
  console.log(`📊 Final Next Location ID: ${finalNextId.toString()}`);

  await api.disconnect();
  console.log('');
  console.log('Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

